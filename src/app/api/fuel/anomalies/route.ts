import { fuelAnomalyScope, recordScope } from "@/lib/record-access";
import { finiteNumber, oneOf } from "@/lib/input-validation";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";
import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApi } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * GET /api/fuel/anomalies
 *
 * Query open or resolved fuel anomalies across the fleet.
 */
async function handleGET(req: Request) {
  const auth = await requireApi("fuel.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "OPEN";
    const scope = await fuelAnomalyScope(auth.access);

    const [anomalies, assets, tanks] = await Promise.all([
      db.fuelAnomaly.findMany({
        where: { ...scope, ...(status === "ALL" ? {} : { status }) },
        orderBy: [{ score: "desc" }, { detectedAt: "desc" }],
      }),
      db.asset.findMany({
        where: recordScope("asset", auth.access),
        select: {
          id: true,
          code: true,
          registrationNo: true,
          name: true,
          assetClass: true,
        },
      }),
      db.fuelTank.findMany({
        where: recordScope("fuelTank", auth.access),
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
    throw err;
  }
}

/**
 * PATCH /api/fuel/anomalies
 *
 * Update anomaly status (INVESTIGATING, RESOLVED, DISMISSED) and resolution notes.
 */
async function handlePATCH(req: Request) {
  const auth = await requireApi("fuel.approve");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const { id, status, resolution, recovered } = body;

    if (!id || !status) {
      return NextResponse.json({ error: "Anomaly id and status required" }, { status: 400 });
    }

    const limit = await reserveRateLimit({ scope: "anomaly-update", subject: auth.access.session.id, limit: 60, windowMs: 60_000 });
    if (!limit.ok) return rateLimitResponse(limit.retryInSeconds);
    const existing = await db.fuelAnomaly.findFirst({ where: { id, ...await fuelAnomalyScope(auth.access) } });
    if (!existing) return NextResponse.json({ error: "Anomaly not found" }, { status: 404 });
    oneOf(status, ["OPEN", "INVESTIGATING", "RECOVERED", "FALSE_POSITIVE", "CLOSED", "RESOLVED", "DISMISSED"], "anomaly status");
    const recoveredAmount = finiteNumber(recovered, "Recovered amount", { min: 0, fallback: 0 });
    const updated = await db.fuelAnomaly.update({
      where: { id },
      data: {
        status,
        resolution: resolution || null,
        recovered: recoveredAmount,
        resolvedAt: status === "OPEN" || status === "INVESTIGATING" ? null : new Date(),
      },
    });

    return NextResponse.json({ ok: true, anomaly: updated });
  } catch (err) {
    console.error("[API] /api/fuel/anomalies PATCH error:", err);
    throw err;
  }
}

export const GET = withApiErrors(handleGET);
export const PATCH = withApiErrors(handlePATCH);
