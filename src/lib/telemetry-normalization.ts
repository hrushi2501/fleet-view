/**
 * The one place raw provider telemetry becomes a record the ERP will reason on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Three separate code paths were writing `TelemetryReading` rows — the Fleet
 * Edge cron sync, the generic device push at `/api/telematics`, and the
 * multi-provider webhook at `/api/fuel/telemetry` — and each validated
 * differently, or not at all. The consequences were not theoretical:
 *
 *   - `/api/fuel/telemetry` never stored `fuelLevelL`, so every fuel figure
 *     derived from a webhook-fed vehicle silently had no data behind it.
 *   - Only the cron path checked for duplicates, so a retried webhook wrote the
 *     same sample twice and every distance and fuel total counted it twice.
 *   - Only the cron path guarded the odometer, so one bad sample from a webhook
 *     could wind a vehicle's meter backwards permanently.
 *   - One path dropped an entire reading — position, fuel and odometer — because
 *     the speed field looked wrong.
 *
 * Everything now goes through `normaliseReading`. It returns a decision, not a
 * value: a reading is ACCEPTED, ACCEPTED WITH FIELDS DROPPED, or REJECTED, and
 * it always says why. Callers cannot get a number out of it without also
 * getting the list of what was wrong with it.
 *
 * THE RULES IT ENFORCES
 *
 *   1. Missing is never zero. A field the provider did not send stays null.
 *      Zero litres and "we don't know" are different facts and the fraud
 *      detection treats them very differently.
 *   2. Impossible is never stored as fact. Values outside physical range are
 *      dropped field-by-field, with a reason, rather than poisoning a total.
 *   3. One bad field does not discard a good reading. Speed failing its range
 *      check nulls the speed, not the fuel level next to it.
 *   4. Raw is preserved. The provider's untouched payload goes to
 *      `TelemetryReading.raw` regardless of what validation decides.
 *   5. Schema drift is reported, not absorbed. Fields the provider starts or
 *      stops sending are surfaced so a silent API change cannot quietly empty
 *      out a calculation.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { TelemetryPing } from "@/lib/telematics-adapters";

// ---------------------------------------------------------------------------
// Physical limits
// ---------------------------------------------------------------------------

/**
 * Bounds every field is checked against. These are physical limits — the point
 * beyond which a number cannot describe a real vehicle — not business
 * preferences, and they are deliberately loose. Anything tighter belongs in the
 * analytics layer where it can be weighed against context.
 */
export type TelemetryLimits = {
  maxSpeedKph: number;
  maxOdometerKm: number;
  maxEngineHours: number;
  /** Used when the asset's tank size is unknown. */
  fallbackTankCapacityL: number;
  /** Tolerance above nominal capacity for a brimmed tank. */
  tankOverfillFactor: number;
  /** How far ahead of the server clock a sample may be stamped, minutes. */
  maxClockSkewMinutes: number;
  /** Older than this and the sample is history being replayed, not news. */
  maxSampleAgeDays: number;
};

export const DEFAULT_LIMITS: TelemetryLimits = {
  // Governed Indian commercial vehicles sit far below this; it is here to catch
  // a corrupt field, not to judge driving.
  maxSpeedKph: 200,
  // ~25 round trips to the moon. A real meter that reads higher is broken.
  maxOdometerKm: 10_000_000,
  // 100 years of continuous running.
  maxEngineHours: 900_000,
  fallbackTankCapacityL: 1_000,
  tankOverfillFactor: 1.05,
  maxClockSkewMinutes: 60,
  maxSampleAgeDays: 400,
};

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type IssueSeverity = "REJECT" | "DROP_FIELD" | "WARN";

export type NormalisationIssue = {
  field: string;
  severity: IssueSeverity;
  /** What was received, for the audit trail. */
  received: unknown;
  reason: string;
};

/** The validated shape, ready to persist. Nulls mean "not known", never zero. */
export type NormalisedReading = {
  recordedAt: Date;
  lat: number | null;
  lng: number | null;
  speedKph: number | null;
  headingDeg: number | null;
  odometerKm: number | null;
  engineHours: number | null;
  fuelLevelPct: number | null;
  fuelLevelL: number | null;
  /** Tank size the vehicle reports, litres. Null when it does not say. */
  fuelCapacityL?: number | null;
  ignitionOn: boolean | null;
};

export type NormalisationResult = {
  accepted: boolean;
  reading: NormalisedReading | null;
  issues: NormalisationIssue[];
  /** True when at least one field was discarded but the reading was kept. */
  degraded: boolean;
};

/** What the validator needs to know about the vehicle to judge the numbers. */
export type AssetContext = {
  /** Nominal tank size in litres, when the register or the OEM reports one. */
  fuelCapacityL?: number | null;
  /** Last known good odometer, to catch a meter winding backwards. */
  lastOdometerKm?: number | null;
  /** Last known engine hours, same reason. */
  lastEngineHours?: number | null;
};

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const finite = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Validates and normalises one provider ping.
 *
 * A reading is only REJECTED outright when it cannot be placed in time or
 * attributed at all — without a usable timestamp there is nothing to order it
 * against, so it cannot contribute to any delta. Everything else degrades
 * field by field.
 */
export function normaliseReading(
  ping: TelemetryPing,
  ctx: AssetContext = {},
  limits: TelemetryLimits = DEFAULT_LIMITS,
  now: Date = new Date(),
): NormalisationResult {
  const issues: NormalisationIssue[] = [];
  const reject = (field: string, received: unknown, reason: string): NormalisationResult => {
    issues.push({ field, severity: "REJECT", received, reason });
    return { accepted: false, reading: null, issues, degraded: false };
  };
  const drop = (field: string, received: unknown, reason: string) => {
    issues.push({ field, severity: "DROP_FIELD", received, reason });
  };
  const warn = (field: string, received: unknown, reason: string) => {
    issues.push({ field, severity: "WARN", received, reason });
  };

  // --- timestamp: the one field a reading cannot survive without ---
  const recordedAt = ping.timestamp;
  if (!(recordedAt instanceof Date) || Number.isNaN(recordedAt.getTime())) {
    return reject("timestamp", ping.timestamp, "Unparseable timestamp — the sample cannot be placed in time.");
  }
  const skewMin = (recordedAt.getTime() - now.getTime()) / 60_000;
  if (skewMin > limits.maxClockSkewMinutes) {
    return reject(
      "timestamp", recordedAt.toISOString(),
      `Stamped ${skewMin.toFixed(0)} min in the future, beyond the ${limits.maxClockSkewMinutes} min skew allowance. ` +
        `A future sample would become the newest reading and freeze every later comparison against it.`,
    );
  }
  const ageDays = (now.getTime() - recordedAt.getTime()) / 86_400_000;
  if (ageDays > limits.maxSampleAgeDays) {
    return reject(
      "timestamp", recordedAt.toISOString(),
      `Sample is ${ageDays.toFixed(0)} days old, beyond the ${limits.maxSampleAgeDays}-day replay window.`,
    );
  }

  // --- position: latitude and longitude stand or fall together ---
  let lat = finite(ping.latitude);
  let lng = finite(ping.longitude);
  if (lat != null && (lat < -90 || lat > 90)) {
    drop("latitude", ping.latitude, "Outside −90…90.");
    lat = null;
  }
  if (lng != null && (lng < -180 || lng > 180)) {
    drop("longitude", ping.longitude, "Outside −180…180.");
    lng = null;
  }
  if ((lat == null) !== (lng == null)) {
    drop("position", { lat: ping.latitude, lng: ping.longitude }, "Only one half of the coordinate pair is usable; a half-fix is not a position.");
    lat = null;
    lng = null;
  }
  // 0,0 is in the Gulf of Guinea. No asset of this fleet is there, and it is
  // the classic signature of a null that was coerced to a number upstream.
  if (lat === 0 && lng === 0) {
    drop("position", { lat: 0, lng: 0 }, "Null Island (0,0) — a missing fix rendered as zero, not a location.");
    lat = null;
    lng = null;
  }

  // --- speed ---
  let speedKph = finite(ping.speedKph);
  if (speedKph != null && speedKph < 0) {
    drop("speedKph", ping.speedKph, "Negative speed.");
    speedKph = null;
  } else if (speedKph != null && speedKph > limits.maxSpeedKph) {
    // Drop the field, keep the reading: the fuel level and odometer alongside a
    // corrupt speed are usually perfectly good.
    drop("speedKph", ping.speedKph, `Above ${limits.maxSpeedKph} km/h — not a speed a road vehicle reaches.`);
    speedKph = null;
  }

  // --- heading ---
  let headingDeg = finite(ping.headingDeg);
  if (headingDeg != null && (headingDeg < 0 || headingDeg > 360)) {
    drop("headingDeg", ping.headingDeg, "Outside 0…360.");
    headingDeg = null;
  }

  // --- odometer ---
  let odometerKm = finite(ping.odometerKm);
  if (odometerKm != null && odometerKm < 0) {
    drop("odometerKm", ping.odometerKm, "Negative odometer.");
    odometerKm = null;
  } else if (odometerKm != null && odometerKm > limits.maxOdometerKm) {
    drop("odometerKm", ping.odometerKm, `Above ${limits.maxOdometerKm.toLocaleString("en-IN")} km.`);
    odometerKm = null;
  } else if (odometerKm != null && ctx.lastOdometerKm != null && odometerKm < ctx.lastOdometerKm) {
    // Kept, not dropped: a genuine meter replacement looks exactly like this,
    // and the distance layer already discards backward movement. Losing the
    // reading would lose the fuel level attached to it.
    warn(
      "odometerKm", ping.odometerKm,
      `Reads ${(ctx.lastOdometerKm - odometerKm).toFixed(0)} km below the last known value ` +
        `(${ctx.lastOdometerKm}). Stored, but it will not be counted as distance travelled.`,
    );
  }

  // --- engine hours ---
  let engineHours = finite(ping.engineHours);
  if (engineHours != null && engineHours < 0) {
    drop("engineHours", ping.engineHours, "Negative engine hours.");
    engineHours = null;
  } else if (engineHours != null && engineHours > limits.maxEngineHours) {
    drop("engineHours", ping.engineHours, `Above ${limits.maxEngineHours.toLocaleString("en-IN")} h — longer than any machine runs.`);
    engineHours = null;
  }

  // --- fuel ---
  const capacity = ctx.fuelCapacityL && ctx.fuelCapacityL > 0 ? ctx.fuelCapacityL : null;
  const ceiling = (capacity ?? limits.fallbackTankCapacityL) * limits.tankOverfillFactor;

  let fuelLevelL = finite(ping.fuelLevelLitres);
  if (fuelLevelL != null && fuelLevelL < 0) {
    drop("fuelLevelLitres", ping.fuelLevelLitres, "Negative fuel level.");
    fuelLevelL = null;
  } else if (fuelLevelL != null && fuelLevelL > ceiling) {
    drop(
      "fuelLevelLitres", ping.fuelLevelLitres,
      capacity
        ? `Exceeds the ${capacity} L tank (+${((limits.tankOverfillFactor - 1) * 100).toFixed(0)}% brim allowance).`
        : `Exceeds the ${limits.fallbackTankCapacityL} L ceiling used when tank size is unknown.`,
    );
    fuelLevelL = null;
  }

  let fuelLevelPct = finite(ping.fuelLevelPct);
  if (fuelLevelPct != null && (fuelLevelPct < 0 || fuelLevelPct > 100 * limits.tankOverfillFactor)) {
    drop("fuelLevelPct", ping.fuelLevelPct, "Outside 0…105%.");
    fuelLevelPct = null;
  }

  // A percentage and a litre figure that disagree mean one of them is being
  // read against the wrong tank. Neither is safe to use until that is resolved.
  if (fuelLevelL != null && fuelLevelPct != null && capacity) {
    const impliedPct = (fuelLevelL / capacity) * 100;
    if (Math.abs(impliedPct - fuelLevelPct) > 10) {
      warn(
        "fuel", { litres: fuelLevelL, pct: fuelLevelPct, capacity },
        `${fuelLevelL} L of a ${capacity} L tank is ${impliedPct.toFixed(1)}%, but the provider reports ` +
          `${fuelLevelPct}%. One of them is measured against a different tank.`,
      );
    }
  }

  const ignitionOn = typeof ping.ignitionState === "boolean" ? ping.ignitionState : null;

  const degraded = issues.some((i) => i.severity === "DROP_FIELD");

  return {
    accepted: true,
    degraded,
    issues,
    reading: {
      recordedAt, lat, lng, speedKph, headingDeg,
      odometerKm, engineHours, fuelLevelPct, fuelLevelL, ignitionOn,
      // Passed straight through from the provider, not from `ctx` — `ctx` holds
      // what the register believes, and the whole point here is to record what
      // the vehicle says when the register has nothing.
      fuelCapacityL: ping.fuelCapacityLitres ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Meter guards
// ---------------------------------------------------------------------------

/**
 * The fields it is safe to copy onto the asset's cached "digital twin" columns.
 *
 * Meters are monotonic and are used as billing and service denominators, so
 * they only ever move forward here. A provider glitch that winds an odometer
 * back would otherwise be permanent — the reading history can be re-derived,
 * but `Asset.meterValue` is a single mutable number with no audit trail behind
 * it.
 */
export function assetCacheUpdate(
  reading: NormalisedReading,
  asset: {
    meterValue: number;
    hourMeterValue: number;
    primaryMeter: string;
    /** Optional so existing callers are unaffected; when given, the vehicle can teach us its tank. */
    fuelCapacity?: number;
  },
): Record<string, unknown> {
  const patch: Record<string, unknown> = { lastSeen: reading.recordedAt };

  if (reading.lat != null && reading.lng != null) {
    patch.lat = reading.lat;
    patch.lng = reading.lng;
  }
  if (reading.speedKph != null) patch.speed = reading.speedKph;
  if (reading.fuelLevelPct != null) {
    patch.fuelLevelPct = reading.fuelLevelPct;
    patch.fuelLevelAt = reading.recordedAt;
  }
  // Only a vehicle whose primary meter *is* the odometer takes its meterValue
  // from one; an excavator is measured in engine hours and writing kilometres
  // into that column would make every service interval nonsense.
  if (reading.odometerKm != null && asset.primaryMeter === "ODOMETER" && reading.odometerKm >= asset.meterValue) {
    patch.meterValue = reading.odometerKm;
  }
  if (reading.engineHours != null && reading.engineHours >= asset.hourMeterValue) {
    patch.hourMeterValue = reading.engineHours;
    if (asset.primaryMeter === "SMU") patch.meterValue = reading.engineHours;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Let the vehicle tell us how big its tank is.
  //
  // Ten trucks were imported from a compliance spreadsheet, which records
  // document expiry and nothing about fuel, so each arrived with a capacity of
  // zero. Meanwhile every payload they sent carried `primaryFuelTankCapacity`
  // — 300 L, or 160 L on the smaller ones. A capacity of zero is not a
  // cosmetic gap: estimated range cannot be divided by it, the refuel detector
  // has no threshold, and the vehicle page reports "tank size not recorded"
  // about a vehicle that states its tank size every minute.
  //
  // Only ever fills a blank. A capacity somebody entered is a deliberate
  // record — a replaced tank, an auxiliary one — and a sensor default must not
  // silently overwrite it. The adapter has already rejected implausible values
  // before this point.
  // ───────────────────────────────────────────────────────────────────────────
  if (
    reading.fuelCapacityL != null &&
    reading.fuelCapacityL > 0 &&
    (asset.fuelCapacity == null || asset.fuelCapacity <= 0)
  ) {
    patch.fuelCapacity = reading.fuelCapacityL;
  }

  return patch;
}

// ---------------------------------------------------------------------------
// Schema drift
// ---------------------------------------------------------------------------

/**
 * Fields Fleet Edge sends today, recorded from 161 verified live samples for
 * RJ21GE3220 on 2026-08-12. This is the contract we believe we are coding
 * against; when it stops being true we want to be told, not to quietly start
 * reading nulls.
 */
export const FLEET_EDGE_KNOWN_FIELDS = [
  "acStatus", "accelX", "accelY", "accelZ", "backupBatteryVoltage", "crankOn",
  "currentGear", "defLevel", "defQuality", "engineRunHour", "eventDateTime",
  "gpsAltitude", "gpsCourseInDegrees", "gpsFix", "gpsLatitude", "gpsLongitude",
  "gpsSignalQuality", "gyroX", "gyroY", "gyroZ", "ignitionOn", "imei",
  "noOfFuelTanks", "noOfSatForFix", "odometer", "primaryFuelLevel",
  "primaryFuelTankCapacity", "registrationNumber", "secondaryFuelLevel1",
  "secondaryFuelTankCapacity1", "speed", "vehicleBatteryVoltage", "vehicleId",
  "vehicleStatus",
] as const;

/**
 * Fields that must be present for the ERP's calculations to mean anything. If
 * one of these disappears, a screen does not go blank — it quietly shows a
 * number derived from nothing, which is far worse.
 */
export const FLEET_EDGE_REQUIRED_FIELDS = [
  "eventDateTime", "odometer", "primaryFuelLevel", "registrationNumber",
] as const;

export type SchemaDrift = {
  /** Fields the provider has started sending that we have never seen. */
  added: string[];
  /** Known fields absent from this payload. */
  missing: string[];
  /** Required fields absent — calculations downstream will be wrong or empty. */
  missingRequired: string[];
  /** True when anything at all changed. */
  changed: boolean;
};

/**
 * Compares a raw payload against the recorded contract.
 *
 * Deliberately reports rather than enforces: a new field is usually harmless
 * and blocking a sync over one would be worse than the drift. A *missing
 * required* field is the case that matters, and callers surface it on the
 * provider's sync status where somebody will see it.
 */
export function detectSchemaDrift(
  raw: Record<string, unknown> | null | undefined,
  known: readonly string[] = FLEET_EDGE_KNOWN_FIELDS,
  required: readonly string[] = FLEET_EDGE_REQUIRED_FIELDS,
): SchemaDrift {
  const present = new Set(Object.keys(raw ?? {}));
  const knownSet = new Set(known);

  const added = [...present].filter((k) => !knownSet.has(k)).sort();
  const missing = known.filter((k) => !present.has(k)).sort();
  // A field sent as null is as absent as one not sent — it carries no value.
  const missingRequired = required
    .filter((k) => !present.has(k) || raw?.[k] == null)
    .sort();

  return { added, missing, missingRequired, changed: added.length > 0 || missing.length > 0 };
}

/** One-line summary for a sync status field or a log line. */
export function describeDrift(d: SchemaDrift): string | null {
  if (!d.changed && d.missingRequired.length === 0) return null;
  const bits: string[] = [];
  if (d.missingRequired.length) bits.push(`MISSING REQUIRED: ${d.missingRequired.join(", ")}`);
  if (d.missing.length) bits.push(`absent: ${d.missing.join(", ")}`);
  if (d.added.length) bits.push(`new: ${d.added.join(", ")}`);
  return bits.join(" | ");
}
