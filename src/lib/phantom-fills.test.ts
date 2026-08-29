/**
 * A broken sender must not manufacture a fuel-theft case.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RJ21GE1657's tank sender alternates between roughly 25 L and 210 L on a 300 L
 * tank, holding each state for minutes at a time. Every upward leg has the
 * shape of a refuel, so the unlogged-fill detector reported TWENTY fills for
 * that one truck on a single day — 132 L, 179 L, 188 L, 190 L — around two
 * hundred thousand rupees of diesel that never moved.
 *
 * That screen is headed "fills the tank saw but nobody logged". It names the
 * vehicle and the day, and it is read by somebody deciding whether a driver
 * stole fuel. Twenty fabricated rows do not merely add noise; they manufacture
 * a case against a person.
 *
 * The displayed level was already withheld for this sender. Withholding the
 * level while still publishing its "fills" was the worse half of the bug left
 * in place — the number nobody acts on was hidden, and the list somebody acts
 * on was not.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { senderContradictsItself } from "./fuel-cache.ts";

/** RJ21GE1657, litres, oldest → newest, straight from the table. */
const BISTABLE = [25.0, 25.0, 209.2, 209.2, 212.0, 211.3, 209.9, 86.0, 28.1, 25.8, 209.9, 210.6];

describe("the sender that produced twenty phantom fills", () => {
  test("is recognised as contradicting itself", () => {
    assert.equal(senderContradictsItself(BISTABLE, 300), true);
  });

  test("each of its upward legs would otherwise look like a refuel", () => {
    // Why the detector believed it: the jumps are the size of real fills.
    const rises = BISTABLE.slice(1)
      .map((v, i) => v - BISTABLE[i]!)
      .filter((d) => d > 20);
    // Two of them in this twelve-sample slice, 184.2 L and 184.1 L — each the
    // size of a genuine tank fill, which is exactly why the detector believed
    // them. Over a full day there were twenty.
    assert.equal(rises.length, 2);
    assert.ok(Math.max(...rises) > 180, "each is the size of a full tank fill");
  });
});

describe("real events still get through, because suppressing them would be worse", () => {
  test("a 100 L fill is not suppressed", () => {
    assert.equal(senderContradictsItself([96, 95.2, 94.8, 210, 209.4, 208.9], 300), false);
  });

  test("a 150 L siphon is not suppressed", () => {
    // The event the whole system exists to catch.
    assert.equal(senderContradictsItself([240, 239.1, 238.4, 90, 89.2, 88.7], 300), false);
  });

  test("a fill followed later by ordinary burn is not suppressed", () => {
    // Rises then falls — but the fall is consumption-sized, not a contradiction.
    assert.equal(senderContradictsItself([100, 250, 244, 238, 232, 226], 300), false);
  });

  test("without a known tank size nothing is suppressed", () => {
    // No capacity means no way to judge the swing, and a silent exclusion is
    // worse than an unfiltered list — the fills would simply vanish.
    assert.equal(senderContradictsItself(BISTABLE, null), false);
  });
});
