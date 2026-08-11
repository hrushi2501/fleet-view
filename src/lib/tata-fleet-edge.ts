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
 * Two things the spec gets wrong, both confirmed against live data:
 *
 *   - `expires_in` is documented as minutes. The server returns 3600, which as
 *     minutes would be 60 hours; it is plainly seconds, and is read as seconds.
 *   - The `VehicleTelemetry` model capitalises `PrimaryFuelLevel`, but the API
 *     sends `primaryFuelLevel`. The adapter reads both spellings.
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
import { TataFleetEdgeAdapter, type TelemetryPing } from "@/lib/telematics-adapters";
import { analyseSegment, riskScore, severityFor, type AnalyticsReading } from "@/lib/fleet-analytics";

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
  constructor(message: string, readonly status?: number, readonly body?: string) {
    super(message);
    this.name = "TataFleetEdgeError";
  }
}

async function getAccessToken(cfg: TataConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + EXPIRY_MARGIN_MS) {
    return cachedToken.value;
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
  return cachedToken.value;
}

/** Drops the cached token. Call after a 401 so the next attempt re-authenticates. */
export function invalidateToken(): void {
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
};

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
async function raiseFuelAnomaly(
  asset: ResolvedAsset,
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

  if (segment.event !== "STATIONARY_DROP" && segment.event !== "EXCESS_CONSUMPTION") return false;

  const score = riskScore(segment, tankCapacityL);
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
      litres: segment.excessLitres,
      valueAtRisk: Math.round(segment.excessLitres * rate),
      reasons: [
        ...segment.reasons,
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
  asset: ResolvedAsset,
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

/**
 * Pulls from Fleet Edge and persists each ping as history, mirroring the push
 * route: `TelemetryReading` is the record, the asset's own lat/lng/fuel columns
 * are only a cache for the map.
 */
export async function syncTataFleetEdge(): Promise<TataSyncResult> {
  const base: TataSyncResult = { ok: false, fetched: 0, stored: 0, unmatched: [] };

  if (process.env.TATA_FLEET_EDGE_ENABLED !== "true") {
    return { ...base, ok: true, skipped: "TATA_FLEET_EDGE_ENABLED is not 'true'" };
  }
  const missing = missingConfigKeys();
  if (missing.length) {
    return { ...base, ok: true, skipped: `missing env: ${missing.join(", ")}` };
  }

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

    for (const ping of pings) {
      const asset = resolveAsset(ping, assetIndex);
      if (!asset) {
        unmatched.add(ping.externalDeviceId);
        continue;
      }

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

      const created = await db.telemetryReading.create({
        data: {
          assetId: asset.id,
          recordedAt: ping.timestamp,
          lat: ping.latitude,
          lng: ping.longitude,
          speedKph: ping.speedKph,
          headingDeg: ping.headingDeg ?? null,
          odometerKm: ping.odometerKm,
          engineHours: ping.engineHours,
          fuelLevelPct: ping.fuelLevelPct,
          fuelLevelL: ping.fuelLevelLitres,
          ignitionOn: ping.ignitionState,
          source: "GPS_API",
          providerId: provider?.id ?? asset.telematicsProviderId ?? null,
          sessionId: session?.id ?? null,
          raw: ping.rawPayload as Prisma.InputJsonValue,
        },
      });

      // The tank size the vehicle reports beats a hand-typed one: fuel-theft
      // detection sizes a siphon against it.
      const reportedCapacity = toFiniteNumber((ping.rawPayload as RawFields).primaryFuelTankCapacity);

      if (previous) {
        analysed++;
        const raised = await raiseFuelAnomaly(
          asset,
          previous as AnalyticsReading,
          {
            recordedAt: ping.timestamp,
            lat: ping.latitude,
            lng: ping.longitude,
            speedKph: ping.speedKph,
            odometerKm: ping.odometerKm,
            fuelLevelL: ping.fuelLevelLitres,
            fuelLevelPct: ping.fuelLevelPct,
            ignitionOn: ping.ignitionState,
          },
          created.id,
          reportedCapacity,
        );
        if (raised) anomaliesRaised++;
      }

      await db.asset.update({
        where: { id: asset.id },
        data: {
          ...(ping.latitude != null && ping.longitude != null ? { lat: ping.latitude, lng: ping.longitude } : {}),
          ...(ping.speedKph != null ? { speed: ping.speedKph } : {}),
          ...(ping.fuelLevelPct != null ? { fuelLevelPct: ping.fuelLevelPct, fuelLevelAt: ping.timestamp } : {}),
          // Without this the asset's odometer stays frozen at whatever was typed
          // when the record was created, while the map moves — the same machine
          // reading as both 89,399 km and somewhere 7 km further along.
          // Guarded against a provider glitch winding a meter backwards.
          ...(ping.odometerKm != null && ping.odometerKm >= asset.meterValue && asset.primaryMeter === "ODOMETER"
            ? { meterValue: ping.odometerKm }
            : {}),
          ...(ping.engineHours != null && ping.engineHours >= asset.hourMeterValue
            ? { hourMeterValue: ping.engineHours }
            : {}),
          ...(reportedCapacity != null && reportedCapacity > 0 ? { fuelCapacity: reportedCapacity } : {}),
          lastSeen: ping.timestamp,
        },
      });
      stored++;
    }

    if (provider) {
      await db.telematicsProvider.update({
        where: { id: provider.id },
        data: { lastSyncAt: new Date(), lastSyncStatus: "OK", lastSyncError: null },
      });
    }

    return {
      ok: true,
      fetched: pings.length,
      stored,
      ...(duplicates ? { duplicates } : {}),
      ...(analysed ? { analysed } : {}),
      ...(anomaliesRaised ? { anomaliesRaised } : {}),
      unmatched: [...unmatched],
      ...(failures.length ? { providerFailures: failures } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (provider) {
      await db.telematicsProvider.update({
        where: { id: provider.id },
        data: { lastSyncAt: new Date(), lastSyncStatus: "ERROR", lastSyncError: message.slice(0, 500) },
      });
    }
    return { ...base, error: message };
  }
}
