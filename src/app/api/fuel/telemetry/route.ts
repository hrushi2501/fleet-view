import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { checkSharedSecret } from "@/lib/auth";
import { getTelemetryAdapter } from "@/lib/telematics-adapters";
import { normaliseReading, assetCacheUpdate, detectSchemaDrift, describeDrift } from "@/lib/telemetry-normalization";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Universal telemetry ingestion endpoint.
 *
 * Accepts webhooks or batch pushes from any telemetry provider (LocoNav,
 * MapMyIndia, Tata Fleet Edge, Generic) via `?provider=CODE`.
 *
 * Every sample is validated by `telemetry-normalization` before it is stored,
 * so this route and the Fleet Edge cron sync cannot disagree about what a valid
 * reading is. What this route used to do instead, and no longer does:
 *
 *   - stored `fuelLevelPct` but silently discarded `fuelLevelL`, leaving every
 *     fuel calculation for a webhook-fed vehicle with no data behind it;
 *   - inserted unconditionally, so a provider retry (or a 429 retry) wrote the
 *     same sample twice and double-counted its distance and fuel;
 *   - copied the odometer onto the asset with no monotonic guard, so one bad
 *     sample could wind a meter backwards permanently;
 *   - dropped an entire reading when speed looked wrong, throwing away the
 *     perfectly good fuel and odometer values alongside it;
 *   - kept no raw payload, so nothing could be re-derived or audited.
 *
 * Authenticated with the shared ingest key (`Authorization: Bearer …`,
 * `x-fleet-key`, or `?key=`) against FLEET_INGEST_KEY. This route accepted
 * anonymous writes before: anyone who knew the URL could invent positions, fuel
 * levels and odometer readings for any vehicle in the fleet, which is the input
 * to every fuel-loss and utilisation figure the client acts on.
 */
export async function POST(req: Request) {
  const auth = checkSharedSecret(req, "FLEET_INGEST_KEY");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(req.url);
    const providerCode = url.searchParams.get("provider") || "GENERIC";
    const adapter = getTelemetryAdapter(providerCode);

    const rawBody = await req.json();
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

      // A provider that changes its payload shape must not do so silently — a
      // field that quietly disappears empties a calculation rather than
      // breaking it, which is the harder failure to notice.
      const d = detectSchemaDrift(p.rawPayload);
      const summary = describeDrift(d);
      if (summary) drift.add(summary);

      // The last good meter reading, so a backwards odometer can be recognised
      // rather than absorbed.
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

      // Identity is (asset, instant, source). A webhook redelivery describes the
      // same moment however many times it arrives.
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
          // The field this route used to drop. Without it there is no fuel
          // analysis at all for anything fed through here.
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
    // The message can carry the Prisma query, table names or the connection
    // target; that belongs in the server log, not in a response to a device.
    console.error("[API] /fuel/telemetry POST error:", e);
    return NextResponse.json({ success: false, error: "Telemetry processing failed" }, { status: 500 });
  }
}
