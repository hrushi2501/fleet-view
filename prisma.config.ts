import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Next loads `.env.local` automatically, while the Prisma CLI does not. Load it
// only for local commands and never overwrite variables supplied by Vercel/CI.
if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required. Set it in .env.local or the deployment environment.");
  return value;
}

/**
 * Supabase's pooled and direct URLs use different hosts and usernames. The
 * existing local file historically copied the pooled URL into both variables,
 * which made schema commands hang behind PgBouncer. Normalise that legacy value
 * in memory; a correctly configured direct URL is returned unchanged.
 */
function directDatabaseUrl(runtimeUrl: string): string {
  const configured = process.env.DATABASE_URL_UNPOOLED?.trim() || runtimeUrl;
  const url = new URL(configured);
  if (!url.hostname.endsWith(".pooler.supabase.com")) return configured;

  const [role, projectRef] = decodeURIComponent(url.username).split(".");
  if (!role || !projectRef) return configured;

  url.hostname = `db.${projectRef}.supabase.co`;
  url.port = "5432";
  url.username = role;
  url.searchParams.delete("pgbouncer");
  url.searchParams.delete("connection_limit");
  url.searchParams.delete("pool_timeout");
  return url.toString();
}

const runtimeUrl = requiredDatabaseUrl();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.mjs",
  },
  engine: "classic",
  datasource: {
    url: runtimeUrl,
    directUrl: directDatabaseUrl(runtimeUrl),
  },
});
