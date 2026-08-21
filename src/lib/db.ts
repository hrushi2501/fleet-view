import { PrismaClient } from "@prisma/client";
import { auditExtension } from "./audit-extension";

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
  const isPooled = finalUrl.includes("pgbouncer") || finalUrl.includes(":6543");
  if (isPooled && !finalUrl.includes("pgbouncer=true")) {
    const sep = finalUrl.includes("?") ? "&" : "?";
    finalUrl = `${finalUrl}${sep}pgbouncer=true`;
  }
  if (!finalUrl.includes("connection_limit=")) {
    const sep = finalUrl.includes("?") ? "&" : "?";
    finalUrl = `${finalUrl}${sep}connection_limit=10&pool_timeout=30`;
  }
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
export const db = rawDb.$extends(auditExtension) as unknown as PrismaClient;
