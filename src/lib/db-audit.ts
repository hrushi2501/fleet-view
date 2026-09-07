import { Prisma } from "@prisma/client";
import { rawDb } from "./db";
import { recordSystemAudit } from "./audit-writer";

export type SchemaAlignmentReport = {
  totalModels: number;
  matchedModels: number;
  missingTables: string[];
  missingColumns: string[];
  synced: boolean;
};

export type SupabaseSecurityReport = {
  totalTables: number;
  rlsEnabledCount: number;
  policyCount: number;
  unsecuredTables: string[];
  anonGrants: { table: string; privilege: string }[];
  authenticatedGrants: { table: string; privilege: string }[];
  isZeroExposure: boolean;
};

export type DatabaseHealthReport = {
  connected: boolean;
  latencyMs: number;
  counts: {
    assets: number;
    users: number;
    activeSessions: number;
    telemetryReadings: number;
    auditEvents: number;
    settings: number;
  };
  rateLimitKeys: number;
};

export type DatabaseAuditResult = {
  timestamp: string;
  trigger: "CRON" | "MANUAL";
  schema: SchemaAlignmentReport;
  security: SupabaseSecurityReport;
  health: DatabaseHealthReport;
  prunedRateLimits: number;
  status: "OPTIMAL" | "ATTENTION_REQUIRED" | "CRITICAL";
  summary: string;
};

/**
 * Pure helper to verify schema alignment between Prisma models and DB columns.
 * Exported for deterministic unit testing.
 */
export function evaluateSchemaAlignment(
  models: readonly { name: string; dbName?: string | null; fields: readonly { kind: string; name: string; dbName?: string | null }[] }[],
  dbTableColumns: Map<string, Set<string>>,
): SchemaAlignmentReport {
  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  let matchedModels = 0;

  for (const model of models) {
    const table = model.dbName ?? model.name;
    const columns = dbTableColumns.get(table);
    if (!columns) {
      missingTables.push(table);
      continue;
    }

    let modelOk = true;
    for (const field of model.fields) {
      if (field.kind !== "scalar" && field.kind !== "enum") continue;
      const column = field.dbName ?? field.name;
      if (!columns.has(column)) {
        missingColumns.push(`${table}.${column}`);
        modelOk = false;
      }
    }

    if (modelOk) {
      matchedModels++;
    }
  }

  return {
    totalModels: models.length,
    matchedModels,
    missingTables,
    missingColumns,
    synced: missingTables.length === 0 && missingColumns.length === 0,
  };
}

/**
 * Checks that the live PostgreSQL schema matches every model and column expected by Prisma.
 */
export async function auditSchemaAlignment(): Promise<SchemaAlignmentReport> {
  const rows = await rawDb.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'`,
  );

  const dbTableColumns = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!dbTableColumns.has(row.table_name)) dbTableColumns.set(row.table_name, new Set());
    dbTableColumns.get(row.table_name)!.add(row.column_name);
  }

  return evaluateSchemaAlignment(Prisma.dmmf.datamodel.models, dbTableColumns);
}

/**
 * Verifies Supabase PostgREST permissions and Row Level Security state.
 * Confirms that public API roles (anon and authenticated) have zero access to tables.
 */
export async function auditSupabaseSecurity(): Promise<SupabaseSecurityReport> {
  const [grants, rlsRows, policyRows] = await Promise.all([
    rawDb.$queryRawUnsafe<Array<{ table_name: string; grantee: string; privilege_type: string }>>(
      `SELECT table_name, grantee, privilege_type
         FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')`,
    ),
    rawDb.$queryRawUnsafe<Array<{ tablename: string; relrowsecurity: boolean }>>(
      `SELECT t.tablename, c.relrowsecurity
         FROM pg_tables t
         JOIN pg_class c ON c.relname = t.tablename
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
        WHERE t.schemaname = 'public'
        ORDER BY t.tablename`,
    ),
    rawDb.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT count(*)::int as count FROM pg_policies WHERE schemaname = 'public'`,
    ),
  ]);

  const anonGrants = grants
    .filter((g) => g.grantee === "anon")
    .map((g) => ({ table: g.table_name, privilege: g.privilege_type }));

  const authenticatedGrants = grants
    .filter((g) => g.grantee === "authenticated")
    .map((g) => ({ table: g.table_name, privilege: g.privilege_type }));

  const unsecuredTables = rlsRows.filter((r) => !r.relrowsecurity).map((r) => r.tablename);
  const rlsEnabledCount = rlsRows.filter((r) => r.relrowsecurity).length;
  const policyCount = policyRows[0]?.count ?? 0;

  return {
    totalTables: rlsRows.length,
    rlsEnabledCount,
    policyCount,
    unsecuredTables,
    anonGrants,
    authenticatedGrants,
    isZeroExposure: anonGrants.length === 0 && authenticatedGrants.length === 0,
  };
}

/**
 * Measures database latency and checks operational table metrics.
 */
export async function auditDatabaseHealth(): Promise<DatabaseHealthReport> {
  const t0 = Date.now();
  await rawDb.$queryRaw`SELECT 1`;
  const latencyMs = Date.now() - t0;

  const [assets, users, activeSessions, telemetryReadings, auditEvents, settings, rateLimitRows] =
    await Promise.all([
      rawDb.asset.count(),
      rawDb.user.count(),
      rawDb.tripSession.count({ where: { status: "ACTIVE" } }),
      rawDb.telemetryReading.count(),
      rawDb.auditEvent.count(),
      rawDb.setting.count(),
      rawDb.setting.count({ where: { key: { startsWith: "rate-limit:" } } }),
    ]);

  return {
    connected: true,
    latencyMs,
    counts: {
      assets,
      users,
      activeSessions,
      telemetryReadings,
      auditEvents,
      settings,
    },
    rateLimitKeys: rateLimitRows,
  };
}

/**
 * Prunes expired rate-limiting transient keys from the Setting table.
 * Prevents continuous database bloat from serverless rate limit sliding windows.
 */
export async function pruneExpiredRateLimits(maxAgeMs: number = 30 * 60_000): Promise<{ prunedCount: number }> {
  const now = Date.now();
  const rows = await rawDb.setting.findMany({
    where: { key: { startsWith: "rate-limit:" } },
    select: { key: true, value: true },
  });

  const expiredKeys: string[] = [];
  for (const row of rows) {
    if (!row.value) {
      expiredKeys.push(row.key);
      continue;
    }
    try {
      const parsed = JSON.parse(row.value) as { requests?: unknown };
      if (!Array.isArray(parsed?.requests) || parsed.requests.length === 0) {
        expiredKeys.push(row.key);
        continue;
      }
      // Check if all timestamps are older than maxAgeMs
      const isAllOld = parsed.requests.every(
        (ts) => typeof ts !== "number" || now - ts > maxAgeMs,
      );
      if (isAllOld) {
        expiredKeys.push(row.key);
      }
    } catch {
      expiredKeys.push(row.key);
    }
  }

  if (expiredKeys.length > 0) {
    await rawDb.setting.deleteMany({
      where: { key: { in: expiredKeys } },
    });
  }

  return { prunedCount: expiredKeys.length };
}

/**
 * Executes a full database audit and records a durable SYSTEM_HEALTH audit event.
 * Runs periodically during cron jobs or on-demand from the admin console.
 */
export async function runPeriodicDatabaseAudit(
  trigger: "CRON" | "MANUAL" = "CRON",
  actor?: { id: string; name: string; role: string } | null,
): Promise<DatabaseAuditResult> {
  const [schema, security, health, prune] = await Promise.all([
    auditSchemaAlignment(),
    auditSupabaseSecurity(),
    auditDatabaseHealth(),
    pruneExpiredRateLimits(),
  ]);

  let status: "OPTIMAL" | "ATTENTION_REQUIRED" | "CRITICAL" = "OPTIMAL";
  if (!schema.synced || !health.connected) {
    status = "CRITICAL";
  } else if (!security.isZeroExposure || security.unsecuredTables.length > 0 || health.latencyMs > 500) {
    status = "ATTENTION_REQUIRED";
  }

  const summary = `Database Audit [${trigger}]: ${schema.matchedModels}/${schema.totalModels} models synced, latency ${health.latencyMs}ms, RLS ${security.rlsEnabledCount}/${security.totalTables} active, ${prune.prunedCount} stale rate-limits pruned (${status})`;

  await recordSystemAudit({
    action: "SYSTEM_HEALTH",
    module: "DATABASE",
    entity: "DatabaseAudit",
    summary,
    changes: {
      trigger,
      status,
      latencyMs: health.latencyMs,
      schema: {
        totalModels: schema.totalModels,
        matchedModels: schema.matchedModels,
        synced: schema.synced,
        missingTables: schema.missingTables,
        missingColumns: schema.missingColumns,
      },
      security: {
        isZeroExposure: security.isZeroExposure,
        rlsEnabled: `${security.rlsEnabledCount}/${security.totalTables}`,
        unsecuredTablesCount: security.unsecuredTables.length,
        anonGrantsCount: security.anonGrants.length,
        policyCount: security.policyCount,
      },
      counts: health.counts,
      prunedRateLimits: prune.prunedCount,
    },
    actor: actor ?? { id: "system", name: `System (${trigger})`, role: "System" },
  });

  return {
    timestamp: new Date().toISOString(),
    trigger,
    schema,
    security,
    health,
    prunedRateLimits: prune.prunedCount,
    status,
    summary,
  };
}
