/**
 * One refuel is reported as one fill, not as one per sensor sample.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS PINS
 *
 * A nozzle in a tank raises the level continuously. A sender reporting once a
 * minute sees a staircase, and every tread on its own clears the "this is a
 * refuel" threshold — so a single fill was booked as several, and priced as
 * several.
 *
 * RJ21GE2479 (TRU-109) on 31 Aug 2026 is the trace below, taken from the
 * production feed: 149.7 L to 300.0 L over four minutes, stationary. The Fuel
 * screen showed it as three unlogged fills of 44 L, 56 L and 50 L worth about
 * ₹13.9 K, when it was one fill of 150.3 L.
 *
 * The opposite mistake matters just as much: two genuine visits to a pump on
 * one day must stay two fills, so that is pinned here too.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { analyseUsage } from "./fleet-analytics.ts";

const TANK = 300;
const t = (hhmmss: string) => new Date(`2026-08-31T${hhmmss}+05:30`);

/** Readings as they arrived from the sender, one a minute. */
function reading(at: string, fuelLevelL: number, speedKph = 0) {
  return {
    recordedAt: t(at),
    fuelLevelL,
    fuelLevelPct: (fuelLevelL / TANK) * 100,
    ignitionOn: true,
    speedKph,
    odometerKm: null,
    lat: 26.9,
    lng: 75.8,
  };
}

describe("a single refuel seen across several samples", () => {
  // The measured trace, verbatim.
  const trace = [
    reading("04:53:49", 149.7),
    reading("04:54:49", 149.7),
    reading("04:55:49", 149.7),
    reading("04:56:49", 193.3),
    reading("04:57:49", 249.6),
    reading("04:59:49", 300.0),
    reading("05:01:49", 300.0),
    reading("05:03:49", 299.8),
  ];

  test("is one fill, not three", () => {
    const { usage } = analyseUsage(trace, null, TANK);
    assert.equal(usage.diagnostics.fuel.refuels.length, 1);
  });

  test("the fill is the whole 150.3 L", () => {
    const { usage } = analyseUsage(trace, null, TANK);
    assert.equal(usage.diagnostics.fuel.refuels[0]!.litresAdded, 150.3);
  });

  test("it spans the real start and finish levels", () => {
    const { usage } = analyseUsage(trace, null, TANK);
    const fill = usage.diagnostics.fuel.refuels[0]!;
    assert.equal(fill.fromL, 149.7);
    assert.equal(fill.toL, 300);
  });

  test("a four-minute fill is still HIGH confidence", () => {
    const { usage } = analyseUsage(trace, null, TANK);
    assert.equal(usage.diagnostics.fuel.refuels[0]!.confidence, "HIGH");
  });

  test("the litres refuelled total is unchanged by the merge", () => {
    // The mass balance must not move: this fix changes how fills are grouped,
    // never how much diesel the tank is judged to have received.
    const { usage } = analyseUsage(trace, null, TANK);
    assert.equal(usage.diagnostics.fuel.litresRefuelled, 150.3);
  });
});

describe("genuinely separate fills stay separate", () => {
  test("two visits to a pump hours apart are two fills", () => {
    const trace = [
      reading("05:00:00", 100),
      reading("05:01:00", 180),
      reading("05:02:00", 180),
      // ... a shift of driving in between, well beyond the coalescing window
      reading("11:00:00", 120),
      reading("11:01:00", 200),
      reading("11:02:00", 200),
    ];
    const { usage } = analyseUsage(trace, null, TANK);
    assert.equal(usage.diagnostics.fuel.refuels.length, 2);
  });

  test("a fill after a drop is not merged into the one before it", () => {
    // Contiguity is required, not just proximity in time: the tank fell in
    // between, so these cannot be one continuous pour.
    const trace = [
      reading("05:00:00", 100),
      reading("05:01:00", 180),
      reading("05:02:00", 130, 40),
      reading("05:03:00", 210),
      reading("05:04:00", 210),
    ];
    const { usage } = analyseUsage(trace, null, TANK);
    assert.equal(usage.diagnostics.fuel.refuels.length, 2);
  });
});
