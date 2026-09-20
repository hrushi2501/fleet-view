import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("fuel-rate settings never report a rejected server action as saved", () => {
  const forms = source("../components/EntryForms.tsx");
  assert.match(forms, /const result = await setFuelRates\(fd\)/);
  assert.match(forms, /if \(isActionError\(result\)\)[\s\S]*Failed to update fuel rates/);
});

test("unpriced fuel findings say that their monetary value is unavailable", () => {
  const aiFraud = source("./ai-fraud.ts");
  const theftScan = source("./fuel-theft-scan.ts");

  assert.match(aiFraud, /Value at risk is not priced because fuel configuration is incomplete/);
  assert.match(theftScan, /Monetary value not calculated: asset fuel type or its current rate is not configured/);
});

test("the nightly scan resolves configured rates once and selects by asset fuel type", () => {
  const theftScan = source("./fuel-theft-scan.ts");
  assert.match(theftScan, /const fuelRates = await getFuelRates\(\)/);
  assert.match(theftScan, /fuelRateFor\(asset\.fuelType, fuelRates\)/);
  assert.doesNotMatch(theftScan, /await getFuelRate\(asset\.fuelType\)/);
});
