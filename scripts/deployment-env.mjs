/** Validate configuration without connecting to or changing any service. Never print values. */
export function validateDeploymentEnv(env) {
  const errors = [];
  const warnings = [];
  const present = key => Boolean(env[key]?.trim());
  if (!present("DATABASE_URL")) errors.push("Set DATABASE_URL to the Supabase transaction-pooler URL.");
  else {
    try {
      const url = new URL(env.DATABASE_URL);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password) {
        errors.push("DATABASE_URL must be a PostgreSQL connection URL with credentials.");
      }
      if (["HOST", "USER", "PASSWORD"].some(value => [url.hostname.toUpperCase(), url.username, url.password].includes(value))) {
        errors.push("Replace the placeholder credentials in DATABASE_URL.");
      }
      if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543" && url.searchParams.get("pgbouncer") !== "true") {
        errors.push("Add pgbouncer=true to the Supabase transaction-pooler URL.");
      }
      if (env.VERCEL && url.hostname.endsWith(".pooler.supabase.com") && !url.searchParams.has("connection_limit")) {
        warnings.push("Set connection_limit=1 in DATABASE_URL to bound serverless database connections.");
      }
    } catch { errors.push("DATABASE_URL is not a valid connection URL."); }
  }
  if (Buffer.byteLength(env.AUTH_SECRET?.trim() ?? "") < 32) errors.push("Set AUTH_SECRET to a unique random secret of at least 32 bytes.");
  if (env.VERCEL_ENV !== "preview" && Buffer.byteLength(env.CRON_SECRET?.trim() ?? "") < 32) {
    errors.push("Set CRON_SECRET to a separate random secret of at least 32 bytes for scheduled jobs.");
  }
  if (present("AUTH_SECRET") && env.AUTH_SECRET === env.CRON_SECRET) errors.push("AUTH_SECRET and CRON_SECRET must be different secrets.");
  if (env.TATA_FLEET_EDGE_ENABLED === "true") {
    for (const key of ["TATA_FLEET_EDGE_CLIENT_ID", "TATA_FLEET_EDGE_CLIENT_SECRET"]) {
      if (!present(key)) errors.push(`Fleet Edge is enabled: set ${key}.`);
    }
  }
  if (env.TATA_PUSH_TRUST_ANY === "true") errors.push("Remove TATA_PUSH_TRUST_ANY: production webhooks reject this insecure setting.");
  if (env.TATA_FLEET_EDGE_AUTO_SYNC === "true") errors.push("Remove TATA_FLEET_EDGE_AUTO_SYNC: Vercel Cron owns scheduled syncing.");
  if (!present("BLOB_READ_WRITE_TOKEN")) warnings.push("Connect a private Vercel Blob store to enable evidence and document uploads.");
  if (!present("GOOGLE_GENERATIVE_AI_API_KEY")) warnings.push("Photo reading is unavailable; drivers can enter readings manually.");
  const pushKeys = ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
  if (pushKeys.some(present) && !pushKeys.every(present)) warnings.push("Browser push needs all three VAPID settings; see .env.example.");
  return { errors, warnings };
}
