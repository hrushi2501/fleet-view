import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { checkSharedSecret } from "@/lib/auth";
import { requireApi } from "@/lib/access";
import { getTelemetryAdapter } from "@/lib/telematics-adapters";
import { normaliseReading, assetCacheUpdate, detectSchemaDrift, describeDrift, readTelemetryJson } from "@/lib/telemetry-normalization";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/fuel/telemetry
 *
 * Query live and historical fuel telemetry readings across the fleet.
 * Filter by `assetId` or limit using `?limit=50`.
 */
async function handleGET(req: Request) {
  const url = new URL(req.url);
  const authSecret = checkSharedSecret(req, "FLEET_INGEST_KEY");
  let isAuthorized = authSecret.ok;

  if (!isAuthorized) {
    const sessionAuth = await requireApi("fuel.view");
    if (sessionAuth.ok) isAuthorized = true;
  }

  if (!isAuthorized) {
    return NextResponse.json(
      { error: "Unauthorized — valid FLEET_INGEST_KEY or session required" },
      { status: 401 }
    );
  }

  const assetId = url.searchParams.get("assetId");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));

  const whereClause: Prisma.TelemetryReadingWhereInput = {};
  if (assetId) {
    whereClause.assetId = assetId;
  }

  const [readings, totalCount, activeAssets] = await Promise.all([
    db.telemetryReading.findMany({
      where: whereClause,
      orderBy: { recordedAt: "desc" },
      take: limit,
      include: {
        asset: {
          select: {
            id: true,
            code: true,
            registrationNo: true,
            name: true,
            assetClass: true,
            fuelCapacity: true,
            status: true,
          },
        },
        provider: {
          select: {
            code: true,
            name: true,
            lastSyncAt: true,
            lastSyncStatus: true,
          },
        },
      },
    }),
    db.telemetryReading.count({ where: whereClause }),
    db.asset.findMany({
      where: {
        fuelCapacity: { gt: 0 },
        decommissionedOn: null,
      },
      select: {
        id: true,
        code: true,
        registrationNo: true,
        name: true,
        fuelCapacity: true,
        meterValue: true,
        status: true,
        lastSeen: true,
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    totalCount,
    limit,
    assets: activeAssets,
    readings: readings.map((r) => ({
      id: r.id,
      assetId: r.assetId,
      assetCode: r.asset?.code,
      registrationNo: r.asset?.registrationNo,
      fuelLevelLitres: r.fuelLevelL,
      fuelLevelPct: r.fuelLevelPct,
      fuelCapacity: r.asset?.fuelCapacity,
      odometerKm: r.odometerKm,
      speedKph: r.speedKph,
      lat: r.lat,
      lng: r.lng,
      ignitionOn: r.ignitionOn,
      source: r.source,
      provider: r.provider?.name ?? r.source,
      recordedAt: r.recordedAt,
    })),
  });
}

/**
 * Universal telemetry ingestion endpoint.
 *
 * Accepts webhooks or batch pushes from any telemetry provider (LocoNav,
 * MapMyIndia, Tata Fleet Edge, Generic) via `?provider=CODE`.
 */
async function handlePOST(req: Request) {
  const auth = checkSharedSecret(req, "FLEET_INGEST_KEY");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(req.url);
    const providerCode = url.searchParams.get("provider") || "GENERIC";
    const adapter = getTelemetryAdapter(providerCode);

    const parsed = await readTelemetryJson(req);
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: parsed.status });
    const rawBody = parsed.value;
    const pings = await adapter.parsePayload(rawBody);

    if (!pings.length) {
      return NextResponse.json({ success: true, processed: 0, message: "No pings found in payload" });
    }

    let stored = 0;
    let duplicates = 0;
    let unmatched = 0;
    let rejected = 0;
    let degraded = 0;
    const problems: { device: string; issues: string[] }[] = [];
    const drift = new Set<string>();

    for (const p of pings) {
      const asset = await db.asset.findFirst({
        where: {
          decommissionedOn: null,
          OR: [
            { deviceId: p.externalDeviceId },
            { code: p.externalDeviceId },
            { registrationNo: p.externalDeviceId },
          ],
        },
        select: {
          id: true, code: true, fuelCapacity: true, meterValue: true,
          hourMeterValue: true, primaryMeter: true, telematicsProviderId: true,
        },
      });

      if (!asset) {
        unmatched++;
        continue;
      }

      const d = detectSchemaDrift(p.rawPayload);
      const summary = describeDrift(d);
      if (summary) drift.add(summary);

      const previous = await db.telemetryReading.findFirst({
        where: { assetId: asset.id, odometerKm: { not: null } },
        orderBy: { recordedAt: "desc" },
        select: { odometerKm: true, engineHours: true },
      });

      const result = normaliseReading(p, {
        fuelCapacityL: asset.fuelCapacity,
        lastOdometerKm: previous?.odometerKm ?? null,
        lastEngineHours: previous?.engineHours ?? null,
      });

      if (!result.accepted || !result.reading) {
        rejected++;
        problems.push({ device: p.externalDeviceId, issues: result.issues.map((i) => `${i.field}: ${i.reason}`) });
        continue;
      }
      if (result.degraded) {
        degraded++;
        problems.push({ device: p.externalDeviceId, issues: result.issues.map((i) => `${i.field}: ${i.reason}`) });
      }

      const r = result.reading;

      const already = await db.telemetryReading.findFirst({
        where: { assetId: asset.id, recordedAt: r.recordedAt, source: adapter.providerCode },
        select: { id: true },
      });
      if (already) {
        duplicates++;
        continue;
      }

      const session = await db.tripSession.findFirst({
        where: { assetId: asset.id, status: "ACTIVE" },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });

      await db.telemetryReading.create({
        data: {
          assetId: asset.id,
          recordedAt: r.recordedAt,
          lat: r.lat, lng: r.lng,
          speedKph: r.speedKph,
          headingDeg: r.headingDeg,
          odometerKm: r.odometerKm,
          engineHours: r.engineHours,
          fuelLevelPct: r.fuelLevelPct,
          fuelLevelL: r.fuelLevelL,
          ignitionOn: r.ignitionOn,
          source: adapter.providerCode,
          providerId: asset.telematicsProviderId,
          sessionId: session?.id ?? null,
          raw: (p.rawPayload ?? {}) as Prisma.InputJsonValue,
        },
      });

      await db.asset.update({
        where: { id: asset.id },
        data: assetCacheUpdate(r, asset),
      });

      stored++;
    }

    return NextResponse.json({
      success: true,
      provider: adapter.providerCode,
      totalPings: pings.length,
      stored,
      ...(duplicates ? { duplicates } : {}),
      ...(unmatched ? { unmatched } : {}),
      ...(rejected ? { rejected } : {}),
      ...(degraded ? { degraded } : {}),
      ...(problems.length ? { problems: problems.slice(0, 20) } : {}),
      ...(drift.size ? { schemaDrift: [...drift] } : {}),
    });
  } catch (e) {
    console.error("[API] /fuel/telemetry POST error:", e);
    return NextResponse.json({ success: false, error: "Telemetry processing failed" }, { status: 500 });
  }
}

export const GET = withApiErrors(handleGET);
export const POST = withApiErrors(handlePOST);
