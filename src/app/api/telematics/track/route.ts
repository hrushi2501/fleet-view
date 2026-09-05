import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApi, canSeeAsset } from "@/lib/access";
import { startOfBusinessDay, parseBusinessDay } from "@/lib/business-time";
import { haversineKm } from "@/lib/fleet-analytics";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";

/** Hard ceiling on points returned, so one request cannot pull a month of history. */
const MAX_POINTS = 4000;

/**
 * A vehicle's track over a window — what Play Back scrubs through.
 *
 * Returns the samples themselves rather than a smoothed line. Fleet Edge polls
 * on an interval, so the honest picture is a chain of observed points with the
 * gaps left visible; interpolating them would draw a road the truck may never
 * have taken and would hide exactly the outages that make a day's fuel figure
 * unreliable.
 *
 * GET /api/telematics/track?assetId=…&date=YYYY-MM-DD
 *   date defaults to today in the business timezone.
 */
async function handleGET(req: Request) {
  const auth = await requireApi("fleet.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limit = await reserveRateLimit({
    scope: "telematics-track",
    subject: auth.access.session.id,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return rateLimitResponse(limit.retryInSeconds, "Too many track playback requests. Please wait.");
  }


  const url = new URL(req.url);
  const assetId = url.searchParams.get("assetId");
  if (!assetId) return NextResponse.json({ error: "assetId required" }, { status: 400 });

  // Scope is enforced per asset here rather than by a `where` clause: this route
  // is addressed by id, and an unscoped lookup would happily return a vehicle
  // from a site the caller cannot see.
  if (!(await canSeeAsset(auth.access, assetId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const dateParam = url.searchParams.get("date");
  const from = dateParam ? startOfBusinessDay(parseBusinessDay(dateParam)) : startOfBusinessDay(new Date());
  const to = new Date(from.getTime() + 86_400_000);

  const rows = await db.telemetryReading.findMany({
    where: { assetId, recordedAt: { gte: from, lt: to } },
    orderBy: { recordedAt: "asc" },
    take: MAX_POINTS,
    select: {
      recordedAt: true, lat: true, lng: true, speedKph: true, headingDeg: true,
      odometerKm: true, fuelLevelL: true, fuelLevelPct: true, ignitionOn: true,
    },
  });

  // Points without a fix are dropped from the track but still counted, so the
  // UI can say "42 of 61 samples had a position" instead of implying the
  // vehicle teleported between the ones that did.
  const points = rows
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => ({
      at: r.recordedAt.toISOString(),
      lat: r.lat as number,
      lng: r.lng as number,
      speedKph: r.speedKph,
      headingDeg: r.headingDeg,
      odometerKm: r.odometerKm,
      fuelLevelL: r.fuelLevelL,
      fuelLevelPct: r.fuelLevelPct,
      ignitionOn: r.ignitionOn,
    }));

  // Straight-line distance along the observed points. It is a floor on the road
  // distance, never a rival to the odometer — named `gpsKm` for that reason.
  let gpsKm = 0;
  for (let i = 1; i < points.length; i++) {
    gpsKm += haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }

  // The widest silence in the window. This is the number that decides whether a
  // playback is a journey or a rumour.
  let worstGapMinutes = 0;
  for (let i = 1; i < rows.length; i++) {
    const gap = (rows[i].recordedAt.getTime() - rows[i - 1].recordedAt.getTime()) / 60_000;
    if (gap > worstGapMinutes) worstGapMinutes = gap;
  }

  return NextResponse.json(
    {
      assetId,
      from: from.toISOString(),
      to: to.toISOString(),
      sampleCount: rows.length,
      positionedCount: points.length,
      truncated: rows.length === MAX_POINTS,
      gpsKm: Math.round(gpsKm * 100) / 100,
      worstGapMinutes: Math.round(worstGapMinutes),
      points,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export const GET = withApiErrors(handleGET);
