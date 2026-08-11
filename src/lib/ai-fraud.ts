import { db } from "@/lib/db";
import { TelemetryReading } from "./telemetry-ingestion";
import { nextCaseNo } from "./loss-prevention";

export class AiFraudDetectionService {
  /**
   * Processes a stream of telemetry and flags anomalies.
   * Returns a probability score (0.0 to 1.0) for the most likely anomaly.
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
      
      let anomalyScore = 0;
      let anomalyReason = "";
      let maxDrop = 0;
      const lastLocation = readings[readings.length - 1].gps;
      
      for (let i = 1; i < readings.length; i++) {
        const prev = readings[i - 1];
        const cur = readings[i];
        
        const tankDrop = prev.tankLevel - cur.tankLevel;
        if (tankDrop > 10) {
          if (cur.speed === 0 || cur.engineState === 'OFF') {
             // Fuel drop while idle or off -> High probability of theft
             anomalyScore = 0.85 + Math.min(0.1, tankDrop / 200); // 0.85 to 0.95
             anomalyReason = `Sudden drop of ${tankDrop.toFixed(0)}L while engine was ${cur.engineState} and speed was ${cur.speed}km/h.`;
             maxDrop = tankDrop;
          } else {
             // Normal burn but maybe excessive
             anomalyScore = Math.max(anomalyScore, 0.4);
          }
        }
      }
      
      if (anomalyScore > 0.75) {
        await this.dispatchFraudEvent(vehicleId, maxDrop, anomalyReason, anomalyScore, lastLocation);
      }
    }
  }

  private async dispatchFraudEvent(vehicleId: string, lostLitres: number, reason: string, score: number, gps: {lat: number, lng: number}) {
    // Check if we already have an open case for this vehicle today to avoid spam
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
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
    const dieselRate = 90; // Assume 90 INR/L
    const valueAtRisk = lostLitres * dieselRate;
    
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
          create: [{ kind: "TELEMETRY", label: "Telemetry Analysis", detail: `Lat: ${gps.lat.toFixed(4)}, Lng: ${gps.lng.toFixed(4)} - ${reason}` }]
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
