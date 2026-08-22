import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkSharedSecret } from "@/lib/auth";
import { normaliseReading, assetCacheUpdate } from "@/lib/telemetry-normalization";
import { TataFleetEdgeAdapter } from "@/lib/telematics-adapters";
import type { TelemetryPing } from "@/lib/telematics-adapters";

export const dynamic = "force-dynamic";
// A push may carry the whole fleet in one body; allow room for a slow write.
export const maxDuration = 120;

/**
 * Tata Fleet Edge push receiver.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE URL TO GIVE TATA
 *
 *   https://fleetview-erp-indol.vercel.app/api/telematics/tata
 *
 * Their subscription flow asks for an endpoint first and issues the credential
 * afterwards, so this route exists and answers before the key is known. Until
 * `TATA_PUSH_KEY` is set it refuses every request with 503 rather than
 * accepting unauthenticated telemetry — an ingest endpoint that is open while
 * "not configured yet" is an endpoint anyone can write fuel readings into.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SEPARATE ROUTE FROM /api/telematics
 *
 * Two reasons, one of each kind.
 *
 * Shape: the generic route expects this application's vocabulary — `lat`,
 * `fuelLevelL`, `odometer`. Fleet Edge speaks its own — `primaryFuelLevel`,
 * `registrationNumber`, and an `engineRunHour` that actually carries the
 * odometer. The mapping already exists in `TataFleetEdgeAdapter`, verified
 * against live responses rather than the PDF, so this route reuses it instead
 * of asking Tata to rename their fields.
 *
 * Credentials: `FLEET_INGEST_KEY` is a single shared secret that can write
 * telemetry for *any* vehicle. Handing that to an OEM would mean a leak
 * anywhere gives an attacker the OEM feed too. Tata gets its own key, and
 * revoking it costs nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `source: "GPS_API"` AND NOT A NEW SOURCE
 *
 * The unique key on `TelemetryReading` is (assetId, recordedAt, source), and
 * `source` is part of it so that the same instant seen by two independent
 * providers stays two observations.
 *
 * Push and pull here are not independent — they are the same TCU reading
 * delivered twice. Tagging push differently would keep both rows, and every
 * distance and fuel figure is measured across a series of readings, so the
 * journey would be counted twice. Sharing the pull's tag makes the dedupe
 * collapse them, which is what lets push and pull run side by side during a
 * cutover without corrupting the numbers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SOURCE = "GPS_API";

/** Normalises an identifier the way the pull path does before matching. */
const key = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/[\s-]/g, "");

async function resolveAsset(ping: TelemetryPing) {
  const ids = ping.identifiers ?? {};
  const candidates = [ids.registrationNo, ids.chassisNo, ids.imei, ping.externalDeviceId]
    .map(key)
    .filter(Boolean);
  if (candidates.length === 0) return null;

  // Registration and chassis are the identifiers Fleet Edge actually sends;
  // `deviceId` is matched too so an aftermarket unit on the same account works.
  const assets = await db.asset.findMany({
    where: {
      OR: [
        { registrationNo: { in: candidates, mode: "insensitive" } },
        { chassisNo: { in: candidates, mode: "insensitive" } },
        { code: { in: candidates, mode: "insensitive" } },
        { deviceId: { in: candidates, mode: "insensitive" } },
      ],
    },
    select: {
      id: true, code: true, fuelCapacity: true, registrationNo: true,
      chassisNo: true, deviceId: true, telematicsProviderId: true,
      // Required by `assetCacheUpdate` to decide which meter a reading advances.
      meterValue: true, hourMeterValue: true, primaryMeter: true,
    },
  });

  if (assets.length === 0) return null;
  // Prefer an exact match on the strongest identifier available.
  for (const c of candidates) {
    const hit = assets.find(
      (a) =>
        key(a.registrationNo) === c ||
        key(a.chassisNo) === c ||
        key(a.deviceId) === c ||
        key(a.code) === c,
    );
    if (hit) return hit;
  }
  return assets[0]!;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // Accepts Authorization: Bearer, x-fleet-key, ?key=, or a `key` field.
  // Fails closed when TATA_PUSH_KEY is unset.
  const bodyKey = body && typeof body === "object" ? (body as Record<string, unknown>).key : undefined;
  const auth = checkSharedSecret(req, "TATA_PUSH_KEY", { bodyKey });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const pings = await new TataFleetEdgeAdapter().parsePayload(body);

  if (pings.length === 0) {
    // The first real push is the first time this shape is seen. Log the body so
    // the mapping can be corrected against what Tata actually sends, and answer
    // 422 rather than 200 — a success would tell them to stop retrying and the
    // readings would be lost while the mapper is wrong.
    console.error("[tata-push] payload produced no readings:", JSON.stringify(body).slice(0, 4000));
    return NextResponse.json(
      { error: "No readings could be read from this payload.", accepted: 0 },
      { status: 422 },
    );
  }

  let accepted = 0;
  let duplicates = 0;
  const unmatched: string[] = [];

  for (const ping of pings) {
    const asset = await resolveAsset(ping);
    if (!asset) {
      unmatched.push(ping.identifiers?.registrationNo ?? ping.externalDeviceId ?? "unknown");
      continue;
    }

    // Same instant, same vehicle, same source — already held, whether it
    // arrived by push, by the pull cron, or by a retry of this very call.
    const already = await db.telemetryReading.findFirst({
      where: { assetId: asset.id, recordedAt: ping.timestamp, source: SOURCE },
      select: { id: true },
    });
    if (already) {
      duplicates++;
      continue;
    }

    const previous = await db.telemetryReading.findFirst({
      where: { assetId: asset.id, recordedAt: { lt: ping.timestamp } },
      orderBy: { recordedAt: "desc" },
      select: { odometerKm: true, engineHours: true },
    });

    // The same validator the pull and the device route use, so a number
    // refused on one path cannot enter through another.
    const result = normaliseReading(ping, {
      fuelCapacityL: asset.fuelCapacity,
      lastOdometerKm: previous?.odometerKm ?? null,
      lastEngineHours: previous?.engineHours ?? null,
    });
    if (!result.accepted || !result.reading) {
      unmatched.push(`${asset.code}: ${result.issues.map((i) => i.field).join(", ")}`);
      continue;
    }
    const r = result.reading;

    const session = await db.tripSession.findFirst({
      where: { assetId: asset.id, status: "ACTIVE" },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });

    try {
      await db.telemetryReading.create({
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
          source: SOURCE,
          providerId: asset.telematicsProviderId,
          sessionId: session?.id ?? null,
          raw: ping.rawPayload as never,
        },
      });
      accepted++;
    } catch {
      // The unique index is the real guard against a concurrent pull writing
      // the same instant between the check above and this insert.
      duplicates++;
      continue;
    }

    await db.asset.update({
      where: { id: asset.id },
      data: assetCacheUpdate(r, asset),
    });
  }

  return NextResponse.json({ ok: true, accepted, duplicates, unmatched });
}
