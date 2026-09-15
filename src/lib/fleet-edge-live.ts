/**
 * Fleet Edge live console — the read model behind the tracking screen.
 *
 * Tata's own Fleet Edge console shows, for every vehicle, a live block (speed,
 * odometer, fuel, DEF, battery, engine hours), a day's statistics (distance,
 * idling, stoppage, efficiency) and a service block. This module assembles the
 * same picture from what we already store, so the client sees no less here than
 * they see there — and sees it alongside the fuel, cost and compliance data
 * Fleet Edge does not hold.
 *
 * Two rules govern every number below, both inherited from the rest of this
 * codebase and both non-negotiable:
 *
 *  1. A wrong number is worse than no number. Anything that cannot be measured
 *     from the samples we actually hold is returned as `null` and rendered as
 *     an em dash. `null` means *not known*; it never means zero.
 *  2. Nothing is integrated from the fuel sender. Tank level is noisy by several
 *     litres (see the header of `fleet-analytics.ts`); day totals come from
 *     `analyseUsage`, which knows that, rather than from arithmetic on levels.
 *
 * The typed telemetry columns cover nine of the ~34 fields Fleet Edge sends.
 * The rest — DEF level, battery voltages, gear, satellite count, GPS quality —
 * live in `TelemetryReading.raw` and are read from there. That is deliberate:
 * the schema was fixed before anyone knew which of those mattered, and this is
 * the screen that finds out.
 */
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { startOfBusinessDay } from "@/lib/business-time";
import { serverCache } from "@/lib/cache";
import {
  analyseUsage, type AnalyticsReading, type Confidence, type Norm,
} from "@/lib/fleet-analytics";

/**
 * The five states the console's filter strip counts.
 *
 * These mirror Fleet Edge's own vocabulary rather than the ERP's `Asset.status`
 * (Active / Idle / Under-Maintenance / …). They answer a different question:
 * `Asset.status` is what the workshop says about a machine, this is what the
 * vehicle is doing right now. A truck can be "Active" in the register and
 * OFFLINE on this screen, and both are true.
 */
export type LiveStatus = "MOVING" | "IDLING" | "STOPPED" | "OFFLINE" | "BREAKDOWN";

/**
 * How long without a sample before a vehicle is called OFFLINE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two thresholds, because a parked truck and a running one report at completely
 * different rates and one number cannot serve both.
 *
 * The single 15-minute rule here was written for the pull era, when the sync ran
 * every two minutes and a missed run was the only reason for a gap. On push the
 * vehicle decides when to speak, and measured over 24 hours of live data the two
 * cases are an order of magnitude apart:
 *
 *   engine running   p50 1 min · p90 2 min · p99 12 min · max 59 min
 *   parked           p50 1 min · p90 62 min · p99 107 min · max 127 min
 *
 * Against 15 minutes, a parked truck was reported OFFLINE more often than not —
 * which is worse than useless, because OFFLINE is meant to mean "we have lost
 * this vehicle" and a screen that cries it about every yard-parked machine
 * teaches people to ignore the one that has genuinely gone missing.
 *
 * Running: 30 minutes, comfortably clear of the 12-minute p99.
 * Parked: 3 hours, clear of both the 107-minute p99 and the 127-minute maximum.
 *
 * Checked against Fleet Edge's own panel, which counted 2 offline of 13 at the
 * same moment: these thresholds give the same 2, where 15 minutes gave 5.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const OFFLINE_RUNNING_MS = 30 * 60_000;
const OFFLINE_PARKED_MS = 3 * 60 * 60_000;

/** Below this the vehicle is not travelling; GPS speed jitters around zero. */
const MOVING_SPEED_KPH = 3;
/** Beyond this an interval is an outage, not a vehicle standing still. Minutes. */
const OBSERVED_GAP_LIMIT_MIN = 20;

/** Service falls to DUE inside either of these, matching Preventive Service. */
const SERVICE_DUE_KM = 500;
const SERVICE_DUE_DAYS = 15;

export type LiveReadings = {
  speedKph: number | null;
  odometerKm: number | null;
  /** Litres and percent are both reported; percent is derived, never the source. */
  fuelLitres: number | null;
  fuelPct: number | null;
  fuelCapacityL: number | null;
  /** AdBlue. Fleet Edge sends a scaled sentinel on this subscription — see below. */
  defPct: number | null;
  batteryV: number | null;
  engineRunHours: number | null;
  ignitionOn: boolean | null;
  gear: string | null;
  satellites: number | null;
  /** False means the position shown is the last known fix, not where it is now. */
  gpsFix: boolean;
};

export type TodayStats = {
  distanceKm: number | null;
  idlingMinutes: number | null;
  stoppageMinutes: number | null;
  /** Elapsed time no sample covers, so the day's figures add up honestly. */
  unobservedMinutes: number | null;
  engineRunHours: number | null;
  kmPerL: number | null;
  confidence: Confidence | null;
  /** Why the efficiency figure is missing or soft, in plain words. */
  confidenceReasons: string[];
};

export type ServiceStatus = {
  taskName: string | null;
  distanceToServiceKm: number | null;
  hoursToService?: number | null;
  daysToService: number | null;
  status: "OK" | "DUE" | "OVERDUE" | null;
};

export type LiveVehicle = {
  id: string;
  code: string;
  name: string;
  registrationNo: string | null;
  chassisNo: string | null;
  /** "SIGNA 3525.TK.FBV" — make and model as one line, the way the cab badge reads. */
  modelLabel: string;
  assetClass: string;
  status: LiveStatus;
  /** What the register says, kept because it explains a BREAKDOWN. */
  registerStatus: string;
  lat: number | null;
  lng: number | null;
  headingDeg: number | null;
  lastUpdate: string | null;
  /**
   * False for a machine in the register that Fleet Edge does not cover. The
   * banner counts these; adding one is a commercial change with Tata, not a
   * software change.
   */
  subscribed: boolean;
  onTrip: boolean;
  driverName: string | null;
  projectCode: string | null;
  live: LiveReadings;
  today: TodayStats;
  service: ServiceStatus;
};

export type LiveFleet = {
  vehicles: LiveVehicle[];
  counts: Record<LiveStatus, number> & { ALL: number };
  unsubscribedCount: number;
  /** Provider sync health, so the screen can say why it is stale. */
  provider: {
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
    lastSyncError: string | null;
  } | null;
  generatedAt: string;
};

// ---------------------------------------------------------------------------
// Raw payload readers
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

function rawOf(value: Prisma.JsonValue | null | undefined): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

function rawNum(raw: Raw, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = raw[k];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function rawStr(raw: Raw, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/**
 * AdBlue, as a percentage, or null.
 *
 * Fleet Edge sends `defLevel: 65000` on this subscription — a constant, on a
 * vehicle whose DEF tank is nothing like 65,000 of any unit. It is a scaled or
 * sentinel value, so it is *not* rendered as a level. Only a value that is
 * already a plausible percentage is believed; anything else reads as unknown,
 * which is what the Tata console itself shows for this truck.
 */
function defPercent(raw: Raw): number | null {
  const v = rawNum(raw, "defLevel", "DefLevel");
  if (v == null) return null;
  if (v < 0 || v > 100) return null;
  return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function deriveStatus(
  registerStatus: string,
  lastSeen: Date | null,
  speedKph: number | null,
  ignitionOn: boolean | null,
  now: Date,
): LiveStatus {
  // A machine the workshop has taken off the road is a breakdown whatever its
  // last ping said — that is the fact the yard needs, and a stale "Stopped"
  // would hide it.
  if (registerStatus === "Breakdown") return "BREAKDOWN";

  // A vehicle last seen with the engine running should speak again within
  // minutes; one last seen parked may not for an hour. Judge each against its
  // own case rather than the stricter of the two.
  const silentFor = lastSeen ? now.getTime() - lastSeen.getTime() : Infinity;
  const allowedSilence = ignitionOn === true ? OFFLINE_RUNNING_MS : OFFLINE_PARKED_MS;
  if (!lastSeen || silentFor > allowedSilence) return "OFFLINE";

  if (speedKph != null && speedKph >= MOVING_SPEED_KPH) return "MOVING";
  // Engine running, wheels not turning. This is the state that burns diesel for
  // nothing, so it is worth separating from a parked vehicle rather than
  // folding both into "Stopped" the way the register does.
  if (ignitionOn === true) return "IDLING";
  return "STOPPED";
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type ScheduleRow = {
  assetId: string | null;
  assetClass: string | null;
  taskName: string;
  intervalKm: number;
  intervalHours: number;
  intervalDays: number;
  lastDoneMeter: number;
  lastDoneDate: Date | null;
};

/**
 * The nearest service, by distance or by calendar — whichever comes first.
 *
 * Preventive Service already works this way for the workshop; this repeats the
 * "whichever comes first" rule so the two screens cannot disagree about whether
 * a truck is due.
 */
function nearestService(
  schedules: ScheduleRow[],
  meterValue: number,
  hourMeterValue: number,
  now: Date,
): ServiceStatus {
  const empty: ServiceStatus = {
    taskName: null, distanceToServiceKm: null, hoursToService: null, daysToService: null, status: null,
  };
  if (!schedules.length) return empty;

  let best: ServiceStatus | null = null;

  for (const s of schedules) {
    const km =
      s.intervalKm > 0 && meterValue > 0
        ? Math.round((s.lastDoneMeter + s.intervalKm) - meterValue)
        : null;

    const days =
      s.intervalDays > 0 && s.lastDoneDate
        ? Math.ceil(
            (s.lastDoneDate.getTime() + s.intervalDays * 86_400_000 - now.getTime()) / 86_400_000,
          )
        : null;

    const hours =
      s.intervalHours > 0 && hourMeterValue > 0
        ? Math.round((s.lastDoneMeter + s.intervalHours) - hourMeterValue)
        : null;

    if (km == null && hours == null && days == null) continue;

    const overdue = (km != null && km <= 0) || (hours != null && hours <= 0) || (days != null && days <= 0);
    const due = (km != null && km <= SERVICE_DUE_KM) || (hours != null && hours <= 50) || (days != null && days <= SERVICE_DUE_DAYS);
    const status: ServiceStatus["status"] = overdue ? "OVERDUE" : due ? "DUE" : "OK";

    const candidate: ServiceStatus = {
      taskName: s.taskName,
      distanceToServiceKm: km,
      hoursToService: hours,
      daysToService: days,
      status,
    };

    // Rank by urgency, then by whichever measure is closest to zero, so the
    // block names the job that will actually come up next.
    const rank = (c: ServiceStatus) => (c.status === "OVERDUE" ? 0 : c.status === "DUE" ? 1 : 2);
    const slack = (c: ServiceStatus) =>
      Math.min(
        c.distanceToServiceKm ?? Number.POSITIVE_INFINITY,
        (c.hoursToService ?? Number.POSITIVE_INFINITY) * 10,
        (c.daysToService ?? Number.POSITIVE_INFINITY) * 100,
      );

    if (!best || rank(candidate) < rank(best) || (rank(candidate) === rank(best) && slack(candidate) < slack(best))) {
      best = candidate;
    }
  }

  return best ?? empty;
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

/**
 * Stationary time, split into engine-on and engine-off.
 *
 * Both are charged against the interval *between* two samples, which is the
 * only thing the data supports: on two-minute polling a vehicle that idles for
 * ninety seconds between pings is invisible, and inventing that time would be
 * exactly the kind of confident wrong number this system refuses to print.
 */
function stationaryMinutes(
  samples: AnalyticsReading[],
): { idling: number; stopped: number; unobserved: number } {
  let idling = 0;
  let stopped = 0;
  let unobserved = 0;

  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const minutes = (b.recordedAt.getTime() - a.recordedAt.getTime()) / 60_000;
    if (!Number.isFinite(minutes) || minutes <= 0) continue;

    // A gap this wide is an outage, not a vehicle standing still. Counting it
    // would report a truck as having idled through the hours it was unobserved.
    //
    // Discarding it silently is its own problem, though: distance comes from
    // the odometer at each end of the day and therefore spans these gaps, while
    // idling and stoppage do not. Printed side by side the three read as one
    // account of the day and do not reconcile — on this fleet two thirds of the
    // elapsed time could vanish between them, which makes a truck that sat
    // unobserved for ten hours look like one that drove all day. So the
    // remainder is measured and returned rather than dropped.
    if (minutes > OBSERVED_GAP_LIMIT_MIN) {
      unobserved += minutes;
      continue;
    }

    const moving = (a.speedKph ?? 0) >= MOVING_SPEED_KPH || (b.speedKph ?? 0) >= MOVING_SPEED_KPH;
    if (moving) continue;

    if (a.ignitionOn === true) idling += minutes;
    else if (a.ignitionOn === false) stopped += minutes;
  }

  return {
    idling: Math.round(idling),
    stopped: Math.round(stopped),
    unobserved: Math.round(unobserved),
  };
}

/**
 * A today-sample carries the engine-hour counter alongside the fields the fuel
 * analytics needs. `AnalyticsReading` deliberately does not model engine hours —
 * it reasons about fuel and distance — so the extra field rides along here
 * rather than widening a type the anomaly engine depends on.
 */
type TodaySample = AnalyticsReading & { engineHours: number | null };

/** Engine hours actually observed today, from the vehicle's own counter. */
function engineHoursToday(samples: TodaySample[]): number | null {
  const withHours = samples.filter((s) => s.engineHours != null);
  if (withHours.length < 2) return null;
  const first = withHours[0].engineHours as number;
  const last = withHours[withHours.length - 1].engineHours as number;
  const delta = last - first;
  // A counter that went backwards is a meter swap or a provider glitch; a day
  // longer than a day is nonsense. Either way we did not measure it.
  if (delta < 0 || delta > 24) return null;
  return Math.round(delta * 10) / 10;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export type LiveFleetScope = Prisma.AssetWhereInput | undefined;

/**
 * The upstream tracker syncs at a coarser cadence. A 90-second cache gives
 * Upstash-free-tier deployments a useful hit rate; every accepted telemetry or
 * fleet mutation explicitly invalidates this key, so fresh provider pushes are
 * visible immediately on the next client refresh.
 */
export const LIVE_FLEET_CACHE_SECONDS = 90;
const liveFleetInFlight = new Map<string, Promise<LiveFleet>>();

/**
 * Prisma where clauses are objects, so plain JSON.stringify is not a safe
 * distributed-cache key: equivalent clauses assembled in a different property
 * order would miss, while an accidental omission could share one user's scope
 * with another.  Canonicalise every supported JSON value before hashing it.
 */
function stableScopeJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableScopeJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableScopeJson(object[key])}`).join(",")}}`;
}

export function liveFleetCacheKey(scope: LiveFleetScope): string {
  const digest = createHash("sha256").update(stableScopeJson(scope ?? {})).digest("hex");
  return `fleet:live:${digest}`;
}

/**
 * Called by writes that change a vehicle's map representation.  Redis failures
 * deliberately stay non-fatal — the 90-second TTL still bounds staleness.
 */
export async function invalidateLiveFleetCache(): Promise<void> {
  liveFleetInFlight.clear();
  await serverCache.invalidatePrefix("fleet:live:");
}

/**
 * Coalesce identical tracking reads within one server process. A page render,
 * its hydration refresh, and a manually opened second tab otherwise run the
 * same six read queries concurrently. Authorization happens before this is
 * called, and the scope is part of the key, so this never share data across
 * access scopes.
 */
/** One row of the DISTINCT ON query above. */
type LatestReadingRow = {
  assetId: string;
  recordedAt: Date;
  lat: number | null;
  lng: number | null;
  speedKph: number | null;
  headingDeg: number | null;
  odometerKm: number | null;
  engineHours: number | null;
  fuelLevelL: number | null;
  fuelLevelPct: number | null;
  ignitionOn: boolean | null;
  source: string;
  raw: unknown;
};

export async function getLiveFleet(scope: LiveFleetScope = undefined): Promise<LiveFleet> {
  const key = liveFleetCacheKey(scope);

  const existing = liveFleetInFlight.get(key);
  if (existing) return existing;

  const pending = serverCache.wrap(key, () => buildLiveFleet(scope), LIVE_FLEET_CACHE_SECONDS)
    .finally(() => liveFleetInFlight.delete(key));
  liveFleetInFlight.set(key, pending);
  return pending;
}

/**
 * Builds the whole console view in a fixed number of queries.
 *
 * The fleet is dozens of vehicles, not millions, so today's readings are pulled
 * in one go and grouped in memory rather than issuing a query per vehicle. That
 * matters here because this screen polls.
 */
async function buildLiveFleet(scope: LiveFleetScope): Promise<LiveFleet> {
  const now = new Date();
  const dayStart = startOfBusinessDay(now);

  const assets = await db.asset.findMany({
    where: scope,
    select: {
      id: true, code: true, name: true, registrationNo: true, chassisNo: true,
      make: true, model: true, assetClass: true, status: true,
      lat: true, lng: true, speed: true, lastSeen: true,
      meterValue: true, hourMeterValue: true, primaryMeter: true,
      fuelCapacity: true, fuelLevelPct: true,
      driver: { select: { name: true } },
      project: { select: { code: true } },
    },
    orderBy: { code: "asc" },
  });

  if (!assets.length) {
    return {
      vehicles: [],
      counts: { ALL: 0, MOVING: 0, IDLING: 0, STOPPED: 0, OFFLINE: 0, BREAKDOWN: 0 },
      unsubscribedCount: 0,
      provider: null,
      generatedAt: now.toISOString(),
    };
  }

  const assetIds = assets.map((a) => a.id);

  const [todayReadings, latestReadings, schedules, activeSessions, norms, provider] =
    await Promise.all([
      db.telemetryReading.findMany({
        where: { assetId: { in: assetIds }, recordedAt: { gte: dayStart } },
        orderBy: { recordedAt: "asc" },
        select: {
          assetId: true, recordedAt: true, lat: true, lng: true, speedKph: true,
          odometerKm: true, engineHours: true, fuelLevelL: true, fuelLevelPct: true,
          ignitionOn: true,
        },
      }),
      // The most recent sample per vehicle, whenever it was — a vehicle that has
      // not reported since yesterday still has a last known position, and saying
      // so is more useful than an empty card.
      //
      // ─────────────────────────────────────────────────────────────────────
      // Written as raw SQL because Prisma's `distinct` is not SQL DISTINCT: it
      // fetches every matching row and reduces them in memory afterwards. With
      // no time bound that meant reading every reading ever recorded for all
      // fifty-three assets — seventy-five thousand rows and climbing by
      // eighteen thousand a day — pulling the ~1 KB raw payload with each one,
      // roughly seventy megabytes over the wire, and then discarding all but
      // fifty-three rows in JavaScript. On every poll of the tracking screen,
      // for every person watching it. It was the slowest query in the system
      // at 235 ms average and peaks near seven seconds, and it got worse every
      // day purely because the table grew.
      //
      // A lateral join, not DISTINCT ON. Both express "latest row per vehicle",
      // but DISTINCT ON has to sort the whole set by (assetId, recordedAt DESC)
      // and the index runs recordedAt ascending — so it still read all 74,807
      // rows and spilled twelve megabytes to disk, 1,458 ms. The lateral form
      // asks the index for one row per vehicle and stops: 53 backward index
      // seeks, no sort, measured at 0.7 ms on the same data.
      // ─────────────────────────────────────────────────────────────────────
      db.$queryRaw<LatestReadingRow[]>`
        SELECT r.*
        FROM unnest(${assetIds}::text[]) AS a(id)
        CROSS JOIN LATERAL (
          SELECT t."assetId", t."recordedAt", t."lat", t."lng", t."speedKph",
                 t."headingDeg", t."odometerKm", t."engineHours", t."fuelLevelL",
                 t."fuelLevelPct", t."ignitionOn", t."source", t."raw"
          FROM "TelemetryReading" t
          WHERE t."assetId" = a.id
          ORDER BY t."recordedAt" DESC
          LIMIT 1
        ) r
      `,
      db.maintenanceSchedule.findMany({
        where: { active: true },
        select: {
          assetId: true, assetClass: true, taskName: true,
          intervalKm: true, intervalHours: true, intervalDays: true, lastDoneMeter: true, lastDoneDate: true,
        },
      }),
      db.tripSession.findMany({
        where: { assetId: { in: assetIds }, status: "ACTIVE" },
        select: { assetId: true, driver: { select: { name: true } } },
      }),
      db.consumptionNorm.findMany({
        where: { unit: "KMPL" },
        select: { assetId: true, assetClass: true, normLow: true, normHigh: true, tolerancePct: true },
      }),
      db.telematicsProvider.findUnique({
        where: { code: "TATA_FLEET_EDGE" },
        select: { lastSyncAt: true, lastSyncStatus: true, lastSyncError: true },
      }),
    ]);

  const byAsset = new Map<string, TodaySample[]>();
  for (const r of todayReadings) {
    const list = byAsset.get(r.assetId);
    const sample: TodaySample = {
      recordedAt: r.recordedAt,
      lat: r.lat,
      lng: r.lng,
      speedKph: r.speedKph,
      odometerKm: r.odometerKm,
      fuelLevelL: r.fuelLevelL,
      fuelLevelPct: r.fuelLevelPct,
      ignitionOn: r.ignitionOn,
      engineHours: r.engineHours,
    };
    if (list) list.push(sample);
    else byAsset.set(r.assetId, [sample]);
  }

  const latestByAsset = new Map(latestReadings.map((r) => [r.assetId, r]));
  const sessionByAsset = new Map(activeSessions.map((s) => [s.assetId, s]));

  const counts: LiveFleet["counts"] = {
    ALL: 0, MOVING: 0, IDLING: 0, STOPPED: 0, OFFLINE: 0, BREAKDOWN: 0,
  };
  let unsubscribedCount = 0;

  const vehicles: LiveVehicle[] = assets.map((a) => {
    const latest = latestByAsset.get(a.id);
    const raw = rawOf(latest?.raw ?? null);
    const samples = byAsset.get(a.id) ?? [];

    // "Subscribed" means Fleet Edge is actually reporting this vehicle. A row in
    // the register with no OEM sample behind it is a machine the subscription
    // does not cover, and the banner says so rather than showing a dead card.
    const subscribed = latest?.source === "GPS_API";
    if (!subscribed) unsubscribedCount++;

    const lastSeen = latest?.recordedAt ?? null;
    const speedKph = latest?.speedKph ?? null;
    const ignitionOn = latest?.ignitionOn ?? null;
    const status = deriveStatus(a.status, lastSeen, speedKph, ignitionOn, now);
    counts[status]++;
    counts.ALL++;

    // Capacity: what the vehicle reports beats what a clerk typed, because the
    // fuel bar and every theft threshold are sized against it.
    const capacity =
      rawNum(raw, "primaryFuelTankCapacity", "PrimaryFuelTankCapacity") ??
      (a.fuelCapacity > 0 ? a.fuelCapacity : null);

    const fuelLitres = latest?.fuelLevelL ?? null;
    const fuelPct =
      latest?.fuelLevelPct ??
      (fuelLitres != null && capacity != null && capacity > 0
        ? Math.round((fuelLitres / capacity) * 1000) / 10
        : null);

    // Odometer: prefer the sample, fall back to the register's meter. The
    // register is updated from the same samples, so this is a staleness
    // fallback, not a second source of truth.
    const odometerKm = latest?.odometerKm ?? (a.meterValue > 0 ? a.meterValue : null);

    const norm = pickNorm(norms, a.id, a.assetClass);
    const { usage } = analyseUsage(samples, norm, capacity, null);
    const stationary = stationaryMinutes(samples);

    const today: TodayStats = {
      // `chosenKm` is odometer-first with a GPS floor; zero is a real answer
      // only when we have samples to say so.
      distanceKm: samples.length >= 2 ? usage.distanceKm : null,
      idlingMinutes: samples.length >= 2 ? stationary.idling : null,
      stoppageMinutes: samples.length >= 2 ? stationary.stopped : null,
      unobservedMinutes: samples.length >= 2 ? stationary.unobserved : null,
      engineRunHours: engineHoursToday(samples),
      // Withheld outright when the day was too thinly sampled to measure a burn.
      kmPerL: usage.insufficientData ? null : usage.avgKmPerL,
      confidence: samples.length >= 2 ? usage.confidence : null,
      confidenceReasons: usage.confidenceReasons ?? [],
    };

    const applicable = schedules.filter(
      (s) => s.assetId === a.id || (s.assetId == null && s.assetClass === a.assetClass),
    );
    const service = nearestService(applicable, a.meterValue, a.hourMeterValue, now);

    const session = sessionByAsset.get(a.id);

    return {
      id: a.id,
      code: a.code,
      name: a.name,
      registrationNo: a.registrationNo,
      chassisNo: a.chassisNo,
      modelLabel: [a.make, a.model].filter(Boolean).join(" ").trim() || a.name,
      assetClass: a.assetClass,
      status,
      registerStatus: a.status,
      // A cached 0/0 is the seed default, not the Gulf of Guinea. Treat it as
      // "never positioned" so the map does not drop a marker in the ocean.
      lat: latest?.lat ?? (a.lat !== 0 ? a.lat : null),
      lng: latest?.lng ?? (a.lng !== 0 ? a.lng : null),
      headingDeg: latest?.headingDeg ?? null,
      lastUpdate: lastSeen ? lastSeen.toISOString() : null,
      subscribed,
      onTrip: Boolean(session),
      driverName: session?.driver?.name ?? null,
      projectCode: a.project?.code ?? null,
      live: {
        speedKph,
        odometerKm,
        fuelLitres,
        fuelPct,
        fuelCapacityL: capacity,
        defPct: defPercent(raw),
        batteryV: rawNum(raw, "vehicleBatteryVoltage", "backupBatteryVoltage"),
        // The typed column is null whenever Fleet Edge echoed the odometer into
        // it — see the adapter. Reading raw here would reinstate exactly the
        // nonsense the adapter threw away, so only the validated column is used.
        engineRunHours: latest?.engineHours ?? null,
        ignitionOn,
        gear: rawStr(raw, "currentGear"),
        satellites: rawNum(raw, "noOfSatForFix"),
        gpsFix: raw.gpsFix !== false,
      },
      today,
      service,
    };
  });

  return {
    vehicles,
    counts,
    unsubscribedCount,
    provider: provider
      ? {
          lastSyncAt: provider.lastSyncAt ? provider.lastSyncAt.toISOString() : null,
          lastSyncStatus: provider.lastSyncStatus,
          lastSyncError: provider.lastSyncError,
        }
      : null,
    generatedAt: now.toISOString(),
  };
}

type NormRow = {
  assetId: string | null;
  assetClass: string | null;
  normLow: number;
  normHigh: number;
  tolerancePct: number;
};

/** A norm set for this exact machine beats one written for its whole class. */
function pickNorm(norms: NormRow[], assetId: string, assetClass: string): Norm | null {
  const exact = norms.find((n) => n.assetId === assetId);
  const byClass = norms.find((n) => n.assetId == null && n.assetClass === assetClass);
  const hit = exact ?? byClass;
  return hit
    ? { normLow: hit.normLow, normHigh: hit.normHigh, tolerancePct: hit.tolerancePct }
    : null;
}
