/**
 * Tata Fleet Edge — OEM telematics pull integration.
 *
 * Fleet Edge is a *pull* API secured with OAuth2 client-credentials, unlike the
 * push adapters in `telematics-adapters.ts` which receive webhooks. Tata issues
 * a client id/secret pair; we exchange it for a short-lived bearer token and
 * poll vehicle positions on a schedule.
 *
 * Contract verified 2026-08-10 against the "FleetEdge Basic Pull API" spec and a
 * live response from the production subscription:
 *
 *   token     POST https://cvp.api.tatamotors/auth/realms/external/protocol/openid-connect/token
 *   snapshot  GET  https://cvp.api.tatamotors/api/vehicle-snapshots?pageNumber&pageSize
 *
 * Things the spec gets wrong, all confirmed against live data:
 *
 *   - `expires_in` is documented as minutes. The server returns 3600, which as
 *     minutes would be 60 hours; it is plainly seconds, and is read as seconds.
 *   - The `VehicleTelemetry` model capitalises `PrimaryFuelLevel`, but the API
 *     sends `primaryFuelLevel`. The adapter reads both spellings.
 *   - `engineRunHour` carries the odometer, not hours (89,513.6 against
 *     89,513 km). It is discarded rather than stored — see the adapter.
 *   - `secondaryFuelLevel1` / `secondaryFuelTankCapacity1` are unused-slot
 *     sentinels (a constant 1,500 L in a 55,555 L tank, on a vehicle that
 *     reports `noOfFuelTanks: 1`). They are never added to the fuel figure.
 *
 * FIELD SEMANTICS, verified against 161 live samples for RJ21GE3220:
 *
 *   primaryFuelLevel        litres, instantaneous. Quantised to 0.3–1.5 L steps
 *                           and noisy: it moves by up to 1.3 L with the engine
 *                           off and the wheels still, and swings ~9 L while the
 *                           vehicle is running. Never integrate it — see the
 *                           header of `fleet-analytics.ts`.
 *   primaryFuelTankCapacity litres, constant 300.
 *   odometer                kilometres, cumulative, integer.
 *   speed                   km/h, instantaneous.
 *   eventDateTime           vehicle clock, no offset, nanosecond precision.
 *   gpsFix                  false means the position is the last known one.
 *   vehicleStatus           "Moving" | "Idling" | "Stopped".
 *   ignitionOn              boolean.
 *   defLevel                AdBlue, a constant 65000 here — a scaled or
 *                           sentinel value, so it is stored raw and not used.
 *
 * There is no cumulative fuel-consumed counter in the payload, so consumption
 * can only ever be derived from tank level. That is the single hardest
 * constraint on how accurate any mileage figure here can be.
 *
 * The snapshot endpoint reports each vehicle's *latest* state and accepts no
 * time filter, so there is no backfill: a missed run is a permanent gap.
 *
 * SUBSCRIPTION: Basic Pull, a single vehicle — RJ21GE3220 / MAT567005R3C08725 —
 * valid 10 Aug 2026 to 09 Sep 2026. When it lapses the sync will start failing
 * against a live-looking endpoint rather than reporting anything as disabled;
 * `TelematicsProvider.lastSyncStatus` / `lastSyncError` is where that shows up.
 * Adding vehicles is a commercial change with Fleet Edge, not a code change —
 * the sync already pages through whatever the subscription returns.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withPollLock } from "@/lib/poll-lock";
import { reserveCall, budgetStatus, startCooldown, cooldownRemaining, TATA_CALLS_PER_HOUR } from "@/lib/api-budget";
import { TataFleetEdgeAdapter, type TelemetryPing } from "@/lib/telematics-adapters";
import { analyseSegment, riskScore, severityFor, type AnalyticsReading } from "@/lib/fleet-analytics";
import {
  normaliseReading, assetCacheUpdate, detectSchemaDrift, describeDrift,
} from "@/lib/telemetry-normalization";

export const TATA_PROVIDER_CODE = "TATA_FLEET_EDGE";

type TataConfig = {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  baseUrl: string;
  positionsPath: string;
};

/** Reads config from env. Returns null (never throws) when incomplete. */
function readConfig(): TataConfig | null {
  const clientId = process.env.TATA_FLEET_EDGE_CLIENT_ID;
  const clientSecret = process.env.TATA_FLEET_EDGE_CLIENT_SECRET;
  const tokenUrl = process.env.TATA_FLEET_EDGE_TOKEN_URL;
  const baseUrl = process.env.TATA_FLEET_EDGE_BASE_URL;
  const positionsPath = process.env.TATA_FLEET_EDGE_POSITIONS_PATH;

  if (!clientId || !clientSecret || !tokenUrl || !baseUrl || !positionsPath) return null;
  return { clientId, clientSecret, tokenUrl, baseUrl, positionsPath: positionsPath.replace(/^\//, "") };
}

/** Which required env vars are still empty — surfaced in the sync result. */
export function missingConfigKeys(): string[] {
  return [
    "TATA_FLEET_EDGE_CLIENT_ID",
    "TATA_FLEET_EDGE_CLIENT_SECRET",
    "TATA_FLEET_EDGE_TOKEN_URL",
    "TATA_FLEET_EDGE_BASE_URL",
    "TATA_FLEET_EDGE_POSITIONS_PATH",
  ].filter((k) => !process.env[k]);
}

export function isTataEnabled(): boolean {
  return process.env.TATA_FLEET_EDGE_ENABLED === "true" && readConfig() !== null;
}

// ---------------------------------------------------------------------------
// Token handling
// ---------------------------------------------------------------------------

/**
 * Module-scoped token cache. Under Fluid Compute a warm instance serves many
 * requests, so this genuinely saves token round-trips; a cold instance simply
 * fetches once. Deliberately not persisted to the DB — a leaked bearer token in
 * a table is a worse failure than an extra token call.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

// Refresh a minute early so a token can't expire mid-flight on a slow sync.
const EXPIRY_MARGIN_MS = 60_000;

export class TataFleetEdgeError extends Error {
  readonly status?: number;
  readonly body?: string;

  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = "TataFleetEdgeError";
    this.status = status;
    this.body = body;
  }
}

/**
 * The bearer token, shared across serverless instances.
 *
 * Stored in `Setting`, which is excluded from the audit extension so this
 * churn does not flood the log. Read and write both fail soft: a token that
 * cannot be shared costs one extra call, while an exception here would fail
 * the whole sync.
 */
const TOKEN_KEY = "tata:token";

async function readSharedToken(): Promise<{ value: string; expiresAt: number } | null> {
  try {
    const row = await db.setting.findUnique({ where: { key: TOKEN_KEY } });
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as { value: string; expiresAt: number };
    return typeof parsed?.value === "string" && typeof parsed.expiresAt === "number" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSharedToken(tok: { value: string; expiresAt: number }): Promise<void> {
  try {
    const value = JSON.stringify(tok);
    await db.setting.upsert({ where: { key: TOKEN_KEY }, update: { value }, create: { key: TOKEN_KEY, value } });
  } catch {
    // Sharing is an optimisation, never a requirement.
  }
}

async function getAccessToken(cfg: TataConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + EXPIRY_MARGIN_MS) {
    return cachedToken.value;
  }

  // The module cache above is per-instance. On a one-minute cron most
  // invocations land on a cold instance, so nearly every sync was spending a
  // second call on a token it could have shared — doubling consumption against
  // a 60-an-hour ceiling and producing the 429s.
  //
  // The comment this replaces argued a bearer token in a table is a worse
  // failure than an extra token call. That reasoning does not survive contact
  // with the arithmetic: the extra call was not occasional, it was every run,
  // and it cost real telemetry. The token is short-lived, the row is reachable
  // only by this application's database role, and the credentials that mint it
  // are already in the same environment.
  const shared = await readSharedToken();
  if (shared && shared.expiresAt > Date.now() + EXPIRY_MARGIN_MS) {
    cachedToken = shared;
    return shared.value;
  }

  // Standard RFC 6749 client-credentials grant. If Fleet Edge expects HTTP Basic
  // auth or a JSON body instead of form encoding, this is the line the
  // integration guide will correct.
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new TataFleetEdgeError(`Token request failed (${res.status})`, res.status, text.slice(0, 500));
  }

  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TataFleetEdgeError("Token response was not JSON", res.status, text.slice(0, 500));
  }

  if (!parsed.access_token) {
    throw new TataFleetEdgeError("Token response contained no access_token", res.status, text.slice(0, 500));
  }

  // Default to 5 minutes when the server omits expires_in — short enough to be safe.
  const ttlMs = (parsed.expires_in ?? 300) * 1000;
  cachedToken = { value: parsed.access_token, expiresAt: Date.now() + ttlMs };
  await writeSharedToken(cachedToken);
  return cachedToken.value;
}

/** Drops the cached token. Call after a 401 so the next attempt re-authenticates. */
export function invalidateToken(): void {
  // Clear the shared copy as well; otherwise a revoked token is handed straight
  // back to the next instance that reads it.
  void db.setting.deleteMany({ where: { key: TOKEN_KEY } }).catch(() => {});
  cachedToken = null;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/** Per-vehicle errors the API reports alongside successful ones (HTTP 207). */
export type TataProviderFailure = { vehicleNumber?: string; code?: string; message?: string };

type SnapshotPage = {
  vehicles?: unknown[];
  failures?: TataProviderFailure[];
  pageable?: { pageNumber?: number; pageSize?: number; totalPages?: number; totalElements?: number };
};

const PAGE_SIZE = 100;
// The subscription is a fixed fleet, not an unbounded feed; this only stops a
// malformed `totalPages` from looping forever.
const MAX_PAGES = 50;

async function fetchSnapshotPage(cfg: TataConfig, pageNumber: number): Promise<SnapshotPage> {
  const token = await getAccessToken(cfg);
  const url = new URL(cfg.positionsPath, cfg.baseUrl.endsWith("/") ? cfg.baseUrl : `${cfg.baseUrl}/`);
  url.searchParams.set("pageNumber", String(pageNumber));
  url.searchParams.set("pageSize", String(PAGE_SIZE));

  const call = (bearer: string) =>
    fetch(url, {
      headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
      cache: "no-store",
    });

  let res = await call(token);

  // A cached token can be revoked server-side; retry once with a fresh one.
  if (res.status === 401) {
    invalidateToken();
    res = await call(await getAccessToken(cfg));
  }

  const text = await res.text();

  // Rate limiting is documented on this endpoint, and it is worth naming in the
  // sync error rather than surfacing as a generic failure.
  if (res.status === 429) {
    throw new TataFleetEdgeError("Fleet Edge rate limit exceeded (429)", 429, text.slice(0, 500));
  }
  // 207 is a documented partial success — some vehicles returned, others listed
  // in `failures`. `res.ok` covers it, but the intent is easy to misread.
  if (!res.ok) {
    throw new TataFleetEdgeError(`Positions request failed (${res.status})`, res.status, text.slice(0, 500));
  }

  try {
    return JSON.parse(text) as SnapshotPage;
  } catch {
    throw new TataFleetEdgeError("Positions response was not JSON", res.status, text.slice(0, 500));
  }
}

/**
 * Pulls every page of the fleet snapshot and normalises it through the existing
 * adapter, so push (webhook) and pull (this file) produce identical
 * `TelemetryPing`s.
 *
 * Note this is a *snapshot* endpoint: it returns each vehicle's latest state and
 * accepts no time filter, so there is no backfill to request after an outage —
 * a missed run is simply a gap in history.
 */
export async function fetchTataPings(): Promise<{ pings: TelemetryPing[]; failures: TataProviderFailure[] }> {
  const cfg = readConfig();
  if (!cfg) throw new TataFleetEdgeError(`Missing config: ${missingConfigKeys().join(", ")}`);

  const adapter = new TataFleetEdgeAdapter();
  const pings: TelemetryPing[] = [];
  const failures: TataProviderFailure[] = [];

  let pageNumber = 0;
  let totalPages = 1;

  while (pageNumber < totalPages && pageNumber < MAX_PAGES) {
    const page = await fetchSnapshotPage(cfg, pageNumber);
    pings.push(...(await adapter.parsePayload(page)));
    if (Array.isArray(page.failures)) failures.push(...page.failures);

    const reported = Number(page.pageable?.totalPages);
    totalPages = Number.isFinite(reported) && reported > 0 ? reported : 1;
    pageNumber++;
  }

  return { pings, failures };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type TataSyncResult = {
  ok: boolean;
  skipped?: string;
  fetched: number;
  stored: number;
  /** Snapshots already held, i.e. the vehicle has not reported since last sync. */
  duplicates?: number;
  /** Reading pairs measured for distance, burn and efficiency. */
  analysed?: number;
  /** Segments where fuel loss exceeded what the journey explains. */
  anomaliesRaised?: number;
  /** Pings rejected outright by validation — never stored, never counted. */
  invalid?: number;
  /** Pings stored with one or more unusable fields discarded. */
  degraded?: number;
  /** Why those pings were rejected or degraded, for the sync report. */
  validationIssues?: string[];
  /** Provider payload no longer matching the recorded field contract. */
  schemaDrift?: string[];
  /** Vehicles the provider returned that match no asset in the register. */
  unmatched: string[];
  /** Vehicles the provider itself could not report on (HTTP 207). */
  providerFailures?: TataProviderFailure[];
  error?: string;
};

/**
 * Resolves a provider-side identifier to one of our assets.
 *
 * Fleet Edge keys on VIN/chassis, but the fleet register was loaded from the
 * client's own spreadsheet where the reliable key is the registration number —
 * so try every identifier we hold rather than assuming one mapping.
 */
type ResolvedAsset = {
  id: string;
  code: string;
  telematicsProviderId: string | null;
  meterValue: number;
  hourMeterValue: number;
  primaryMeter: string;
  assetClass: string;
  /** Register's tank size, used to range-check fuel when the OEM omits one. */
  fuelCapacity: number;
};

/** The minimal registered-vehicle data required for a fuel-change assessment. */
export type FuelAnomalyAsset = Pick<ResolvedAsset, "id" | "assetClass">;

type RawFields = Record<string, unknown>;

function toFiniteNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Upper-cased alphanumerics only, so "RJ 21 GE 3220" and "rj21ge3220" agree. */
function normaliseId(v: string | null | undefined): string {
  return (v ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * Registration numbers are written by hand in spreadsheets — with spaces, with
 * hyphens, in either case — so an exact column match silently drops vehicles
 * that are plainly the same machine. The fleet is dozens of rows, not millions,
 * so the fallback index is cheap and is built once per sync.
 */
async function buildAssetIndex(): Promise<Map<string, ResolvedAsset>> {
  const assets = await db.asset.findMany({
    where: { decommissionedOn: null },
    select: {
      id: true,
      code: true,
      telematicsProviderId: true,
      deviceId: true,
      chassisNo: true,
      registrationNo: true,
      meterValue: true,
      hourMeterValue: true,
      primaryMeter: true,
      assetClass: true,
      fuelCapacity: true,
    },
  });

  const index = new Map<string, ResolvedAsset>();
  for (const a of assets) {
    const target: ResolvedAsset = {
      id: a.id,
      code: a.code,
      telematicsProviderId: a.telematicsProviderId,
      meterValue: a.meterValue,
      hourMeterValue: a.hourMeterValue,
      primaryMeter: a.primaryMeter,
      assetClass: a.assetClass,
      fuelCapacity: a.fuelCapacity,
    };
    for (const key of [a.registrationNo, a.chassisNo, a.deviceId, a.code]) {
      const k = normaliseId(key);
      // First writer wins: an earlier asset's real registration should not be
      // displaced by a later asset that happens to reuse the string as a code.
      if (k && !index.has(k)) index.set(k, target);
    }
  }
  return index;
}

/**
 * Analyses the step between two readings and, when fuel goes missing that the
 * journey cannot explain, files it into the existing Fuel Anomalies queue.
 *
 * Deliberately writes an anomaly rather than a fraud case: a case names a
 * person, and on daily sampling the evidence does not support that. The queue
 * is where a human decides.
 */
export async function recordTelemetryFuelAnomaly(
  asset: FuelAnomalyAsset,
  previous: AnalyticsReading,
  current: AnalyticsReading,
  readingId: string,
  tankCapacityL: number | null,
): Promise<boolean> {
  const norm =
    (await db.consumptionNorm.findFirst({ where: { assetId: asset.id, unit: "KMPL" } })) ??
    (await db.consumptionNorm.findFirst({ where: { assetClass: asset.assetClass, unit: "KMPL" } }));
  // Idle burn is charged against time; without a class norm the analytics
  // module falls back to a deliberately generous default.
  const idle = await db.consumptionNorm.findFirst({
    where: { assetClass: asset.assetClass, unit: "LPH" },
  });

  const segment = analyseSegment(previous, current, norm, tankCapacityL, idle?.normHigh ?? null);

  // A tank that rises was filled. Record it as a fuel issue so it appears in
  // Fuel Management, Reconciliation and the cost reports like any other fill —
  // the fact that a sensor noticed it rather than a clerk typing it is a
  // provenance detail, not a reason to keep it in a separate silo.
  if (segment.event === "REFUEL" && segment.fuelDeltaL && segment.fuelDeltaL > 0) {
    await recordSensorRefuel(asset, current, segment.fuelDeltaL, segment.hours);
    return false;
  }

  if (
    segment.event !== "STATIONARY_DROP" &&
    segment.event !== "EXCESS_CONSUMPTION" &&
    segment.event !== "IMPLAUSIBLE_DROP"
  ) return false;

  // A physically impossible fall (for example 200 L to 170 L in ten minutes)
  // is not evidence that a driver stole fuel. It may be a sender fault, leak,
  // splash, or removal. It must still reach the problem queue, otherwise the
  // system silently loses the exact signal a supervisor needs to inspect.
  const rapidSensorDrop = segment.event === "IMPLAUSIBLE_DROP";
  const involvedLitres = rapidSensorDrop
    ? Math.abs(segment.fuelDeltaL ?? 0)
    : segment.excessLitres;
  const capacity = tankCapacityL && tankCapacityL > 0 ? tankCapacityL : 300;
  const score = rapidSensorDrop
    ? Math.max(20, Math.min(50, Math.round((involvedLitres / capacity) * 100)))
    : riskScore(segment, tankCapacityL);
  const rate = await dieselRate();

  await db.fuelAnomaly.upsert({
    // Keyed on the reading, so re-running the sync re-scores rather than
    // filling the queue with copies of the same incident.
    where: { source_refId: { source: "ASSET_EFFICIENCY", refId: readingId } },
    update: {},
    create: {
      source: "ASSET_EFFICIENCY",
      refId: readingId,
      assetId: asset.id,
      severity: severityFor(score),
      score,
      litres: involvedLitres,
      // Keep a fast sender drop out of monetary-loss totals until a person has
      // verified that there was a real loss. The case is a prompt to inspect,
      // not an automated allegation or recovery demand.
      valueAtRisk: rapidSensorDrop ? 0 : Math.round(segment.excessLitres * rate),
      reasons: [
        ...segment.reasons,
        ...(rapidSensorDrop
          ? ["Rapid fuel-level change queued for inspection. Cause is unconfirmed: check for a leak, siphoning, or sender fault; no person has been implicated."]
          : []),
        `Window ${segment.from.toISOString()} → ${segment.to.toISOString()} (${segment.hours} h).`,
        `Confidence ${segment.confidence}` +
          (segment.confidence !== "HIGH"
            ? " — sampling interval is too wide to be certain; poll more often before acting."
            : "."),
      ].join("\n"),
    },
  });

  return true;
}

/** How far either side of a sensor-detected fill to look for its paperwork. */
const PAPERWORK_WINDOW_MS = 3 * 60 * 60_000;

/**
 * Turns a detected tank rise into a fuel issue record.
 *
 * Two cases, and the difference matters to the client:
 *
 *  - Paperwork already exists → attach the measured rise to it. That is exactly
 *    what the fuel-verification screens compare against the claimed quantity,
 *    and it is the difference between "the clerk says 150 L" and "150 L
 *    actually entered the tank".
 *  - No paperwork → record the fill anyway, from the sensor. Diesel entering a
 *    tank with no issue slip behind it is worth seeing, not discarding.
 */
async function recordSensorRefuel(
  asset: Pick<ResolvedAsset, "id">,
  reading: AnalyticsReading,
  litres: number,
  windowHours: number,
): Promise<void> {
  const at = reading.recordedAt;
  const rate = await dieselRate();
  const rounded = Math.round(litres * 10) / 10;

  const claimed = await db.fuelTransaction.findFirst({
    where: {
      assetId: asset.id,
      type: "ISSUE",
      captureMethod: { not: "SENSOR" },
      sensorRise: 0,
      date: { gte: new Date(at.getTime() - PAPERWORK_WINDOW_MS), lte: new Date(at.getTime() + PAPERWORK_WINDOW_MS) },
    },
    orderBy: { date: "desc" },
    select: { id: true, quantity: true },
  });

  if (claimed) {
    const variancePct = claimed.quantity > 0 ? ((claimed.quantity - rounded) / claimed.quantity) * 100 : 0;
    await db.fuelTransaction.update({
      where: { id: claimed.id },
      data: {
        sensorRise: rounded,
        variancePct: Math.round(variancePct * 10) / 10,
        // Diesel paid for that never reached the tank is the loss worth
        // catching; a small over-read is sensor tolerance.
        anomaly: variancePct > 10,
      },
    });
    return;
  }

  // Guard against re-recording the same fill if a sync is replayed.
  const already = await db.fuelTransaction.findFirst({
    where: { assetId: asset.id, date: at, captureMethod: "SENSOR" },
    select: { id: true },
  });
  if (already) return;

  await db.fuelTransaction.create({
    data: {
      type: "ISSUE",
      assetId: asset.id,
      quantity: rounded,
      sensorRise: rounded,
      rate,
      amount: Math.round(rounded * rate),
      // `FuelTransaction.meterValue` is non-nullable with a 0 default, and 0 is
      // this column's established "no reading" sentinel — every consumer guards
      // it (`fuel.ts` mileage segments, the meter-rollback scan in
      // loss-prevention, and the fuel tables all test `meterValue > 0`). It is
      // written explicitly here so the convention is visible rather than
      // arriving silently via the schema default.
      meterValue: reading.odometerKm ?? 0,
      lat: reading.lat,
      lng: reading.lng,
      date: at,
      captureMethod: "SENSOR",
      // A fill seen across a 15-minute window is a tight observation; one
      // inferred across hours could be two fills, or a fill and a siphon.
      captureConfidence: windowHours <= 0.5 ? 0.9 : windowHours <= 2 ? 0.6 : 0.3,
      source: "RETAIL",
    },
  });
}

async function dieselRate(): Promise<number> {
  const setting = await db.setting.findUnique({ where: { key: "dieselRate" } });
  const parsed = Number(setting?.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 95;
}

function resolveAsset(ping: TelemetryPing, index: Map<string, ResolvedAsset>): ResolvedAsset | null {
  const ids = ping.identifiers ?? {};
  for (const candidate of [ids.registrationNo, ids.chassisNo, ids.imei, ping.externalDeviceId]) {
    const hit = index.get(normaliseId(candidate));
    if (hit) return hit;
  }
  return null;
}

let isSyncInProgress = false;

/**
 * How long a sync may hold the shared lock.
 *
 * Comfortably above the route's `maxDuration` of 120s, so a slow-but-healthy
 * run is never treated as dead and overtaken mid-flight. A run that genuinely
 * crashes blocks its successors for at most this long.
 */
const SYNC_LOCK_TTL_MS = 150_000;

/** The lock name. One subscription, one poller, one lock. */
export const SYNC_LOCK = "tata-fleet-edge-sync";

/** Budget key. One subscription, one allowance, shared by every caller. */
export const TATA_BUDGET = "tata-fleet-edge";

/** How long to stop calling after the provider refuses. */
const RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;

/**
 * Pulls from Fleet Edge, guaranteeing only one sync runs at a time across every
 * server instance.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE LOCK
 *
 * Fleet Edge allows 60 calls an hour for the whole subscription, and its Basic
 * Pull API is a snapshot with no history endpoint — so a call refused with 429
 * is a moment that can never be recovered. Two overlapping syncs spend two of
 * those calls describing the same minute.
 *
 * The module-level `isSyncInProgress` flag below cannot prevent that on its own:
 * on Vercel each serverless instance holds its own copy, so two instances can
 * both be syncing while each correctly believes it is alone. The flag is kept as
 * a free early-out within one instance; the database lock is what actually
 * holds across them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function syncTataFleetEdge(
  /** A person waiting on a screen may spend the reserve the cron may not. */
  priority: "scheduled" | "manual" = "scheduled",
): Promise<TataSyncResult> {
  const base: TataSyncResult = { ok: false, fetched: 0, stored: 0, unmatched: [] };

  // Cheap checks before taking a lock — no point serialising callers only to
  // discover the integration is switched off.
  if (process.env.TATA_FLEET_EDGE_ENABLED !== "true") {
    return { ...base, ok: true, skipped: "TATA_FLEET_EDGE_ENABLED is not 'true'" };
  }
  const missing = missingConfigKeys();
  if (missing.length) {
    return { ...base, ok: true, skipped: `missing env: ${missing.join(", ")}` };
  }

  if (isSyncInProgress) {
    return { ...base, ok: true, skipped: "Sync already in progress on this instance" };
  }

  const attempt = await withPollLock(SYNC_LOCK, SYNC_LOCK_TTL_MS, async () => {
    isSyncInProgress = true;
    try {
      // A 429 leaves the provider's own window full, and a refused request
      // still lands on their counter — so retrying every minute keeps it topped
      // up and it never drains. Wait it out instead; a call made now would
      // return nothing anyway.
      const cooling = await cooldownRemaining(TATA_BUDGET);
      if (cooling > 0) {
        return {
          ...base,
          ok: true,
          skipped: `Backing off after a rate limit — resuming in ${cooling}s.`,
        };
      }

      // Spend from the hour's allowance before calling, not after being
      // refused. A 429 costs a call and returns nothing; skipping costs
      // neither, and on a snapshot API the moment it would have described
      // cannot be fetched later regardless.
      const slot = await reserveCall(TATA_BUDGET, TATA_CALLS_PER_HOUR, priority);
      if (!slot.ok) {
        return {
          ...base,
          ok: true,
          skipped:
            `Hourly allowance of ${TATA_CALLS_PER_HOUR} Fleet Edge calls is spent. ` +
            `Next slot frees in ${slot.retryInSeconds}s.`,
        };
      }
      return await runTataSync(base);
    } finally {
      isSyncInProgress = false;
    }
  });

  if (!attempt.ran) {
    // Not an error: the other run is fetching exactly the data this one would.
    return { ...base, ok: true, skipped: "Sync already running on another instance" };
  }
  return attempt.result;
}

/** The sync itself. Only ever called by `syncTataFleetEdge`, under the lock. */
async function runTataSync(base: TataSyncResult): Promise<TataSyncResult> {

  // Self-healing: the provider row is what Tracking → Sessions binds assets to,
  // and what records sync health. Create it on first run rather than depending
  // on a seed that production may never have been given.
  let provider: { id: string } | undefined;

  try {
    provider = await db.telematicsProvider.upsert({
      where: { code: TATA_PROVIDER_CODE },
      update: {},
      create: {
        code: TATA_PROVIDER_CODE,
        name: "Tata Fleet Edge",
        apiBaseUrl: process.env.TATA_FLEET_EDGE_BASE_URL ?? null,
        apiKeyEnv: "TATA_FLEET_EDGE_CLIENT_SECRET",
        syncIntervalMin: 15,
      },
      select: { id: true },
    });

    const { pings, failures } = await fetchTataPings();
    const assetIndex = await buildAssetIndex();

    const unmatched = new Set<string>();
    let stored = 0;
    let duplicates = 0;
    let analysed = 0;
    let anomaliesRaised = 0;
    let invalid = 0;
    let degraded = 0;
    const validationIssues: string[] = [];
    const drift = new Set<string>();

    for (const ping of pings) {
      const asset = resolveAsset(ping, assetIndex);
      if (!asset) {
        unmatched.add(ping.externalDeviceId);
        continue;
      }

      // Fleet Edge changing its payload shape must be reported, not absorbed. A
      // field that quietly disappears does not break a screen — it empties a
      // calculation, which is far harder to notice and far worse to act on.
      const summary = describeDrift(detectSchemaDrift(ping.rawPayload));
      if (summary) drift.add(summary);

      // This is a snapshot endpoint, so a parked vehicle returns the identical
      // eventDateTime on every run. Inserting unconditionally would write one
      // duplicate row per sync — and every duplicate reads as a fresh sample to
      // anything reasoning over reading history, such as idle-time and
      // fuel-drop detection.
      const alreadyStored = await db.telemetryReading.findFirst({
        where: { assetId: asset.id, recordedAt: ping.timestamp, source: "GPS_API" },
        select: { id: true },
      });
      if (alreadyStored) {
        duplicates++;
        continue;
      }

      // Attribute the sample to whoever is checked in, so a fuel drop has an
      // accountable driver and not just a vehicle.
      const session = await db.tripSession.findFirst({
        where: { assetId: asset.id, status: "ACTIVE" },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });

      // The immediately preceding sample is what turns a snapshot into a
      // measurement — distance covered, fuel burned, and whether those agree.
      const previous = await db.telemetryReading.findFirst({
        where: { assetId: asset.id, recordedAt: { lt: ping.timestamp } },
        orderBy: { recordedAt: "desc" },
        select: {
          recordedAt: true, lat: true, lng: true, speedKph: true,
          odometerKm: true, fuelLevelL: true, fuelLevelPct: true, ignitionOn: true,
        },
      });

      // The tank size the vehicle reports beats a hand-typed one: fuel-theft
      // detection sizes a siphon against it, and so does the sender's noise
      // band. Only tanks the adapter actually read are counted — see
      // `interpretFleetEdgeFuel` for why the secondary pair is not one of them.
      const fuel = ping.fuelInterpretation;
      const reportedCapacity =
        fuel?.secondaryIncluded && fuel.primaryCapacityL != null && fuel.secondaryCapacityL != null
          ? fuel.primaryCapacityL + fuel.secondaryCapacityL
          : (fuel?.primaryCapacityL ??
             toFiniteNumber((ping.rawPayload as RawFields).primaryFuelTankCapacity));

      // Same validator as every other ingestion path, so a value Fleet Edge
      // sends cannot be stored here on terms the push routes would refuse.
      const check = normaliseReading(ping, {
        fuelCapacityL: reportedCapacity ?? asset.fuelCapacity,
        lastOdometerKm: previous?.odometerKm ?? null,
      });

      if (!check.accepted || !check.reading) {
        invalid++;
        validationIssues.push(
          `${ping.externalDeviceId}: ${check.issues.map((i) => `${i.field} — ${i.reason}`).join("; ")}`,
        );
        continue;
      }
      if (check.degraded) {
        degraded++;
        validationIssues.push(
          `${ping.externalDeviceId}: ${check.issues.map((i) => `${i.field} — ${i.reason}`).join("; ")}`,
        );
      }

      const r = check.reading;

      // The pre-check above is the fast path; this is the race. Two runs
      // overlapping — a slow sync still in flight when the next cron fires —
      // both pass the check and both insert. `TelemetryReading` carries a
      // unique constraint on (assetId, recordedAt, source) for exactly this,
      // and a violation here means the other run already stored the sample.
      let created: { id: string };
      try {
        created = await db.telemetryReading.create({
          data: {
            assetId: asset.id,
            recordedAt: r.recordedAt,
            lat: r.lat,
            lng: r.lng,
            speedKph: r.speedKph,
            headingDeg: r.headingDeg,
            odometerKm: r.odometerKm,
            engineHours: r.engineHours,
            fuelLevelPct: r.fuelLevelPct,
            fuelLevelL: r.fuelLevelL,
            ignitionOn: r.ignitionOn,
            source: "GPS_API",
            providerId: provider?.id ?? asset.telematicsProviderId ?? null,
            sessionId: session?.id ?? null,
            raw: ping.rawPayload as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        // P2002 = unique violation. The concurrent run won; its row is the same
        // observation, so this is a duplicate, not a failure.
        if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
          duplicates++;
          continue;
        }
        throw e;
      }

      if (previous) {
        analysed++;
        const raised = await recordTelemetryFuelAnomaly(
          asset,
          previous as AnalyticsReading,
          {
            recordedAt: r.recordedAt,
            lat: r.lat,
            lng: r.lng,
            speedKph: r.speedKph,
            odometerKm: r.odometerKm,
            fuelLevelL: r.fuelLevelL,
            fuelLevelPct: r.fuelLevelPct,
            ignitionOn: r.ignitionOn,
          },
          created.id,
          reportedCapacity,
        );
        if (raised) anomaliesRaised++;
      }

      await db.asset.update({
        where: { id: asset.id },
        data: {
          ...assetCacheUpdate(r, asset),
          // Reading provenance already proves this asset came from Tata. Keep
          // the register relation in step as well, so provider-scoped views
          // and future reports do not depend on historical reading joins.
          telematicsProviderId: provider.id,
          ...(reportedCapacity != null && reportedCapacity > 0 ? { fuelCapacity: reportedCapacity } : {}),
        },
      });
      stored++;
    }

    if (provider) {
      // A required field vanishing from the feed is a data-integrity incident,
      // not a healthy sync. Surfacing it on the provider row is what makes it
      // visible on Tracking → Sessions instead of only in a log nobody reads.
      const driftNotes = [...drift];
      const breaking = driftNotes.filter((d) => d.includes("MISSING REQUIRED"));
      await db.telematicsProvider.update({
        where: { id: provider.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: breaking.length ? "SCHEMA_DRIFT" : "OK",
          lastSyncError: breaking.length ? breaking.join(" || ").slice(0, 500) : null,
        },
      });
    }

    return {
      ok: true,
      fetched: pings.length,
      stored,
      ...(duplicates ? { duplicates } : {}),
      ...(analysed ? { analysed } : {}),
      ...(anomaliesRaised ? { anomaliesRaised } : {}),
      ...(invalid ? { invalid } : {}),
      ...(degraded ? { degraded } : {}),
      ...(validationIssues.length ? { validationIssues: validationIssues.slice(0, 20) } : {}),
      ...(drift.size ? { schemaDrift: [...drift] } : {}),
      unmatched: [...unmatched],
      ...(failures.length ? { providerFailures: failures } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Fleet Edge allows one call a minute. Polling close to that ceiling means
    // the occasional 429 is expected traffic shaping, not a broken integration
    // — the next run is two minutes away and will simply succeed. Recording it
    // as an ERROR would leave the provider showing red most of the day and
    // train whoever watches it to ignore a status that eventually matters.
    if (err instanceof TataFleetEdgeError && err.status === 429) {
      // Long enough for the provider's window to drain meaningfully. Shorter
      // and the retries keep it full; much longer and a transient limit costs
      // more telemetry than it needs to.
      await startCooldown(TATA_BUDGET, RATE_LIMIT_COOLDOWN_MS);
      if (provider) {
        await db.telematicsProvider.update({
          where: { id: provider.id },
          data: { lastSyncStatus: "RATE_LIMITED", lastSyncError: null },
        });
      }
      return { ...base, ok: true, skipped: "Rate limited by Fleet Edge — retrying on the next run." };
    }

    if (provider) {
      await db.telematicsProvider.update({
        where: { id: provider.id },
        data: { lastSyncAt: new Date(), lastSyncStatus: "ERROR", lastSyncError: message.slice(0, 500) },
      });
    }
    return { ...base, error: message };
  }
}

export type TataStatusInfo = {
  enabled: boolean;
  configured: boolean;
  missingKeys: string[];
  /** Calls used and left in the trailing hour, so the ceiling is visible. */
  budget: { used: number; limit: number; remaining: number };
  provider: {
    id: string;
    code: string;
    name: string;
    lastSyncAt: Date | null;
    lastSyncStatus: string | null;
    lastSyncError: string | null;
  } | null;
  lastReadingAt: Date | null;
  activeVehiclesCount: number;
  totalReadingsCount: number;
};

export async function getTataSyncStatus(): Promise<TataStatusInfo> {
  const enabled = process.env.TATA_FLEET_EDGE_ENABLED === "true";
  const missing = missingConfigKeys();
  const configured = missing.length === 0;

  const [provider, lastReading, activeVehicles, totalReadings] = await db.$transaction([
    db.telematicsProvider.findUnique({
      where: { code: TATA_PROVIDER_CODE },
      select: {
        id: true,
        code: true,
        name: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastSyncError: true,
      },
    }),
    db.telemetryReading.findFirst({
      where: { source: "GPS_API" },
      orderBy: { recordedAt: "desc" },
      select: { recordedAt: true },
    }),
    db.asset.count({
      where: {
        lastSeen: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
        lat: { not: 0 },
      },
    }),
    db.telemetryReading.count({ where: { source: "GPS_API" } }),
  ]);

  const budget = await budgetStatus(TATA_BUDGET, TATA_CALLS_PER_HOUR);

  return {
    enabled,
    configured,
    missingKeys: missing,
    budget,
    provider,
    lastReadingAt: lastReading?.recordedAt ?? null,
    activeVehiclesCount: activeVehicles,
    totalReadingsCount: totalReadings,
  };
}
