import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApi } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * GET /api/fuel/anomalies
 *
 * Query open or resolved fuel anomalies across the fleet.
 */
export async function GET(req: Request) {
  const auth = await requireApi("fuel.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "OPEN";

    const [anomalies, assets, tanks] = await Promise.all([
      db.fuelAnomaly.findMany({
        where: status === "ALL" ? {} : { status },
        orderBy: [{ score: "desc" }, { detectedAt: "desc" }],
      }),
      db.asset.findMany({
        select: {
          id: true,
          code: true,
          registrationNo: true,
          name: true,
          assetClass: true,
        },
      }),
      db.fuelTank.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          location: true,
        },
      }),
    ]);

    const assetMap = new Map(assets.map((a) => [a.id, a]));
    const tankMap = new Map(tanks.map((t) => [t.id, t]));

    const totals = {
      count: anomalies.length,
      totalLitres: anomalies.reduce((s, a) => s + a.litres, 0),
      totalValueAtRisk: anomalies.reduce((s, a) => s + a.valueAtRisk, 0),
      highSeverityCount: anomalies.filter((a) => a.severity === "HIGH").length,
    };

    return NextResponse.json({
      ok: true,
      totals,
      anomalies: anomalies.map((a) => ({
        ...a,
        asset: a.assetId ? assetMap.get(a.assetId) ?? null : null,
        tank: a.tankId ? tankMap.get(a.tankId) ?? null : null,
      })),
    });
  } catch (err) {
    console.error("[API] /api/fuel/anomalies GET error:", err);
    return NextResponse.json({ error: "Failed to fetch anomalies" }, { status: 500 });
  }
}

/**
 * PATCH /api/fuel/anomalies
 *
 * Update anomaly status (INVESTIGATING, RESOLVED, DISMISSED) and resolution notes.
 */
export async function PATCH(req: Request) {
  const auth = await requireApi("fuel.approve");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const { id, status, resolution, recovered } = body;

    if (!id || !status) {
      return NextResponse.json({ error: "Anomaly id and status required" }, { status: 400 });
    }

    const updated = await db.fuelAnomaly.update({
      where: { id },
      data: {
        status,
        resolution: resolution || null,
        recovered: recovered ? Number(recovered) : 0,
        resolvedAt: status === "OPEN" || status === "INVESTIGATING" ? null : new Date(),
      },
    });

    return NextResponse.json({ ok: true, anomaly: updated });
  } catch (err) {
    console.error("[API] /api/fuel/anomalies PATCH error:", err);
    return NextResponse.json({ error: "Failed to update anomaly" }, { status: 500 });
  }
}
