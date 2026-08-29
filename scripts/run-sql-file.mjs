/** Runs an owner-approved SQL file without placing database credentials in the
 * process argument list. Local commands load `.env.local`; CI may provide the
 * same variables directly. Prisma's bundled executor keeps this portable on
 * developer machines that do not have `psql` installed. */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL_UNPOOLED && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/run-sql-file.mjs <path.sql>");

const configured = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!configured) throw new Error("DATABASE_URL_UNPOOLED is required.");

const url = new URL(configured);
if (url.hostname.endsWith(".pooler.supabase.com")) {
  const [role, projectRef] = decodeURIComponent(url.username).split(".");
  if (role && projectRef) {
    url.hostname = `db.${projectRef}.supabase.co`;
    url.port = "5432";
    url.username = role;
  }
}

const directUrl = url.toString();
const result = spawnSync(process.execPath, [
  "node_modules/prisma/build/index.js",
  "db",
  "execute",
  "--file",
  file,
  "--schema",
  "prisma/schema.prisma",
], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: directUrl,
    DATABASE_URL_UNPOOLED: directUrl,
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
