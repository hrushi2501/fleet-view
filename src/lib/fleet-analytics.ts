/**
 * Derived fleet metrics from raw OEM telemetry.
 *
 * Everything here works on *consecutive pairs* of readings. A single snapshot
 * says where a vehicle is; only the gap between two says what it did — how far
 * it went, what it burned, and whether those two agree.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SAMPLING IS THE LIMIT, NOT THE MATHS
 *
 * Confidence in every output below is a function of how often the vehicle is
 * polled. At one sample a day a 40-litre siphon and a hard day's haulage are
 * the same number; the algorithms cannot separate them, and they say so via
 * `confidence` rather than pretending otherwise. At 15-minute sampling a
 * stationary drop is unambiguous, because a parked vehicle cannot burn fuel.
 *
 * Read `confidence` before acting on anything here. Accusing a driver on a
 * daily sample is how a fleet system loses the trust of the people using it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type AnalyticsReading = {
  recordedAt: Date;
  lat: number | null;
  lng: number | null;
  speedKph: number | null;
  odometerKm: number | null;
  fuelLevelL: number | null;
  fuelLevelPct: number | null;
  ignitionOn: boolean | null;
};

export type FuelEventKind =
  | "REFUEL"
  | "NORMAL"
  | "EXCESS_CONSUMPTION"
  | "STATIONARY_DROP";

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type Segment = {
  from: Date;
  to: Date;
  hours: number;
  /** Odometer delta — what the vehicle says it travelled. */
  distanceKm: number | null;
  /** Straight-line GPS distance — always ≤ road distance, so a useful floor. */
  gpsDistanceKm: number | null;
  /** Negative = burned, positive = filled. */
  fuelDeltaL: number | null;
  litresConsumed: number | null;
  kmPerL: number | null;
  event: FuelEventKind;
  /** Litres beyond what the norm can explain. Zero unless suspicious. */
  excessLitres: number;
  confidence: Confidence;
  reasons: string[];
};

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export type Norm = { normLow: number; normHigh: number; tolerancePct: number };

/** Below this, treat the vehicle as having stayed put — manoeuvring, not travel. */
const STATIONARY_KM = 2;
/**
 * Floor on what counts as a finding, in litres. Tank senders slosh, round and
 * drift by a litre or two; without this the queue fills with noise and the real
 * cases are buried under it.
 */
const MIN_MEANINGFUL_DROP_L = 5;
/** Tank movement above this share of capacity reads as a fill, not a burn. */
const REFUEL_FRACTION = 0.02;
/**
 * Idle burn for a heavy vehicle with no LPH norm on record, litres/hour.
 * Deliberately generous: a truck idling with the AC on genuinely drinks this,
 * and over-allowing costs a missed case while under-allowing accuses an
 * innocent driver every time they wait at a loading bay.
 */
const DEFAULT_IDLE_LPH = 4;

/**
 * Sampling gap beyond which a stationary drop stops being conclusive: the
 * vehicle had time to drive away and return between samples, so "it did not
 * move" only means "it was in the same place twice".
 */
const CONCLUSIVE_GAP_HOURS = 1;

export function analyseSegment(
  a: AnalyticsReading,
  b: AnalyticsReading,
  norm: Norm | null,
  tankCapacityL: number | null,
  /** Litres/hour this machine burns standing still, when a norm is on record. */
  idleLph: number | null = null,
): Segment {
  const hours = (b.recordedAt.getTime() - a.recordedAt.getTime()) / 3_600_000;

  const distanceKm =
    a.odometerKm != null && b.odometerKm != null ? round(b.odometerKm - a.odometerKm, 2) : null;

  const gpsDistanceKm =
    a.lat != null && a.lng != null && b.lat != null && b.lng != null
      ? round(haversineKm(a.lat, a.lng, b.lat, b.lng), 2)
      : null;

  const fuelDeltaL =
    a.fuelLevelL != null && b.fuelLevelL != null ? round(b.fuelLevelL - a.fuelLevelL, 2) : null;

  const reasons: string[] = [];
  let event: FuelEventKind = "NORMAL";
  let excessLitres = 0;
  let litresConsumed: number | null = null;
  let kmPerL: number | null = null;

  const refuelThreshold = tankCapacityL ? tankCapacityL * REFUEL_FRACTION : 5;

  if (fuelDeltaL != null && fuelDeltaL > refuelThreshold) {
    event = "REFUEL";
    reasons.push(`Tank rose ${fuelDeltaL.toFixed(1)} L — recorded as a fill, not consumption.`);
  } else if (fuelDeltaL != null && fuelDeltaL < 0) {
    litresConsumed = round(-fuelDeltaL, 2);

    if (distanceKm != null && distanceKm > 0) {
      kmPerL = round(distanceKm / litresConsumed, 2);
    }

    const movedKm = distanceKm ?? gpsDistanceKm ?? 0;

    if (movedKm < STATIONARY_KM) {
      // A vehicle that did not travel can still legitimately burn fuel — by
      // idling. Charge that against time, not distance, because distance-based
      // norms divide by ~zero here and flag every loading bay as a theft.
      const engineRan = a.ignitionOn === true || b.ignitionOn === true;
      const idleAllowance = engineRan ? (idleLph ?? DEFAULT_IDLE_LPH) * hours : 0;
      const unexplained = litresConsumed - idleAllowance;

      if (unexplained >= MIN_MEANINGFUL_DROP_L) {
        event = "STATIONARY_DROP";
        excessLitres = round(unexplained, 2);
        reasons.push(
          `${litresConsumed.toFixed(1)} L left the tank while the vehicle moved ` +
            `${movedKm.toFixed(1)} km over ${hours.toFixed(1)} h.`,
        );
        if (!engineRan) {
          reasons.push(
            "Ignition was off at both ends of the window — a parked engine burns nothing, " +
              "so this fuel did not leave through the exhaust.",
          );
        } else {
          reasons.push(
            `Idling at ${(idleLph ?? DEFAULT_IDLE_LPH)} L/h accounts for only ` +
              `${idleAllowance.toFixed(1)} L of it.`,
          );
        }
      }
    } else if (norm && distanceKm != null) {
      // Worst credible burn: the journey driven at the *poorest* efficiency the
      // norm permits, plus its tolerance. Fuel beyond that is fuel the journey
      // cannot account for.
      const worstCaseLitres = distanceKm / norm.normLow;
      const allowance = worstCaseLitres * (1 + norm.tolerancePct / 100);
      const unexplained = litresConsumed - allowance;

      if (unexplained >= MIN_MEANINGFUL_DROP_L) {
        event = "EXCESS_CONSUMPTION";
        excessLitres = round(unexplained, 2);
        reasons.push(
          `Burned ${litresConsumed.toFixed(1)} L over ${distanceKm.toFixed(1)} km ` +
            `(${kmPerL?.toFixed(2)} km/L). The norm allows up to ${allowance.toFixed(1)} L ` +
            `at ${norm.normLow} km/L +${norm.tolerancePct}% tolerance.`,
        );
      }
    }
  }

  // An odometer that advances far less than the GPS track is either broken or
  // being interfered with — and it is the denominator of every efficiency
  // figure, so it is worth catching early.
  if (distanceKm != null && gpsDistanceKm != null && gpsDistanceKm > 5 && distanceKm < gpsDistanceKm * 0.8) {
    reasons.push(
      `Odometer advanced ${distanceKm.toFixed(1)} km but GPS shows at least ` +
        `${gpsDistanceKm.toFixed(1)} km of movement — odometer may be under-reading.`,
    );
  }

  return {
    from: a.recordedAt,
    to: b.recordedAt,
    hours: round(hours, 2),
    distanceKm,
    gpsDistanceKm,
    fuelDeltaL,
    litresConsumed,
    kmPerL,
    event,
    excessLitres,
    confidence: confidenceFor(event, hours),
    reasons,
  };
}

/**
 * How much weight the finding can carry. A long gap between samples is the
 * enemy of every conclusion here.
 */
function confidenceFor(event: FuelEventKind, hours: number): Confidence {
  if (event === "NORMAL" || event === "REFUEL") return "HIGH";
  if (hours <= CONCLUSIVE_GAP_HOURS) return "HIGH";
  if (hours <= 6) return "MEDIUM";
  return "LOW";
}

export function analyseReadings(
  readings: AnalyticsReading[],
  norm: Norm | null,
  tankCapacityL: number | null,
  idleLph: number | null = null,
): Segment[] {
  const ordered = [...readings].sort((x, y) => x.recordedAt.getTime() - y.recordedAt.getTime());
  const out: Segment[] = [];
  for (let i = 1; i < ordered.length; i++) {
    out.push(analyseSegment(ordered[i - 1], ordered[i], norm, tankCapacityL, idleLph));
  }
  return out;
}

export type UsageSummary = {
  segments: number;
  windowHours: number;
  distanceKm: number;
  litresBurned: number;
  litresFilled: number;
  avgKmPerL: number | null;
  suspectSegments: number;
  litresUnaccounted: number;
  /** Longest gap between samples — the honest measure of how blind we are. */
  worstGapHours: number;
};

export function summarise(segments: Segment[]): UsageSummary {
  let distanceKm = 0;
  let litresBurned = 0;
  let litresFilled = 0;
  let litresUnaccounted = 0;
  let suspectSegments = 0;
  let windowHours = 0;
  let worstGapHours = 0;

  for (const s of segments) {
    windowHours += s.hours;
    worstGapHours = Math.max(worstGapHours, s.hours);
    if (s.distanceKm && s.distanceKm > 0) distanceKm += s.distanceKm;
    if (s.litresConsumed) litresBurned += s.litresConsumed;
    if (s.fuelDeltaL && s.fuelDeltaL > 0) litresFilled += s.fuelDeltaL;
    if (s.event === "STATIONARY_DROP" || s.event === "EXCESS_CONSUMPTION") {
      suspectSegments++;
      litresUnaccounted += s.excessLitres;
    }
  }

  return {
    segments: segments.length,
    windowHours: round(windowHours, 2),
    distanceKm: round(distanceKm, 2),
    litresBurned: round(litresBurned, 2),
    litresFilled: round(litresFilled, 2),
    // Fleet-wide efficiency is total distance over total burn, never the mean
    // of per-segment figures — a 2 km hop would otherwise weigh as much as a
    // 400 km haul.
    avgKmPerL: litresBurned > 0 ? round(distanceKm / litresBurned, 2) : null,
    suspectSegments,
    litresUnaccounted: round(litresUnaccounted, 2),
    worstGapHours: round(worstGapHours, 2),
  };
}

/** 0–100 risk score for a suspect segment, used to rank the case queue. */
export function riskScore(segment: Segment, tankCapacityL: number | null): number {
  if (segment.excessLitres <= 0) return 0;
  const capacity = tankCapacityL && tankCapacityL > 0 ? tankCapacityL : 300;
  // Share of a full tank that cannot be explained, which scales across a
  // 60 L pickup and a 300 L truck alike.
  const share = Math.min(segment.excessLitres / capacity, 1);
  let score = Math.round(share * 100);
  if (segment.event === "STATIONARY_DROP") score += 25;
  if (segment.confidence === "HIGH") score += 15;
  else if (segment.confidence === "LOW") score -= 20;
  return Math.max(1, Math.min(100, score));
}

export function severityFor(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 65) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
