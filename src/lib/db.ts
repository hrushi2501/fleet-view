import { PrismaClient } from "@prisma/client";

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
  const isPooled =
    url.includes("pgbouncer") || url.includes(":6543");
  if (!isPooled || url.includes("pgbouncer=true")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}pgbouncer=true`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: resolveDbUrl(),
    log: process.env.NODE_ENV === "development" ? ["error"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
