import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyseUsage,
  confirmSensorRefuel,
  despikeFuelSeries,
  analyseSegment,
  DEFAULT_FUEL_CONFIG,
  type AnalyticsReading,
} from "./fleet-analytics";

const TANK = 300;
const at = (minutesFromStart: number) => new Date(Date.UTC(2026, 8, 17, 7, minutesFromStart, 0));

function reading(overrides: Partial<AnalyticsReading>): AnalyticsReading {
  return {
    recordedAt: new Date(),
    lat: 27.83,
    lng: 73.92,
    speedKph: 0,
    odometerKm: 97_000,
    fuelLevelPct: 50,
    fuelLevelL: 150,
    ignitionOn: true,
    ...overrides,
  };
}

describe("fuel-slosh-filtering & refuel gating", () => {
  it("smooths an isolated transient slosh spike using despikeFuelSeries", () => {
    const raw: AnalyticsReading[] = [
      reading({ recordedAt: at(0), fuelLevelL: 35.2 }),
      reading({ recordedAt: at(1), fuelLevelL: 35.5 }),
      reading({ recordedAt: at(2), fuelLevelL: 110.3 }), // isolated slosh spike!
      reading({ recordedAt: at(3), fuelLevelL: 35.4 }),
      reading({ recordedAt: at(4), fuelLevelL: 35.1 }),
    ];

    const despiked = despikeFuelSeries(raw, TANK);
    assert.equal(despiked[2]?.fuelLevelL, 35.45);
    assert.ok(despiked[2]!.fuelLevelL! < 40, "spike must be eliminated");
  });

  it("does not erase a repeating oscillation one sample at a time", () => {
    const raw = [35, 36, 80, 35, 80, 36, 35].map((fuelLevelL, index) =>
      reading({ recordedAt: at(index), fuelLevelL }),
    );

    const despiked = despikeFuelSeries(raw, TANK);
    assert.deepEqual(despiked.map((sample) => sample.fuelLevelL), raw.map((sample) => sample.fuelLevelL));

    const { usage } = analyseUsage(raw, null, TANK);
    assert.equal(usage.fuelResolution, "UNRESOLVED_IMPLAUSIBLE_MOVEMENT");
    assert.equal(usage.insufficientData, true);
  });

  it("uses the caller's fuel configuration during series cleaning", () => {
    const raw = [35, 35, 80, 35, 35].map((fuelLevelL, index) =>
      reading({ recordedAt: at(index), fuelLevelL }),
    );
    const cfg = { ...DEFAULT_FUEL_CONFIG, noiseBandMinL: 30 };

    const { usage } = analyseUsage(raw, null, TANK, null, cfg);
    assert.equal(usage.diagnostics.hygiene.transientFuelImpulses, 0);
    assert.equal(usage.fuelResolution, "UNRESOLVED_IMPLAUSIBLE_MOVEMENT");
  });

  it("rejects cold-boot momentary dip-and-rebound in confirmSensorRefuel", () => {
    // Exact scenario that produced the 207.5 L phantom fill:
    // Truck at 275 L, turned off, on startup briefly reads 67.9 L and returns to 275 L.
    const readings: AnalyticsReading[] = [
      reading({ recordedAt: at(0), fuelLevelL: 275.4, ignitionOn: false, speedKph: 0 }),
      reading({ recordedAt: at(10), fuelLevelL: 275.4, ignitionOn: false, speedKph: 0 }),
      reading({ recordedAt: at(48), fuelLevelL: 67.9, ignitionOn: true, speedKph: 0 }), // cold boot dip
      reading({ recordedAt: at(49), fuelLevelL: 79.9, ignitionOn: true, speedKph: 0 }),
      reading({ recordedAt: at(50), fuelLevelL: 275.4, ignitionOn: true, speedKph: 0 }), // plateau
      reading({ recordedAt: at(52), fuelLevelL: 275.4, ignitionOn: true, speedKph: 0 }),
      reading({ recordedAt: at(53), fuelLevelL: 275.4, ignitionOn: true, speedKph: 0 }),
      reading({ recordedAt: at(55), fuelLevelL: 274.8, ignitionOn: true, speedKph: 0 }),
    ];

    const refuel = confirmSensorRefuel(readings, TANK);
    assert.equal(refuel, null, "cold-boot dip and return to pre-event level must NOT be confirmed as a refuel");
  });

  it("rejects fills that violate commercial pump flow rate limits", () => {
    // 200 L rise in 20 seconds = 600 L/min, exceeding the 300 L/min safety ceiling.
    const atSec = (sec: number) => new Date(Date.UTC(2026, 8, 17, 7, 0, sec));
    const readings: AnalyticsReading[] = [
      reading({ recordedAt: atSec(0), fuelLevelL: 50, ignitionOn: true, speedKph: 0 }),
      reading({ recordedAt: atSec(20), fuelLevelL: 250, ignitionOn: true, speedKph: 0 }),
      reading({ recordedAt: at(5), fuelLevelL: 250, ignitionOn: true, speedKph: 0 }),
      reading({ recordedAt: at(6), fuelLevelL: 250, ignitionOn: true, speedKph: 0 }),
      reading({ recordedAt: at(7), fuelLevelL: 250, ignitionOn: true, speedKph: 0 }),
      reading({ recordedAt: at(8), fuelLevelL: 250, ignitionOn: true, speedKph: 0 }),
    ];

    const refuel = confirmSensorRefuel(readings, TANK);
    assert.equal(refuel, null, "200 L in 20 seconds exceeds physical pump rate and must be rejected");
  });

  it("rejects rises while in motion in analyseSegment", () => {
    const a = reading({ recordedAt: at(0), fuelLevelL: 40, speedKph: 35, odometerKm: 1000 });
    const b = reading({ recordedAt: at(1), fuelLevelL: 90, speedKph: 38, odometerKm: 1001 });

    const seg = analyseSegment(a, b, null, TANK);
    assert.equal(seg.event, "NOISE");
    assert.ok(seg.reasons.some((r) => /motion|slosh/i.test(r)));
  });

  it("confirms a genuine stationary refuel with physical delivery time", () => {
    // 120 L added over 3 minutes while stationary (40 L/min)
    const readings: AnalyticsReading[] = [
      reading({ recordedAt: at(0), fuelLevelL: 60, ignitionOn: true, speedKph: 0, odometerKm: 5000 }),
      reading({ recordedAt: at(1), fuelLevelL: 100, ignitionOn: true, speedKph: 0, odometerKm: 5000 }),
      reading({ recordedAt: at(2), fuelLevelL: 140, ignitionOn: true, speedKph: 0, odometerKm: 5000 }),
      reading({ recordedAt: at(3), fuelLevelL: 180, ignitionOn: true, speedKph: 0, odometerKm: 5000 }),
      reading({ recordedAt: at(5), fuelLevelL: 180, ignitionOn: true, speedKph: 0, odometerKm: 5000 }),
      reading({ recordedAt: at(7), fuelLevelL: 179.5, ignitionOn: true, speedKph: 0, odometerKm: 5000 }),
      reading({ recordedAt: at(9), fuelLevelL: 180.2, ignitionOn: true, speedKph: 0, odometerKm: 5000 }),
    ];

    const refuel = confirmSensorRefuel(readings, TANK);
    assert.ok(refuel != null, "genuine stationary refuel must be confirmed");
    assert.equal(refuel.fromL, 60);
    assert.equal(refuel.toL, 180);
    assert.equal(refuel.litresAdded, 120);
  });
});
