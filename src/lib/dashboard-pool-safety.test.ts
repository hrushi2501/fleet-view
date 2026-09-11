import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("dashboard reads do not fan out against the one-connection production pool", () => {
  const dashboard = source("../app/(app)/page.tsx");
  const layout = source("../app/(app)/layout.tsx");
  const fleetUsage = source("./fleet-usage.ts");

  assert.match(dashboard, /await db\.\$transaction\(\[/);
  assert.doesNotMatch(dashboard, /await Promise\.all\(\[/);
  assert.doesNotMatch(layout, /getNotificationFeed/);
  assert.match(fleetUsage, /await db\.\$transaction\(\[/);
  assert.doesNotMatch(fleetUsage, /await Promise\.all\(\[/);
});

test("authorization is deduplicated for the layout and page in one request", () => {
  const access = source("./access.ts");
  assert.match(access, /export const getAccess = cache\(resolveAccess\)/);
});

test("the database URL gives local development safe pool headroom and a realistic queue timeout", () => {
  const database = source("./db.ts");
  assert.match(database, /PRISMA_CONNECTION_LIMIT/);
  assert.match(database, /localMinimum = process\.env\.NODE_ENV === "production" \? 1 : 5/);
  assert.match(database, /setParam\("pool_timeout", "30"\)/);
});

test("tracking reads share a transaction, coalesce duplicate polls, and hydrate deterministically", () => {
  const liveFleet = source("./fleet-edge-live.ts");
  const tata = source("./tata-fleet-edge.ts");
  const console = source("../components/FleetEdgeConsole.tsx");

  assert.match(liveFleet, /const liveFleetInFlight = new Map/);
  assert.match(liveFleet, /await db\.\$transaction\(\[/);
  assert.doesNotMatch(liveFleet, /await Promise\.all\(\[/);
  assert.match(tata, /const \[provider, lastReading, activeVehicles, totalReadings\] = await db\.\$transaction\(\[/);
  assert.match(console, /const initialNow = Date\.parse\(initial\.generatedAt\)/);
  assert.doesNotMatch(console, /useState\(\(\) => Date\.now\(\)\)/);
});
