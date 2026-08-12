// M7 — Cost, TCO & profitability.
//
// The demo could total up cost transactions. What an owner actually asks is
// "what does this machine cost me per kilometre / per engine-hour / per cubic
// metre, and is this project making money?" That needs three things the demo
// lacked: costs pulled automatically from the operational modules, depreciation,
// and a production denominator (M23).
//
// Cost is assembled from live module data rather than hand-keyed entries:
//   fuel        <- M5 fuel issues
//   maintenance <- work orders (labour + parts)
//   hire        <- M8 verified payable, not the vendor's claim
//   other       <- manual CostTransaction rows (tyres, insurance, EMI, tolls…)
//   depreciation<- computed from acquisition cost and asset life

import { parseBusinessDay } from "./business-time";

export const COST_HEADS = ["FUEL", "MAINTENANCE", "HIRE", "TYRE", "OPERATOR", "INSURANCE", "EMI", "TOLL", "DEPRECIATION", "OTHER"] as const;
export type CostHead = (typeof COST_HEADS)[number];

export const COST_HEAD_LABEL: Record<string, string> = {
  FUEL: "Fuel", MAINTENANCE: "Maintenance", HIRE: "Hire charges", TYRE: "Tyres", OPERATOR: "Operator",
  INSURANCE: "Insurance", EMI: "EMI / lease", TOLL: "Tolls & permits", DEPRECIATION: "Depreciation", OTHER: "Other",
};

/* ------------------------------ depreciation ------------------------------ */

export type DepInput = {
  acquisitionCost: number;
  salvageValue: number;
  usefulLifeYears: number;
  method: string; // SLM | WDV
  inServiceDate: Date | null;
  yearMfg: number;
};

export type Depreciation = {
  annual: number;
  monthly: number;
  accumulated: number;
  bookValue: number;
  ageYears: number;
  fullyDepreciated: boolean;
  /**
   * False when the machine has no acquisition cost or no in-service date, so
   * nothing here was actually computed. The zeros that come back in that case
   * are the absence of a figure, not a machine that costs nothing to own — and
   * a fleet full of them reports a flattering, entirely fictional profit.
   */
  known: boolean;
};

/**
 * Straight-line or written-down-value depreciation.
 *
 * WDV rate is derived from the salvage ratio rather than assumed, so a machine
 * with a real residual value doesn't depreciate to near-zero on paper.
 */
export function depreciation(a: DepInput, asOf = new Date()): Depreciation {
  const cost = a.acquisitionCost;
  const life = Math.max(1, a.usefulLifeYears);
  const salvage = Math.min(a.salvageValue, cost);

  // `new Date(year, 0, 1)` builds 1 January in the *server's* timezone, which is
  // UTC on Vercel and IST on a laptop — the same asset then ages by different
  // amounts depending on where the page rendered. Anchor it to the business
  // calendar instead.
  const start = a.inServiceDate ?? (a.yearMfg > 1970 ? parseBusinessDay(`${a.yearMfg}-01-01`) : null);
  if (!cost || !start) {
    return { annual: 0, monthly: 0, accumulated: 0, bookValue: cost, ageYears: 0, fullyDepreciated: false, known: false };
  }

  const ageYears = Math.max(0, (asOf.getTime() - start.getTime()) / (365.25 * 86400000));

  if (a.method === "WDV") {
    // r = 1 - (salvage/cost)^(1/life); with no salvage, fall back to a conventional 15%.
    const ratio = cost > 0 ? Math.min(cost, salvage) / cost : 0;
    const rate = ratio > 0 && ratio < 1 ? 1 - Math.pow(ratio, 1 / life) : (ratio >= 1 ? 0 : 0.15);
    const bookValue = Math.max(salvage, cost * Math.pow(1 - rate, ageYears));
    const accumulated = cost - bookValue;
    const annual = bookValue * rate;
    return { annual, monthly: annual / 12, accumulated, bookValue, ageYears, fullyDepreciated: bookValue <= salvage + 1, known: true };
  }

  const annual = (cost - salvage) / life;
  const accumulated = Math.min(cost - salvage, annual * ageYears);
  const bookValue = cost - accumulated;
  return { annual, monthly: annual / 12, accumulated, bookValue, ageYears, fullyDepreciated: ageYears >= life, known: true };
}

/* ------------------------------- asset costs ------------------------------- */

export type CostInputs = {
  fuel: number;
  maintenance: number;
  hire: number;
  manual: { costHead: string; amount: number }[];
  depreciationForPeriod: number;
};

export type UnitDenominators = {
  km: number;
  engineHours: number;
  tonnage: number;
  volumeM3: number;
  trips: number;
};

export type AssetCost = {
  byHead: { head: string; amount: number }[];
  total: number;
  /** Cash cost excludes depreciation — what actually left the bank this period. */
  cashTotal: number;
  perKm: number | null;
  perHour: number | null;
  perTonne: number | null;
  perM3: number | null;
  perTrip: number | null;
};

export function assetCost(inputs: CostInputs, d: UnitDenominators): AssetCost {
  const heads = new Map<string, number>();
  const add = (h: string, v: number) => { if (v) heads.set(h, (heads.get(h) ?? 0) + v); };

  add("FUEL", inputs.fuel);
  add("MAINTENANCE", inputs.maintenance);
  add("HIRE", inputs.hire);
  for (const m of inputs.manual) add(m.costHead || "OTHER", m.amount);
  add("DEPRECIATION", inputs.depreciationForPeriod);

  const total = [...heads.values()].reduce((s, v) => s + v, 0);
  const cashTotal = total - (heads.get("DEPRECIATION") ?? 0);

  const per = (den: number) => (den > 0 ? total / den : null);

  return {
    byHead: [...heads.entries()].map(([head, amount]) => ({ head, amount })).sort((a, b) => b.amount - a.amount),
    total,
    cashTotal,
    perKm: per(d.km),
    perHour: per(d.engineHours),
    perTonne: per(d.tonnage),
    perM3: per(d.volumeM3),
    perTrip: per(d.trips),
  };
}

/* ---------------------------- project profitability ---------------------------- */

export type ProjectPnL = {
  projectId: string;
  revenue: number;
  cost: number;
  margin: number;
  /** Null when no revenue has been booked — there is no base to take a percentage of. */
  marginPct: number | null;
  budget: number;
  /** Null when the project carries no budget — spend cannot be a share of nothing. */
  budgetUsedPct: number | null;
  overBudget: boolean;
  byHead: { head: string; amount: number }[];
};

export function projectPnL(
  projectId: string,
  revenue: number,
  costsByHead: { head: string; amount: number }[],
  budget: number
): ProjectPnL {
  const cost = costsByHead.reduce((s, c) => s + c.amount, 0);
  const margin = revenue - cost;
  return {
    projectId,
    revenue,
    cost,
    margin,
    // A project that has burnt ₹40 lakh and billed nothing yet is not running at
    // a 0% margin — breakeven — which is exactly how a 0 renders on the P&L
    // table. Same for a project with real spend and no budget line: 0% used
    // reads as untouched.
    marginPct: revenue > 0 ? (margin / revenue) * 100 : null,
    budget,
    budgetUsedPct: budget > 0 ? (cost / budget) * 100 : null,
    overBudget: budget > 0 && cost > budget,
    byHead: [...costsByHead].sort((a, b) => b.amount - a.amount),
  };
}

/* --------------------------- replace vs repair --------------------------- */

export type ReplaceAdvice = {
  verdict: "keep" | "watch" | "replace";
  reasons: string[];
  maintenanceToBookRatio: number | null;
  annualMaintenance: number;
};

/**
 * A blunt but honest heuristic: when a machine's yearly upkeep approaches what
 * it is still worth on the books, it has stopped being an asset.
 */
export function replaceVsRepair(
  annualMaintenance: number,
  dep: Depreciation,
  downtimeHrs: number,
  ageYears: number,
  usefulLifeYears: number
): ReplaceAdvice {
  const reasons: string[] = [];
  const ratio = dep.bookValue > 0 ? annualMaintenance / dep.bookValue : null;
  let score = 0;

  if (ratio != null) {
    if (ratio > 0.5) { score += 2; reasons.push(`Yearly maintenance is ${(ratio * 100).toFixed(0)}% of remaining book value.`); }
    else if (ratio > 0.25) { score += 1; reasons.push(`Yearly maintenance is ${(ratio * 100).toFixed(0)}% of book value — worth watching.`); }
  }
  if (dep.fullyDepreciated) { score += 1; reasons.push("Fully depreciated — running on borrowed time."); }
  if (ageYears > usefulLifeYears) { score += 1; reasons.push(`${ageYears.toFixed(1)} years old against a ${usefulLifeYears}-year expected life.`); }
  if (downtimeHrs > 200) { score += 1; reasons.push(`${downtimeHrs.toFixed(0)} hours of recorded downtime.`); }

  const verdict: ReplaceAdvice["verdict"] = score >= 3 ? "replace" : score >= 2 ? "watch" : "keep";
  if (verdict === "keep" && reasons.length === 0) reasons.push("Costs are in line with the machine's remaining value.");

  return { verdict, reasons, maintenanceToBookRatio: ratio, annualMaintenance };
}
