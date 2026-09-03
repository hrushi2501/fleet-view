/**
 * A vehicle parked overnight is still watched for theft.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * The nightly scan was gated on `usage.insufficientData` — a flag that answers
 * "can this vehicle's km/L be trusted", which needs continuous sampling. Theft
 * asks something narrower: did the level fall between two readings while the
 * vehicle stood still.
 *
 * A parked truck reports roughly hourly. Every gap over an hour counts as
 * blind, so a night in the yard pushed coverage under the bar and the whole
 * vehicle was skipped. On 2 September the scan examined ONE vehicle out of
 * eleven and logged "nothing found" — TRU-053 dropped for a 2.32 h gap,
 * TRU-106 for 1.07 h, TRU-111 for 1.06 h.
 *
 * Standing still overnight is precisely when diesel goes missing, so the one
 * condition that should raise attention was the condition that switched the
 * detector off.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { analyseUsage } from "./fleet-analytics.ts";

const TANK = 300;

/** Hourly reports through a night in the yard, as the real feed delivers. */
function parkedOvernight(levels: number[]) {
  const start = Date.parse("2026-09-02T14:00:00Z");
  return levels.map((fuelLevelL, i) => ({
    recordedAt: new Date(start + i * 3_600_000),
    fuelLevelL,
    fuelLevelPct: (fuelLevelL / TANK) * 100,
    ignitionOn: false,
    speedKph: 0,
    odometerKm: 90_000,
    lat: 26.9,
    lng: 75.8,
  }));
}

describe("hourly reporting while parked", () => {
  const steady = parkedOvernight(Array.from({ length: 12 }, () => 240));

  test("is judged too sparse for a mileage figure — which is correct", () => {
    // Not a bug: km/L genuinely cannot be trusted on this sampling. The bug was
    // letting that verdict decide whether theft is looked for.
    const { usage } = analyseUsage(steady, null, TANK);
    assert.equal(usage.insufficientData, true);
  });

  test("but still yields the fuel readings a theft check needs", () => {
    const { usage } = analyseUsage(steady, null, TANK);
    assert.ok(
      usage.diagnostics.fuel.levelSamples >= 6,
      `only ${usage.diagnostics.fuel.levelSamples} samples reached the detector`,
    );
  });
});

describe("diesel disappearing from a parked truck", () => {
  // Full at midnight, 60 L lighter by morning, never moved.
  const siphoned = parkedOvernight([240, 240, 240, 238, 180, 178, 178, 177, 177, 176, 176, 175]);

  test("the drop is visible in the analysis, not averaged away", () => {
    const { usage } = analyseUsage(siphoned, null, TANK);
    assert.ok(
      usage.litresBurned >= 50,
      `expected the ~64 L loss to survive; got ${usage.litresBurned} L`,
    );
  });

  test("the vehicle never moved, so none of it is explained by driving", () => {
    const { usage } = analyseUsage(siphoned, null, TANK);
    assert.equal(usage.distanceKm, 0);
  });

  test("a loss this size clears the sender's own noise", () => {
    // The floor the scan raises against. 64 L on a 300 L tank is far above the
    // 8–12 L these senders invent.
    const { usage } = analyseUsage(siphoned, null, TANK);
    assert.ok(
      usage.diagnostics.fuel.noiseBandL < 50,
      `noise band ${usage.diagnostics.fuel.noiseBandL} L would swallow a real theft`,
    );
  });
});

describe("a quiet parked night stays quiet", () => {
  test("no loss is reported when nothing moved", () => {
    // The opposite failure: widening what the scan looks at must not invent
    // findings on a truck that simply sat there.
    const { usage } = analyseUsage(parkedOvernight(Array.from({ length: 12 }, () => 240)), null, TANK);
    assert.ok(usage.litresBurned <= 5, `invented ${usage.litresBurned} L of loss`);
  });
});
