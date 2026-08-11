import { NextResponse } from "next/server";
import { getTelemetryAdapter } from "@/lib/telematics-adapters";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Universal Telemetry Ingestion Endpoint
 * Accepts webhooks or batch pushes from any telemetry provider (LocoNav, MapMyIndia, Tata Fleet Edge, Generic)
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const providerCode = url.searchParams.get("provider") || "GENERIC";
    const adapter = getTelemetryAdapter(providerCode);

    const rawBody = await req.json();
    const pings = await adapter.parsePayload(rawBody);

    if (!pings.length) {
      return NextResponse.json({ success: true, processed: 0, message: "No pings found in payload" });
    }

    let insertedCount = 0;

    for (const p of pings) {
      // Find asset by provider deviceId or registration number
      const asset = await db.asset.findFirst({
        where: {
          OR: [
            { deviceId: p.externalDeviceId },
            { code: p.externalDeviceId },
            { registrationNo: p.externalDeviceId },
          ],
        },
      });

      if (!asset) continue;

      // Filter GPS noise / jumps
      if (p.speedKph != null && p.speedKph > 150) continue;

      await db.telemetryReading.create({
        data: {
          assetId: asset.id,
          recordedAt: p.timestamp,
          lat: p.latitude,
          lng: p.longitude,
          speedKph: p.speedKph,
          odometerKm: p.odometerKm,
          fuelLevelPct: p.fuelLevelPct,
          ignitionOn: p.ignitionState,
          source: adapter.providerCode,
        },
      });

      // Update asset real-time digital twin fields
      await db.asset.update({
        where: { id: asset.id },
        data: {
          ...(p.latitude != null && p.longitude != null ? { lat: p.latitude, lng: p.longitude } : {}),
          ...(p.speedKph != null ? { speed: p.speedKph } : {}),
          ...(p.odometerKm != null ? { meterValue: p.odometerKm } : {}),
          ...(p.fuelLevelPct != null ? { fuelLevelPct: p.fuelLevelPct, fuelLevelAt: p.timestamp } : {}),
          lastSeen: p.timestamp,
        },
      });

      insertedCount++;
    }

    return NextResponse.json({
      success: true,
      provider: adapter.providerCode,
      processed: insertedCount,
      totalPings: pings.length,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Telemetry processing failed" },
      { status: 500 }
    );
  }
}
