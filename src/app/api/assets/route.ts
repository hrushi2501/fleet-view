import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

const MAX_ROWS = 500;

/**
 * Fleet listing.
 *
 * Fields are listed explicitly rather than returning the whole row. The row
 * carries `qrToken` — the permanent secret printed on the cabin QR sticker —
 * and `deviceId`, so the old `findMany` handed every signed-in caller, drivers
 * included, the credential needed to check in to any machine in the fleet.
 */
export async function GET(req: Request) {
  const auth = await requirePermission("fleet.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const assetClass = searchParams.get("class") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const limit = Number(searchParams.get("limit"));
  const take = Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_ROWS) : MAX_ROWS;

  const assets = await db.asset.findMany({
    where: { assetClass, status },
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
