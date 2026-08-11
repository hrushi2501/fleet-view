import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Shared device key — any GPS tracker, provider relay, or phone can POST positions.
const KEY = process.env.FLEET_INGEST_KEY || "mcc-fleet-2026";

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
 * Also accepts { readings: [...] } for providers that batch.
 */
async function ingestOne(body: Record<string, unknown>) {
  const where = body.assetId ? { id: String(body.assetId) }
    : body.registrationNo ? { registrationNo: String(body.registrationNo) }
    : body.assetCode ? { code: String(body.assetCode) }
    : body.deviceId ? { deviceId: String(body.deviceId) } : null;
  if (!where) return { ok: false as const, error: "asset identifier required" };

  const asset = await db.asset.findFirst({ where });
  if (!asset) return { ok: false as const, error: "asset not found" };

  const num = (k: string) => (body[k] != null && isFinite(Number(body[k])) ? Number(body[k]) : null);
  const lat = num("lat"), lng = num("lng");
  const fuelPct = num("fuelLevelPct");
  const recordedAt = body.recordedAt ? new Date(String(body.recordedAt)) : new Date();

  // Tie the sample to whoever is checked in, so a position or a fuel drop has an
  // accountable driver and not just a vehicle.
  const session = await db.tripSession.findFirst({
    where: { assetId: asset.id, status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
  });

  await db.telemetryReading.create({
    data: {
      assetId: asset.id,
      recordedAt,
      lat, lng,
      speedKph: num("speed") ?? num("speedKph"),
      headingDeg: num("heading") ?? num("headingDeg"),
      odometerKm: num("odometer") ?? num("odometerKm"),
      engineHours: num("engineHours"),
      fuelLevelPct: fuelPct,
      fuelLevelL: num("fuelLevelL"),
      ignitionOn: typeof body.ignition === "boolean" ? body.ignition : null,
      source: typeof body.source === "string" ? body.source : "DEVICE",
      providerId: asset.telematicsProviderId,
      sessionId: session?.id ?? null,
    },
  });

  await db.asset.update({
    where: { id: asset.id },
    data: {
      ...(lat != null && lng != null ? { lat, lng } : {}),
      ...(num("speed") != null ? { speed: num("speed")! } : {}),
      ...(fuelPct != null ? { fuelLevelPct: fuelPct, fuelLevelAt: recordedAt } : {}),
      ...(typeof body.status === "string" ? { status: body.status } : {}),
      lastSeen: recordedAt,
    },
  });

  return { ok: true as const, asset: asset.code, session: session?.id ?? null };
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  if (body.key !== KEY) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (Array.isArray(body.readings)) {
    const results = [];
    for (const r of body.readings as Record<string, unknown>[]) {
      results.push(await ingestOne({ ...r, key: body.key }));
    }
    return NextResponse.json({ ok: true, accepted: results.filter((r) => r.ok).length, rejected: results.filter((r) => !r.ok).length, results });
  }

  const r = await ingestOne(body);
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.error === "asset not found" ? 404 : 400 });
}
