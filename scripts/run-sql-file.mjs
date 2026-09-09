/** Runs an owner-approved SQL file without placing database credentials in the
 * process argument list. Local commands load `.env.local`; CI may provide the
 * same variables directly. Prisma's bundled executor keeps this portable on
 * developer machines that do not have `psql` installed. */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";

if (!process.env.DATABASE_URL_OWNER && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/run-sql-file.mjs <path.sql>");

// These scripts alter objects owned by `postgres`. Runtime traffic deliberately
// connects as `fleetview_app`, which must not receive owner privileges.
const requiresOwner = new Set([
  "enable-rls.sql",
  "supabase-schema-alignment.sql",
  "drop-redundant-hire-log-index.sql",
]);
const runtimeUrl = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();

/** Builds a direct postgres-owner URL only when an operator deliberately
 * supplies the Supabase database password. The password is never logged. */
function ownerUrlFromSupabasePassword() {
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  if (!password || !runtimeUrl) return null;
  const runtime = new URL(runtimeUrl);
  const usernameParts = decodeURIComponent(runtime.username).split(".");
  const projectRef = usernameParts.length > 1
    ? usernameParts.at(-1)
    : runtime.hostname.match(/^db\.([^.]+)\.supabase\.co$/)?.[1];
  if (!projectRef) return null;
  const owner = new URL(`postgresql://postgres@db.${projectRef}.supabase.co:5432/postgres`);
  owner.password = password;
  owner.searchParams.set("sslmode", "require");
  return owner.toString();
}

const ownerUrl = process.env.DATABASE_URL_OWNER?.trim() || ownerUrlFromSupabasePassword();
if (requiresOwner.has(basename(file)) && !ownerUrl) {
  throw new Error(
    `${basename(file)} changes table-owned PostgreSQL objects. Set DATABASE_URL_OWNER (or SUPABASE_DB_PASSWORD with DATABASE_URL) for this one-off operator command, or run the SQL in the Supabase Dashboard SQL Editor as postgres.`,
  );
}

// DDL such as RLS policies must be applied by the table owner. Runtime traffic
// deliberately uses the restricted application role. DATABASE_URL_OWNER is
// intentionally opt-in and mandatory for table-owned RLS policy changes.
const configured = ownerUrl || runtimeUrl;
if (!configured) throw new Error("DATABASE_URL_OWNER or DATABASE_URL_UNPOOLED is required.");

const url = new URL(configured);
// A verifier only reads catalog tables, so keep it on the normal pooler. The
// direct Supabase endpoint is often intentionally private and was making the
// verifier fail before it could report the actual RLS state. Owner-only DDL
// still uses the explicitly supplied owner URL and may be rewritten to its
// direct endpoint when needed.
if (requiresOwner.has(basename(file)) && url.hostname.endsWith(".pooler.supabase.com")) {
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
