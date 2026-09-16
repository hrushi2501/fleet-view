import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fuelHeadline } from "./fuel-headline";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("fuel record headline totals", () => {
  test("two recorded entries remain 245.5 L even beside a 237 L sensor observation", () => {
    const headline = fuelHeadline(
      { litres: 230 + 15.5, spend: 21_275 + 1_434, entries: 2 },
      { litres: 237, fills: 1 },
    );

    assert.deepEqual(headline.recorded, { litres: 245.5, spend: 22_709, entries: 2 });
    assert.deepEqual(headline.sensorOnly, { litres: 237, fills: 1 });
    assert.equal("totalLitres" in headline, false, "the view model must not offer an ambiguous combined total");
  });

  test("the records headline uses all persisted entries, not the bounded history table", () => {
    const records = source("../app/(app)/fuel/_sections/FuelRecords.tsx");

    assert.match(records, /fuelTransaction\.aggregate\(\{/);
    assert.match(records, /_sum:\s*\{\s*quantity:\s*true,\s*amount:\s*true\s*\}/);
    assert.match(records, /value=\{`\$\{num\(headline\.recorded\.litres\)\} L`\}/);
    assert.doesNotMatch(records, /headline\.recorded\.litres\s*\+\s*headline\.sensorOnly\.litres/);
  });

  test("sensor-only observations stay separate from the recorded overview total", () => {
    const overview = source("../app/(app)/fuel/_sections/Overview.tsx");

    assert.match(overview, /value=\{`\$\{num\(headline\.recorded\.litres\)\} L`\}/);
    assert.doesNotMatch(overview, /headline\.recorded\.litres\s*\+\s*headline\.sensorOnly\.litres/);
  });
});
