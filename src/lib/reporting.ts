// M19 — Reporting, KPIs and export.
//
// Fifteen modules each have their own screen. What nobody has yet is the single
// page an owner opens on Monday morning, and a way to get any of it out as a
// file their accountant can open.
//
// The KPI catalogue is deliberately explicit about what each number *means* and
// which module it comes from, because a dashboard figure nobody can trace is a
// figure nobody trusts.

import { businessDay } from "@/lib/business-time";

export type KpiDirection = "higher-better" | "lower-better" | "neutral";

export type Kpi = {
  key: string;
  label: string;
  value: number;
  unit: string;
  direction: KpiDirection;
  module: string;
  /** What this number actually measures, shown on the card. */
  meaning: string;
  /** Null when there is no data to compute it from — never fabricate a zero. */
  available: boolean;
  target?: number;
};

export type KpiInput = {
  fuelLitres: number;
  fuelSpend: number;
  fuelShrinkagePct: number | null;
  productionTonnes: number;
  productionM3: number;
  idlePct: number | null;
  totalCost: number;
  revenue: number;
  openCases: number;
  atRisk: number;
  recovered: number;
  overbilled: number;
  breakdowns: number;
  plannedRatio: number | null;
  pmOverdue: number;
  notOperable: number;
  assetCount: number;
  activeAssets: number;
  dataCompleteness: number;
  weighShortagePct: number | null;
};

/**
 * Build the KPI set. `available: false` means "we cannot compute this yet",
 * which the UI shows as a dash rather than a misleading zero — a fleet with no
 * production logged has *unknown* efficiency, not perfect efficiency.
 */
export function buildKpis(i: KpiInput): Kpi[] {
  const kpi = (
    key: string, label: string, value: number, unit: string, direction: KpiDirection,
    module: string, meaning: string, available: boolean, target?: number
  ): Kpi => ({ key, label, value, unit, direction, module, meaning, available, target });

  return [
    kpi("fuel_spend", "Diesel Spend", i.fuelSpend, "₹", "lower-better", "M5", "Total value of diesel issued in the period.", i.fuelSpend > 0),
    kpi("shrinkage", "Fuel Shrinkage", i.fuelShrinkagePct ?? 0, "%", "lower-better", "M5",
      "Unaccounted litres as a share of tank throughput. Needs dipstick readings.", i.fuelShrinkagePct != null, 0.5),
    kpi("litres_per_tonne", "Diesel per Tonne", i.productionTonnes > 0 ? i.fuelLitres / i.productionTonnes : 0, "L/t", "lower-better", "M23",
      "Litres burnt per tonne moved — the number that makes fuel figures meaningful.", i.productionTonnes > 0 && i.fuelLitres > 0),
    kpi("idle", "Idle Time", i.idlePct ?? 0, "%", "lower-better", "M23",
      "Share of logged machine time producing nothing while still burning diesel.", i.idlePct != null, 30),
    kpi("cost_per_tonne", "Cost per Tonne", i.productionTonnes > 0 ? i.totalCost / i.productionTonnes : 0, "₹/t", "lower-better", "M7",
      "All-in fleet cost divided by tonnes moved.", i.productionTonnes > 0 && i.totalCost > 0),
    kpi("margin", "Fleet Margin", i.revenue > 0 ? ((i.revenue - i.totalCost) / i.revenue) * 100 : 0, "%", "higher-better", "M7",
      "Revenue minus true fleet cost. Needs project revenue entered.", i.revenue > 0),
    kpi("at_risk", "Value at Risk", i.atRisk, "₹", "lower-better", "M6",
      "Open loss-prevention exposure across fuel, hire and compliance.", true),
    kpi("recovered", "Recovered", i.recovered, "₹", "higher-better", "M6",
      "Money actually clawed back and evidenced.", true),
    kpi("overbilled", "Vendor Overbilling", i.overbilled, "₹", "lower-better", "M8",
      "Claimed beyond what site logs support.", true),
    kpi("weigh_short", "Material Shortage", i.weighShortagePct ?? 0, "%", "lower-better", "M24",
      "Dispatched tonnage that never arrived. Needs paired weighbridge slips.", i.weighShortagePct != null, 1.5),
    kpi("planned_ratio", "Planned Maintenance", i.plannedRatio ?? 0, "%", "higher-better", "M14",
      "Share of jobs that were planned rather than reactive — the workshop health signal.", i.plannedRatio != null, 60),
    kpi("pm_overdue", "Services Overdue", i.pmOverdue, "", "lower-better", "M14",
      "Preventive tasks past their km, hour or calendar interval.", true, 0),
    kpi("not_operable", "Not Legal to Operate", i.notOperable, "", "lower-better", "M13",
      "Machines with a blocking document expired or never recorded.", true, 0),
    kpi("utilisation", "Fleet Active", i.assetCount > 0 ? (i.activeAssets / i.assetCount) * 100 : 0, "%", "higher-better", "M1",
      "Share of the fleet in an active status.", i.assetCount > 0),
    kpi("completeness", "Master Data", i.dataCompleteness, "%", "higher-better", "M1",
      "Weighted completeness of asset records. Every other number depends on it.", i.assetCount > 0, 90),
  ];
}

/** Traffic-light band for a KPI against its target. */
export function kpiBand(k: Kpi): "good" | "watch" | "bad" | "none" {
  if (!k.available || k.target == null) return "none";
  if (k.direction === "higher-better") {
    if (k.value >= k.target) return "good";
    return k.value >= k.target * 0.7 ? "watch" : "bad";
  }
  if (k.direction === "lower-better") {
    if (k.value <= k.target) return "good";
    return k.value <= k.target * 2 ? "watch" : "bad";
  }
  return "none";
}

/* --------------------------------- export --------------------------------- */

/**
 * CSV with correct escaping. Values containing a comma, quote or newline are
 * quoted and inner quotes doubled — the thing that quietly corrupts a report
 * when a vendor name has a comma in it.
 */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return "";
  const cols = columns ?? Object.keys(rows[0]);

  // Dates are formatted in the BUSINESS timezone, not UTC and not the server's.
  //
  // toISOString() would shift an IST timestamp back a day (local midnight is
  // 18:30 UTC the day before). But the previous fix here — getFullYear() and
  // friends — reads the *server's* zone, which is IST on a developer's laptop
  // and UTC on Vercel: the same export produced different dates depending on
  // where it ran. `businessDay` pins it to the zone the client works in.
  const cell = (v: unknown): string => {
    if (v == null) return "";
    if (v instanceof Date) return businessDay(v);
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const head = cols.map(cell).join(",");
  const body = rows.map((r) => cols.map((c) => cell(r[c])).join(","));
  return [head, ...body].join("\n");
}

export const REPORT_CATALOGUE = [
  { key: "fuel_issues", label: "Fuel issues", module: "M5", description: "Every diesel issue with asset, litres, rate and location." },
  { key: "fuel_reconciliation", label: "Tank reconciliation", module: "M5", description: "Opening dip, receipts, issues, closing dip and variance per tank." },
  { key: "hire_invoices", label: "Hire invoice verification", module: "M8", description: "Claimed vs supported vs payable, with findings." },
  { key: "production", label: "Production log", module: "M23", description: "Daily output by machine, material and project." },
  { key: "cost_per_asset", label: "Cost per asset", module: "M7", description: "Cost by head with per-km, per-hour and per-tonne unit costs." },
  { key: "compliance", label: "Compliance register", module: "M13", description: "Every document with expiry, plus machines missing one entirely." },
  { key: "loss_cases", label: "Loss-prevention cases", module: "M6", description: "Cases with amount at risk, recovered and disposition." },
  { key: "maintenance", label: "Work orders", module: "M14", description: "Jobs with labour, parts, downtime and technician." },
  { key: "weighbridge", label: "Weighbridge tickets", module: "M24", description: "Dispatch and receipt slips with shortage." },
  { key: "attendance", label: "Attendance", module: "M2", description: "Daily attendance by person and project." },
] as const;
