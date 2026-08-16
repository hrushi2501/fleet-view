import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApi } from "@/lib/access";
import { fleetUsage } from "@/lib/fleet-usage";
import { getDieselRate } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/fuel
 *
 * Comprehensive fleet fuel data endpoint:
 * - Fleet-wide consumption & efficiency metrics derived from live telemetry.
 * - Per-vehicle fuel levels, capacity, and current burn rate.
 * - Open fuel anomalies & value at risk.
 * - Recent fuel transactions & tank balances.
 */
export async function GET(req: Request) {
  const auth = await requireApi("fuel.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(req.url);
    const sinceDays = Math.max(1, Number(url.searchParams.get("days")) || 30);

    const [usage, anomalies, tanks, recentTxns, dieselRate] = await Promise.all([
      fleetUsage(sinceDays),
      db.fuelAnomaly.findMany({
        where: { status: "OPEN" },
        orderBy: { detectedAt: "desc" },
        take: 50,
      }),
      db.fuelTank.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          location: true,
          capacity: true,
          currentLevel: true,
          minLevel: true,
          status: true,
        },
      }),
      db.fuelTransaction.findMany({
        orderBy: { date: "desc" },
        take: 20,
        include: {
          asset: { select: { id: true, code: true, registrationNo: true, name: true } },
        },
      }),
      getDieselRate(),
    ]);

    return NextResponse.json({
      ok: true,
      dieselRate,
      totals: usage.totals,
      vehicles: usage.perAsset.map((a) => ({
        assetId: a.assetId,
        code: a.code,
        registrationNo: a.registrationNo,
        name: a.name,
        assetClass: a.assetClass,
        fuelLevelPct: a.fuelLevelPct,
        lastSeen: a.lastSeen,
        avgKmPerL: a.usage.avgKmPerL,
        distanceKm: a.usage.distanceKm,
        litresBurned: a.usage.litresBurned,
        litresUnaccounted: a.usage.litresUnaccounted,
        belowNorm: a.belowNorm,
        confidence: a.usage.confidence,
      })),
      tanks,
      openAnomalies: anomalies.map((a) => ({
        id: a.id,
        source: a.source,
        assetId: a.assetId,
        tankId: a.tankId,
        severity: a.severity,
        score: a.score,
        litres: a.litres,
        valueAtRisk: a.valueAtRisk,
        reasons: a.reasons,
        status: a.status,
        detectedAt: a.detectedAt,
      })),
      recentTransactions: recentTxns,
    });
  } catch (err) {
    console.error("[API] /api/fuel GET error:", err);
    return NextResponse.json({ error: "Failed to fetch fuel metrics" }, { status: 500 });
  }
}

/**
 * POST /api/fuel
 *
 * Records a fuel issue or receipt transaction.
 */
export async function POST(req: Request) {
  const auth = await requireApi("fuel.issue");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const {
      type = "ISSUE",
      assetId,
      tankId,
      quantity,
      rate,
      meterValue,
      odometerPhoto,
      pumpPhoto,
      date = new Date(),
    } = body;

    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      return NextResponse.json({ error: "Valid fuel quantity required" }, { status: 400 });
    }

    const defaultRate = await getDieselRate();
    const effectiveRate = Number(rate) > 0 ? Number(rate) : defaultRate;
    const amount = qty * effectiveRate;

    const txn = await db.$transaction(async (tx) => {
      const created = await tx.fuelTransaction.create({
        data: {
          type,
          assetId: assetId || null,
          tankId: tankId || null,
          quantity: qty,
          rate: effectiveRate,
          amount,
          meterValue: meterValue ? Number(meterValue) : undefined,
          odometerPhoto: odometerPhoto || null,
          pumpPhoto: pumpPhoto || null,
          date: new Date(date),
        },
      });

      if (tankId) {
        if (type === "ISSUE") {
          await tx.fuelTank.update({
            where: { id: tankId },
            data: { currentLevel: { decrement: qty } },
          });
        } else if (type === "RECEIPT") {
          await tx.fuelTank.update({
            where: { id: tankId },
            data: { currentLevel: { increment: qty } },
          });
        }
      }

      if (assetId && meterValue != null && !isNaN(Number(meterValue))) {
        await tx.asset.update({
          where: { id: assetId },
          data: { meterValue: Number(meterValue) },
        });
      }

      return created;
    });

    return NextResponse.json({ ok: true, transaction: txn });
  } catch (err) {
    console.error("[API] /api/fuel POST error:", err);
    return NextResponse.json({ error: "Failed to record fuel transaction" }, { status: 500 });
  }
}
