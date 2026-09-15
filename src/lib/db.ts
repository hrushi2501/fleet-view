import { PrismaClient } from "@prisma/client";
import { auditExtension } from "./audit-extension";
import { fuelEvidenceSchemaCompatExtension } from "./fuel-evidence-schema-compat";

/**
 * Build a runtime-safe connection URL.
 *
 * Both Neon and Supabase front their databases with a transaction-mode pooler
 * (PgBouncer / Supavisor). Prisma must disable prepared statements against those
 * or it throws intermittent "prepared statement already exists" errors under
 * serverless concurrency — the kind of fault that passes every test and then
 * fails one request in fifty in production.
 *
 * The host spelling differs by vendor, so match loosely:
 *   Neon      ep-xxx-pooler.region.aws.neon.tech
 *   Supabase  aws-0-region.pooler.supabase.com  (port 6543 = transaction mode)
 */
function resolveDbUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  let finalUrl = url;
  const setParam = (name: string, value: string) => {
    const parsed = new URL(finalUrl);
    parsed.searchParams.set(name, value);
    finalUrl = parsed.toString();
  };
  const param = (name: string) => new URL(finalUrl).searchParams.get(name);
  const isPooled = finalUrl.includes("pgbouncer") || finalUrl.includes(":6543");
  if (isPooled && param("pgbouncer") !== "true") setParam("pgbouncer", "true");

  // Keep the per-instance pool deliberately small, but do not default it to one.
  // Most pages start several independent reads together. With one connection,
  // Prisma serializes that work and every Supabase round trip is added to the
  // navigation time. Three production connections preserve a bounded pool while
  // allowing ordinary RSC reads to overlap; local development keeps five.
  // PRISMA_CONNECTION_LIMIT remains the explicit escape hatch for deployments
  // whose database connection budget requires a different value.
  const requestedLimit = process.env.PRISMA_CONNECTION_LIMIT?.trim();
  const configuredLimit = Number(param("connection_limit"));
  const runtimeMinimum = process.env.NODE_ENV === "production" ? 3 : 5;
  const connectionLimit = requestedLimit
    || (!Number.isFinite(configuredLimit) || configuredLimit < runtimeMinimum
      ? String(runtimeMinimum)
      : null);
  if (connectionLimit) setParam("connection_limit", connectionLimit);
  // A short pool timeout turns a brief queue behind one slower query into a
  // failed RSC response, leaving the browser on its loading skeleton. Give
  // queued work a realistic window to acquire one of the configured slots.
  if (!param("pool_timeout")) setParam("pool_timeout", "30");
  process.env.DATABASE_URL = finalUrl;
  return finalUrl;
}

const resolvedUrl = resolveDbUrl();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The unextended client.
 *
 * Exported for one purpose: writing audit rows. Going through the extended
 * client below to record an audit event would audit the audit write, so the
 * logger has to sit underneath the extension rather than inside it.
 */
export const rawDb =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: resolvedUrl,
    log: process.env.NODE_ENV === "development" ? ["error"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = rawDb;

/**
 * The client the application uses.
 *
 * Extended so that a write to a business model leaves an audit row without the
 * caller having to remember. See `audit-extension.ts` for what that covers and,
 * more importantly, what it deliberately does not.
 */
// Keep the compatibility retry outside the audit extension. A fuel write is
// audited only after its retried database operation succeeds, never after the
// initial rejected attempt against an older schema.
export const db = rawDb
  .$extends(auditExtension)
  .$extends(fuelEvidenceSchemaCompatExtension) as unknown as PrismaClient;
