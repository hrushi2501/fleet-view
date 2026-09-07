import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { requireApi } from "@/lib/access";
import {
  auditSchemaAlignment,
  auditSupabaseSecurity,
  auditDatabaseHealth,
  runPeriodicDatabaseAudit,
} from "@/lib/db-audit";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";
import { requireSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/db-audit
 *
 * Reads live database status, schema alignment against Prisma DMMF,
 * Supabase PostgREST security posture, and database ping latency.
 */
async function handleGET() {
  const auth = await requireApi("admin.audit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [schema, security, health] = await Promise.all([
    auditSchemaAlignment(),
    auditSupabaseSecurity(),
    auditDatabaseHealth(),
  ]);

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    schema,
    security,
    health,
  });
}

/**
 * POST /api/admin/db-audit
 *
 * Triggers a full database audit sweep, prunes expired rate limit rows,
 * and writes a durable SYSTEM_HEALTH event to the AuditEvent log.
 */
async function handlePOST(req: Request) {
  const auth = await requireApi("admin.settings");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  requireSameOrigin(req);

  const limit = await reserveRateLimit({
    scope: "admin-db-audit",
    subject: auth.access.session.id,
    limit: 6,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return rateLimitResponse(limit.retryInSeconds, "Too many audit triggers. Please wait a moment.");
  }

  const result = await runPeriodicDatabaseAudit("MANUAL", {
    id: auth.access.session.id,
    name: auth.access.session.name,
    role: auth.access.session.role,
  });

  return NextResponse.json({ ok: true, ...result });
}

export const GET = withApiErrors(handleGET);
export const POST = withApiErrors(handlePOST);
