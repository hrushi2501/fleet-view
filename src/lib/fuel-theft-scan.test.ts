/**
 * What the nightly scan will and will not accuse.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A fuel anomaly names a vehicle and a night, and by implication whoever had
 * the keys. So this tests the boundary in both directions, and the second is
 * the one that gets forgotten: a scan tuned only to avoid false accusations
 * eventually accuses nobody, and a fleet that is being robbed reads as clean.
 *
 * The rules under test come from `analyseSegment`, which the scan filters
 * rather than reimplements — these pin the shape of what reaches a person.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { analyseSegment, type AnalyticsReading } from "./fleet-analytics.ts";
import { senderContradictsItself } from "./fuel-cache.ts";

const TANK = 300;
const at = (iso: string) => new Date(iso);

function reading(iso: string, fuelL: number, odo: number, ignition: boolean, lat = 27.9, lng = 73.8): AnalyticsReading {
  return {
    recordedAt: at(iso), lat, lng, speedKph: ignition ? 0 : 0,
    odometerKm: odo, fuelLevelL: fuelL, fuelLevelPct: (fuelL / TANK) * 100,
    ignitionOn: ignition,
  };
}

describe("theft while parked is caught", () => {
  test("40 litres gone overnight with the engine off is a stationary drop", () => {
    // The case this whole system exists for: truck parked, key out, tank down.
    const seg = analyseSegment(
      reading("2026-08-29T20:00:00Z", 260, 90_000, false),
      reading("2026-08-30T02:00:00Z", 220, 90_000, false),
      null, TANK,
    );
    assert.equal(seg.event, "STATIONARY_DROP");
    assert.ok(seg.excessLitres > 30, `expected most of the 40 L to be unexplained, got ${seg.excessLitres}`);
  });

  test("the finding carries where the vehicle was, not just how much went", () => {
    // "40 L vanished overnight, here" is an investigation. "−40 L" is a rumour.
    const seg = analyseSegment(
      reading("2026-08-29T20:00:00Z", 260, 90_000, false, 27.91605, 73.84639),
      reading("2026-08-30T02:00:00Z", 220, 90_000, false, 27.91605, 73.84639),
      null, TANK,
    );
    assert.ok(seg.parkedAt, "a stationary segment must record where it stood");
    assert.equal(seg.fuelBeforeL, 260);
    assert.equal(seg.fuelAfterL, 220);
  });
});

describe("ordinary operations are not accused", () => {
  test("idling at a loading bay is charged against time, not distance", () => {
    // Two hours idling at 4 L/h is 8 L. Distance is ~zero, so a distance-based
    // norm would divide by nothing and call this a theft.
    const seg = analyseSegment(
      reading("2026-08-29T10:00:00Z", 200, 90_000, true),
      reading("2026-08-29T12:00:00Z", 192, 90_000, true),
      null, TANK,
    );
    assert.notEqual(seg.event, "STATIONARY_DROP");
  });

  test("a drop inside the sender's noise band is not a drop", () => {
    // 1.5% of a 300 L tank is 4.5 L. Three litres is the sender breathing.
    const seg = analyseSegment(
      reading("2026-08-29T20:00:00Z", 200, 90_000, false),
      reading("2026-08-29T21:00:00Z", 197, 90_000, false),
      null, TANK,
    );
    assert.equal(seg.excessLitres, 0);
  });

  test("a refuel is not a theft, however large", () => {
    const seg = analyseSegment(
      reading("2026-08-29T10:00:00Z", 60, 90_000, false),
      reading("2026-08-29T10:30:00Z", 260, 90_000, false),
      null, TANK,
    );
    assert.equal(seg.event, "REFUEL");
    assert.equal(seg.excessLitres, 0);
  });

  test("a fall too fast for any engine is a data fault, not a theft", () => {
    // The scan never raises IMPLAUSIBLE_DROP. Mislabelling a broken sender as
    // theft is how an honest driver gets accused.
    const seg = analyseSegment(
      reading("2026-08-29T10:00:00Z", 280, 90_000, true),
      reading("2026-08-29T10:01:00Z", 20, 90_001, true),
      null, TANK,
    );
    assert.equal(seg.event, "IMPLAUSIBLE_DROP");
  });
});

describe("a vehicle that cannot be judged is excluded, not passed", () => {
  test("the bistable sender is excluded before any segment is read", () => {
    // RJ21GE1657. Its downward legs are perfect theft shapes.
    const trace = [25.0, 209.2, 212.0, 209.9, 86.0, 28.1, 209.9];
    assert.equal(senderContradictsItself(trace, TANK), true);
  });

  test("a healthy sender is not excluded, so real theft still reaches a person", () => {
    // A tank that falls 40 L overnight and stays down: the shape of a siphon.
    const trace = [260, 259.4, 258.8, 220.1, 219.6, 219.0];
    assert.equal(senderContradictsItself(trace, TANK), false);
  });
});
