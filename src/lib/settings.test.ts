import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fuelRateFor, normalizeFuelType, parseDieselRate } from "./settings";

describe("diesel-rate settings", () => {
  test("keeps a valid positive configured rate", () => {
    assert.equal(parseDieselRate("97.45"), 97.45);
  });

  test("leaves absent, non-finite, or non-positive values unpriced", () => {
    for (const value of [undefined, null, "", "NaN", Infinity, 0, -1]) {
      assert.equal(parseDieselRate(value), null);
    }
  });

  test("normalizes fuel names without guessing from vehicle class", () => {
    assert.equal(normalizeFuelType("HSD"), "DIESEL");
    assert.equal(normalizeFuelType("petrol"), "PETROL");
    assert.equal(normalizeFuelType("CNG"), null);
    assert.equal(normalizeFuelType(undefined), null);
  });

  test("selects the configured rate for the asset fuel type", () => {
    const rates = { DIESEL: 97.46, PETROL: 113.2 };
    assert.equal(fuelRateFor("DIESEL", rates), 97.46);
    assert.equal(fuelRateFor("PETROL", rates), 113.2);
    assert.equal(fuelRateFor(null, rates), null);
  });
});
