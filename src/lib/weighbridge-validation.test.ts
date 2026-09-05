import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateWeighbridgeWeights, MAX_REASONABLE_GROSS_KG } from "./weighbridge";

describe("Weighbridge Validation Bounds", () => {
  test("accepts valid gross and tare weights and derives netKg", () => {
    const res = validateWeighbridgeWeights({ grossKg: 42_000, tareKg: 14_000 });
    assert.equal(res.valid, true);
    assert.equal(res.error, undefined);
    assert.equal(res.computedNetKg, 28_000);
  });

  test("rejects explicit netKg inconsistent with measured gross and tare", () => {
    const res = validateWeighbridgeWeights({ grossKg: 42_000, tareKg: 14_000, netKg: 27_900 });
    assert.equal(res.valid, false);
    assert.match(res.error!, /gross minus tare/);
  });

  test("rejects non-finite weights and negative net without silently deriving a replacement", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      assert.equal(validateWeighbridgeWeights({ grossKg: bad, tareKg: 0 }).valid, false);
      assert.equal(validateWeighbridgeWeights({ grossKg: 100, tareKg: 0, netKg: bad }).valid, false);
    }
    assert.equal(validateWeighbridgeWeights({ grossKg: 100, tareKg: 0, netKg: -1 }).valid, false);
    assert.equal(validateWeighbridgeWeights({ grossKg: 0, tareKg: 10 }).valid, false);
  });

  test("rejects negative gross weight", () => {
    const res = validateWeighbridgeWeights({ grossKg: -100, tareKg: 12_000 });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("cannot be negative"));
  });

  test("rejects negative tare weight", () => {
    const res = validateWeighbridgeWeights({ grossKg: 20_000, tareKg: -500 });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("cannot be negative"));
  });

  test("rejects gross weight less than tare weight", () => {
    const res = validateWeighbridgeWeights({ grossKg: 10_000, tareKg: 15_000 });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("cannot be less than empty tare weight"));
  });

  test("rejects unrealistic gross weight exceeding maximum limit", () => {
    const res = validateWeighbridgeWeights({ grossKg: MAX_REASONABLE_GROSS_KG + 100, tareKg: 15_000 });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("exceeds maximum permissible threshold"));
  });

  test("rejects unrealistic tare weight exceeding maximum limit", () => {
    const res = validateWeighbridgeWeights({ grossKg: 120_000, tareKg: MAX_REASONABLE_GROSS_KG + 1 });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("exceeds maximum permissible threshold"));
  });
});
