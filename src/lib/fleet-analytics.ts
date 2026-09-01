/**
 * Derived fleet metrics from raw OEM telemetry.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE WAS REWRITTEN — read before changing the maths
 *
 * The first version accumulated consumption tick by tick:
 *
 *     for each consecutive pair: if (fuel fell) burned += drop
 *
 * That is full-wave rectification of a noisy signal, and it is wrong for any
 * fuel sender ever fitted to a truck. A float sender quantises (this fleet's
 * reports in steps of 0.3–1.5 L on a 300 L tank) and the fuel physically
 * sloshes, so the reported level walks up and down around the true value. Every
 * downward step of that walk was booked as diesel burned and every upward step
 * as diesel filled, so both totals grew without limit while the tank did
 * nothing. Measured on the live vehicle over 42 h: 128.8 L "burned" and 68.1 L
 * "filled" from a tank that actually fell 60.7 L — and the error scales with
 * polling rate, so moving from 15-minute to 2-minute sampling made it ~7× worse
 * rather than better.
 *
 * The correction is to stop integrating the noise and use conservation of mass
 * instead. Over any window, for a tank that is only ever filled or burnt:
 *
 *     consumed = startLevel − endLevel + Σ refuelled
 *
 * Only the two endpoints and the refuels matter; every intermediate wobble
 * cancels. So the algorithm's real job is to identify refuels robustly and to
 * reject readings that cannot be trusted — not to add up deltas.
 *
 * Thresholds are calibrated against the live fleet, not guessed. Across pairs
 * where the engine was off and the odometer static — where physics guarantees
 * zero consumption — the reported level still moved by up to 1.3 L. While
 * running, excursions reached 9.6 L in 60 seconds, which would be 576 L/h and
 * is plainly the tank sloshing, not the engine drinking.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SAMPLING IS THE LIMIT, NOT THE MATHS
 *
 * Confidence in every output below is a function of how often the vehicle is
 * polled. At one sample a day a 40-litre siphon and a hard day's haulage are
 * the same number; the algorithms cannot separate them, and they say so via
 * `confidence` rather than pretending otherwise.
 *
 * Read `confidence` before acting on anything here. Accusing a driver on a
 * daily sample is how a fleet system loses the trust of the people using it.
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
  | "STATIONARY_DROP"
  /** Movement too small to be distinguished from sender noise. */
  | "NOISE"
  /** A drop too fast for any engine to have burnt it — a data fault, not a theft. */
  | "IMPLAUSIBLE_DROP";

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Every threshold the analysis depends on, in one place so they can be tuned
 * per fleet rather than hunted down across the codebase.
 *
 * Fuel thresholds are expressed as a fraction of tank capacity *and* as an
 * absolute floor, because a 55 L pickup and a 300 L tipper do not share a
 * sensible litre threshold but do share a sensible percentage one.
 */
export type FuelAnalysisConfig = {
  /**
   * Level movement below this is sender noise, not a real change. The live
   * fleet moves up to 1.3 L with the engine off and the wheels still, and up to
   * ~3 L at the 90th percentile while running; 1.5% of a 300 L tank is 4.5 L,
   * which clears both with margin.
   */
  noiseBandFractionOfTank: number;
  /** Absolute floor for the noise band, litres — for tanks too small to scale. */
  noiseBandMinL: number;
  /** A sustained rise of at least this much is a refuel rather than slosh. */
  refuelFractionOfTank: number;
  refuelMinL: number;
  /**
   * A rise must still be there this many readings later to be booked as a fill.
   * A single high sample is a splash; a fill does not drain away by itself.
   */
  refuelConfirmSamples: number;
  /**
   * Litres/hour above which a drop cannot be combustion. A large truck diesel
   * at full load peaks near 60 L/h, so this is deliberately generous — it is
   * here to catch 500 L/h sensor glitches, not to second-guess a hard shift.
   */
  maxBurnRateLph: number;
  /** Idle burn when no LPH norm is on record, litres/hour. */
  defaultIdleLph: number;
  /** Sampling this often or better is what the theft detection was designed for. */
  normalGapMinutes: number;
  /** Beyond this a stationary drop stops being conclusive. Hours. */
  warningGapHours: number;
  /** Beyond this the window is a blind spot, not a measurement. Hours. */
  staleGapHours: number;
  /** Share of the window inside normal/warning gaps needed for each confidence. */
  minCoverageForHigh: number;
  minCoverageForMedium: number;
  minSamplesForHigh: number;
  minSamplesForMedium: number;
  /** Odometer jumps implying more than this are a provider glitch. km/h. */
  maxPlausibleSpeedKph: number;
  /** Below this a vehicle counts as having stayed put — manoeuvring, not travel. */
  stationaryKm: number;
  /** Floor on what counts as a *finding*, in litres, after allowances. */
  minMeaningfulDropL: number;
};

export const DEFAULT_FUEL_CONFIG: FuelAnalysisConfig = {
  noiseBandFractionOfTank: 0.015,
  noiseBandMinL: 2,
  refuelFractionOfTank: 0.05,
  refuelMinL: 15,
  refuelConfirmSamples: 1,
  maxBurnRateLph: 120,
  defaultIdleLph: 4,
  normalGapMinutes: 15,
  warningGapHours: 1,
  staleGapHours: 6,
  minCoverageForHigh: 0.8,
  minCoverageForMedium: 0.5,
  minSamplesForHigh: 30,
  minSamplesForMedium: 10,
  maxPlausibleSpeedKph: 120,
  stationaryKm: 2,
  minMeaningfulDropL: 5,
};

/** The two fuel thresholds resolved against a specific tank. */
export function fuelThresholds(tankCapacityL: number | null, cfg: FuelAnalysisConfig) {
  const capacity = tankCapacityL && tankCapacityL > 0 ? tankCapacityL : null;
  const noiseBandL = capacity
    ? Math.max(cfg.noiseBandMinL, capacity * cfg.noiseBandFractionOfTank)
    : cfg.noiseBandMinL;
  const refuelMinL = capacity
    ? Math.max(cfg.refuelMinL, capacity * cfg.refuelFractionOfTank)
    : cfg.refuelMinL;
  return { noiseBandL: round(noiseBandL, 2), refuelMinL: round(refuelMinL, 2) };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Sample hygiene
// ---------------------------------------------------------------------------

export type SeriesHygiene = {
  received: number;
  used: number;
  /** Same timestamp as a sample already kept. */
  duplicateTimestamps: number;
  /** Fuel level outside the physical range of the tank; the level is dropped. */
  impossibleLevels: number;
  /** No timestamp we can order by. */
  unusable: number;
};

/**
 * Sorts, de-duplicates and sanity-checks a reading series.
 *
 * The snapshot endpoint reports a parked vehicle's *last* state on every poll,
 * so identical rows are normal and must not read as fresh evidence. Timestamp
 * is the identity: two samples from the same instant describe one moment,
 * however many times we asked for it.
 */
export function cleanSeries(
  readings: AnalyticsReading[],
  tankCapacityL: number | null,
): { samples: AnalyticsReading[]; hygiene: SeriesHygiene } {
  const hygiene: SeriesHygiene = {
    received: readings.length,
    used: 0,
    duplicateTimestamps: 0,
    impossibleLevels: 0,
    unusable: 0,
  };

  const usable = readings.filter((r) => {
    const ok = r.recordedAt instanceof Date && Number.isFinite(r.recordedAt.getTime());
    if (!ok) hygiene.unusable++;
    return ok;
  });

  const ordered = [...usable].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  // Tanks do not hold more than they hold. A little headroom absorbs the
  // sender reading slightly over full on a brimmed tank.
  const ceiling = tankCapacityL && tankCapacityL > 0 ? tankCapacityL * 1.05 : null;

  const samples: AnalyticsReading[] = [];
  let lastAt = Number.NaN;

  for (const r of ordered) {
    const t = r.recordedAt.getTime();
    if (t === lastAt) {
      hygiene.duplicateTimestamps++;
      continue;
    }
    lastAt = t;

    let fuelLevelL = r.fuelLevelL;
    if (fuelLevelL != null && (!Number.isFinite(fuelLevelL) || fuelLevelL < 0 || (ceiling != null && fuelLevelL > ceiling))) {
      hygiene.impossibleLevels++;
      fuelLevelL = null;
    }

    samples.push({ ...r, fuelLevelL });
  }

  hygiene.used = samples.length;
  return { samples, hygiene };
}

// ---------------------------------------------------------------------------
// Fuel series — the core correction
// ---------------------------------------------------------------------------

export type RefuelEvent = {
  at: Date;
  fromL: number;
  toL: number;
  litresAdded: number;
  lat: number | null;
  lng: number | null;
  /** Whether the raised level was still there on the following sample(s). */
  confirmed: boolean;
  confidence: Confidence;
  /** Sampling gap the fill was seen across — a wide one could hide two fills. */
  hoursObserved: number;
};

/**
 * How long a single physical refuel may take.
 *
 * A nozzle in a tank raises the level continuously, and a sender reporting once
 * a minute sees that as a staircase rather than a step. Every tread clears the
 * refuel threshold on its own, so without this the loop below books each one as
 * a separate fill.
 *
 * RJ21GE2479 on 31 Aug is the case that exposed it: 149.7 L to 300.0 L between
 * 04:55:49 and 04:59:49 IST, stationary, ignition on — one fill of 150.3 L,
 * reported to the Fuel screen as three (43.6 L, 56.3 L, 50.4 L) and priced
 * three times over.
 *
 * Ten minutes is comfortably longer than filling a 300 L tank and far shorter
 * than the gap between two genuine visits to a pump.
 */
const FILL_COALESCE_MINUTES = 10;

/**
 * Joins the treads back into one staircase.
 *
 * Two events belong to the same fill when the later one begins where the
 * earlier ended — which the baseline reset guarantees exactly — and follows it
 * within the window above. The merged event keeps the first fill's starting
 * level, the last one's finishing level, and the sum of the litres, so the mass
 * balance is unchanged: this only stops one fill being counted as several.
 */
function coalesceRefuels(events: RefuelEvent[], cfg: FuelAnalysisConfig): RefuelEvent[] {
  if (events.length < 2) return events;

  const merged: RefuelEvent[] = [];
  for (const next of events) {
    const open = merged[merged.length - 1];
    const contiguous =
      open !== undefined &&
      Math.abs(next.fromL - open.toL) < 0.05 &&
      next.at.getTime() - open.at.getTime() <= FILL_COALESCE_MINUTES * 60_000;

    if (!open || !contiguous) {
      merged.push({ ...next });
      continue;
    }

    open.toL = next.toL;
    open.litresAdded = round(open.litresAdded + next.litresAdded, 2);
    open.hoursObserved = round(open.hoursObserved + next.hoursObserved, 2);
    // The position where filling finished is where the vehicle actually stood.
    open.lat = next.lat;
    open.lng = next.lng;
    open.at = next.at;
    open.confidence =
      open.hoursObserved <= 0.5 ? "HIGH" : open.hoursObserved <= cfg.warningGapHours ? "MEDIUM" : "LOW";
  }

  return merged;
}


export type ImplausibleDrop = {
  at: Date;
  litres: number;
  hours: number;
  impliedLph: number;
};

export type FuelSeriesAnalysis = {
  startLevelL: number | null;
  endLevelL: number | null;
  /** startLevel − endLevel + refuelled, floored at zero. */
  litresConsumed: number;
  litresRefuelled: number;
  refuels: RefuelEvent[];
  implausibleDrops: ImplausibleDrop[];
  /** Number of samples that actually carried a fuel level. */
  levelSamples: number;
  /** ± uncertainty on litresConsumed from sender resolution at each endpoint. */
  uncertaintyL: number;
  noiseBandL: number;
  refuelThresholdL: number;
  /** Confirmed drops first seen across a gap wider than the stale threshold. */
  litresAcrossStaleGaps: number;
  /** True when the whole level change is smaller than the sender can resolve. */
  withinNoise: boolean;
};

/**
 * Derives consumption and refuels from a fuel-level series.
 *
 * Consumption comes from conservation of mass across the window's endpoints,
 * not from summing deltas — see the file header for why. The walk below exists
 * to find the refuels that the mass balance needs, and to notice drops that no
 * engine could have produced.
 *
 * The baseline is a hysteresis tracker: it only moves when the level leaves a
 * band around it, so slosh and quantisation never move it, while a genuine
 * trend eventually accumulates past the band and does. Nothing is discarded by
 * the band — a slow drain is recognised late and in a lump, not lost, because
 * the final number comes from the endpoints regardless.
 */
export function analyseFuelSeries(
  samples: AnalyticsReading[],
  tankCapacityL: number | null,
  cfg: FuelAnalysisConfig = DEFAULT_FUEL_CONFIG,
): FuelSeriesAnalysis {
  const { noiseBandL, refuelMinL } = fuelThresholds(tankCapacityL, cfg);

  const levelled = samples.filter((s) => s.fuelLevelL != null);
  const base: FuelSeriesAnalysis = {
    startLevelL: null,
    endLevelL: null,
    litresConsumed: 0,
    litresRefuelled: 0,
    refuels: [],
    implausibleDrops: [],
    levelSamples: levelled.length,
    uncertaintyL: round(noiseBandL, 2),
    noiseBandL,
    refuelThresholdL: refuelMinL,
    litresAcrossStaleGaps: 0,
    withinNoise: true,
  };

  if (levelled.length < 2) return base;

  const startLevelL = levelled[0].fuelLevelL!;
  const endLevelL = levelled[levelled.length - 1].fuelLevelL!;

  const refuels: RefuelEvent[] = [];
  const implausibleDrops: ImplausibleDrop[] = [];
  let litresAcrossStaleGaps = 0;

  let baseline = startLevelL;
  let baselineAt = levelled[0].recordedAt;

  for (let i = 1; i < levelled.length; i++) {
    const r = levelled[i];
    const level = r.fuelLevelL!;
    const delta = level - baseline;
    const hoursSinceBaseline = (r.recordedAt.getTime() - baselineAt.getTime()) / 3_600_000;

    if (delta <= -noiseBandL) {
      // A fall that has cleared the noise band. Before accepting it, ask
      // whether an engine could physically have burnt it in the time available.
      const impliedLph = hoursSinceBaseline > 0 ? -delta / hoursSinceBaseline : Infinity;

      if (impliedLph > cfg.maxBurnRateLph) {
        // Not combustion. Could be a sender fault, a splash against a baffle,
        // or fuel genuinely removed very fast — all worth a human look, none
        // safe to book as consumption. The baseline still follows the tank so
        // the mass balance stays anchored to reality.
        implausibleDrops.push({
          at: r.recordedAt,
          litres: round(-delta, 2),
          hours: round(hoursSinceBaseline, 3),
          impliedLph: Number.isFinite(impliedLph) ? round(impliedLph, 1) : -1,
        });
      } else if (hoursSinceBaseline > cfg.staleGapHours) {
        litresAcrossStaleGaps += -delta;
      }

      baseline = level;
      baselineAt = r.recordedAt;
      continue;
    }

    if (delta >= refuelMinL) {
      // A rise big enough to be a fill. Confirm it persisted: fuel that is
      // really in the tank is still there on the next sample, a splash is not.
      const confirmed = confirmRise(levelled, i, baseline + refuelMinL, cfg.refuelConfirmSamples);
      if (confirmed) {
        refuels.push({
          at: r.recordedAt,
          fromL: round(baseline, 2),
          toL: round(level, 2),
          litresAdded: round(delta, 2),
          lat: r.lat,
          lng: r.lng,
          confirmed: true,
          // A fill seen across a tight window is an observation; one inferred
          // across hours could be two fills, or a fill and a siphon.
          confidence:
            hoursSinceBaseline <= 0.5 ? "HIGH" : hoursSinceBaseline <= cfg.warningGapHours ? "MEDIUM" : "LOW",
          hoursObserved: round(hoursSinceBaseline, 2),
        });
        baseline = level;
        baselineAt = r.recordedAt;
      }
      continue;
    }

    // Inside the band, or an unconfirmed rise: the tank has not demonstrably
    // moved. Leave the baseline where it is.
  }

  const fills = coalesceRefuels(refuels, cfg);

  const litresRefuelled = fills.reduce((s, e) => s + e.litresAdded, 0);
  const netDrop = startLevelL - endLevelL;
  const rawConsumed = netDrop + litresRefuelled;

  // A negative result means the refuels we found exceed the tank's net change,
  // which is a detection error rather than negative consumption. Floor it and
  // let confidence carry the doubt.
  const litresConsumed = Math.max(0, rawConsumed);

  // Each endpoint carries the sender's own resolution, so the difference of two
  // of them carries both.
  const uncertaintyL = round(noiseBandL * 2, 2);

  return {
    startLevelL: round(startLevelL, 2),
    endLevelL: round(endLevelL, 2),
    litresConsumed: round(litresConsumed, 2),
    litresRefuelled: round(litresRefuelled, 2),
    refuels: fills,
    implausibleDrops,
    levelSamples: levelled.length,
    uncertaintyL,
    noiseBandL,
    refuelThresholdL: refuelMinL,
    litresAcrossStaleGaps: round(litresAcrossStaleGaps, 2),
    // Below this the tank has not moved by more than the sender can resolve, so
    // "how much was burnt" has no answer worth printing.
    withinNoise: litresConsumed <= noiseBandL && fills.length === 0,
  };
}

/** Whether a rise is still present `hold` samples later. */
function confirmRise(levelled: AnalyticsReading[], index: number, floor: number, hold: number): boolean {
  if (hold <= 0) return true;
  let seen = 0;
  for (let j = index + 1; j < levelled.length && seen < hold; j++) {
    if ((levelled[j].fuelLevelL ?? -Infinity) < floor) return false;
    seen++;
  }
  // The series ending right after the rise is not disproof; a fill on the last
  // sample is still a fill. Treat it as confirmed but let its own confidence
  // and the series confidence carry the caveat.
  return true;
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

export type DistanceAnalysis = {
  /** Sum of plausible forward odometer movement. */
  odometerKm: number | null;
  /** Straight-line GPS track — always ≤ road distance, so a floor, not a rival. */
  gpsKm: number | null;
  chosenKm: number;
  source: "ODOMETER" | "GPS" | "NONE";
  odometerSamples: number;
  /** Odometer went backwards — a provider glitch or a meter swap. */
  odometerRollbacks: number;
  /** Movement implying an impossible speed, dropped from both figures. */
  rejectedJumps: number;
};

/**
 * Measures distance, preferring the vehicle's own odometer.
 *
 * The odometer wins on every axis that matters here: it measures road distance
 * rather than straight lines between fixes, it is maintained by the ECU rather
 * than inferred, it does not wander while the vehicle is parked, and it does
 * not silently under-report when the sky is blocked. GPS is kept as a floor and
 * as a cross-check — a track substantially longer than the odometer's advance
 * is evidence the odometer is under-reading — and is used for the headline only
 * when there is no usable odometer at all.
 *
 * Distance is summed from consecutive forward movement rather than taken as
 * last-minus-first, so a meter reset or a single wild sample costs one segment
 * instead of poisoning the whole window.
 */
export function analyseDistance(
  samples: AnalyticsReading[],
  cfg: FuelAnalysisConfig = DEFAULT_FUEL_CONFIG,
): DistanceAnalysis {
  let odoKm = 0;
  let odoSamples = 0;
  let rollbacks = 0;
  let rejected = 0;
  let gpsKm = 0;
  let gpsPairs = 0;

  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const hours = (b.recordedAt.getTime() - a.recordedAt.getTime()) / 3_600_000;
    // A jump is judged against the time available to make it. Over a long gap
    // almost any distance is possible, so the ceiling relaxes with the gap.
    const ceilingKm = Math.max(cfg.maxPlausibleSpeedKph * Math.max(hours, 0), 1);

    if (a.odometerKm != null && b.odometerKm != null) {
      odoSamples++;
      const d = b.odometerKm - a.odometerKm;
      if (d < 0) rollbacks++;
      else if (d > ceilingKm) rejected++;
      else odoKm += d;
    }

    if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
      const d = haversineKm(a.lat, a.lng, b.lat, b.lng);
      if (d > ceilingKm) rejected++;
      else {
        gpsKm += d;
        gpsPairs++;
      }
    }
  }

  const hasOdo = odoSamples > 0;
  const hasGps = gpsPairs > 0;

  return {
    odometerKm: hasOdo ? round(odoKm, 2) : null,
    gpsKm: hasGps ? round(gpsKm, 2) : null,
    chosenKm: hasOdo ? round(odoKm, 2) : hasGps ? round(gpsKm, 2) : 0,
    source: hasOdo ? "ODOMETER" : hasGps ? "GPS" : "NONE",
    odometerSamples: odoSamples,
    odometerRollbacks: rollbacks,
    rejectedJumps: rejected,
  };
}

// ---------------------------------------------------------------------------
// Sampling coverage
// ---------------------------------------------------------------------------

export type GapAnalysis = {
  windowHours: number;
  worstGapHours: number;
  medianGapMinutes: number;
  normalGaps: number;
  warningGaps: number;
  staleGaps: number;
  /** Share of the window covered by gaps no wider than the warning threshold. */
  coverage: number;
  /** Hours of the window with no telemetry at all. */
  blindHours: number;
};

export function analyseGaps(
  samples: AnalyticsReading[],
  cfg: FuelAnalysisConfig = DEFAULT_FUEL_CONFIG,
): GapAnalysis {
  if (samples.length < 2) {
    return {
      windowHours: 0, worstGapHours: 0, medianGapMinutes: 0,
      normalGaps: 0, warningGaps: 0, staleGaps: 0, coverage: 0, blindHours: 0,
    };
  }

  const gapsH: number[] = [];
  let normal = 0, warning = 0, stale = 0, covered = 0, blind = 0;

  for (let i = 1; i < samples.length; i++) {
    const h = (samples[i].recordedAt.getTime() - samples[i - 1].recordedAt.getTime()) / 3_600_000;
    gapsH.push(h);
    if (h <= cfg.normalGapMinutes / 60) { normal++; covered += h; }
    else if (h <= cfg.warningGapHours) { warning++; covered += h; }
    else { if (h > cfg.staleGapHours) stale++; else warning++; blind += h; }
  }

  const windowHours = gapsH.reduce((s, h) => s + h, 0);
  const sorted = [...gapsH].sort((a, b) => a - b);

  return {
    windowHours: round(windowHours, 2),
    worstGapHours: round(Math.max(...gapsH), 2),
    medianGapMinutes: round(sorted[Math.floor(sorted.length / 2)] * 60, 2),
    normalGaps: normal,
    warningGaps: warning,
    staleGaps: stale,
    coverage: windowHours > 0 ? round(covered / windowHours, 3) : 0,
    blindHours: round(blind, 2),
  };
}

// ---------------------------------------------------------------------------
// Per-pair analysis — what feeds the anomaly queue
// ---------------------------------------------------------------------------

export type Segment = {
  from: Date;
  to: Date;
  hours: number;
  /** Odometer delta — what the vehicle says it travelled. */
  distanceKm: number | null;
  /** Straight-line GPS distance — always ≤ road distance, so a useful floor. */
  gpsDistanceKm: number | null;
  /** Negative = fell, positive = rose. Raw, before any judgement. */
  fuelDeltaL: number | null;
  /**
   * The tank at each end of the segment, in litres.
   *
   * The delta alone answers "how much moved" but not "moved from what", and the
   * second question is the one asked in a dispute. "260 L when it parked, 220 L
   * when it started" is a sentence a yard supervisor can check against a
   * dipstick; "−40 L" is a number they have to take on trust. Both endpoints
   * were always in hand here — only the difference was being kept.
   */
  fuelBeforeL: number | null;
  fuelAfterL: number | null;
  /**
   * Where the vehicle sat, when it did not move.
   *
   * Populated only for a stationary segment, because that is the only case where
   * one position describes the whole window. During a blind spot the vehicle is
   * parked by definition, so its location is known even though nothing was
   * transmitted — which turns "40 L vanished overnight" into "40 L vanished
   * overnight, here", and that is the difference between an alert and an
   * investigation.
   */
  parkedAt: { lat: number; lng: number } | null;
  /** Null unless the fall cleared the noise band and a plausible burn rate. */
  litresConsumed: number | null;
  kmPerL: number | null;
  event: FuelEventKind;
  /** Litres beyond what the norm can explain. Zero unless suspicious. */
  excessLitres: number;
  confidence: Confidence;
  reasons: string[];
};

export function analyseSegment(
  a: AnalyticsReading,
  b: AnalyticsReading,
  norm: Norm | null,
  tankCapacityL: number | null,
  /** Litres/hour this machine burns standing still, when a norm is on record. */
  idleLph: number | null = null,
  cfg: FuelAnalysisConfig = DEFAULT_FUEL_CONFIG,
): Segment {
  const hours = (b.recordedAt.getTime() - a.recordedAt.getTime()) / 3_600_000;
  const { noiseBandL, refuelMinL } = fuelThresholds(tankCapacityL, cfg);

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
  let rateImplausible = false;

  if (fuelDeltaL != null && fuelDeltaL >= refuelMinL) {
    event = "REFUEL";
    reasons.push(
      `Tank rose ${fuelDeltaL.toFixed(1)} L, clearing the ${refuelMinL.toFixed(1)} L fill ` +
        `threshold for a ${tankCapacityL ?? "?"} L tank — recorded as a fill, not consumption.`,
    );
  } else if (fuelDeltaL != null && Math.abs(fuelDeltaL) < noiseBandL) {
    // The single most important guard in this file. A 300 L tank's sender moves
    // by more than a litre while the vehicle is switched off; treating that as
    // fuel burnt is what produced 128 L of phantom consumption.
    event = "NOISE";
    reasons.push(
      `Level moved ${fuelDeltaL.toFixed(1)} L, inside the ${noiseBandL.toFixed(1)} L ` +
        `resolution of the sender — not counted as consumption or as a fill.`,
    );
  } else if (fuelDeltaL != null && fuelDeltaL < 0) {
    const dropped = -fuelDeltaL;
    const impliedLph = hours > 0 ? dropped / hours : Infinity;

    if (impliedLph > cfg.maxBurnRateLph) {
      // Flag for investigation, do not book as consumption and do not accuse
      // anyone: 9.6 L in 60 seconds is 576 L/h, which is a data fault.
      event = "IMPLAUSIBLE_DROP";
      rateImplausible = true;
      reasons.push(
        `Level fell ${dropped.toFixed(1)} L in ${(hours * 60).toFixed(0)} min — ` +
          `${Number.isFinite(impliedLph) ? impliedLph.toFixed(0) : "∞"} L/h, beyond the ` +
          `${cfg.maxBurnRateLph} L/h an engine can physically burn. Treated as a sensor ` +
          `fault or a splash, not as diesel consumed. Worth investigating if it repeats.`,
      );
    } else {
      litresConsumed = round(dropped, 2);

      if (distanceKm != null && distanceKm > 0) {
        kmPerL = round(distanceKm / litresConsumed, 2);
      }

      const movedKm = distanceKm ?? gpsDistanceKm ?? 0;

      if (movedKm < cfg.stationaryKm) {
        // A vehicle that did not travel can still legitimately burn fuel — by
        // idling. Charge that against time, not distance, because distance-based
        // norms divide by ~zero here and flag every loading bay as a theft.
        const engineRan = a.ignitionOn === true || b.ignitionOn === true;
        const idleAllowance = engineRan ? (idleLph ?? cfg.defaultIdleLph) * hours : 0;
        const unexplained = litresConsumed - idleAllowance - noiseBandL;

        if (unexplained >= cfg.minMeaningfulDropL) {
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
              `Idling at ${(idleLph ?? cfg.defaultIdleLph)} L/h accounts for only ` +
                `${idleAllowance.toFixed(1)} L of it, and sender tolerance for a further ` +
                `${noiseBandL.toFixed(1)} L.`,
            );
          }

          // The two readings that bracket the window, stated plainly. This is
          // the line somebody checks against a dipstick — a delta on its own
          // cannot be verified against anything.
          if (a.fuelLevelL != null && b.fuelLevelL != null) {
            reasons.push(
              `Tank read ${a.fuelLevelL.toFixed(1)} L when it stopped and ` +
                `${b.fuelLevelL.toFixed(1)} L when it moved again.`,
            );
          }
        }
      } else if (norm && distanceKm != null) {
        // Worst credible burn: the journey driven at the *poorest* efficiency the
        // norm permits, plus its tolerance. Fuel beyond that is fuel the journey
        // cannot account for.
        const worstCaseLitres = distanceKm / norm.normLow;
        const allowance = worstCaseLitres * (1 + norm.tolerancePct / 100);
        const unexplained = litresConsumed - allowance - noiseBandL;

        if (unexplained >= cfg.minMeaningfulDropL) {
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
  } else if (fuelDeltaL != null && fuelDeltaL > 0) {
    // Above the noise band but below a credible fill — slosh against a baffle,
    // or a sender settling. Neither consumption nor a fill.
    event = "NOISE";
    reasons.push(
      `Level rose ${fuelDeltaL.toFixed(1)} L — above sender noise but below the ` +
        `${refuelMinL.toFixed(1)} L fill threshold, so it is not booked as a fill.`,
    );
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
    fuelBeforeL: a.fuelLevelL ?? null,
    fuelAfterL: b.fuelLevelL ?? null,
    // Only meaningful when the vehicle stayed put — otherwise one coordinate
    // pair describes the start of a journey, not where the fuel went. The
    // opening reading is used because that is where it was parked; `b` is the
    // moment it was found, which may be after it moved off.
    parkedAt:
      (distanceKm ?? gpsDistanceKm ?? 0) < cfg.stationaryKm && a.lat != null && a.lng != null
        ? { lat: a.lat, lng: a.lng }
        : null,
    litresConsumed,
    kmPerL,
    event,
    excessLitres,
    confidence: confidenceFor(event, hours, rateImplausible, cfg),
    reasons,
  };
}

/**
 * How much weight a per-pair finding can carry.
 *
 * Note the direction of the time term. A *narrow* window makes a stationary
 * drop more conclusive, because the vehicle had no opportunity to drive away
 * and return — but only once the drop has already passed the rate check. A
 * large drop over a very short window is not strong evidence, it is bad data,
 * and the previous version marking exactly that case "HIGH" is how three
 * physically impossible siphons reached the queue.
 */
function confidenceFor(
  event: FuelEventKind,
  hours: number,
  rateImplausible: boolean,
  cfg: FuelAnalysisConfig,
): Confidence {
  if (rateImplausible) return "LOW";
  if (event === "NORMAL" || event === "NOISE") return "HIGH";
  if (event === "REFUEL") return hours <= cfg.warningGapHours ? "HIGH" : "MEDIUM";
  if (hours <= cfg.warningGapHours) return "HIGH";
  if (hours <= cfg.staleGapHours) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// Window rollup
// ---------------------------------------------------------------------------

export type UsageSummary = {
  segments: number;
  windowHours: number;
  distanceKm: number;
  distanceSource: DistanceAnalysis["source"];
  gpsDistanceKm: number | null;
  litresBurned: number;
  /** ± band on litresBurned, from sender resolution at the window's endpoints. */
  litresBurnedUncertainty: number;
  litresFilled: number;
  refuelEvents: number;
  avgKmPerL: number | null;
  suspectSegments: number;
  litresUnaccounted: number;
  /** Longest gap between samples — the honest measure of how blind we are. */
  worstGapHours: number;
  confidence: Confidence;
  /** Plain-English reasons the confidence is what it is. */
  confidenceReasons: string[];
  /** True when the data cannot support a fuel figure worth printing. */
  insufficientData: boolean;
  diagnostics: UsageDiagnostics;
};

export type UsageDiagnostics = {
  hygiene: SeriesHygiene;
  gaps: GapAnalysis;
  distance: DistanceAnalysis;
  fuel: FuelSeriesAnalysis;
  /** Litres the journey's own norm says the distance should have cost. */
  expectedLitresForDistance: number | null;
  /** Litres idling can account for, charged against engine-on stationary time. */
  idleAllowanceLitres: number;
  idleHours: number;
  config: FuelAnalysisConfig;
};

/**
 * The single entry point for window-level usage.
 *
 * Both the per-pair segments (which drive the anomaly queue and the UI's
 * timeline) and the window totals come from here, so a screen cannot show a
 * mileage that disagrees with the segments underneath it.
 */
export function analyseUsage(
  readings: AnalyticsReading[],
  norm: Norm | null,
  tankCapacityL: number | null,
  idleLph: number | null = null,
  cfg: FuelAnalysisConfig = DEFAULT_FUEL_CONFIG,
): { segments: Segment[]; usage: UsageSummary } {
  const { samples, hygiene } = cleanSeries(readings, tankCapacityL);

  const segments: Segment[] = [];
  for (let i = 1; i < samples.length; i++) {
    segments.push(analyseSegment(samples[i - 1], samples[i], norm, tankCapacityL, idleLph, cfg));
  }

  const gaps = analyseGaps(samples, cfg);
  const distance = analyseDistance(samples, cfg);
  const fuel = analyseFuelSeries(samples, tankCapacityL, cfg);

  // Idle burn is charged against time the engine ran without the odometer
  // advancing. It is reported, never silently subtracted from the headline.
  let idleHours = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const moved = a.odometerKm != null && b.odometerKm != null ? b.odometerKm - a.odometerKm : 0;
    const engineRan = a.ignitionOn === true && b.ignitionOn === true;
    if (engineRan && moved <= 0) {
      idleHours += (b.recordedAt.getTime() - a.recordedAt.getTime()) / 3_600_000;
    }
  }
  const idleAllowanceLitres = idleHours * (idleLph ?? cfg.defaultIdleLph);

  const expectedLitresForDistance =
    norm && norm.normLow > 0 && distance.chosenKm > 0
      ? round((distance.chosenKm / norm.normLow) * (1 + norm.tolerancePct / 100), 2)
      : null;

  // Unaccounted fuel is what the journey, the idling and the sender's own
  // tolerance together cannot explain — never the raw difference between
  // measured and expected, which would call every hard shift a theft.
  const explained = (expectedLitresForDistance ?? 0) + idleAllowanceLitres + fuel.uncertaintyL;
  const litresUnaccounted =
    expectedLitresForDistance != null ? Math.max(0, round(fuel.litresConsumed - explained, 2)) : 0;

  const avgKmPerL =
    fuel.litresConsumed > fuel.noiseBandL && distance.chosenKm > 0
      ? round(distance.chosenKm / fuel.litresConsumed, 2)
      : null;

  const { confidence, reasons, insufficient } = confidenceForWindow(
    { hygiene, gaps, distance, fuel },
    cfg,
  );

  const usage: UsageSummary = {
    segments: segments.length,
    windowHours: gaps.windowHours,
    distanceKm: distance.chosenKm,
    distanceSource: distance.source,
    gpsDistanceKm: distance.gpsKm,
    litresBurned: fuel.litresConsumed,
    litresBurnedUncertainty: fuel.uncertaintyL,
    litresFilled: fuel.litresRefuelled,
    refuelEvents: fuel.refuels.length,
    avgKmPerL,
    suspectSegments: segments.filter(
      (s) => s.event === "STATIONARY_DROP" || s.event === "EXCESS_CONSUMPTION",
    ).length,
    litresUnaccounted,
    worstGapHours: gaps.worstGapHours,
    confidence,
    confidenceReasons: reasons,
    insufficientData: insufficient,
    diagnostics: {
      hygiene,
      gaps,
      distance,
      fuel,
      expectedLitresForDistance,
      idleAllowanceLitres: round(idleAllowanceLitres, 2),
      idleHours: round(idleHours, 2),
      config: cfg,
    },
  };

  return { segments, usage };
}

function confidenceForWindow(
  d: { hygiene: SeriesHygiene; gaps: GapAnalysis; distance: DistanceAnalysis; fuel: FuelSeriesAnalysis },
  cfg: FuelAnalysisConfig,
): { confidence: Confidence; reasons: string[]; insufficient: boolean } {
  const reasons: string[] = [];
  let confidence: Confidence = "HIGH";
  let insufficient = false;

  const demote = (to: Confidence, why: string) => {
    reasons.push(why);
    if (to === "LOW" || confidence === "LOW") confidence = "LOW";
    else if (to === "MEDIUM") confidence = "MEDIUM";
  };

  if (d.fuel.levelSamples < 2) {
    demote("LOW", "Fewer than two fuel-level samples in the window — nothing to measure between.");
    insufficient = true;
  }
  if (d.fuel.levelSamples > 0 && d.fuel.levelSamples < cfg.minSamplesForMedium) {
    demote("LOW", `Only ${d.fuel.levelSamples} fuel samples; ${cfg.minSamplesForMedium} is the minimum for a usable estimate.`);
    insufficient = true;
  } else if (d.fuel.levelSamples < cfg.minSamplesForHigh) {
    demote("MEDIUM", `${d.fuel.levelSamples} fuel samples is thin; ${cfg.minSamplesForHigh} would support a firm figure.`);
  }

  if (d.gaps.coverage < cfg.minCoverageForMedium) {
    demote(
      "LOW",
      `Only ${(d.gaps.coverage * 100).toFixed(0)}% of the window is covered by regular sampling — ` +
        `${d.gaps.blindHours} h of it is a blind spot, so fuel could have moved unobserved.`,
    );
    insufficient = true;
  } else if (d.gaps.coverage < cfg.minCoverageForHigh) {
    demote("MEDIUM", `${(d.gaps.coverage * 100).toFixed(0)}% sampling coverage — some of the window is unobserved.`);
  }

  if (d.gaps.worstGapHours > cfg.staleGapHours) {
    demote("LOW", `Longest gap between samples is ${d.gaps.worstGapHours} h; a tank can be filled and drained inside that.`);
  } else if (d.gaps.worstGapHours > cfg.warningGapHours) {
    demote("MEDIUM", `Longest gap between samples is ${d.gaps.worstGapHours} h.`);
  }

  if (d.distance.source === "NONE") {
    demote("LOW", "No usable odometer or GPS distance, so efficiency cannot be derived.");
    insufficient = true;
  } else if (d.distance.source === "GPS") {
    demote("MEDIUM", "Distance is from the GPS track, which cuts corners and reads short against road distance.");
  }

  if (d.distance.odometerRollbacks > 0) {
    demote("MEDIUM", `Odometer went backwards on ${d.distance.odometerRollbacks} sample(s); that movement was discarded.`);
  }
  if (d.distance.rejectedJumps > 0) {
    demote("MEDIUM", `${d.distance.rejectedJumps} position jump(s) implied impossible speeds and were discarded.`);
  }

  if (d.fuel.implausibleDrops.length > 0) {
    demote(
      "MEDIUM",
      `${d.fuel.implausibleDrops.length} fuel drop(s) implied a burn rate no engine can reach — ` +
        `excluded from consumption and flagged as a sensor fault.`,
    );
  }

  if (d.fuel.withinNoise) {
    demote(
      "LOW",
      `Total tank movement is within the sender's ${d.fuel.noiseBandL} L resolution — ` +
        `indistinguishable from no consumption at all.`,
    );
    insufficient = true;
  }

  if (d.hygiene.duplicateTimestamps > 0) {
    reasons.push(`${d.hygiene.duplicateTimestamps} duplicate snapshot(s) ignored.`);
  }
  if (d.hygiene.impossibleLevels > 0) {
    demote("MEDIUM", `${d.hygiene.impossibleLevels} fuel reading(s) fell outside the tank's physical range and were dropped.`);
  }

  if (reasons.length === 0) reasons.push("Dense sampling, a working odometer and a consistent fuel sender across the window.");

  return { confidence, reasons, insufficient };
}

/**
 * A traceable record of how a fuel figure was reached.
 *
 * Every number the UI shows should be reproducible from this block alone — if
 * a mileage looks wrong, this is what tells you which input made it wrong.
 */
export function describeUsage(label: string, usage: UsageSummary): string {
  const d = usage.diagnostics;
  const lines = [
    `── Fuel analysis · ${label}`,
    `   Window            : ${d.gaps.windowHours} h across ${usage.segments + 1} samples ` +
      `(${d.hygiene.received} received, ${d.hygiene.duplicateTimestamps} duplicate, ${d.hygiene.impossibleLevels} impossible)`,
    `   Sampling          : median ${d.gaps.medianGapMinutes} min · worst ${d.gaps.worstGapHours} h · ` +
      `coverage ${(d.gaps.coverage * 100).toFixed(0)}% · blind ${d.gaps.blindHours} h`,
    `   Fuel unit         : litres, as reported by primaryFuelLevel (tank ${d.fuel.refuelThresholdL > 0 ? "capacity known" : "capacity unknown"})`,
    `   Sender resolution : ±${d.fuel.noiseBandL} L noise band · ${d.fuel.refuelThresholdL} L fill threshold`,
    `   Starting fuel     : ${d.fuel.startLevelL ?? "—"} L`,
    `   Ending fuel       : ${d.fuel.endLevelL ?? "—"} L`,
    `   Fuel refilled     : ${usage.litresFilled} L across ${usage.refuelEvents} confirmed event(s)`,
    `   Fuel consumed     : ${usage.litresBurned} ±${usage.litresBurnedUncertainty} L ` +
      `(start − end + refills)`,
    `   Across wide gaps  : ${d.fuel.litresAcrossStaleGaps} L first seen after a gap > ${d.config.staleGapHours} h`,
    `   Implausible drops : ${d.fuel.implausibleDrops.length}` +
      (d.fuel.implausibleDrops.length
        ? ` (worst ${Math.max(...d.fuel.implausibleDrops.map((x) => x.impliedLph))} L/h)`
        : ""),
    `   Distance source   : ${usage.distanceSource}`,
    `   Odometer distance : ${d.distance.odometerKm ?? "—"} km over ${d.distance.odometerSamples} pairs ` +
      `(${d.distance.odometerRollbacks} rollback, ${d.distance.rejectedJumps} rejected)`,
    `   GPS distance      : ${d.distance.gpsKm ?? "—"} km (straight-line floor)`,
    `   Idle time         : ${d.idleHours} h → ${d.idleAllowanceLitres} L allowance`,
    `   Expected for dist.: ${d.expectedLitresForDistance ?? "—"} L at the class norm`,
    `   Unaccounted       : ${usage.litresUnaccounted} L`,
    `   Final mileage     : ${usage.avgKmPerL ?? "—"} km/L`,
    `   Confidence        : ${usage.confidence}${usage.insufficientData ? " (insufficient data)" : ""}`,
    ...usage.confidenceReasons.map((r) => `     · ${r}`),
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

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
