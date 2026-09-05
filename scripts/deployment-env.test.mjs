import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDeploymentEnv } from "./deployment-env.mjs";

const valid = {
  VERCEL: "1", VERCEL_ENV: "production",
  DATABASE_URL: "postgresql://app.project:test-secret@aws-0.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1",
  AUTH_SECRET: "a".repeat(48), CRON_SECRET: "b".repeat(48),
};
test("minimal production settings pass without owner credentials", () => {
  assert.deepEqual(validateDeploymentEnv(valid).errors, []);
});
test("missing required settings fail with names, never secret values", () => {
  assert.equal(validateDeploymentEnv({}).errors.length, 3);
  const bad = { ...valid, DATABASE_URL: "invalid-private-value", AUTH_SECRET: "private-value" };
  const messages = JSON.stringify(validateDeploymentEnv(bad));
  assert.ok(!messages.includes("private-value"));
});
test("pooler requires its prepared-statement compatibility flag", () => {
  assert.ok(validateDeploymentEnv({ ...valid, DATABASE_URL: valid.DATABASE_URL.replace("pgbouncer=true", "pgbouncer=false") }).errors.length);
});
test("rejects sample credentials, short and shared secrets", () => {
  assert.ok(validateDeploymentEnv({ ...valid, DATABASE_URL: "postgresql://USER:PASSWORD@HOST:6543/postgres" }).errors.length);
  assert.ok(validateDeploymentEnv({ ...valid, CRON_SECRET: "short" }).errors.length);
  assert.ok(validateDeploymentEnv({ ...valid, CRON_SECRET: valid.AUTH_SECRET }).errors.length);
});
test("enabled telemetry must have credentials; disabled telemetry is optional", () => {
  assert.equal(validateDeploymentEnv({ ...valid, TATA_FLEET_EDGE_ENABLED: "true" }).errors.length, 2);
  assert.deepEqual(validateDeploymentEnv({ ...valid, TATA_FLEET_EDGE_ENABLED: "false" }).errors, []);
});
test("rejects background timers and insecure webhooks", () => {
  assert.equal(validateDeploymentEnv({ ...valid, TATA_PUSH_TRUST_ANY: "true", TATA_FLEET_EDGE_AUTO_SYNC: "true" }).errors.length, 2);
});
test("previews need database and session settings, but no production cron secret", () => {
  assert.deepEqual(validateDeploymentEnv({ ...valid, VERCEL_ENV: "preview", CRON_SECRET: undefined }).errors, []);
});
test("optional integrations produce actionable warnings", () => {
  const { warnings } = validateDeploymentEnv({ ...valid, VAPID_PRIVATE_KEY: "configured" });
  assert.equal(warnings.length, 3);
});
