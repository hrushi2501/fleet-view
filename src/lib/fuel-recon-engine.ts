import { db } from "@/lib/db";
import { TankLite, ReceiptLite, IssueLite, DipLite, TankRecon } from "@/lib/fuel-recon";

export interface ResolvedReconThresholds {
  dipToleranceL: number;
  shrinkagePctWarn: number;
  shrinkagePctCrit: number;
  capacityPctWarn: number;
  seasonalFactor: number;
}

/**
 * Resolves configuration cascading: TANK -> PROJECT -> GLOBAL -> DEFAULT
 */
type ReconConfigRow = {
  scope: string;
  dipToleranceL?: number;
  shrinkagePctWarn?: number;
  shrinkagePctCrit?: number;
  capacityPctWarn?: number;
  seasonalFactor?: number;
};

export async function resolveTankThresholds(
  tankId: string,
  projectId?: string | null
): Promise<ResolvedReconThresholds> {
  let configs: ReconConfigRow[] = [];
  try {
    configs = await db.fuelReconConfig.findMany({
      where: {
        OR: [
          { scope: "TANK", scopeId: tankId },
          ...(projectId ? [{ scope: "PROJECT", scopeId: projectId }] : []),
          { scope: "GLOBAL", scopeId: null },
        ],
      },
    });
  } catch {
    // Table may not exist yet — fall through to defaults
  }

  const tankCfg = configs.find((c) => c.scope === "TANK");
  const projCfg = configs.find((c) => c.scope === "PROJECT");
  const globCfg = configs.find((c) => c.scope === "GLOBAL");


  const dipToleranceL = tankCfg?.dipToleranceL ?? projCfg?.dipToleranceL ?? globCfg?.dipToleranceL ?? 25;
  const shrinkagePctWarn = tankCfg?.shrinkagePctWarn ?? projCfg?.shrinkagePctWarn ?? globCfg?.shrinkagePctWarn ?? 0.5;
  const shrinkagePctCrit = tankCfg?.shrinkagePctCrit ?? projCfg?.shrinkagePctCrit ?? globCfg?.shrinkagePctCrit ?? 2.0;
  const capacityPctWarn = tankCfg?.capacityPctWarn ?? projCfg?.capacityPctWarn ?? globCfg?.capacityPctWarn ?? 2.0;

  // Seasonal thermal expansion factor: 1.20 during Indian Summer (Apr-Aug), 1.00 otherwise
  const month = new Date().getMonth();
  const isSummer = month >= 3 && month <= 7;
  const seasonalFactor = isSummer ? (tankCfg?.seasonalFactor ?? 1.2) : 1.0;

  return {
    dipToleranceL: dipToleranceL * seasonalFactor,
    shrinkagePctWarn: shrinkagePctWarn * seasonalFactor,
    shrinkagePctCrit: shrinkagePctCrit * seasonalFactor,
    capacityPctWarn: capacityPctWarn * seasonalFactor,
    seasonalFactor,
  };
}

/**
 * Calculates dynamic tolerance incorporating historic standard deviation
 */
export function computeDynamicTolerance(
  baseToleranceL: number,
  tankCapacityL: number,
  capacityPctWarn: number,
  historicalVariances: number[]
): number {
  if (historicalVariances.length < 3) {
    return Math.max(baseToleranceL, tankCapacityL * (capacityPctWarn / 100));
  }

  const mean = historicalVariances.reduce((s, v) => s + Math.abs(v), 0) / historicalVariances.length;
  const varianceSum = historicalVariances.reduce((s, v) => s + (Math.abs(v) - mean) ** 2, 0);
  const stdDev = Math.sqrt(varianceSum / historicalVariances.length);

  // Dynamic tolerance = max(base, capacity%, mean + 2*stdDev)
  return Math.max(baseToleranceL, tankCapacityL * (capacityPctWarn / 100), mean + 2 * stdDev);
}

/**
 * Enhanced Tank Reconciliation using Dynamic Thresholds
 */
export function reconcileTankDynamic(
  tank: TankLite,
  receipts: ReceiptLite[],
  issues: IssueLite[],
  dips: DipLite[],
  thresholds: ResolvedReconThresholds,
  historicalVariancesL: number[] = []
): TankRecon {
  const dynamicToleranceL = computeDynamicTolerance(
    thresholds.dipToleranceL,
    tank.capacity,
    thresholds.capacityPctWarn,
    historicalVariancesL
  );

  const inWin = <T extends { date: Date }>(rows: T[]) =>
    [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());

  const d = inWin(dips);
  const opening = d[0] ?? null;
  const closing = d.length > 1 ? d[d.length - 1] : null;

  const between = <T extends { date: Date }>(rows: T[]) =>
    inWin(rows).filter((r) => (!opening || r.date >= opening.date) && (!closing || r.date <= closing.date));

  const rec = between(receipts);
  const iss = between(issues);

  const receiptsL = rec.reduce((s, r) => s + r.qtyReceived, 0);
  const issuesL = iss.reduce((s, i) => s + i.quantity, 0);
  const shortDeliveryL = rec.reduce((s, r) => s + Math.max(0, r.shortfall), 0);

  const openingDip = opening?.level ?? 0;
  const closingDip = closing?.level ?? null;
  const expectedClosing = openingDip + receiptsL - issuesL;
  const throughput = receiptsL + issuesL;

  const varianceL = closingDip == null ? 0 : closingDip - expectedClosing;
  const variancePct = throughput > 0 ? (varianceL / throughput) * 100 : 0;

  const reasons: string[] = [];
  let status: TankRecon["status"] = "ok";

  if (!opening || !closing) {
    status = "insufficient";
    reasons.push(
      !opening
        ? "No dipstick reading in this period — cannot reconcile."
        : "Only one dipstick reading — a closing dip is needed to reconcile."
    );
  } else {
    const missing = -varianceL;
    if (missing > dynamicToleranceL && Math.abs(variancePct) > thresholds.shrinkagePctWarn) {
      status = missing > dynamicToleranceL * 3 || Math.abs(variancePct) > thresholds.shrinkagePctCrit ? "critical" : "watch";
      reasons.push(
        `${missing.toFixed(0)} L unaccounted for (${Math.abs(variancePct).toFixed(2)}% of throughput, dynamic tolerance: ${dynamicToleranceL.toFixed(0)} L).`
      );
    } else if (varianceL > dynamicToleranceL) {
      status = "watch";
      reasons.push(
        `Tank holds ${varianceL.toFixed(0)} L more than the book — check for unrecorded receipts or under-recorded issues.`
      );
    }

    if (shortDeliveryL > 0) {
      if (status === "ok") status = "watch";
      reasons.push(`${shortDeliveryL.toFixed(0)} L invoiced by supplier but never dipped into the tank.`);
    }

    if (closingDip != null && closingDip < tank.minLevel) {
      reasons.push(`Tank below reorder level (${closingDip.toFixed(0)} / ${tank.minLevel} L).`);
    }
  }

  return {
    tank,
    periodStart: opening?.date ?? new Date(0),
    periodEnd: closing?.date ?? new Date(),
    openingDip,
    closingDip,
    receiptsL,
    issuesL,
    expectedClosing,
    varianceL,
    variancePct,
    throughput,
    status,
    receipts: rec,
    issues: iss,
    shortDeliveryL,
    reasons,
  };
}

/**
 * Computes supplier shortfall statistics across all historical deliveries
 */
export function calculateSupplierScorecard(
  receipts: { supplier: string; qtyInvoiced: number; qtyReceived: number; shortfall: number; amount: number }[]
) {
  const bySupplier = new Map<
    string,
    { supplier: string; totalDeliveries: number; totalInvoiced: number; totalReceived: number; totalShortfall: number; totalSpend: number }
  >();

  for (const r of receipts) {
    const s = bySupplier.get(r.supplier) || {
      supplier: r.supplier,
      totalDeliveries: 0,
      totalInvoiced: 0,
      totalReceived: 0,
      totalShortfall: 0,
      totalSpend: 0,
    };

    s.totalDeliveries++;
    s.totalInvoiced += r.qtyInvoiced;
    s.totalReceived += r.qtyReceived;
    s.totalShortfall += Math.max(0, r.shortfall);
    s.totalSpend += r.amount;

    bySupplier.set(r.supplier, s);
  }

  return [...bySupplier.values()]
    .map((s) => ({
      ...s,
      shortfallRatioPct: s.totalInvoiced > 0 ? (s.totalShortfall / s.totalInvoiced) * 100 : 0,
    }))
    .sort((a, b) => b.totalShortfall - a.totalShortfall);
}
