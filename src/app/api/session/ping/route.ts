import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";
import { requireSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * Position from the driver's phone. POST { lat, lng, speed?, accuracy? }
 *
 * The fallback for vehicles with no tracker: the phone in the cab reports where
 * the vehicle is. Tagged MOBILE so nobody later mistakes it for hardware
 * telemetry, and dropped entirely when the fix is too poor to be worth storing.
 */
async function handlePOST(req: Request) {
  const auth = await getSession();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  requireSameOrigin(req);

  const limit = await reserveRateLimit({
    scope: "mobile-ping",
    subject: auth.id,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return rateLimitResponse(limit.retryInSeconds, "Too many location pings. Please wait before updating.");
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const lat = Number(body.lat), lng = Number(body.lng);
  if (!isFinite(lat) || !isFinite(lng)) return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "Coordinates out of physical bounds (-90..90, -180..180)" }, { status: 400 });
  }


  // A fix worse than half a kilometre tells us nothing useful about a vehicle.
  const accuracy = body.accuracy != null ? Number(body.accuracy) : null;
  if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 500)) {
    return NextResponse.json({ ok: true, stored: false, reason: `Position accurate only to ${Math.round(accuracy)} m — not stored.` });
  }

  const account = await db.user.findUnique({ where: { id: auth.id }, include: { driverRef: true } });
  const person = account?.driverRef;
  if (!person) return NextResponse.json({ error: "Login not linked to a driver record" }, { status: 409 });

  const active = await db.tripSession.findFirst({
    where: { driverId: person.id, status: "ACTIVE" }, orderBy: { startedAt: "desc" },
  });
  if (!active) return NextResponse.json({ ok: true, stored: false, reason: "No active trip." });

  const rawSpeed = body.speed != null && isFinite(Number(body.speed)) ? Number(body.speed) : null;
  const speedKph = rawSpeed != null ? Math.max(0, Math.min(300, rawSpeed)) : null;
  await db.telemetryReading.create({
    data: {
      assetId: active.assetId, sessionId: active.id, lat, lng,
      speedKph,
      source: "MOBILE", recordedAt: new Date(),
    },
  });
  await db.asset.update({
    where: { id: active.assetId },
    data: { lat, lng, ...(speedKph != null ? { speed: speedKph } : {}), lastSeen: new Date() },
  });

  return NextResponse.json({ ok: true, stored: true, sessionId: active.id });
}

export const POST = withApiErrors(handlePOST);
