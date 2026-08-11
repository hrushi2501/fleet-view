// M9/M10 — Telemetry ingestion, fuel-level derivation and trip reconstruction.
//
// The fleet is mixed and always will be: some machines carry a GPS unit with a
// fuel sensor, some carry GPS with no fuel sensor, and plenty carry nothing at
// all. Rather than build two systems, everything lands in one telemetry stream
// tagged with where it came from, so downstream code — reconciliation, cost per
// km, theft detection — never has to care whether a number arrived from a sensor
// or from a photograph of a gauge.
//
//   GPS_API  provider pulled us the data
//   DEVICE   a tracker pushed it to us
//   MOBILE   the driver's phone, when the vehicle has no GPS
//   IMAGE    derived from a verified fuel-gauge photo
//
// The only rule is that an IMAGE reading must be verified before it is treated
// as fact, because a model's guess and a sensor's measurement are not the same
// kind of thing and pretending otherwise is how you get confident nonsense.

export type TelemetrySource = "GPS_API" | "DEVICE" | "MOBILE" | "IMAGE";

export type ReadingLite = {
  id: string;
  recordedAt: Date;
  lat: number | null;
  lng: number | null;
  speedKph: number | null;
  odometerKm: number | null;
  fuelLevelPct: number | null;
  ignitionOn: boolean | null;
  source: string;
};

/** Metres between two points (haversine). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** A jump further than this between consecutive pings is GPS drift, not travel. */
export const MAX_JUMP_M = 20000;
/** Speeds above this are noise from a bad fix. */
export const MAX_SPEED_KPH = 150;

export type TripPath = {
  distanceKm: number;
  points: number;
  movingMinutes: number;
  idleMinutes: number;
  maxSpeedKph: number;
  discarded: number;
  startAt: Date | null;
  endAt: Date | null;
};

/**
 * Reconstruct distance and moving time from a series of positions.
 *
 * Consumer GPS wanders when a vehicle is parked, and a single bad fix can add
 * kilometres that were never driven — which would then flow into cost-per-km and
 * fuel efficiency as fact. Implausible hops are dropped and counted, so the
 * figure is honest about what it ignored rather than silently inflated.
 */
export function reconstructPath(readings: ReadingLite[]): TripPath {
  const pts = readings
    .filter((r) => r.lat != null && r.lng != null)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  if (pts.length < 2) {
    return {
      distanceKm: 0, points: pts.length, movingMinutes: 0, idleMinutes: 0,
      maxSpeedKph: pts[0]?.speedKph ?? 0, discarded: 0,
      startAt: pts[0]?.recordedAt ?? null, endAt: pts[pts.length - 1]?.recordedAt ?? null,
    };
  }

  let metres = 0, moving = 0, idle = 0, discarded = 0, maxSpeed = 0;

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = distanceM(a.lat!, a.lng!, b.lat!, b.lng!);
    const minutes = (b.recordedAt.getTime() - a.recordedAt.getTime()) / 60000;

    if (d > MAX_JUMP_M) { discarded++; continue; }
    // Implied speed sanity — catches a fix that teleports over a short interval.
    if (minutes > 0 && (d / 1000) / (minutes / 60) > MAX_SPEED_KPH) { discarded++; continue; }

    metres += d;
    // A vehicle that moved less than 20 m between pings was standing still.
    if (d > 20) moving += minutes; else idle += minutes;
    maxSpeed = Math.max(maxSpeed, b.speedKph ?? 0);
  }

  return {
    distanceKm: metres / 1000,
    points: pts.length,
    movingMinutes: moving,
    idleMinutes: idle,
    maxSpeedKph: maxSpeed,
    discarded,
    startAt: pts[0].recordedAt,
    endAt: pts[pts.length - 1].recordedAt,
  };
}

/* ------------------------------ fuel from telemetry ------------------------------ */

export type FuelEvent = {
  at: Date;
  kind: "FILL" | "DROP";
  fromPct: number;
  toPct: number;
  deltaPct: number;
  litres: number | null;
  /** A drop while stationary with the engine off is the classic siphoning signature. */
  suspicious: boolean;
  reason: string;
};

/** Level changes smaller than this are sensor slosh, not events. */
export const FUEL_NOISE_PCT = 3;

/**
 * Find fills and drops in a fuel-level series.
 *
 * Tank level bounces around while a vehicle moves — fuel sloshes, senders lag —
 * so small changes are ignored. What matters is a sharp drop with the engine off
 * and the vehicle stationary: fuel cannot be burnt that way, so it left the tank
 * some other way.
 */
export function detectFuelEvents(readings: ReadingLite[], tankCapacityL = 0): FuelEvent[] {
  const pts = readings
    .filter((r) => r.fuelLevelPct != null)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  const out: FuelEvent[] = [];

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const delta = b.fuelLevelPct! - a.fuelLevelPct!;
    if (Math.abs(delta) < FUEL_NOISE_PCT) continue;

    const litres = tankCapacityL > 0 ? Math.abs(delta) * (tankCapacityL / 100) : null;
    const moved = a.lat != null && b.lat != null ? distanceM(a.lat, a.lng!, b.lat, b.lng!) : 0;
    const engineOff = b.ignitionOn === false && a.ignitionOn === false;
    const stationary = moved < 100;

    if (delta > 0) {
      out.push({
        at: b.recordedAt, kind: "FILL", fromPct: a.fuelLevelPct!, toPct: b.fuelLevelPct!,
        deltaPct: delta, litres, suspicious: false,
        reason: `Level rose ${delta.toFixed(1)}%${litres ? ` (~${litres.toFixed(0)} L)` : ""}.`,
      });
      continue;
    }

    const suspicious = stationary && engineOff;
    out.push({
      at: b.recordedAt, kind: "DROP", fromPct: a.fuelLevelPct!, toPct: b.fuelLevelPct!,
      deltaPct: delta, litres, suspicious,
      reason: suspicious
        ? `Level fell ${Math.abs(delta).toFixed(1)}%${litres ? ` (~${litres.toFixed(0)} L)` : ""} while parked with the engine off — fuel cannot be burnt this way.`
        : `Level fell ${Math.abs(delta).toFixed(1)}%${litres ? ` (~${litres.toFixed(0)} L)` : ""} in normal running.`,
    });
  }

  return out;
}

/* ------------------------------ image confidence ------------------------------ */

/** Readings at or above this are trusted without a human looking. */
export const AUTO_VERIFY_CONFIDENCE = 0.85;

export type GaugeExtraction = {
  levelPct: number | null;
  odometerKm: number | null;
  confidence: number;
  gaugeType: string | null;
  reasoning: string | null;
};

export type GaugeDecision = {
  status: "VERIFIED" | "PENDING";
  levelPct: number | null;
  litres: number | null;
  needsReview: boolean;
  reasons: string[];
};

/**
 * Decide whether a gauge photo can be trusted on its own.
 *
 * Auto-verifying everything would put model guesses into the fuel ledger as
 * fact; holding everything for review would make the feature useless at scale.
 * The split is on stated confidence, plus a plausibility check against the last
 * known level — a needle does not jump from a quarter to full without a fill.
 */
export function decideGaugeReading(
  x: GaugeExtraction,
  tankCapacityL = 0,
  previousPct: number | null = null,
  hoursSincePrevious = 0
): GaugeDecision {
  const reasons: string[] = [];

  if (x.levelPct == null) {
    return { status: "PENDING", levelPct: null, litres: null, needsReview: true, reasons: ["Gauge could not be read from the photo."] };
  }

  const pct = Math.max(0, Math.min(100, x.levelPct));
  if (pct !== x.levelPct) reasons.push(`Reading ${x.levelPct} clamped to ${pct}%.`);

  let ok = x.confidence >= AUTO_VERIFY_CONFIDENCE;
  if (!ok) reasons.push(`Confidence ${(x.confidence * 100).toFixed(0)}% is below the ${AUTO_VERIFY_CONFIDENCE * 100}% auto-accept threshold.`);

  // An analog needle read to a false precision deserves suspicion.
  if (x.gaugeType === "ANALOG_NEEDLE" && x.confidence < 0.95 && pct % 1 !== 0) {
    reasons.push("Analog needle read to a fractional percentage — treat as approximate.");
  }

  // A rise without a recorded fill, or a fall too steep to be consumption.
  if (previousPct != null) {
    const delta = pct - previousPct;
    if (delta > 15) {
      ok = false;
      reasons.push(`Level rose ${delta.toFixed(0)}% since the last reading with no fill recorded.`);
    } else if (delta < -40 && hoursSincePrevious < 4) {
      ok = false;
      reasons.push(`Level fell ${Math.abs(delta).toFixed(0)}% in under ${hoursSincePrevious.toFixed(1)} hours — steeper than consumption explains.`);
    }
  }

  return {
    status: ok ? "VERIFIED" : "PENDING",
    levelPct: pct,
    litres: tankCapacityL > 0 ? (pct / 100) * tankCapacityL : null,
    needsReview: !ok,
    reasons,
  };
}

/* --------------------------------- sessions --------------------------------- */

/** A session left open longer than this is treated as forgotten, not active. */
export const SESSION_STALE_HOURS = 18;

export type SessionLite = {
  id: string;
  assetId: string;
  driverId: string;
  startedAt: Date;
  endedAt: Date | null;
  status: string;
};

export type ScanOutcome =
  | { ok: true; action: "START" | "RESUME"; message: string; releaseSessionId?: string }
  | { ok: false; reason: string; blockingSessionId?: string };

/**
 * Decide what a QR scan should do.
 *
 * Three cases matter and each has an obviously right answer:
 *   - the driver already holds this vehicle → resume, don't spawn a duplicate
 *   - the driver holds a *different* vehicle → close that one, they cannot drive two
 *   - somebody else holds this vehicle → refuse, because two drivers on one
 *     machine makes every downstream number unattributable
 */
export function evaluateScan(
  assetId: string,
  driverId: string,
  openSessions: SessionLite[],
  now = new Date()
): ScanOutcome {
  const live = openSessions.filter(
    (s) => s.status === "ACTIVE" && (now.getTime() - s.startedAt.getTime()) / 3.6e6 <= SESSION_STALE_HOURS
  );

  const mineOnThis = live.find((s) => s.assetId === assetId && s.driverId === driverId);
  if (mineOnThis) return { ok: true, action: "RESUME", message: "You are already checked in to this vehicle." };

  const heldByOther = live.find((s) => s.assetId === assetId && s.driverId !== driverId);
  if (heldByOther) {
    return {
      ok: false,
      reason: "Another driver is currently checked in to this vehicle. They must check out first, or a supervisor can release it.",
      blockingSessionId: heldByOther.id,
    };
  }

  const mineElsewhere = live.find((s) => s.driverId === driverId && s.assetId !== assetId);
  if (mineElsewhere) {
    return {
      ok: true, action: "START",
      message: "Checked in. Your previous vehicle has been checked out automatically.",
      releaseSessionId: mineElsewhere.id,
    };
  }

  return { ok: true, action: "START", message: "Checked in." };
}

/** Sessions past the stale window, for the sweeper to close. */
export function staleSessions(sessions: SessionLite[], now = new Date()): SessionLite[] {
  return sessions.filter(
    (s) => s.status === "ACTIVE" && (now.getTime() - s.startedAt.getTime()) / 3.6e6 > SESSION_STALE_HOURS
  );
}

/** Opaque, unguessable token for the cabin sticker. */
export function makeQrToken(bytes: Uint8Array): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous characters
  return "FV-" + Array.from(bytes).map((b) => A[b % A.length]).join("");
}

export const PROVIDERS = [
  { code: "GENERIC", name: "Generic / direct device push", apiBaseUrl: "", apiKeyEnv: "" },
  { code: "MAPMYINDIA", name: "MapmyIndia (Mappls)", apiBaseUrl: "https://apis.mappls.com", apiKeyEnv: "MAPMYINDIA_API_KEY" },
  { code: "LOCONAV", name: "LocoNav", apiBaseUrl: "https://api.loconav.com", apiKeyEnv: "LOCONAV_API_KEY" },
  { code: "WHEELSEYE", name: "WheelsEye", apiBaseUrl: "https://api.wheelseye.com", apiKeyEnv: "WHEELSEYE_API_KEY" },
];
