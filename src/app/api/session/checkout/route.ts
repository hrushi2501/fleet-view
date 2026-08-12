import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { reconstructPath, type ReadingLite } from "@/lib/telematics";

export const dynamic = "force-dynamic";

/**
 * End a trip session. POST { sessionId?, lat?, lng?, odometer?, notes? }
 *
 * Distance comes from the recorded path where positions exist, and falls back to
 * the odometer difference where they do not — a vehicle with no GPS still
 * produces a usable trip record, just a coarser one.
 */
export async function POST(req: Request) {
  const auth = await getSession();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* checkout with no body is fine */ }

  const account = await db.user.findUnique({ where: { id: auth.id }, include: { driverRef: true } });
  const person = account?.driverRef ?? (await db.driver.findFirst({ where: { name: auth.name } }));

  const active = body.sessionId
    ? await db.tripSession.findUnique({ where: { id: String(body.sessionId) } })
    : person
      ? await db.tripSession.findFirst({ where: { driverId: person.id, status: "ACTIVE" }, orderBy: { startedAt: "desc" } })
      : null;

  if (!active || active.status !== "ACTIVE") {
    return NextResponse.json({ error: "No active trip to check out of." }, { status: 404 });
  }

  const num = (k: string) => (body[k] != null && isFinite(Number(body[k])) ? Number(body[k]) : null);
  const endOdo = num("odometer");

  // Explicit columns: `reconstructPath` uses eight of them, and the row also
  // carries `raw`, the full provider payload. A long shift is thousands of
  // samples, so pulling the blob for each was the bulk of this request.
  const readings = await db.telemetryReading.findMany({
    where: { sessionId: active.id },
    orderBy: { recordedAt: "asc" },
    select: {
      id: true, recordedAt: true, lat: true, lng: true, speedKph: true,
      odometerKm: true, fuelLevelPct: true, ignitionOn: true, source: true,
    },
  });
  const path = reconstructPath(readings.map((r): ReadingLite => ({
    id: r.id, recordedAt: r.recordedAt, lat: r.lat, lng: r.lng, speedKph: r.speedKph,
    odometerKm: r.odometerKm, fuelLevelPct: r.fuelLevelPct, ignitionOn: r.ignitionOn, source: r.source,
  })));

  // Prefer the tracked path; fall back to the meter when there was no GPS.
  const odoDistance = endOdo != null && active.startOdometer != null ? Math.max(0, endOdo - active.startOdometer) : 0;
  const distanceKm = path.distanceKm > 0.05 ? path.distanceKm : odoDistance;

  const closed = await db.tripSession.update({
    where: { id: active.id },
    data: {
      status: "COMPLETED", endedAt: new Date(), endedBy: "DRIVER",
      endLat: num("lat"), endLng: num("lng"), endOdometer: endOdo,
      distanceKm, notes: body.notes ? String(body.notes) : undefined,
    },
  });

  // A completed session becomes a Trip so it appears in the operational history.
  await db.trip.create({
    data: {
      assetId: closed.assetId, driverId: closed.driverId, projectId: closed.projectId,
      startTime: closed.startedAt, endTime: closed.endedAt!,
      distanceKm, idleHours: path.idleMinutes / 60,
      gpsVerified: path.points > 1, status: "Completed",
    },
  });

  if (endOdo != null && endOdo > 0) {
    await db.meterReading.create({
      data: { assetId: closed.assetId, meterType: "ODOMETER", value: endOdo, source: "GPS", refId: closed.id, recordedBy: auth.name },
    });
    const asset = await db.asset.findUnique({ where: { id: closed.assetId } });
    if (asset && endOdo > asset.meterValue) {
      await db.asset.update({ where: { id: closed.assetId }, data: { meterValue: endOdo } });
    }
  }

  return NextResponse.json({
    ok: true,
    sessionId: closed.id,
    distanceKm: Number(distanceKm.toFixed(2)),
    source: path.points > 1 ? "GPS path" : odoDistance > 0 ? "odometer difference" : "no distance recorded",
    points: path.points,
    discardedPoints: path.discarded,
    movingMinutes: Math.round(path.movingMinutes),
    idleMinutes: Math.round(path.idleMinutes),
  });
}
