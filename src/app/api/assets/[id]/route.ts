import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApi, canSeeAsset } from "@/lib/access";
import { analyseUsage, describeUsage } from "@/lib/fleet-analytics";

export const dynamic = "force-dynamic";

/** Fields a device or relay may have posted alongside its reading. Rows written
 *  before the ingest route stopped persisting the shared key still hold it, and
 *  this response is readable by every signed-in user. */
const RAW_SECRET_FIELDS = new Set(["key", "token", "secret", "password", "apikey", "api_key", "authorization"]);

function redactRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw ?? null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (RAW_SECRET_FIELDS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Previously this asked only whether a session existed. Any signed-in
  // account — a driver included — could read any vehicle by id: its position,
  // driver, costs, documents and full telemetry payload.
  const auth = await requireApi("fleet.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  // 404 rather than 403 when the vehicle exists but is not theirs. Confirming
  // that a record exists is itself a disclosure — it tells a scoped supervisor
  // exactly how to enumerate the rest of the fleet.
  if (!(await canSeeAsset(auth.access, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const asset = await db.asset.findUnique({
    where: { id },
    include: {
      project: { select: { code: true, name: true, location: true } },
      driver: { select: { name: true } },
      compliance: { orderBy: { expiryDate: "asc" } },
      workOrders: { orderBy: { reportedAt: "desc" }, take: 5 },
      fuelTxns: { where: { type: "ISSUE" }, orderBy: { date: "desc" }, take: 5 },
      costs: true,
    },
  });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Two queries rather than one join: the usage maths needs 200 samples but only
  // the typed columns, while `raw` — the whole provider payload, the largest
  // column in the schema — is shown for the newest sample alone. Fetching 200
  // raw blobs to display one was the single heaviest read in the app.
  const [history, latest] = await Promise.all([
    db.telemetryReading.findMany({
      where: { assetId: asset.id },
      orderBy: { recordedAt: "desc" },
      take: 200,
      select: {
        recordedAt: true, lat: true, lng: true, speedKph: true, odometerKm: true,
        fuelLevelL: true, fuelLevelPct: true, ignitionOn: true,
      },
    }),
    db.telemetryReading.findFirst({
      where: { assetId: asset.id },
      orderBy: { recordedAt: "desc" },
      select: {
        recordedAt: true, source: true, speedKph: true, headingDeg: true,
        odometerKm: true, engineHours: true, fuelLevelPct: true, fuelLevelL: true,
        ignitionOn: true, raw: true,
        provider: { select: { name: true, lastSyncAt: true, lastSyncStatus: true } },
      },
    }),
  ]);

  // Derived usage: distance, burn, efficiency and unexplained loss, measured
  // between consecutive samples rather than read off any single one.
  const norm =
    (await db.consumptionNorm.findFirst({ where: { assetId: asset.id, unit: "KMPL" } })) ??
    (await db.consumptionNorm.findFirst({ where: { assetClass: asset.assetClass, unit: "KMPL" } }));
  const idleNorm = await db.consumptionNorm.findFirst({
    where: { assetClass: asset.assetClass, unit: "LPH" },
  });

  const { segments, usage } = analyseUsage(
    history.map((t) => ({
      recordedAt: t.recordedAt,
      lat: t.lat, lng: t.lng, speedKph: t.speedKph,
      odometerKm: t.odometerKm, fuelLevelL: t.fuelLevelL,
      fuelLevelPct: t.fuelLevelPct, ignitionOn: t.ignitionOn,
    })),
    norm,
    asset.fuelCapacity || null,
    idleNorm?.normHigh ?? null,
  );

  if (process.env.FUEL_ANALYSIS_DEBUG === "true") {
    console.info(describeUsage(`${asset.code} (${asset.registrationNo ?? "no reg"})`, usage));
  }

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
    // Sensor-detected fills, so the UI can show that a tank rise was recognised
    // as a fill rather than quietly cancelling out against consumption.
    refuels: usage.diagnostics.fuel.refuels.map((r) => ({
      at: r.at, fromL: r.fromL, toL: r.toL, litresAdded: r.litresAdded,
      lat: r.lat, lng: r.lng, confidence: r.confidence, hoursObserved: r.hoursObserved,
    })),
    segments: segments
      .slice(-12)
      .reverse()
      .map((s) => ({
        from: s.from, to: s.to, hours: s.hours,
        distanceKm: s.distanceKm, fuelDeltaL: s.fuelDeltaL, litresConsumed: s.litresConsumed,
        // The tank at both ends, and where it sat if it did not move. A delta on
        // its own cannot be checked against a dipstick, and a loss with no place
        // attached is not something anyone can be sent to look at.
        fuelBeforeL: s.fuelBeforeL, fuelAfterL: s.fuelAfterL, parkedAt: s.parkedAt,
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
      raw: redactRaw(latest.raw),
    },
  });
}
