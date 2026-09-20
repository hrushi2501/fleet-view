import { db } from "@/lib/db";
import { getFuelRate } from "@/lib/settings";

export interface SignalInput {
  id: string;
  source: "TANK_RECON" | "TELEMETRY_DROP" | "EFFICIENCY_DROP" | "PHOTO_MISMATCH" | "GEOFENCE" | "METER_ROLLBACK" | "RECEIPT_SHORT";
  refId: string;
  assetId?: string | null;
  tankId?: string | null;
  driverId?: string | null;
  supplier?: string | null;
  timestamp: Date;
  litres: number;
  valueAtRisk: number;
  confidence: number; // 0-1
  description: string;
}

export interface CorrelatedAnomalyCase {
  caseNo: string;
  primaryDomain: "FUEL_THEFT" | "SUPPLIER_SHORTFALL" | "METER_TAMPERING" | "TANK_LEAK";
  severity: "HIGH" | "MEDIUM" | "LOW";
  score: number; // 0-100
  confidence: number;
  totalLitresAtRisk: number;
  totalValueAtRisk: number;
  assetId?: string | null;
  tankId?: string | null;
  driverId?: string | null;
  supplier?: string | null;
  signals: SignalInput[];
}

/**
 * Correlates raw signals within a 4-hour time window and same asset/tank into unified cases
 */
export function correlateSignals(signals: SignalInput[]): CorrelatedAnomalyCase[] {
  const sorted = [...signals].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const cases: CorrelatedAnomalyCase[] = [];

  for (const sig of sorted) {
    // Try to find an existing correlated case (within 4 hours and matching asset or tank)
    const existing = cases.find((c) => {
      const sameAsset = sig.assetId && c.assetId === sig.assetId;
      const sameTank = sig.tankId && c.tankId === sig.tankId;
      const sameSupplier = sig.supplier && c.supplier === sig.supplier;
      const timeDiffH = Math.abs(c.signals[0].timestamp.getTime() - sig.timestamp.getTime()) / 3.6e6;
      return (sameAsset || sameTank || sameSupplier) && timeDiffH <= 4;
    });

    if (existing) {
      existing.signals.push(sig);
      existing.totalLitresAtRisk = Math.max(existing.totalLitresAtRisk, sig.litres);
      existing.totalValueAtRisk = Math.max(existing.totalValueAtRisk, sig.valueAtRisk);
      existing.confidence = Math.min(1.0, existing.confidence + 0.15); // Corroboration increases confidence
    } else {
      let primaryDomain: CorrelatedAnomalyCase["primaryDomain"] = "FUEL_THEFT";
      if (sig.source === "RECEIPT_SHORT") primaryDomain = "SUPPLIER_SHORTFALL";
      else if (sig.source === "METER_ROLLBACK") primaryDomain = "METER_TAMPERING";
      else if (sig.source === "TANK_RECON") primaryDomain = "TANK_LEAK";

      cases.push({
        caseNo: `CASE-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`,
        primaryDomain,
        severity: "LOW",
        score: 0,
        confidence: sig.confidence,
        totalLitresAtRisk: sig.litres,
        totalValueAtRisk: sig.valueAtRisk,
        assetId: sig.assetId,
        tankId: sig.tankId,
        driverId: sig.driverId,
        supplier: sig.supplier,
        signals: [sig],
      });
    }
  }

  // Calculate scores and severity for all correlated cases
  for (const c of cases) {
    const baseScore = Math.min(40, (c.totalLitresAtRisk / 100) * 20); // 200L = 40 pts
    const sourceTypes = new Set(c.signals.map((s) => s.source)).size;
    const corroborationBonus = Math.min(30, sourceTypes * 15); // 2 sources = 30 pts
    const financialPts = Math.min(15, (c.totalValueAtRisk / 10000) * 15); // ₹10k = 15 pts

    const rawScore = Math.round((baseScore + corroborationBonus + financialPts) * c.confidence);
    c.score = Math.max(1, Math.min(100, rawScore));

    c.severity = c.score >= 60 ? "HIGH" : c.score >= 30 ? "MEDIUM" : "LOW";
  }

  return cases.sort((a, b) => b.score - a.score);
}

/**
 * Sweeps signals and updates `UnifiedAnomaly` table in database
 */
export async function syncUnifiedAnomalies(rawSignals: SignalInput[]) {
  const correlated = correlateSignals(rawSignals);
  for (const c of correlated) {
    const asset = c.assetId
      ? await db.asset.findUnique({ where: { id: c.assetId }, select: { fuelType: true } })
      : null;
    const rate = asset ? await getFuelRate(asset.fuelType) : null;
    await db.unifiedAnomaly.upsert({

      where: { caseNo: c.caseNo },
      create: {
        caseNo: c.caseNo,
        primaryDomain: c.primaryDomain,
        severity: c.severity,
        score: c.score,
        confidence: c.confidence,
        litresAtRisk: c.totalLitresAtRisk,
        valueAtRisk: c.totalValueAtRisk || (rate == null ? 0 : c.totalLitresAtRisk * rate),
        signals: JSON.stringify(c.signals),
        assetId: c.assetId || null,
        tankId: c.tankId || null,
        driverId: c.driverId || null,
        supplier: c.supplier || null,
        status: "OPEN",
      },
      update: {
        severity: c.severity,
        score: c.score,
        confidence: c.confidence,
        litresAtRisk: c.totalLitresAtRisk,
        valueAtRisk: c.totalValueAtRisk || (rate == null ? 0 : c.totalLitresAtRisk * rate),
        signals: JSON.stringify(c.signals),
      },
    });
  }
}
