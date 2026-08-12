import { db } from "@/lib/db";
import { TelemetryReading } from "./telemetry-ingestion";
import { nextCaseNo } from "./loss-prevention";
import { DEFAULT_FUEL_CONFIG, fuelThresholds } from "./fleet-analytics";
import { startOfBusinessDay } from "./business-time";

/**
 * Opens a loss-prevention case against a named vehicle, so the bar for firing
 * is deliberately high.
 *
 * The rules below mirror `fleet-analytics.ts` rather than inventing a second,
 * looser standard. The original version fired on any 10 L fall between two
 * samples with no noise band and no rate check — on a 300 L tank whose sender
 * swings several litres while idling, that manufactures theft cases. It also
 * treated a *missing* speed or ignition reading as "stationary with the engine
 * off", which is the exact condition that makes a fuel drop look inexplicable.
 * Unknown is now unknown, and unknown is never evidence.
 */
export class AiFraudDetectionService {
  /**
   * Processes a stream of telemetry and flags anomalies.
   *
   * A case is only raised when every one of these holds:
   *   - both tank levels are actually known;
   *   - the fall clears the sender's noise band for that tank;
   *   - the implied burn rate is physically possible (otherwise it is a sensor
   *     fault, not a siphon);
   *   - the vehicle is *known* to have been stationary with the engine off.
   */
  async processTelemetry(stream: TelemetryReading[]): Promise<void> {
    if (stream.length < 2) return;

    // Group by vehicleId
    const byVehicle = new Map<string, TelemetryReading[]>();
    for (const r of stream) {
      const arr = byVehicle.get(r.vehicleId) || [];
      arr.push(r);
      byVehicle.set(r.vehicleId, arr);
    }

    for (const [vehicleId, readings] of byVehicle.entries()) {
      // Sort by timestamp
      readings.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // Size the noise band against this vehicle's real tank.
      const asset = await db.asset.findFirst({
        where: { OR: [{ code: vehicleId }, { registrationNo: vehicleId }] },
        select: { fuelCapacity: true },
      });
      const { noiseBandL } = fuelThresholds(asset?.fuelCapacity ?? null, DEFAULT_FUEL_CONFIG);
      // A siphon worth opening a case over is well clear of sender tolerance.
      const minDropL = Math.max(noiseBandL * 2, DEFAULT_FUEL_CONFIG.minMeaningfulDropL);

      let anomalyScore = 0;
      let anomalyReason = "";
      let maxDrop = 0;
      // Only a real fix is a location. A missing one must not become 0,0.
      const lastLocation = [...readings].reverse().find((r) => r.gps != null)?.gps ?? null;

      for (let i = 1; i < readings.length; i++) {
        const prev = readings[i - 1];
        const cur = readings[i];

        // Missing is not zero, and two unknowns do not make a measurement.
        if (prev.tankLevel == null || cur.tankLevel == null) continue;

        const tankDrop = prev.tankLevel - cur.tankLevel;
        if (tankDrop < minDropL) continue;

        const hours = (new Date(cur.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 3_600_000;
        // A drop faster than any engine can burn is a sensor fault. Reading it
        // as theft is how a data glitch becomes an accusation against a driver.
        if (hours > 0 && tankDrop / hours > DEFAULT_FUEL_CONFIG.maxBurnRateLph) continue;

        // "Known to be stopped" — not "not known to be moving".
        const definitelyStopped = cur.speed === 0 && cur.engineState === "OFF";

        if (definitelyStopped) {
          anomalyScore = 0.85 + Math.min(0.1, tankDrop / 200); // 0.85 to 0.95
          anomalyReason =
            `Tank fell ${tankDrop.toFixed(0)} L over ${(hours * 60).toFixed(0)} min while the engine was off ` +
            `and the vehicle was stationary. Sender tolerance for this tank is ±${noiseBandL} L.`;
          maxDrop = tankDrop;
        } else if (cur.speed == null || cur.engineState === "UNKNOWN") {
          // Real drop, but we cannot say what the vehicle was doing. Worth a
          // look, never worth a case.
          anomalyScore = Math.max(anomalyScore, 0.3);
        } else {
          // Normal burn but maybe excessive
          anomalyScore = Math.max(anomalyScore, 0.4);
        }
      }

      if (anomalyScore > 0.75 && maxDrop > 0) {
        await this.dispatchFraudEvent(vehicleId, maxDrop, anomalyReason, anomalyScore, lastLocation);
      }
    }
  }

  private async dispatchFraudEvent(vehicleId: string, lostLitres: number, reason: string, score: number, gps: {lat: number, lng: number} | null) {
    // Check if we already have an open case for this vehicle today to avoid
    // spam. "Today" is the business's day, not the server's — on Vercel the
    // server runs in UTC, which would start a fresh dedupe window at 05:30 IST
    // and let a second case through every morning.
    const today = startOfBusinessDay(new Date());

    // Get Asset ID
    const asset = await db.asset.findFirst({ where: { code: vehicleId } });
    if (!asset) return; // Unknown asset
    
    const existingCase = await db.fraudCase.findFirst({
      where: { 
        assetId: asset.id, 
        ruleCode: "AI_FUEL_THEFT", 
        openedAt: { gte: today },
        status: { in: ["OPEN", "INVESTIGATING"] }
      }
    });
    
    if (existingCase) return; // Already escalated today
    
    // 1. Create Loss Prevention Incident
    const seq = await db.fraudCase.count();
    const caseTitle = `AI Detection: Fuel Siphoning (${lostLitres.toFixed(0)}L)`;
    // The configured diesel rate, not a hardcoded guess. This number goes on a
    // case as "amount at risk" and may be quoted at a recovery conversation, so
    // it has to be the rate the business actually pays.
    const setting = await db.setting.findUnique({ where: { key: "dieselRate" } });
    const parsed = Number(setting?.value);
    const dieselRate = Number.isFinite(parsed) && parsed > 0 ? parsed : 95;
    const valueAtRisk = Math.round(lostLitres * dieselRate);
    
    const fraudCase = await db.fraudCase.create({
      data: {
        caseNo: nextCaseNo(new Date().getFullYear(), seq),
        title: caseTitle,
        domain: "FUEL",
        ruleCode: "AI_FUEL_THEFT",
        severity: score > 0.9 ? "HIGH" : "MEDIUM",
        score: Math.round(score * 100),
        amountAtRisk: valueAtRisk,
        assetId: asset.id,
        summary: reason,
        signalKey: `AI_FUEL_THEFT:${asset.id}:${Date.now()}`,
        openedBy: "AI Fraud Engine",
        evidence: {
          create: [{
            kind: "TELEMETRY",
            label: "Telemetry Analysis",
            detail: gps
              ? `Lat: ${gps.lat.toFixed(4)}, Lng: ${gps.lng.toFixed(4)} - ${reason}`
              : `Location unknown (no GPS fix on the readings involved) - ${reason}`,
          }]
        },
        actions: {
          create: [{ action: "OPENED", note: "Auto-opened by AI Inference Engine", by: "AI Fraud Engine" }]
        }
      }
    });

    // 2. Dispatch CRITICAL alert to the Singular Alerts Stream
    await db.alert.create({
      data: {
        category: "Loss",
        severity: "Critical",
        title: caseTitle,
        message: `${vehicleId}: ${reason} Value at risk: ₹${valueAtRisk.toLocaleString("en-IN")}`,
        status: "Open",
        assetId: asset.id,
        actionUrl: `/loss-prevention/${fraudCase.id}`
      }
    });
  }
}
