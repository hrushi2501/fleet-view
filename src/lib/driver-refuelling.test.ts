import assert from "node:assert/strict";
import { test } from "node:test";
import { driverFuelDetails } from "./driver-refuelling";

test("a driver fuel amount becomes a reconciled per-litre rate", () => {
  assert.deepEqual(driverFuelDetails(42.5, 4_080), { amount: 4_080, rate: 96 });
  assert.deepEqual(driverFuelDetails(33.3, 3_080.25), { amount: 3_080.25, rate: 92.5 });
});

test("a driver fuel record can be reconciled without camera evidence", () => {
  // Photos are useful forensic evidence, not a prerequisite for recording a
  // real-world fill when a low-end phone has no usable camera or signal.
  assert.deepEqual(driverFuelDetails(20, 1_900), { amount: 1_900, rate: 95 });
});

test("a malformed or implausible fuel amount is refused", () => {
  assert.throws(() => driverFuelDetails(0, 1), /quantity/i);
  assert.throws(() => driverFuelDetails(10, 0), /amount/i);
  assert.throws(() => driverFuelDetails(10, 5_001), /plausible/i);
});
