import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("fuel record headline totals", () => {
  test("the records headline uses all persisted entries, not the bounded history table", () => {
    const records = source("../app/(app)/fuel/_sections/FuelRecords.tsx");

    assert.match(records, /fuelTransaction\.aggregate\(\{/);
    assert.match(records, /_sum:\s*\{\s*quantity:\s*true,\s*amount:\s*true\s*\}/);
    assert.match(records, /value=\{`\$\{num\(totalLitres\)\} L`\}/);
    assert.doesNotMatch(records, /num\(totalLitres\s*\+\s*unloggedLitres\)/);
  });

  test("sensor-only observations stay separate from the recorded overview total", () => {
    const overview = source("../app/(app)/fuel/_sections/Overview.tsx");

    assert.match(overview, /value=\{`\$\{num\(fleet\.totalLitres\)\} L`\}/);
    assert.doesNotMatch(overview, /num\(fleet\.totalLitres\s*\+\s*unloggedLitres\)/);
  });
});
