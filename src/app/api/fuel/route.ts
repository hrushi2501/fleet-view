import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireApi, assetScope, projectIdScope } from "@/lib/access";
import { fleetUsage } from "@/lib/fleet-usage";
import { getDieselRate } from "@/lib/settings";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";
import { requireSameOrigin, isPrivateFileReference } from "@/lib/request-security";

export const dynamic = "force-dynamic";

type ScopedFuelIds = { assetIds: string[]; tankIds: string[]; projectIds: string[] | null };

/**
 * Fuel anomalies keep scalar asset/tank ids rather than Prisma relations, so
 * derive the visible ids once and use them for every corresponding query.
 */
async function scopedFuelIds(access: Parameters<typeof assetScope>[0]): Promise<ScopedFuelIds | null> {
  if (access.group === "ADMIN") return null;
  const [assets, tanks] = await db.$transaction([
    db.asset.findMany({ where: assetScope(access), select: { id: true } }),
    db.fuelTank.findMany({ where: projectIdScope(access), select: { id: true } }),
  ]);
  return { assetIds: assets.map((asset) => asset.id), tankIds: tanks.map((tank) => tank.id), projectIds: access.projectIds };
}

function scopedFuelRows(scope: ScopedFuelIds | null): Prisma.FuelTransactionWhereInput | Prisma.FuelAnomalyWhereInput {
  if (!scope) return {};
  const branches: Array<Record<string, unknown>> = [
    { assetId: { in: scope.assetIds } },
    { tankId: { in: scope.tankIds } },
  ];
  if (scope.projectIds !== null) branches.push({ projectId: { in: scope.projectIds } });
  return { OR: branches };
}

class FuelInputError extends Error {}

/**
 * GET /api/fuel
 *
 * Comprehensive fleet fuel data endpoint:
 * - Fleet-wide consumption & efficiency metrics derived from live telemetry.
 * - Per-vehicle fuel levels, capacity, and current burn rate.
 * - Open fuel anomalies & value at risk.
 * - Recent fuel transactions & tank balances.
 */
async function handleGET(req: Request) {
  const auth = await requireApi("fuel.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(req.url);
    const sinceDays = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
    const ids = await scopedFuelIds(auth.access);
    const usage = await fleetUsage(sinceDays, assetScope(auth.access) as Prisma.AssetWhereInput);
    const [anomalies, tanks, recentTxns, dieselRate] = await db.$transaction([
      db.fuelAnomaly.findMany({
        where: { AND: [{ status: "OPEN" }, scopedFuelRows(ids) as Prisma.FuelAnomalyWhereInput] },
        orderBy: { detectedAt: "desc" },
        take: 50,
      }),
      db.fuelTank.findMany({
        where: projectIdScope(auth.access),
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
        where: scopedFuelRows(ids) as Prisma.FuelTransactionWhereInput,
        orderBy: { date: "desc" },
        take: 20,
        include: {
          asset: { select: { id: true, code: true, registrationNo: true, name: true } },
        },
      }),
      db.setting.findUnique({ where: { key: "dieselRate" } }),
    ]);
    const effectiveDieselRate = Number(dieselRate?.value) > 0 ? Number(dieselRate?.value) : await getDieselRate();

    return NextResponse.json({
      ok: true,
      dieselRate: effectiveDieselRate,
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
    throw err;
  }
}

/**
 * POST /api/fuel
 *
 * Records a fuel issue or receipt transaction.
 */
async function handlePOST(req: Request) {
  const auth = await requireApi("fuel.issue");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  requireSameOrigin(req);

  const limit = await reserveRateLimit({ scope: "fuel-api-mutation", subject: auth.access.session.id, limit: 30, windowMs: 60_000 });
  if (!limit.ok) return rateLimitResponse(limit.retryInSeconds, "Too many fuel entries. Please wait before trying again.");

  try {
    const body = await req.json() as Record<string, unknown>;
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
    if (!Number.isFinite(qty) || qty <= 0 || qty > 50_000) {
      return NextResponse.json({ error: "Valid fuel quantity required" }, { status: 400 });
    }
    if (type !== "ISSUE" && type !== "RECEIPT") {
      return NextResponse.json({ error: "Fuel type must be ISSUE or RECEIPT" }, { status: 400 });
    }

    const asset = assetId
      ? await db.asset.findFirst({ where: { id: String(assetId), ...assetScope(auth.access) }, select: { id: true, projectId: true, meterValue: true } })
      : null;
    if (assetId && !asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

    const tank = tankId
      ? await db.fuelTank.findFirst({ where: { id: String(tankId), ...projectIdScope(auth.access) }, select: { id: true, projectId: true, capacity: true } })
      : null;
    if (tankId && !tank) return NextResponse.json({ error: "Tank not found" }, { status: 404 });
    if (!asset && !tank) return NextResponse.json({ error: "An asset or tank is required" }, { status: 400 });

    const parsedDate = new Date(String(date));
    if (Number.isNaN(parsedDate.getTime())) return NextResponse.json({ error: "Valid transaction date required" }, { status: 400 });
    const parsedMeter = meterValue == null || meterValue === "" ? null : Number(meterValue);
    if (parsedMeter != null && (!Number.isFinite(parsedMeter) || parsedMeter < 0)) {
      return NextResponse.json({ error: "Valid meter value required" }, { status: 400 });
    }
    if (asset && parsedMeter != null && parsedMeter < asset.meterValue) {
      return NextResponse.json({ error: "Meter value cannot be lower than the vehicle's current reading." }, { status: 400 });
    }
    for (const photo of [odometerPhoto, pumpPhoto]) {
      if (photo != null && photo !== "" && !isPrivateFileReference(photo)) {
        return NextResponse.json({ error: "Evidence photos must be uploaded through FleetView." }, { status: 400 });
      }
    }

    const defaultRate = await getDieselRate();
    const effectiveRate = Number(rate) > 0 ? Number(rate) : defaultRate;
    if (!Number.isFinite(effectiveRate) || effectiveRate > 10_000) {
      return NextResponse.json({ error: "Valid fuel rate required" }, { status: 400 });
    }
    const amount = qty * effectiveRate;
    if (!Number.isSafeInteger(Math.round(amount * 100)) || amount > 500_000_000) {
      return NextResponse.json({ error: "Fuel amount exceeds the permitted transaction limit." }, { status: 400 });
    }

    const txn = await db.$transaction(async (tx) => {
      const created = await tx.fuelTransaction.create({
        data: {
          type,
          assetId: asset?.id ?? null,
          projectId: asset?.projectId ?? tank?.projectId ?? null,
          tankId: tank?.id ?? null,
          quantity: qty,
          rate: effectiveRate,
          amount,
          meterValue: parsedMeter ?? undefined,
          odometerPhoto: isPrivateFileReference(odometerPhoto) ? odometerPhoto : null,
          pumpPhoto: isPrivateFileReference(pumpPhoto) ? pumpPhoto : null,
          date: parsedDate,
        },
      });

      if (tank) {
        if (type === "ISSUE") {
          const debited = await tx.fuelTank.updateMany({
            where: { id: tank.id, currentLevel: { gte: qty } },
            data: { currentLevel: { decrement: qty } },
          });
          if (debited.count !== 1) throw new FuelInputError("The selected tank does not have enough fuel available.");
        } else if (type === "RECEIPT") {
          const credited = await tx.fuelTank.updateMany({
            where: { id: tank.id, currentLevel: { lte: tank.capacity - qty } },
            data: { currentLevel: { increment: qty } },
          });
          if (credited.count !== 1) throw new FuelInputError("The receipt would exceed the selected tank's capacity.");
        }
      }

      if (asset && parsedMeter != null) {
        const updated = await tx.asset.updateMany({ where: { id: asset.id, meterValue: { lte: parsedMeter } }, data: { meterValue: parsedMeter } });
        if (updated.count !== 1) throw new FuelInputError("Meter value cannot be lower than the vehicle's current reading.");
      }

      return created;
    });

    return NextResponse.json({ ok: true, transaction: txn });
  } catch (err) {
    if (err instanceof FuelInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[API] /api/fuel POST error:", err);
    throw err;
  }
}

export const GET = withApiErrors(handleGET);
export const POST = withApiErrors(handlePOST);
