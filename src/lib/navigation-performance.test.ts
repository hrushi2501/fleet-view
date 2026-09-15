import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("nonce proxy skips Next link prefetch requests", () => {
  const proxy = source("../proxy.ts");

  assert.match(proxy, /missing:\s*\[/);
  assert.match(proxy, /key:\s*["']next-router-prefetch["']/);
  assert.match(proxy, /key:\s*["']purpose["'],\s*value:\s*["']prefetch["']/);
});

test("consolidated async tabs stream through keyed section boundaries", () => {
  const pages = [
    "../app/(app)/fleet/page.tsx",
    "../app/(app)/fuel/problems/page.tsx",
    "../app/(app)/fuel/tanks/page.tsx",
    "../app/(app)/people/attendance/page.tsx",
    "../app/(app)/people/page.tsx",
    "../app/(app)/people/payroll/page.tsx",
  ];

  for (const page of pages) {
    const contents = source(page);
    assert.match(contents, /<Suspense key=\{(?:tab|`\$\{tab\}:\$\{period\}`)\}/, `${page} must reset its section fallback when the tab changes`);
    assert.match(contents, /fallback=\{<ModuleSectionLoading/, `${page} must stream a section loading state`);
  }
});

test("interactive fuel tabs keep telemetry analysis inside a one-day request window", () => {
  const overview = source("../app/(app)/fuel/_sections/Overview.tsx");
  const records = source("../app/(app)/fuel/_sections/FuelRecords.tsx");

  assert.match(overview, /const liveWindowDays = 1/);
  assert.match(overview, /fleetUsage\(liveWindowDays, visible\)/);
  assert.match(overview, /getDetectedFills\(visible, rate, liveWindowDays\)/);
  assert.match(records, /getDetectedFills\(visible, rate, 1\)/);
  assert.doesNotMatch(overview, /fleetUsage\((?:14|30), visible\)/);
  assert.doesNotMatch(records, /getDetectedFills\(visible, rate, 14\)/);
});
