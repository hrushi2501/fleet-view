import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApi, assetScope } from "@/lib/access";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";

const MAX_ROWS = 500;

/**
 * Fleet listing.
 *
 * Fields are listed explicitly rather than returning the whole row. The row
 * carries `qrToken` — the permanent secret printed on the cabin QR sticker —
 * and `deviceId`, so the old `findMany` handed every signed-in caller, drivers
 * included, the credential needed to check in to any machine in the fleet.
 */
async function handleGET(req: Request) {
  const auth = await requireApi("fleet.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = await reserveRateLimit({
    scope: "assets-query",
    subject: auth.access.session.id,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return rateLimitResponse(rateLimit.retryInSeconds, "Too many vehicle queries. Please slow down.");
  }

  const { searchParams } = new URL(req.url);
  const assetClass = searchParams.get("class") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const limit = Number(searchParams.get("limit"));
  const take = Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_ROWS) : MAX_ROWS;

  const assets = await db.asset.findMany({
    // Scoped, not just permitted. A supervisor assigned to one site holds
    // fleet.view like everyone else; what makes their access theirs is that
    // the query never reaches another site's vehicles.
    where: { assetClass, status, ...assetScope(auth.access) },
    select: {
      id: true, code: true, registrationNo: true, name: true, assetClass: true,
      category: true, ownershipType: true, make: true, model: true, yearMfg: true,
      primaryMeter: true, meterValue: true, hourMeterValue: true, fuelCapacity: true,
      status: true, healthScore: true, utilization: true, lat: true, lng: true,
      speed: true, lastSeen: true, serviceDueDate: true, lastServiceDate: true,
      hasFuelSensor: true, fuelLevelPct: true, fuelLevelAt: true,
      project: { select: { code: true } },
      driver: { select: { name: true } },
    },
    orderBy: { code: "asc" },
    take,
  });
  return NextResponse.json({ count: assets.length, data: assets, limit: take });
}

export const GET = withApiErrors(handleGET);
