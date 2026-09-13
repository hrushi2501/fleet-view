import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkSharedSecret } from "@/lib/auth";
import { normaliseReading, assetCacheUpdate, readTelemetryJson } from "@/lib/telemetry-normalization";
import type { TelemetryPing } from "@/lib/telematics-adapters";
import { reserveRateLimit, rateLimitResponse, clientIp } from "@/lib/request-rate-limit";
import { recordTelemetryFuelAnomaly, type FuelAnomalyAsset } from "@/lib/tata-fleet-edge";
import { invalidateLiveFleetCache } from "@/lib/fleet-edge-live";

export const dynamic = "force-dynamic";

// Shared device key — any GPS tracker, provider relay, or phone can POST
// positions, so FLEET_INGEST_KEY is the only thing standing between this route
// and fabricated telemetry. It is read per request and has no default: an unset
// variable disables ingest rather than falling back to a key that is published
// in this repository's history.

/** Statuses a device is allowed to set. Anything else is a typo or an attack. */
const DEVICE_SETTABLE_STATUS = new Set(["Active", "Idle", "Breakdown", "Under Maintenance", "Parked"]);

/**
 * Telemetry ingest.
 *
 * POST {
 *   key, assetId | assetCode | registrationNo | deviceId,
 *   lat?, lng?, speed?, heading?, odometer?, engineHours?,
 *   fuelLevelPct?, fuelLevelL?, ignition?, source?, recordedAt?, status?
 * }
 *
 * Every sample is stored as history rather than only overwriting the asset, so a
 * trip can be reconstructed and a fuel drop can be placed in time and space. The
 * asset's cached position is still updated for the map, but it is a cache, not
 * the record.
 *
 * Validation is shared with every other ingestion path via
 * `telemetry-normalization`, so a device cannot write a number here that the
 * Fleet Edge sync would have refused.
 *
 * Also accepts { readings: [...] } for providers that batch.
 */
async function ingestOne(body: Record<string, unknown>) {
  const where = body.assetId ? { id: String(body.assetId) }
    : body.registrationNo ? { registrationNo: String(body.registrationNo) }
    : body.assetCode ? { code: String(body.assetCode) }
    : body.deviceId ? { deviceId: String(body.deviceId) } : null;
  if (!where) return { ok: false as const, error: "asset identifier required" };

  const asset = await db.asset.findFirst({
    where: { ...where, decommissionedOn: null },
    select: {
      id: true, code: true, fuelCapacity: true, meterValue: true,
      hourMeterValue: true, primaryMeter: true, telematicsProviderId: true, assetClass: true,
    },
  });
  if (!asset) return { ok: false as const, error: "asset not found" };

  const num = (k: string) => (body[k] != null && isFinite(Number(body[k])) ? Number(body[k]) : null);

  // An unparseable date used to fall through to "now", which stamps a sample
  // with a time it was not taken and reorders the whole series around it.
  let recordedAt = new Date();
  if (body.recordedAt != null) {
    const parsed = new Date(String(body.recordedAt));
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false as const, error: `unparseable recordedAt: ${String(body.recordedAt)}` };
    }
    recordedAt = parsed;
  }

  const suppliedSource = typeof body.source === "string" ? body.source.trim().toUpperCase() : "";
  const source = ["DEVICE", "MOBILE", "LOCANAV", "MAPMYINDIA", "TATA_FLEET_EDGE"].includes(suppliedSource) ? suppliedSource : "DEVICE";

  const previous = await db.telemetryReading.findFirst({
    where: { assetId: asset.id, odometerKm: { not: null } },
    orderBy: { recordedAt: "desc" },
    select: {
      recordedAt: true, lat: true, lng: true, speedKph: true, odometerKm: true,
      fuelLevelL: true, fuelLevelPct: true, ignitionOn: true, engineHours: true,
    },
  });

  // Reuse the provider-agnostic validator by shaping the body as a ping.
  const ping: TelemetryPing = {
    externalDeviceId: asset.code,
    timestamp: recordedAt,
    latitude: num("lat"),
    longitude: num("lng"),
    speedKph: num("speed") ?? num("speedKph"),
    headingDeg: num("heading") ?? num("headingDeg"),
    odometerKm: num("odometer") ?? num("odometerKm"),
    engineHours: num("engineHours"),
    fuelLevelPct: num("fuelLevelPct"),
    fuelLevelLitres: num("fuelLevelL"),
    ignitionState: typeof body.ignition === "boolean" ? body.ignition : null,
    rawPayload: body,
  };

  const result = normaliseReading(ping, {
    fuelCapacityL: asset.fuelCapacity,
    lastOdometerKm: previous?.odometerKm ?? null,
    lastEngineHours: previous?.engineHours ?? null,
  });

  if (!result.accepted || !result.reading) {
    return { ok: false as const, error: result.issues.map((i) => `${i.field}: ${i.reason}`).join("; ") };
  }
  const r = result.reading;

  // A device that retries — or a relay that replays a batch — describes the
  // same instant twice. Counting it twice doubles distance and fuel.
  const already = await db.telemetryReading.findFirst({
    where: { assetId: asset.id, recordedAt: r.recordedAt, source },
    select: { id: true },
  });
  if (already) {
    return { ok: true as const, asset: asset.code, duplicate: true, session: null };
  }

  // Tie the sample to whoever is checked in, so a position or a fuel drop has an
  // accountable driver and not just a vehicle.
  const session = await db.tripSession.findFirst({
    where: { assetId: asset.id, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });

  let created: { id: string };
  try {
    created = await db.telemetryReading.create({
      data: {
      assetId: asset.id,
      recordedAt: r.recordedAt,
      lat: r.lat, lng: r.lng,
      speedKph: r.speedKph,
      headingDeg: r.headingDeg,
      odometerKm: r.odometerKm,
      engineHours: r.engineHours,
      fuelLevelPct: r.fuelLevelPct,
      fuelLevelL: r.fuelLevelL,
      ignitionOn: r.ignitionOn,
      source,
      providerId: asset.telematicsProviderId,
      sessionId: session?.id ?? null,
      raw: body as never,
      },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      return { ok: true, asset: asset.code, duplicate: true, session: null };
    }
    throw error;
  }

  if (previous) {
    await recordTelemetryFuelAnomaly(
      asset as FuelAnomalyAsset,
      previous,
      {
        recordedAt: r.recordedAt, lat: r.lat, lng: r.lng, speedKph: r.speedKph,
        odometerKm: r.odometerKm, fuelLevelL: r.fuelLevelL,
        fuelLevelPct: r.fuelLevelPct, ignitionOn: r.ignitionOn,
      },
      created.id,
      asset.fuelCapacity,
    );
  }

  // Status is operational state, not telemetry. Accept only the vocabulary the
  // ERP uses — an arbitrary string here propagates to every status filter,
  // dashboard count and availability report in the system.
  const statusPatch =
    typeof body.status === "string" && DEVICE_SETTABLE_STATUS.has(body.status)
      ? { status: body.status }
      : {};

  await db.asset.update({
    where: { id: asset.id },
    data: { ...assetCacheUpdate(r, asset), ...statusPatch },
  });

  return {
    ok: true as const,
    asset: asset.code,
    session: session?.id ?? null,
    ...(result.degraded ? { droppedFields: result.issues.filter((i) => i.severity === "DROP_FIELD").map((i) => i.field) } : {}),
    ...(typeof body.status === "string" && !DEVICE_SETTABLE_STATUS.has(body.status)
      ? { statusIgnored: body.status }
      : {}),
  };
}

async function handlePOST(req: Request) {
  const parsed = await readTelemetryJson(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return NextResponse.json({ error: "Telemetry payload must be a JSON object." }, { status: 400 });
  }
  const body = parsed.value as Record<string, unknown>;

  const auth = checkSharedSecret(req, "FLEET_INGEST_KEY", { bodyKey: body.key });
  if (!auth.ok) {
    const ip = clientIp(req);
    const limit = await reserveRateLimit({
      scope: "failed-ingest-key",
      subject: ip,
      limit: 20,
      windowMs: 60_000,
    });
    if (!limit.ok) {
      return rateLimitResponse(limit.retryInSeconds, "Too many unauthorized attempts. Please wait.");
    }
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }


  // The whole body is persisted as `raw` and served back on the asset detail
  // API, so the credential must not travel with it — otherwise the ingest key is
  // readable by every signed-in user.
  delete body.key;
  const limit = await reserveRateLimit({ scope: "device-ingest", subject: "provider", limit: 600, windowMs: 60_000 });
  if (!limit.ok) return rateLimitResponse(limit.retryInSeconds);

  if (Array.isArray(body.readings)) {
    if (body.readings.length > 1_000) return NextResponse.json({ error: "Telemetry payload contains too many readings." }, { status: 413 });
    const results = [];
    for (const r of body.readings as Record<string, unknown>[]) {
      const { key: _ignored, ...reading } = r;
      void _ignored;
      results.push(await ingestOne(reading));
    }
    const accepted = results.filter((r) => r.ok && !("duplicate" in r && r.duplicate)).length;
    if (accepted > 0) await invalidateLiveFleetCache();
    return NextResponse.json({
      ok: true,
      accepted,
      duplicates: results.filter((r) => r.ok && "duplicate" in r && r.duplicate).length,
      rejected: results.filter((r) => !r.ok).length,
      results,
    });
  }

  const r = await ingestOne(body);
  if (r.ok && !("duplicate" in r && r.duplicate)) await invalidateLiveFleetCache();
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.error === "asset not found" ? 404 : 400 });
}

export const POST = withApiErrors(handlePOST);
