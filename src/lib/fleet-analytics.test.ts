/**
 * Regression tests for the fuel, distance and mileage derivation.
 *
 * Run with `npm test` (node's built-in runner, TypeScript stripped natively —
 * no test framework is installed and none is needed for pure functions).
 *
 * Every case here is one that the previous implementation got wrong on real
 * data. The scenarios are deliberately written as physics — "the tank held this
 * much, the vehicle went this far" — rather than as assertions about internal
 * steps, so the maths can be rewritten again without rewriting the tests.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  analyseUsage,
  analyseSegment,
  analyseFuelSeries,
  cleanSeries,
  DEFAULT_FUEL_CONFIG,
  confirmSensorRefuel,
  type AnalyticsReading,
  type Norm,
} from "./fleet-analytics.ts";

const TANK = 300;
const TRUCK_NORM: Norm = { normLow: 3, normHigh: 5.5, tolerancePct: 15 };

const t0 = new Date("2026-08-12T00:00:00.000Z");
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

/** A reading with sensible defaults, so each test states only what it means. */
function reading(over: Partial<AnalyticsReading> & { recordedAt: Date }): AnalyticsReading {
  return {
    lat: 27.9, lng: 73.8, speedKph: 0, odometerKm: null,
    fuelLevelL: null, fuelLevelPct: null, ignitionOn: false,
    ...over,
  };
}

/** A steadily-driven series: `steps` samples, each covering km and litres. */
function drive(opts: {
  steps: number; minutesEach: number; kmEach: number; litresEach: number;
  startOdo: number; startFuel: number;
}): AnalyticsReading[] {
  const out: AnalyticsReading[] = [];
  for (let i = 0; i <= opts.steps; i++) {
    out.push(reading({
      recordedAt: at(i * opts.minutesEach),
      odometerKm: opts.startOdo + i * opts.kmEach,
      fuelLevelL: opts.startFuel - i * opts.litresEach,
      ignitionOn: true,
      speedKph: 40,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------

describe("TEST 1 — normal driving", () => {
  test("100 km on 20 L reads as 5 km/L", () => {
    const readings = drive({
      steps: 40, minutesEach: 5, kmEach: 2.5, litresEach: 0.5,
      startOdo: 10_000, startFuel: 200,
    });
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    assert.equal(usage.distanceKm, 100);
    assert.equal(usage.litresBurned, 20);
    assert.equal(usage.avgKmPerL, 5);
    assert.equal(usage.distanceSource, "ODOMETER");
    assert.equal(usage.insufficientData, false);
    assert.equal(usage.confidence, "HIGH");
  });
});

describe("TEST 2 — refuelling", () => {
  test("a large rise must persist while stationary before it is a fill", () => {
    const low = reading({ recordedAt: at(0), odometerKm: 10, fuelLevelL: 100 });
    const high1 = reading({ recordedAt: at(2), odometerKm: 10, fuelLevelL: 130 });
    const high2 = reading({ recordedAt: at(4), odometerKm: 10, fuelLevelL: 131 });
    const high3 = reading({ recordedAt: at(6), odometerKm: 10, fuelLevelL: 130 });
    const high4 = reading({ recordedAt: at(8), odometerKm: 10, fuelLevelL: 130 });
    const result = confirmSensorRefuel([low, high1, high2, high3, high4], TANK);
    assert.equal(result?.litresAdded, 30);
  });

  test("a long history confirms only the newest plateau, not an old fill", () => {
    const readings = Array.from({ length: 96 }, (_, i) => reading({
      recordedAt: at(i), odometerKm: 100, fuelLevelL: 50,
    }));
    for (let i = 96; i <= 100; i++) {
      readings.push(reading({ recordedAt: at(i), odometerKm: 100, fuelLevelL: 200 }));
    }
    const result = confirmSensorRefuel(readings, TANK);
    assert.equal(result?.litresAdded, 150);
  });

  test("a multi-ping pumping ramp uses the pre-fill baseline", () => {
    const levels = [50, 50, 80, 130, 170, 200, 200, 200, 200];
    const result = confirmSensorRefuel(levels.map((fuelLevelL, i) => reading({
      recordedAt: at(i), odometerKm: 100, fuelLevelL,
    })), TANK);
    assert.equal(result?.fromL, 50);
    assert.equal(result?.toL, 200);
    assert.equal(result?.litresAdded, 150);
  });

  test("an unstable high/low wave is not a fill", () => {
    const result = confirmSensorRefuel([
      reading({ recordedAt: at(0), odometerKm: 10, fuelLevelL: 100 }),
      reading({ recordedAt: at(2), odometerKm: 10, fuelLevelL: 130 }),
      reading({ recordedAt: at(4), odometerKm: 10, fuelLevelL: 145 }),
      reading({ recordedAt: at(6), odometerKm: 10, fuelLevelL: 130 }),
      reading({ recordedAt: at(8), odometerKm: 10, fuelLevelL: 130 }),
    ], TANK);
    assert.equal(result, null);
  });

  test("a sudden spike while moving is rejected as sensor noise", () => {
    const result = confirmSensorRefuel([
      reading({ recordedAt: at(0), odometerKm: 10, fuelLevelL: 100, speedKph: 0 }),
      reading({ recordedAt: at(1), odometerKm: 12, fuelLevelL: 130, speedKph: 40 }),
      reading({ recordedAt: at(2), odometerKm: 14, fuelLevelL: 131, speedKph: 40 }),
      reading({ recordedAt: at(4), odometerKm: 18, fuelLevelL: 130, speedKph: 40 }),
      reading({ recordedAt: at(6), odometerKm: 20, fuelLevelL: 130, speedKph: 40 }),
    ], TANK);
    assert.equal(result, null);
  });

  test("small 1–2 litre rises are ignored", () => {
    const result = confirmSensorRefuel([
      reading({ recordedAt: at(0), odometerKm: 10, fuelLevelL: 100 }),
      reading({ recordedAt: at(2), odometerKm: 10, fuelLevelL: 101 }),
      reading({ recordedAt: at(4), odometerKm: 10, fuelLevelL: 102 }),
      reading({ recordedAt: at(6), odometerKm: 10, fuelLevelL: 101 }),
    ], TANK);
    assert.equal(result, null);
  });

  test("start 100 L, +50 L fill, end 120 L is 30 L consumed — not −20 or 70", () => {
    const readings: AnalyticsReading[] = [
      reading({ recordedAt: at(0), odometerKm: 0, fuelLevelL: 100, ignitionOn: true }),
      reading({ recordedAt: at(30), odometerKm: 30, fuelLevelL: 90, ignitionOn: true }),
      reading({ recordedAt: at(60), odometerKm: 60, fuelLevelL: 80, ignitionOn: true }),
      // the fill
      reading({ recordedAt: at(70), odometerKm: 60, fuelLevelL: 130, ignitionOn: false }),
      reading({ recordedAt: at(90), odometerKm: 75, fuelLevelL: 125, ignitionOn: true }),
      reading({ recordedAt: at(120), odometerKm: 100, fuelLevelL: 120, ignitionOn: true }),
    ];
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    assert.equal(usage.litresBurned, 30);
    assert.equal(usage.litresFilled, 50);
    assert.equal(usage.refuelEvents, 1);
    assert.ok(usage.litresBurned > 0, "consumption must never be negative");
  });

  test("the fill is reported with its own before/after levels", () => {
    const readings: AnalyticsReading[] = [
      reading({ recordedAt: at(0), odometerKm: 0, fuelLevelL: 100, ignitionOn: true }),
      reading({ recordedAt: at(30), odometerKm: 30, fuelLevelL: 80, ignitionOn: true }),
      reading({ recordedAt: at(40), odometerKm: 30, fuelLevelL: 230, ignitionOn: false }),
      reading({ recordedAt: at(60), odometerKm: 45, fuelLevelL: 225, ignitionOn: true }),
    ];
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);
    const [fill] = usage.diagnostics.fuel.refuels;

    assert.equal(usage.refuelEvents, 1);
    assert.equal(fill.fromL, 80);
    assert.equal(fill.toL, 230);
    assert.equal(fill.litresAdded, 150);
    // 100 → 225 with 150 added: 100 − 225 + 150 = 25 L burnt.
    assert.equal(usage.litresBurned, 25);
  });
});

describe("TEST 3 — stationary fuel fluctuation", () => {
  test("0 km travelled and a 1 L wobble is not consumption", () => {
    const readings: AnalyticsReading[] = [];
    for (let i = 0; i <= 20; i++) {
      readings.push(reading({
        recordedAt: at(i * 2),
        odometerKm: 5_000,
        // the sawtooth that produced 128 L of phantom burn on the live vehicle
        fuelLevelL: i % 2 === 0 ? 240.4 : 241.1,
        ignitionOn: false,
      }));
    }
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    assert.equal(usage.litresBurned, 0, "a wobble around a constant level burns nothing");
    assert.equal(usage.litresFilled, 0, "and fills nothing");
    assert.equal(usage.avgKmPerL, null);
    assert.equal(usage.insufficientData, true);
    assert.equal(usage.suspectSegments, 0, "nobody should be accused over 0.7 L of sender noise");
  });

  test("every segment of that sawtooth is classified as noise", () => {
    const a = reading({ recordedAt: at(0), odometerKm: 5_000, fuelLevelL: 241.1, ignitionOn: false });
    const b = reading({ recordedAt: at(2), odometerKm: 5_000, fuelLevelL: 240.4, ignitionOn: false });
    const seg = analyseSegment(a, b, TRUCK_NORM, TANK);

    assert.equal(seg.event, "NOISE");
    assert.equal(seg.litresConsumed, null);
    assert.equal(seg.excessLitres, 0);
  });

  test("a 4.9 L one-minute dip on a 300 L tank stays below the finding floor", () => {
    const a = reading({ recordedAt: at(0), odometerKm: 203_147, fuelLevelL: 129.7, ignitionOn: true, speedKph: 10 });
    const b = reading({ recordedAt: at(1), odometerKm: 203_147, fuelLevelL: 124.8, ignitionOn: true, speedKph: 0 });
    const seg = analyseSegment(a, b, TRUCK_NORM, TANK);

    assert.equal(seg.event, "NOISE");
    assert.equal(seg.litresConsumed, null);
    assert.equal(seg.excessLitres, 0);
  });
});

describe("TEST 4 — large sampling gap", () => {
  test("a 20 L drop across an 11 h gap is reported at LOW confidence", () => {
    const readings: AnalyticsReading[] = [
      reading({ recordedAt: at(0), odometerKm: 1_000, fuelLevelL: 200, ignitionOn: false }),
      reading({ recordedAt: at(11 * 60), odometerKm: 1_060, fuelLevelL: 180, ignitionOn: false }),
    ];
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    assert.equal(usage.litresBurned, 20);
    assert.equal(usage.confidence, "LOW");
    assert.ok(usage.worstGapHours > 10);
    assert.ok(
      usage.confidenceReasons.some((r) => /gap/i.test(r)),
      "the reason given must name the gap",
    );
    assert.equal(
      usage.diagnostics.fuel.litresAcrossStaleGaps, 20,
      "fuel first seen after a blind spell is tracked separately",
    );
  });

  test("the same 20 L over dense sampling is not LOW", () => {
    const readings = drive({
      steps: 40, minutesEach: 5, kmEach: 1.5, litresEach: 0.5,
      startOdo: 1_000, startFuel: 200,
    });
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    assert.equal(usage.litresBurned, 20);
    assert.notEqual(usage.confidence, "LOW");
  });
});

describe("TEST 5 — duplicate telemetry", () => {
  test("the same timestamp repeated does not multiply consumption", () => {
    const clean = drive({
      steps: 40, minutesEach: 5, kmEach: 2.5, litresEach: 0.5,
      startOdo: 10_000, startFuel: 200,
    });
    // The snapshot endpoint re-reports a parked vehicle's last state on every
    // poll, so this is what a real duplicate looks like: identical in full.
    const withDupes = clean.flatMap((r) => [r, { ...r }, { ...r }]);

    const a = analyseUsage(clean, TRUCK_NORM, TANK).usage;
    const b = analyseUsage(withDupes, TRUCK_NORM, TANK).usage;

    assert.equal(b.litresBurned, a.litresBurned);
    assert.equal(b.distanceKm, a.distanceKm);
    assert.equal(b.avgKmPerL, a.avgKmPerL);
    assert.equal(b.diagnostics.hygiene.duplicateTimestamps, 82);
  });

  test("duplicates are dropped before anything else looks at the series", () => {
    const rows = [
      reading({ recordedAt: at(0), fuelLevelL: 100 }),
      reading({ recordedAt: at(0), fuelLevelL: 100 }),
      reading({ recordedAt: at(5), fuelLevelL: 99 }),
    ];
    const { samples, hygiene } = cleanSeries(rows, TANK);

    assert.equal(samples.length, 2);
    assert.equal(hygiene.duplicateTimestamps, 1);
  });
});

describe("TEST 6 — impossible fuel drop", () => {
  test("100 L in 5 minutes is flagged, not booked as consumption", () => {
    const readings: AnalyticsReading[] = [
      reading({ recordedAt: at(0), odometerKm: 1_000, fuelLevelL: 250, ignitionOn: true }),
      reading({ recordedAt: at(5), odometerKm: 1_002, fuelLevelL: 150, ignitionOn: true }),
      reading({ recordedAt: at(10), odometerKm: 1_004, fuelLevelL: 149, ignitionOn: true }),
    ];
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);
    const drops = usage.diagnostics.fuel.implausibleDrops;

    assert.equal(drops.length, 1);
    assert.ok(drops[0].impliedLph > DEFAULT_FUEL_CONFIG.maxBurnRateLph);
    assert.ok(
      usage.confidenceReasons.some((r) => /burn rate/i.test(r)),
      "the flag must be visible in the confidence reasons",
    );
  });

  test("a physically impossible drop is not dressed up as a HIGH-confidence theft", () => {
    // The exact shape of the three phantom siphons the old code filed against
    // the live vehicle: ~9.6 L in 60 seconds, engine idling, wheels still.
    const a = reading({ recordedAt: at(0), odometerKm: 89_485, fuelLevelL: 231.4, ignitionOn: true });
    const b = reading({ recordedAt: at(1), odometerKm: 89_485, fuelLevelL: 221.8, ignitionOn: true });
    const seg = analyseSegment(a, b, TRUCK_NORM, TANK);

    assert.equal(seg.event, "IMPLAUSIBLE_DROP");
    assert.equal(seg.confidence, "LOW");
    assert.equal(seg.excessLitres, 0, "no litres at risk should be claimed from a sensor fault");
    assert.equal(seg.litresConsumed, null);
  });

  test("a 30 L fall in ten minutes is a rapid-change investigation signal", () => {
    const a = reading({ recordedAt: at(0), odometerKm: 5_000, fuelLevelL: 200, ignitionOn: true });
    const b = reading({ recordedAt: at(10), odometerKm: 5_001, fuelLevelL: 170, ignitionOn: true });
    const seg = analyseSegment(a, b, TRUCK_NORM, TANK);

    assert.equal(seg.event, "IMPLAUSIBLE_DROP");
    assert.equal(seg.excessLitres, 0, "the detector must not label an unverified change as a loss");
    assert.ok(seg.reasons.some((reason) => /30\.0 L in 10 min/i.test(reason)));
  });
});

describe("TEST 7 — multiple tanks", () => {
  test("thresholds scale with the tank, so a small tank is not judged by a big one's noise", () => {
    const big = analyseFuelSeries(
      [reading({ recordedAt: at(0), fuelLevelL: 300 }), reading({ recordedAt: at(60), fuelLevelL: 297 })],
      600,
    );
    const small = analyseFuelSeries(
      [reading({ recordedAt: at(0), fuelLevelL: 50 }), reading({ recordedAt: at(60), fuelLevelL: 47 })],
      55,
    );

    assert.ok(big.noiseBandL > small.noiseBandL);
    // 3 L is noise in a 600 L tank and a real change in a 55 L one.
    assert.equal(big.withinNoise, true);
    assert.equal(small.withinNoise, false);
  });

  test("an unverified second tank is never added to the primary level", async () => {
    const { interpretFleetEdgeFuel } = await import("./telematics-adapters.ts");

    // The live payload, exactly as Fleet Edge sends it.
    const live = interpretFleetEdgeFuel({
      noOfFuelTanks: 1,
      primaryFuelLevel: 214,
      primaryFuelTankCapacity: 300,
      secondaryFuelLevel1: 1500,
      secondaryFuelTankCapacity1: 55555,
    });
    assert.equal(live.secondaryIncluded, false);
    assert.equal(live.primaryLitres, 214);
    assert.ok(live.notes.some((n) => /ignored/i.test(n)), "the rejection must be explained, not silent");

    // A vehicle that genuinely has two credible tanks does get both.
    const twin = interpretFleetEdgeFuel({
      noOfFuelTanks: 2,
      primaryFuelLevel: 180,
      primaryFuelTankCapacity: 300,
      secondaryFuelLevel1: 90,
      secondaryFuelTankCapacity1: 200,
    });
    assert.equal(twin.secondaryIncluded, true);
  });

  test("the engine-hour field is rejected when it is the odometer echoed back", async () => {
    const { TataFleetEdgeAdapter } = await import("./telematics-adapters.ts");
    const [ping] = await new TataFleetEdgeAdapter().parsePayload({
      vehicles: [{
        registrationNumber: "RJ21GE3220",
        eventDateTime: "2026-08-12T10:28:04.000000009",
        odometer: 89513,
        engineRunHour: 89513.6, // 0.6 apart, so a rounded comparison missed it
        primaryFuelLevel: 214,
        primaryFuelTankCapacity: 300,
        noOfFuelTanks: 1,
        secondaryFuelLevel1: 1500,
        secondaryFuelTankCapacity1: 55555,
      }],
    });

    assert.equal(ping.engineHours, null);
    assert.equal(ping.odometerKm, 89513);
    assert.equal(ping.fuelLevelLitres, 214, "the 1500 L phantom tank must not be added");
    assert.equal(ping.fuelLevelPct, 71.3);
  });
});

describe("TEST 8 — odometer vs GPS", () => {
  test("distance is not double-counted across the two sources", () => {
    const readings: AnalyticsReading[] = [
      reading({ recordedAt: at(0), odometerKm: 0, lat: 27.90, lng: 73.80, fuelLevelL: 200, ignitionOn: true }),
      reading({ recordedAt: at(60), odometerKm: 20, lat: 27.99, lng: 73.89, fuelLevelL: 195, ignitionOn: true }),
      reading({ recordedAt: at(120), odometerKm: 40, lat: 28.08, lng: 73.98, fuelLevelL: 190, ignitionOn: true }),
    ];
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    assert.equal(usage.distanceKm, 40, "the odometer's 40 km, not 40 + the GPS track");
    assert.equal(usage.distanceSource, "ODOMETER");
    assert.ok(usage.gpsDistanceKm! > 0, "GPS is still measured, as a cross-check");
    assert.ok(usage.gpsDistanceKm! < usage.distanceKm, "straight lines are shorter than roads");
  });

  test("an odometer rollback is discarded rather than counted as travel", () => {
    const readings: AnalyticsReading[] = [
      reading({ recordedAt: at(0), odometerKm: 1_000, fuelLevelL: 200, ignitionOn: true }),
      reading({ recordedAt: at(60), odometerKm: 1_050, fuelLevelL: 190, ignitionOn: true }),
      reading({ recordedAt: at(120), odometerKm: 40, fuelLevelL: 180, ignitionOn: true }), // meter swap
      reading({ recordedAt: at(180), odometerKm: 60, fuelLevelL: 170, ignitionOn: true }),
    ];
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    assert.equal(usage.distanceKm, 70, "50 km + 20 km; the rollback contributes nothing");
    assert.equal(usage.diagnostics.distance.odometerRollbacks, 1);
  });

  test("a teleporting GPS fix is rejected", () => {
    const readings: AnalyticsReading[] = [
      reading({ recordedAt: at(0), lat: 27.90, lng: 73.80, fuelLevelL: 200 }),
      reading({ recordedAt: at(1), lat: 19.07, lng: 72.87, fuelLevelL: 199 }), // Bikaner → Mumbai in a minute
      reading({ recordedAt: at(2), lat: 27.90, lng: 73.80, fuelLevelL: 198 }),
    ];
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    assert.equal(usage.diagnostics.distance.rejectedJumps, 2);
    // Null, not zero: every fix was discarded, so we have no GPS distance at
    // all. Reporting 0 km would assert the vehicle stayed put, which is a
    // different — and unevidenced — claim.
    assert.equal(usage.diagnostics.distance.gpsKm, null);
  });
});

describe("TEST 9 — missing GPS", () => {
  test("analysis still works on the odometer alone", () => {
    const readings = drive({
      steps: 40, minutesEach: 5, kmEach: 2.5, litresEach: 0.5,
      startOdo: 10_000, startFuel: 200,
    }).map((r) => ({ ...r, lat: null, lng: null }));

    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    assert.equal(usage.distanceSource, "ODOMETER");
    assert.equal(usage.avgKmPerL, 5);
    assert.equal(usage.insufficientData, false);
  });

  test("with no odometer either, GPS carries it at reduced confidence", () => {
    const readings: AnalyticsReading[] = [];
    for (let i = 0; i <= 40; i++) {
      readings.push(reading({
        recordedAt: at(i * 5),
        odometerKm: null,
        lat: 27.9 + i * 0.005,
        lng: 73.8,
        fuelLevelL: 200 - i * 0.5,
        ignitionOn: true,
      }));
    }
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    assert.equal(usage.distanceSource, "GPS");
    assert.ok(usage.distanceKm > 0);
    assert.notEqual(usage.confidence, "HIGH");
    assert.ok(usage.confidenceReasons.some((r) => /GPS/i.test(r)));
  });

  test("with neither, no efficiency is invented", () => {
    const readings: AnalyticsReading[] = [];
    for (let i = 0; i <= 40; i++) {
      readings.push(reading({
        recordedAt: at(i * 5), odometerKm: null, lat: null, lng: null,
        fuelLevelL: 200 - i * 0.5, ignitionOn: true,
      }));
    }
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    assert.equal(usage.avgKmPerL, null);
    assert.equal(usage.insufficientData, true);
    assert.equal(usage.confidence, "LOW");
  });
});

describe("TEST 10 — vehicle stopped", () => {
  test("ignition off and stationary: sender drift is not diesel", () => {
    const readings: AnalyticsReading[] = [];
    for (let i = 0; i <= 30; i++) {
      readings.push(reading({
        recordedAt: at(i * 2),
        odometerKm: 5_000,
        // ±1.3 L, the worst drift measured on the live vehicle with the
        // engine off — physics says consumption here is exactly zero.
        fuelLevelL: 220 + [0, 0.7, -0.6, 1.3, -1.3, 0.7][i % 6],
        ignitionOn: false,
        speedKph: 0,
      }));
    }
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    assert.equal(usage.litresBurned, 0);
    assert.equal(usage.suspectSegments, 0);
    assert.equal(usage.litresUnaccounted, 0);
    assert.equal(usage.insufficientData, true);
  });

  test("a genuine drop with the engine off is still caught", () => {
    // 40 L gone from a parked vehicle over an hour: slow enough to be
    // physically possible, far too much to be sender drift or idling.
    const a = reading({ recordedAt: at(0), odometerKm: 5_000, fuelLevelL: 260, ignitionOn: false });
    const b = reading({ recordedAt: at(60), odometerKm: 5_000, fuelLevelL: 220, ignitionOn: false });
    const seg = analyseSegment(a, b, TRUCK_NORM, TANK);

    assert.equal(seg.event, "STATIONARY_DROP");
    assert.equal(seg.confidence, "HIGH");
    assert.ok(seg.excessLitres > 30);
    assert.ok(seg.reasons.some((r) => /parked engine burns nothing/i.test(r)));
  });

  test("the tank level at both ends is reported, not just the difference", () => {
    // "-40 L" cannot be checked against anything. "260 L when it stopped, 220 L
    // when it moved again" is a claim a yard supervisor can verify with a dipstick,
    // which is the difference between a number and evidence.
    const a = reading({ recordedAt: at(0), odometerKm: 5_000, fuelLevelL: 260, ignitionOn: false });
    const b = reading({ recordedAt: at(60), odometerKm: 5_000, fuelLevelL: 220, ignitionOn: false });
    const seg = analyseSegment(a, b, TRUCK_NORM, TANK);

    assert.equal(seg.fuelBeforeL, 260);
    assert.equal(seg.fuelAfterL, 220);
    assert.ok(
      seg.reasons.some((r) => /260\.0 L when it stopped and 220\.0 L when it moved again/.test(r)),
      `expected a before/after line, got: ${seg.reasons.join(" | ")}`,
    );
  });

  test("a stationary drop records where the vehicle was parked", () => {
    // During a blind spot the vehicle is parked by definition, so its position is
    // known even though nothing was transmitted. That is what turns "40 L vanished
    // overnight" into somewhere to send someone.
    const a = reading({ recordedAt: at(0), odometerKm: 5_000, fuelLevelL: 260, ignitionOn: false, lat: 27.9881, lng: 73.7749 });
    const b = reading({ recordedAt: at(60), odometerKm: 5_000, fuelLevelL: 220, ignitionOn: false, lat: 27.9881, lng: 73.7749 });
    const seg = analyseSegment(a, b, TRUCK_NORM, TANK);

    assert.equal(seg.event, "STATIONARY_DROP");
    assert.deepEqual(seg.parkedAt, { lat: 27.9881, lng: 73.7749 });
  });

  test("a moving vehicle is never given a parked location", () => {
    // The failure that would matter: one coordinate pair describing a journey
    // would put a fuel loss at the point of departure, and send an investigator
    // to the wrong place with apparent precision.
    const a = reading({ recordedAt: at(0), odometerKm: 5_000, fuelLevelL: 260, ignitionOn: true, lat: 27.9881, lng: 73.7749 });
    const b = reading({ recordedAt: at(60), odometerKm: 5_180, fuelLevelL: 200, ignitionOn: true, lat: 28.4, lng: 74.2 });
    const seg = analyseSegment(a, b, TRUCK_NORM, TANK);

    assert.equal(seg.parkedAt, null);
    // The endpoints are still reported — they are useful on any segment.
    assert.equal(seg.fuelBeforeL, 260);
    assert.equal(seg.fuelAfterL, 200);
  });

  test("a missing sender reading leaves the endpoints null rather than zero", () => {
    // `?? 0` on a measurement turns unknown into a confident reading, which the
    // README names as the bug that has fabricated fuel-theft cases here before.
    const a = reading({ recordedAt: at(0), odometerKm: 5_000, fuelLevelL: null, ignitionOn: false });
    const b = reading({ recordedAt: at(60), odometerKm: 5_000, fuelLevelL: 220, ignitionOn: false });
    const seg = analyseSegment(a, b, TRUCK_NORM, TANK);

    assert.equal(seg.fuelBeforeL, null);
    assert.equal(seg.fuelAfterL, 220);
  });
});

// ---------------------------------------------------------------------------
// The specific defect this work was raised for
// ---------------------------------------------------------------------------

describe("the rectified-noise defect", () => {
  test("a noisy series is not charged for both the down-ticks and the up-ticks", () => {
    // 100 km driven, tank falls 20 L, with ±1 L of sender noise on every
    // sample. The old code summed 50 down-ticks and called it consumption.
    const readings: AnalyticsReading[] = [];
    const wobble = [0, 1, -1, 0.7, -0.7, 1, -1, 0.5];
    for (let i = 0; i <= 50; i++) {
      readings.push(reading({
        recordedAt: at(i * 5),
        odometerKm: 20_000 + i * 2,
        fuelLevelL: 200 - i * 0.4 + wobble[i % wobble.length],
        ignitionOn: true,
        speedKph: 30,
      }));
    }
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    const naiveBurn = readings.reduce((sum, r, i) => {
      if (i === 0) return sum;
      const d = r.fuelLevelL! - readings[i - 1].fuelLevelL!;
      return d < 0 ? sum + -d : sum;
    }, 0);

    assert.ok(naiveBurn > 30, `the old method would report ${naiveBurn.toFixed(1)} L`);
    assert.ok(
      Math.abs(usage.litresBurned - 20) <= usage.litresBurnedUncertainty,
      `expected ~20 L within ±${usage.litresBurnedUncertainty}, got ${usage.litresBurned}`,
    );
    assert.ok(usage.avgKmPerL! > 4, "and mileage lands near the real 5 km/L, not a third of it");
  });

  test("polling faster does not increase reported consumption", () => {
    // The same journey, sampled at three rates. Physics does not care how
    // often we look, so neither should the answer.
    const build = (samples: number) => {
      const rows: AnalyticsReading[] = [];
      const wobble = [0, 0.9, -0.9, 0.6, -0.6];
      for (let i = 0; i <= samples; i++) {
        const f = i / samples;
        rows.push(reading({
          recordedAt: at(f * 240),
          odometerKm: 30_000 + f * 100,
          fuelLevelL: 200 - f * 20 + wobble[i % wobble.length],
          ignitionOn: true,
          speedKph: 40,
        }));
      }
      return analyseUsage(rows, TRUCK_NORM, TANK).usage;
    };

    const slow = build(12);
    const medium = build(60);
    const fast = build(240);

    for (const u of [slow, medium, fast]) {
      assert.ok(
        Math.abs(u.litresBurned - 20) <= u.litresBurnedUncertainty,
        `expected ~20 L, got ${u.litresBurned}`,
      );
    }
    assert.ok(
      fast.litresBurned <= slow.litresBurned + slow.litresBurnedUncertainty,
      "sampling 20× more often must not multiply the fuel bill",
    );
  });
});

describe("unaccounted fuel", () => {
  test("a journey the norm explains leaves nothing unaccounted", () => {
    const readings = drive({
      steps: 40, minutesEach: 5, kmEach: 2.5, litresEach: 0.5,
      startOdo: 10_000, startFuel: 200,
    });
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    // 100 km at 5 km/L is well inside a 3 km/L norm.
    assert.equal(usage.litresUnaccounted, 0);
  });

  test("fuel beyond journey, idling and tolerance combined is what gets reported", () => {
    // 100 km but 80 L gone: the norm's worst case is 100/3 × 1.15 ≈ 38 L.
    const readings = drive({
      steps: 40, minutesEach: 5, kmEach: 2.5, litresEach: 2,
      startOdo: 10_000, startFuel: 250,
    });
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);

    assert.equal(usage.litresBurned, 80);
    assert.ok(usage.litresUnaccounted > 0);
    // Never the raw measured-minus-expected: allowances must come off first.
    assert.ok(
      usage.litresUnaccounted < 80 - usage.diagnostics.expectedLitresForDistance!,
      "idling and sender tolerance must be deducted before anything is called unaccounted",
    );
  });

  test("nothing is called unaccounted without a norm to judge it against", () => {
    const readings = drive({
      steps: 40, minutesEach: 5, kmEach: 2.5, litresEach: 2,
      startOdo: 10_000, startFuel: 250,
    });
    const { usage } = analyseUsage(readings, null, TANK);

    assert.equal(usage.litresUnaccounted, 0);
  });
});

describe("diagnostics", () => {
  test("every headline number is reproducible from the diagnostic block", () => {
    const readings = drive({
      steps: 40, minutesEach: 5, kmEach: 2.5, litresEach: 0.5,
      startOdo: 10_000, startFuel: 200,
    });
    const { usage } = analyseUsage(readings, TRUCK_NORM, TANK);
    const d = usage.diagnostics;

    // consumed = start − end + refills
    assert.equal(
      usage.litresBurned,
      d.fuel.startLevelL! - d.fuel.endLevelL! + usage.litresFilled,
    );
    // mileage = distance ÷ consumption
    assert.equal(usage.avgKmPerL, Math.round((usage.distanceKm / usage.litresBurned) * 100) / 100);
    assert.equal(d.hygiene.received, readings.length);
    assert.equal(d.config.maxBurnRateLph, DEFAULT_FUEL_CONFIG.maxBurnRateLph);
  });
});
