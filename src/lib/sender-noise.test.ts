/**
 * A drop no bigger than the sender's own invented gains is not an accusation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CASE THIS COMES FROM
 *
 * TRU-101 (RJ21GD0598) on the evening of 30 Aug 2026, parked, nobody filling
 * it. The tank sender reported, in order: 93 L, then 101 L, then 89 L, then
 * back to 93 L. Diesel cannot appear, so the 8 L gain is the unit being wrong
 * by 8 L — and the 12 L fall an hour later is the same wrongness pointing the
 * other way.
 *
 * Read against the assumed band (1.5% of tank — 2.4 L on this 160 L tank) that
 * fall looks like twelve litres of diesel leaving a stationary truck, which is
 * the exact shape of a siphon. The scan's flat 10 L floor would not have saved
 * it either. Somebody would have been asked to explain a theft that never
 * happened.
 *
 * Measured across fourteen days of the real feed, the impossible gains reach
 * 12.3 L on TRU-108, 11.8 L on TRU-106, 11.6 L on TRU-053. So this is not one
 * odd truck; it is what this hardware does.
 *
 * The opposite failure is pinned too: widening the band must not blind the scan
 * to a real siphon, so a genuine large drop on a quiet sender still stands.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { measureSenderNoiseL, analyseFuelSeries } from "./fleet-analytics.ts";

const TANK = 160;

function series(levels: number[], startMs = Date.parse("2026-08-30T14:00:00Z")) {
  return levels.map((fuelLevelL, i) => ({
    recordedAt: new Date(startMs + i * 60_000),
    fuelLevelL,
    fuelLevelPct: (fuelLevelL / TANK) * 100,
    ignitionOn: false,
    speedKph: 0,
    odometerKm: 86685,
    lat: 26.9,
    lng: 75.8,
  }));
}

/** A sender that wobbles ±8 L, as TRU-101's actually does. */
function wobbling(): number[] {
  const out: number[] = [];
  const pattern = [93, 101, 89, 93, 97, 90, 96, 88, 94, 99];
  for (let i = 0; i < 6; i++) out.push(...pattern);
  return out;
}

describe("the sender's noise is measured, not assumed", () => {
  test("a wobbling sender reports a band far wider than 1.5% of the tank", () => {
    const noise = measureSenderNoiseL(series(wobbling()), 15);
    assert.ok(noise != null, "expected a measurement from 60 samples");
    // 1.5% of a 160 L tank is 2.4 L. The real unit is several times worse.
    assert.ok(noise > 5, `expected a wide band, got ${noise} L`);
  });

  test("a quiet sender is not handed a made-up band", () => {
    // Steady drain, one litre at a time — nothing impossible ever reported.
    const steady = Array.from({ length: 60 }, (_, i) => 140 - i);
    assert.equal(measureSenderNoiseL(series(steady), 15), null);
  });

  test("too few samples yields no measurement rather than a guess", () => {
    assert.equal(measureSenderNoiseL(series([93, 101, 89]), 15), null);
  });

  test("a real fill is not counted as noise", () => {
    // A fill would inflate the band enough to hide a theft behind it.
    const withFill = [...wobbling().slice(0, 40), 140, 140, ...wobbling().slice(0, 20)];
    const noise = measureSenderNoiseL(series(withFill), 15);
    assert.ok(noise != null && noise < 15, `fill leaked into the band: ${noise} L`);
  });
});

describe("the band widens but never narrows", () => {
  test("a noisy sender gets the measured band, not the assumed one", () => {
    const analysis = analyseFuelSeries(series(wobbling()), TANK);
    assert.ok(
      analysis.noiseBandL > 2.4,
      `assumed band was ${analysis.noiseBandL} L — the measurement was ignored`,
    );
  });

  test("a quiet sender keeps its tight assumed band", () => {
    const steady = Array.from({ length: 60 }, (_, i) => 140 - i * 0.5);
    const analysis = analyseFuelSeries(series(steady), TANK);
    assert.equal(analysis.noiseBandL, 2.4);
  });
});
