import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { analyseSegment } from "./fleet-analytics";
import {
  MIN_FUEL_SCAN_SAMPLES,
  fuelScanProviderProblem,
  pickFuelScanNorm,
  prepareFuelScanEvidence,
  type FuelScanReading,
  type FuelScanNormRow,
} from "./fuel-theft-scan-evidence";

const TANK = 300;
const TATA_PROVIDER_ID = "provider-tata";
const start = new Date("2026-09-15T18:30:00.000Z");

function reading(
  minute: number,
  fuelLevelL: number | null,
  source = "GPS_API",
  providerId: string | null = TATA_PROVIDER_ID,
): FuelScanReading {
  return {
    source,
    providerId,
    recordedAt: new Date(start.getTime() + minute * 60_000),
    lat: 27.9,
    lng: 73.8,
    speedKph: 0,
    odometerKm: 90_000,
    fuelLevelL,
    fuelLevelPct: fuelLevelL == null ? null : (fuelLevelL / TANK) * 100,
    ignitionOn: false,
  };
}

describe("nightly fuel evidence provenance", () => {
  test("manual and mobile readings cannot manufacture a drop in a clean OEM trace", () => {
    const oem = [0, 10, 20, 30, 40, 50].map((minute, i) => reading(minute, 240 - i));
    const untrusted = [
      reading(15, 80, "MOBILE"),
      reading(25, 250, "DEVICE"),
      reading(35, 75, "IMAGE"),
    ];

    const evidence = prepareFuelScanEvidence([...oem, ...untrusted], TANK, TATA_PROVIDER_ID);

    assert.equal(evidence.fuelSamples, MIN_FUEL_SCAN_SAMPLES);
    assert.deepEqual(evidence.samples.map((sample) => sample.fuelLevelL), [240, 239, 238, 237, 236, 235]);
    assert.equal(evidence.contradictorySender, false);
  });

  test("six repeated rows at one timestamp remain one observation", () => {
    const sameMoment = Array.from({ length: MIN_FUEL_SCAN_SAMPLES }, () => reading(0, 220));
    const evidence = prepareFuelScanEvidence(sameMoment, TANK, TATA_PROVIDER_ID);

    assert.equal(evidence.samples.length, 1);
    assert.equal(evidence.fuelSamples, 1);
  });

  test("out-of-order OEM readings are sorted before the sender is judged", () => {
    const ordered = [0, 10, 20, 30, 40, 50].map((minute, i) => reading(minute, 260 - i * 8));
    const evidence = prepareFuelScanEvidence([...ordered].reverse(), TANK, TATA_PROVIDER_ID);

    assert.deepEqual(evidence.samples.map((sample) => sample.recordedAt), ordered.map((sample) => sample.recordedAt));
    assert.equal(evidence.fuelSamples, MIN_FUEL_SCAN_SAMPLES);
    assert.equal(evidence.contradictorySender, false);
  });

  test("impossible and missing levels do not satisfy the sample gate", () => {
    const rows = [
      reading(0, 250),
      reading(10, null),
      reading(20, -1),
      reading(30, 400),
      reading(40, Number.NaN),
      reading(50, 245),
    ];
    const evidence = prepareFuelScanEvidence(rows, TANK, TATA_PROVIDER_ID);

    assert.equal(evidence.samples.length, MIN_FUEL_SCAN_SAMPLES);
    assert.equal(evidence.fuelSamples, 2);
  });

  test("a contradictory OEM sender remains excluded", () => {
    const levels = [25, 209.2, 212, 209.9, 86, 28.1, 209.9];
    const evidence = prepareFuelScanEvidence(levels.map((level, i) => reading(i * 10, level)), TANK, TATA_PROVIDER_ID);

    assert.equal(evidence.contradictorySender, true);
  });

  test("GPS_API rows attributed to another provider are excluded", () => {
    const tata = [0, 10, 20, 30, 40, 50].map((minute, i) => reading(minute, 240 - i));
    const otherProvider = [
      reading(15, 80, "GPS_API", "provider-other"),
      reading(25, 250, "GPS_API", null),
    ];

    const evidence = prepareFuelScanEvidence([...tata, ...otherProvider], TANK, TATA_PROVIDER_ID);

    assert.equal(evidence.fuelSamples, MIN_FUEL_SCAN_SAMPLES);
    assert.deepEqual(evidence.samples.map((sample) => sample.fuelLevelL), [240, 239, 238, 237, 236, 235]);
  });
});

describe("nightly consumption norm selection", () => {
  const classNorm: FuelScanNormRow = {
    assetId: null, assetClass: "TIPPER", normLow: 3, normHigh: 5.5, tolerancePct: 15,
  };
  const exactNorm: FuelScanNormRow = {
    assetId: "asset-1", assetClass: null, normLow: 4, normHigh: 6, tolerancePct: 10,
  };

  test("an asset-specific norm wins over its class fallback", () => {
    assert.deepEqual(pickFuelScanNorm([classNorm, exactNorm], "asset-1", "TIPPER"), {
      normLow: 4, normHigh: 6, tolerancePct: 10,
    });
  });

  test("a class norm is used when the machine has no override", () => {
    assert.deepEqual(pickFuelScanNorm([classNorm, exactNorm], "asset-2", "TIPPER"), {
      normLow: 3, normHigh: 5.5, tolerancePct: 15,
    });
  });

  test("the selected norm makes moving excess consumption reachable", () => {
    const norm = pickFuelScanNorm([classNorm, exactNorm], "asset-1", "TIPPER");
    const from = { ...reading(0, 260), odometerKm: 90_000, ignitionOn: true, speedKph: 40 };
    const to = { ...reading(60, 200), odometerKm: 90_100, ignitionOn: true, speedKph: 40 };
    const segment = analyseSegment(from, to, norm, TANK);

    assert.equal(segment.event, "EXCESS_CONSUMPTION");
    assert.ok(segment.excessLitres > 20);
  });

  test("without a norm, moving fuel loss is not claimed as excess consumption", () => {
    assert.equal(pickFuelScanNorm([classNorm], "asset-2", "EXCAVATOR"), null);
    const from = { ...reading(0, 260), odometerKm: 90_000, ignitionOn: true, speedKph: 40 };
    const to = { ...reading(60, 200), odometerKm: 90_100, ignitionOn: true, speedKph: 40 };
    const segment = analyseSegment(from, to, null, TANK);

    assert.equal(segment.event, "NORMAL");
    assert.equal(segment.excessLitres, 0);
  });
});

test("a missing Tata provider produces an explicit not-assessed reason", () => {
  const problem = fuelScanProviderProblem(null, "TATA_FLEET_EDGE");
  assert.match(problem!, /not registered/);
  assert.match(problem!, /provenance cannot be verified/);
  assert.equal(fuelScanProviderProblem("provider-tata", "TATA_FLEET_EDGE"), null);
});
