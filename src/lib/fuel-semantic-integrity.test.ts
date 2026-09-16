import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("asset detail withholds operational fuel claims when sender evidence is unresolved", () => {
  const api = source("../app/api/assets/[id]/route.ts");
  const card = source("../components/AssetGlass.tsx");
  const queries = source("./query-hooks.ts");

  assert.match(api, /const fuelAssessed = usage\.fuelResolution === "RESOLVED" && !usage\.insufficientData/);
  assert.match(api, /refuels: \(fuelAssessed \? usage\.diagnostics\.fuel\.refuels : \[\]\)/);
  assert.match(api, /event: fuelAssessed \? s\.event : "UNRESOLVED"/);
  assert.match(api, /fuelLevelPct: fuelAssessed \? latest\.fuelLevelPct : null/);
  assert.match(card, /sender readings conflict; level not assessed/);
  assert.match(card, /f\.sensorRise > 0 \? "Within range" : "Not assessed"/);
  assert.match(queries, /fetch\(`\/api\/assets\/\$\{encodeURIComponent\(assetId\)\}`, \{ cache: "no-store" \}\)/);
  assert.match(queries, /refetchOnMount: "always"/);
});

test("live tracking withholds a tank gauge for an unresolved sender", () => {
  const live = source("./fleet-edge-live.ts");

  assert.match(live, /const fuelAssessed = usage\.fuelResolution === "RESOLVED"/);
  assert.match(live, /const fuelLitres = fuelAssessed \? latest\?\.fuelLevelL \?\? null : null/);
  assert.match(live, /const fuelPct = fuelAssessed/);
  assert.match(live, /invalidatePrefix\("telemetry:fleet-usage:"\)/);
  assert.match(live, /invalidatePrefix\("fuel:detected-fills:"\)/);
  assert.match(live, /invalidatePrefix\("fuel:daily-fills:"\)/);
});

test("fuel summaries distinguish not assessed from a measured zero", () => {
  const api = source("../app/api/fuel/route.ts");
  const dashboard = source("../app/(app)/page.tsx");
  const overview = source("../app/(app)/fuel/_sections/Overview.tsx");
  const queue = source("../app/(app)/fuel/problems/_sections/ProblemQueue.tsx");
  const patterns = source("../app/(app)/fuel/problems/_sections/FuelInsights.tsx");
  const actionCenter = source("../components/MorningActionCenter.tsx");

  assert.match(api, /litresBurned: a\.usage\.insufficientData \? null : a\.usage\.litresBurned/);
  assert.match(api, /fuelResolution: a\.usage\.fuelResolution/);
  assert.match(dashboard, /const assessedFuelIssues = fuelIssues\.filter/);
  assert.match(dashboard, /value=\{fuelLossPct == null \? "—"/);
  assert.match(overview, /not assessed; nightly check overdue/);
  assert.match(overview, /not assessed across all vehicles/);
  assert.match(queue, /This does not mean every vehicle or tank was assessed/);
  assert.match(patterns, /available: boolean/);
  assert.match(patterns, /r\.status !== "insufficient"/);
  assert.match(patterns, /not assessed; two dips required/);
  assert.match(patterns, /r\.status === "insufficient" \? "—"/);
  assert.doesNotMatch(actionCenter, /Fleet Optimal|Telemetry healthy/);
  assert.match(actionCenter, /No open priorities/);
});
