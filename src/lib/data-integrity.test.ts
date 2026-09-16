/**
 * Data-integrity regression tests for the ingestion and calculation pipeline.
 *
 * Each case here is a bug that was live in the codebase. They are written as
 * statements about what the business must never see — a fabricated zero, a
 * double-counted litre, a date in the wrong month — rather than about internal
 * implementation, so the code underneath can change without the guarantee
 * changing.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  normaliseReading,
  assetCacheUpdate,
  detectSchemaDrift,
  describeDrift,
  DEFAULT_LIMITS,
  FLEET_EDGE_KNOWN_FIELDS,
  MAX_RAW_TELEMETRY_PAYLOAD_BYTES,
  rawPayloadSizeBytes,
} from "./telemetry-normalization.ts";
import { businessDay, businessMonth, parseBusinessDay, startOfBusinessDay } from "./business-time.ts";
import { analyzeAsset, analyzeFleet } from "./fuel.ts";
import { issueVariance } from "./fuel-recon.ts";
import { reconcilePairs, byMaterial, byVehicle } from "./weighbridge.ts";
import { utilisation } from "./hire.ts";
import type { TelemetryPing } from "./telematics-adapters.ts";

const now = new Date("2026-08-12T10:00:00.000Z");

function ping(over: Partial<TelemetryPing> = {}): TelemetryPing {
  return {
    externalDeviceId: "RJ21GE3220",
    timestamp: new Date("2026-08-12T09:00:00.000Z"),
    latitude: 27.9159, longitude: 73.8459,
    speedKph: 30, headingDeg: 180,
    odometerKm: 89_513, engineHours: null,
    fuelLevelPct: 71.3, fuelLevelLitres: 214,
    ignitionState: true,
    rawPayload: {},
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("normalisation — missing is never zero", () => {
  test("absent fields stay null rather than becoming measurements", () => {
    const r = normaliseReading(
      ping({ fuelLevelLitres: null, odometerKm: null, speedKph: null, latitude: null, longitude: null }),
      {}, DEFAULT_LIMITS, now,
    );
    assert.equal(r.accepted, true);
    assert.equal(r.reading!.fuelLevelL, null);
    assert.equal(r.reading!.odometerKm, null);
    assert.equal(r.reading!.speedKph, null);
    assert.equal(r.reading!.lat, null);
  });

  test("Null Island is treated as a missing fix, not a location", () => {
    const r = normaliseReading(ping({ latitude: 0, longitude: 0 }), {}, DEFAULT_LIMITS, now);
    assert.equal(r.reading!.lat, null);
    assert.equal(r.reading!.lng, null);
    assert.ok(r.issues.some((i) => /Null Island/.test(i.reason)));
  });

  test("half a coordinate pair is not a position", () => {
    const r = normaliseReading(ping({ longitude: null }), {}, DEFAULT_LIMITS, now);
    assert.equal(r.reading!.lat, null);
    assert.equal(r.reading!.lng, null);
  });
});

describe("normalisation — one bad field does not discard a good reading", () => {
  test("an impossible speed drops the speed, keeping the fuel and odometer", () => {
    const r = normaliseReading(ping({ speedKph: 4000 }), {}, DEFAULT_LIMITS, now);
    assert.equal(r.accepted, true, "the reading must survive");
    assert.equal(r.degraded, true);
    assert.equal(r.reading!.speedKph, null);
    assert.equal(r.reading!.fuelLevelL, 214, "fuel alongside a bad speed is still good");
    assert.equal(r.reading!.odometerKm, 89_513);
  });

  test("fuel above the tank's physical capacity is dropped, not stored", () => {
    const r = normaliseReading(ping({ fuelLevelLitres: 1500 }), { fuelCapacityL: 300 }, DEFAULT_LIMITS, now);
    assert.equal(r.accepted, true);
    assert.equal(r.reading!.fuelLevelL, null, "1500 L cannot be in a 300 L tank");
    assert.ok(r.issues.some((i) => i.field === "fuelLevelLitres" && i.severity === "DROP_FIELD"));
  });

  test("a litre reading that contradicts the percentage is flagged", () => {
    const r = normaliseReading(
      ping({ fuelLevelLitres: 150, fuelLevelPct: 90 }), { fuelCapacityL: 300 }, DEFAULT_LIMITS, now,
    );
    assert.equal(r.accepted, true, "valid time, location and odometer are preserved");
    assert.equal(r.degraded, true);
    assert.equal(r.reading!.fuelLevelL, null);
    assert.equal(r.reading!.fuelLevelPct, null);
    assert.equal(r.reading!.odometerKm, 89_513);
    assert.ok(r.issues.some((i) => i.field === "fuel" && i.severity === "DROP_FIELD" && /different tank/.test(i.reason)));
  });
});

describe("normalisation — a reading that cannot be placed in time is rejected", () => {
  test("unparseable timestamp", () => {
    const r = normaliseReading(ping({ timestamp: new Date("nonsense") }), {}, DEFAULT_LIMITS, now);
    assert.equal(r.accepted, false);
    assert.equal(r.reading, null);
  });

  test("a future sample is refused rather than becoming the newest reading", () => {
    const r = normaliseReading(
      ping({ timestamp: new Date(now.getTime() + 6 * 3_600_000) }), {}, DEFAULT_LIMITS, now,
    );
    assert.equal(r.accepted, false);
    assert.ok(r.issues.some((i) => /future/.test(i.reason)));
  });

  test("a backwards odometer is kept with a warning, not thrown away", () => {
    const r = normaliseReading(ping({ odometerKm: 500 }), { lastOdometerKm: 89_513 }, DEFAULT_LIMITS, now);
    assert.equal(r.accepted, true);
    assert.equal(r.reading!.odometerKm, 500, "the reading is preserved for its fuel level");
    assert.ok(r.issues.some((i) => i.field === "odometerKm" && i.severity === "WARN"));
  });
});

describe("normalisation — raw payload retention is bounded", () => {
  test("rejects a provider payload over the 64 KiB per-reading ceiling", () => {
    const rawPayload = { diagnostic: "x".repeat(MAX_RAW_TELEMETRY_PAYLOAD_BYTES) };
    assert.ok(rawPayloadSizeBytes(rawPayload)! > MAX_RAW_TELEMETRY_PAYLOAD_BYTES);

    const r = normaliseReading(ping({ rawPayload }), {}, DEFAULT_LIMITS, now);
    assert.equal(r.accepted, false);
    assert.ok(r.issues.some((i) => i.field === "rawPayload" && /64 KiB/.test(i.reason)));
  });

  test("keeps normal diagnostic payloads", () => {
    const r = normaliseReading(ping({ rawPayload: { imei: "123", satellites: 12 } }), {}, DEFAULT_LIMITS, now);
    assert.equal(r.accepted, true);
  });
});

describe("meter guards on the asset cache", () => {
  const asset = { meterValue: 89_513, hourMeterValue: 1_200, primaryMeter: "ODOMETER" };

  test("a lower odometer never overwrites the asset's meter", () => {
    const r = normaliseReading(ping({ odometerKm: 500 }), { lastOdometerKm: 89_513 }, DEFAULT_LIMITS, now);
    const patch = assetCacheUpdate(r.reading!, asset);
    assert.equal("meterValue" in patch, false, "meters only move forward");
  });

  test("a higher odometer does update it", () => {
    const r = normaliseReading(ping({ odometerKm: 89_600 }), {}, DEFAULT_LIMITS, now);
    const patch = assetCacheUpdate(r.reading!, asset);
    assert.equal(patch.meterValue, 89_600);
  });

  test("kilometres are never written into an hour-metered machine's primary meter", () => {
    const excavator = { meterValue: 4_000, hourMeterValue: 4_000, primaryMeter: "SMU" };
    const r = normaliseReading(ping({ odometerKm: 89_600, engineHours: null }), {}, DEFAULT_LIMITS, now);
    const patch = assetCacheUpdate(r.reading!, excavator);
    assert.equal("meterValue" in patch, false, "an excavator is measured in hours, not km");
  });
});

describe("schema drift detection", () => {
  const live = Object.fromEntries(FLEET_EDGE_KNOWN_FIELDS.map((f) => [f, 1]));

  test("an unchanged payload reports no drift", () => {
    const d = detectSchemaDrift(live);
    assert.equal(d.changed, false);
    assert.equal(d.missingRequired.length, 0);
    assert.equal(describeDrift(d), null);
  });

  test("a required field disappearing is reported, not absorbed", () => {
    const { primaryFuelLevel: _drop, ...without } = live;
    void _drop;
    const d = detectSchemaDrift(without);
    assert.deepEqual(d.missingRequired, ["primaryFuelLevel"]);
    assert.match(describeDrift(d)!, /MISSING REQUIRED/);
  });

  test("a required field sent as null counts as absent", () => {
    const d = detectSchemaDrift({ ...live, odometer: null });
    assert.ok(d.missingRequired.includes("odometer"));
  });

  test("a new field is noticed but is not treated as breaking", () => {
    const d = detectSchemaDrift({ ...live, brandNewSensor: 42 });
    assert.deepEqual(d.added, ["brandNewSensor"]);
    assert.equal(d.missingRequired.length, 0);
    assert.match(describeDrift(d)!, /new: brandNewSensor/);
  });
});

// ---------------------------------------------------------------------------

describe("business timezone", () => {
  // 02:00 IST on 1 Sept is 20:30 UTC on 31 Aug — the boundary that moved fuel
  // spend between accounting months and attendance between payroll days.
  const earlyMorningIST = new Date("2026-08-31T20:30:00.000Z");

  test("an early-morning IST timestamp belongs to the IST day, not the UTC one", () => {
    assert.equal(earlyMorningIST.toISOString().slice(0, 10), "2026-08-31", "precondition: UTC says August");
    assert.equal(businessDay(earlyMorningIST), "2026-09-01");
  });

  test("and to the IST accounting month", () => {
    assert.equal(businessMonth(earlyMorningIST), "2026-09");
  });

  test("a date typed on a form round-trips to the same day", () => {
    for (const day of ["2026-01-01", "2026-08-12", "2026-12-31"]) {
      assert.equal(businessDay(parseBusinessDay(day)), day);
    }
  });

  test("the day boundary is 18:30 UTC, and both sides land correctly", () => {
    assert.equal(businessDay(new Date("2026-08-11T18:29:59.000Z")), "2026-08-11");
    assert.equal(businessDay(new Date("2026-08-11T18:30:00.000Z")), "2026-08-12");
  });

  test("startOfBusinessDay is the instant the IST day begins", () => {
    const start = startOfBusinessDay(new Date("2026-08-12T09:00:00.000Z"));
    assert.equal(start.toISOString(), "2026-08-11T18:30:00.000Z");
    assert.equal(businessDay(start), "2026-08-12");
  });

  test("results do not depend on the server's own timezone", () => {
    // The old helper used getFullYear()/getDate(), which differ between a
    // developer's IST laptop and Vercel's UTC runtime.
    const original = process.env.TZ;
    const seen = new Set<string>();
    for (const tz of ["UTC", "America/New_York", "Asia/Kolkata"]) {
      process.env.TZ = tz;
      seen.add(businessDay(earlyMorningIST));
    }
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    assert.equal(seen.size, 1, `expected one answer across server timezones, got ${[...seen].join(", ")}`);
  });
});

// ---------------------------------------------------------------------------

const truck = {
  id: "a1", code: "TRU-053", name: "Tipper", assetClass: "TRUCK",
  category: "VEHICLE", primaryMeter: "ODOMETER", fuelCapacity: 300,
};
const fill = (over: Partial<Parameters<typeof analyzeAsset>[1][number]>) => ({
  id: "f", assetId: "a1", quantity: 100, meterValue: 1_000, rate: 92.5, amount: 9_250,
  date: new Date("2026-08-01T06:00:00.000Z"), odometerPhoto: null, pumpPhoto: null,
  sensorRise: 0, anomaly: false, variancePct: 0,
  ...over,
});

describe("cost per km uses the spend it can actually attribute", () => {
  test("a fill whose segment was rejected does not inflate the rate of the others", () => {
    const txns = [
      fill({ id: "f1", meterValue: 1_000, quantity: 100, amount: 9_250, date: new Date("2026-08-01T06:00:00Z") }),
      fill({ id: "f2", meterValue: 1_400, quantity: 100, amount: 9_250, date: new Date("2026-08-05T06:00:00Z") }),
      // 5,000 km later — a missed fill or a mistyped meter, not a real run.
      fill({ id: "f3", meterValue: 6_400, quantity: 100, amount: 9_250, date: new Date("2026-08-09T06:00:00Z") }),
    ];
    const r = analyzeAsset(truck, txns);

    assert.equal(r.travel, 400, "only the credible 400 km segment is measured");
    // ₹9,250 bought that 400 km. Dividing all three fills' spend by it would
    // have produced ₹69/km instead of ₹23/km.
    assert.ok(r.costPerUnit != null);
    assert.ok(Math.abs(r.costPerUnit! - 9_250 / 400) < 0.01, `got ${r.costPerUnit}`);
  });

  test("fleet mileage is null, not zero, when nothing is measurable", () => {
    const f = analyzeFleet([truck], [fill({ id: "only", meterValue: 0 })]);
    assert.equal(f.avgFleetKmpl, null, "0 km/L would read as a fleet going nowhere");
  });
});

describe("fuel variance without metered work says so", () => {
  test("no meter movement yields null, not a reassuring 0%", () => {
    const v = issueVariance(200, 0, { unit: "KMPL", normLow: 3, normHigh: 5.5, tolerancePct: 15 });
    assert.equal(v.variancePct, null);
    assert.equal(v.expected, null);
    assert.equal(v.beyondTolerance, false);
    assert.match(v.reason!, /nothing to compare/i);
  });

  test("real metered work still produces a real variance", () => {
    const v = issueVariance(100, 300, { unit: "KMPL", normLow: 3, normHigh: 5, tolerancePct: 15 });
    assert.ok(v.variancePct != null && v.variancePct > 0);
    assert.equal(v.beyondTolerance, true);
  });
});

describe("weighbridge — missing paperwork is not measured loss", () => {
  const ticket = (over: Record<string, unknown>) => ({
    id: "t", ticketNo: "D1", kind: "DISPATCH", date: new Date("2026-08-01T06:00:00Z"),
    material: "GSB", grossKg: 30_000, tareKg: 10_000, netKg: 20_000, billedKg: 0,
    rate: 500, amount: 0, assetId: "a1", vendor: null, pairedTicketNo: null,
    ...over,
  });

  test("an unpaired dispatch does not become a 100% transit loss in the rollup", () => {
    const pairs = reconcilePairs([
      ticket({ id: "d1", ticketNo: "D1" }),
      ticket({ id: "r1", ticketNo: "R1", kind: "RECEIPT", netKg: 19_900, pairedTicketNo: "D1" }),
      ticket({ id: "d2", ticketNo: "D2" }), // no receipt at all
    ]);

    const [gsb] = byMaterial(pairs);
    assert.equal(gsb.matchedTrips, 1);
    assert.equal(gsb.unmatchedTrips, 1);
    assert.equal(gsb.unmatchedKg, 20_000);
    assert.equal(gsb.dispatchedKg, 20_000, "only the weighed-at-both-ends trip counts");
    assert.equal(gsb.shortageKg, 100);
    // 100 / 20,000 = 0.5%. Folding the unmatched load in gave 50%.
    assert.ok(Math.abs(gsb.shortagePct! - 0.5) < 0.001, `got ${gsb.shortagePct}`);
  });

  test("a material with no paired trips reports null, not 0%", () => {
    const pairs = reconcilePairs([ticket({ id: "d1", ticketNo: "D1" })]);
    assert.equal(byMaterial(pairs)[0].shortagePct, null);
  });

  test("per-vehicle shortage excludes unmatched trips from its percentage", () => {
    const pairs = reconcilePairs([
      ticket({ id: "d1", ticketNo: "D1" }),
      ticket({ id: "r1", ticketNo: "R1", kind: "RECEIPT", netKg: 19_000, pairedTicketNo: "D1" }),
      ticket({ id: "d2", ticketNo: "D2" }),
    ]);
    const [v] = byVehicle(pairs);
    assert.equal(v.unmatchedTrips, 1);
    assert.ok(Math.abs(v.shortagePct! - 5) < 0.001, `got ${v.shortagePct}`);
  });
});

describe("hire utilisation", () => {
  const contract = {
    id: "c1", vendor: "V", rateType: "PER_DAY" as const, rate: 5_000, overtimeRate: 0,
    minGuarantee: 0, guaranteeUnit: null, fuelBorneBy: "VENDOR",
    breakdownBillable: false, idleBillable: false,
  };
  const log = (over: Record<string, unknown>) => ({
    date: new Date("2026-08-01T06:00:00Z"), present: true, workedHours: 8, idleHours: 0,
    breakdownHours: 0, km: 100, trips: 2, source: "MANUAL", ...over,
  });

  test("the working-day assumption is stated rather than buried", () => {
    const u = utilisation(contract, [log({})], 1);
    assert.equal(u.workingHoursPerDay, 8);
    assert.equal(u.utilPct, 100);
  });

  test("an unknown period gives null utilisation, not 0%", () => {
    const u = utilisation(contract, [log({})], 0);
    assert.equal(u.utilPct, null, "0% would read as a machine that never worked");
    assert.equal(u.presencePct, null);
  });
});
