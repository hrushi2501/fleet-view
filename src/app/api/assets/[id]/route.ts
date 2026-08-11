import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { analyseReadings, summarise } from "@/lib/fleet-analytics";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const asset = await db.asset.findUnique({
    where: { id },
    include: {
      project: { select: { code: true, name: true, location: true } },
      driver: { select: { name: true } },
      compliance: { orderBy: { expiryDate: "asc" } },
      workOrders: { orderBy: { reportedAt: "desc" }, take: 5 },
      fuelTxns: { where: { type: "ISSUE" }, orderBy: { date: "desc" }, take: 5 },
      costs: true,
      // Latest sample from the OEM feed, carried whole so the UI can show every
      // field the vehicle reports rather than the handful with typed columns.
      telemetry: {
        orderBy: { recordedAt: "desc" },
        take: 200,
        include: { provider: { select: { name: true, lastSyncAt: true, lastSyncStatus: true } } },
      },
    },
  });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const latest = asset.telemetry[0] ?? null;

  // Derived usage: distance, burn, efficiency and unexplained loss, measured
  // between consecutive samples rather than read off any single one.
  const norm =
    (await db.consumptionNorm.findFirst({ where: { assetId: asset.id, unit: "KMPL" } })) ??
    (await db.consumptionNorm.findFirst({ where: { assetClass: asset.assetClass, unit: "KMPL" } }));
  const idleNorm = await db.consumptionNorm.findFirst({
    where: { assetClass: asset.assetClass, unit: "LPH" },
  });

  const segments = analyseReadings(
    asset.telemetry.map((t) => ({
      recordedAt: t.recordedAt,
      lat: t.lat, lng: t.lng, speedKph: t.speedKph,
      odometerKm: t.odometerKm, fuelLevelL: t.fuelLevelL,
      fuelLevelPct: t.fuelLevelPct, ignitionOn: t.ignitionOn,
    })),
    norm,
    asset.fuelCapacity || null,
    idleNorm?.normHigh ?? null,
  );
  const usage = summarise(segments);

  const costByHead: Record<string, number> = {};
  for (const c of asset.costs) costByHead[c.costHead] = (costByHead[c.costHead] || 0) + c.amount;
  const totalCost = Object.values(costByHead).reduce((s, v) => s + v, 0);

  return NextResponse.json({
    id: asset.id, code: asset.code, name: asset.name, registrationNo: asset.registrationNo,
    assetClass: asset.assetClass, category: asset.category, ownershipType: asset.ownershipType,
    make: asset.make, model: asset.model, yearMfg: asset.yearMfg, primaryMeter: asset.primaryMeter,
    meterValue: asset.meterValue, fuelCapacity: asset.fuelCapacity, status: asset.status,
    healthScore: asset.healthScore, utilization: asset.utilization, acquisitionCost: asset.acquisitionCost,
    lat: asset.lat, lng: asset.lng, lastSeen: asset.lastSeen,
    project: asset.project, driver: asset.driver,
    compliance: asset.compliance.map((c) => ({ docType: c.docType, number: c.number, expiryDate: c.expiryDate, status: c.status })),
    workOrders: asset.workOrders.map((w) => ({ woNo: w.woNo, type: w.type, description: w.description, totalCost: w.totalCost, status: w.status })),
    fuel: asset.fuelTxns.map((f) => ({ date: f.date, quantity: f.quantity, sensorRise: f.sensorRise, variancePct: f.variancePct, anomaly: f.anomaly })),
    costByHead, totalCost,
    usage: { ...usage, norm: norm ? { low: norm.normLow, high: norm.normHigh, unit: norm.unit } : null },
    segments: segments
      .slice(-12)
      .reverse()
      .map((s) => ({
        from: s.from, to: s.to, hours: s.hours,
        distanceKm: s.distanceKm, litresConsumed: s.litresConsumed,
        kmPerL: s.kmPerL, event: s.event, excessLitres: s.excessLitres,
        confidence: s.confidence, reasons: s.reasons,
      })),
    telemetry: latest && {
      recordedAt: latest.recordedAt,
      source: latest.source,
      provider: latest.provider?.name ?? null,
      lastSyncAt: latest.provider?.lastSyncAt ?? null,
      lastSyncStatus: latest.provider?.lastSyncStatus ?? null,
      speedKph: latest.speedKph,
      headingDeg: latest.headingDeg,
      odometerKm: latest.odometerKm,
      engineHours: latest.engineHours,
      fuelLevelPct: latest.fuelLevelPct,
      fuelLevelL: latest.fuelLevelL,
      ignitionOn: latest.ignitionOn,
      raw: latest.raw ?? null,
    },
  });
}
