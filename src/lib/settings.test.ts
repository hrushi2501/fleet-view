import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseDieselRate } from "./settings";

describe("diesel-rate settings", () => {
  test("keeps a valid positive configured rate", () => {
    assert.equal(parseDieselRate("97.45"), 97.45);
  });

  test("falls back safely for absent, non-finite, or non-positive values", () => {
    for (const value of [undefined, null, "", "NaN", Infinity, 0, -1]) {
      assert.equal(parseDieselRate(value), 92.5);
    }
  });
});
