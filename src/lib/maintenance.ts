// M14 — Preventive & breakdown maintenance.
//
// The demo could list work orders. What a workshop actually needs is to know
// what is due before it breaks, and what breaking is costing.
//
// Due-ness is driven by whichever interval trips first — kilometres,
// engine-hours or calendar days. A machine that sits idle still ages, and one
// that runs hard ages faster than the calendar suggests, so neither meter nor
// date alone is sufficient.

export type ScheduleLite = {
  id: string;
  taskName: string;
  intervalKm: number;
  intervalHours: number;
  intervalDays: number;
  lastDoneMeter: number;
  lastDoneDate: Date | null;
  estimatedCost: number;
};

export type DueStatus = "overdue" | "due" | "upcoming" | "ok";

export type PmDue = {
  schedule: ScheduleLite;
  /** Whichever basis is closest to tripping. */
  basis: "km" | "hours" | "days";
  dueAtMeter: number | null;
  dueOnDate: Date | null;
  meterRemaining: number | null;
  daysRemaining: number | null;
  /** 0–100+; 100 means exactly due, above means overdue. */
  progressPct: number;
  status: DueStatus;
  label: string;
};

/** Warn when within this fraction of the interval. */
const WARN_AT = 0.9;

/**
 * Work out how close a scheduled task is to falling due for one asset.
 * `currentMeter` is km for road vehicles, engine-hours for equipment.
 */
export function pmDue(s: ScheduleLite, currentMeter: number, meterIsHours: boolean, now = new Date()): PmDue {
  const candidates: { basis: PmDue["basis"]; pct: number; dueAtMeter: number | null; dueOnDate: Date | null; remaining: number }[] = [];

  const meterInterval = meterIsHours ? s.intervalHours : s.intervalKm;
  if (meterInterval > 0) {
    const dueAt = s.lastDoneMeter + meterInterval;
    const used = currentMeter - s.lastDoneMeter;
    candidates.push({
      basis: meterIsHours ? "hours" : "km",
      pct: (used / meterInterval) * 100,
      dueAtMeter: dueAt,
      dueOnDate: null,
      remaining: dueAt - currentMeter,
    });
  }

  if (s.intervalDays > 0 && s.lastDoneDate) {
    const dueOn = new Date(s.lastDoneDate.getTime() + s.intervalDays * 86400000);
    const usedDays = (now.getTime() - s.lastDoneDate.getTime()) / 86400000;
    candidates.push({
      basis: "days",
      pct: (usedDays / s.intervalDays) * 100,
      dueAtMeter: null,
      dueOnDate: dueOn,
      remaining: (dueOn.getTime() - now.getTime()) / 86400000,
    });
  }

  if (candidates.length === 0) {
    return {
      schedule: s, basis: "km", dueAtMeter: null, dueOnDate: null, meterRemaining: null, daysRemaining: null,
      progressPct: 0, status: "ok", label: "No interval set",
    };
  }

  // The binding constraint is whichever is furthest along.
  const winner = candidates.reduce((a, b) => (b.pct > a.pct ? b : a));
  const status: DueStatus =
    winner.pct >= 100 ? "overdue" : winner.pct >= WARN_AT * 100 ? "due" : winner.pct >= 70 ? "upcoming" : "ok";

  const unit = winner.basis === "days" ? "days" : winner.basis === "hours" ? "hrs" : "km";
  const label =
    winner.remaining >= 0
      ? `${Math.round(winner.remaining).toLocaleString("en-IN")} ${unit} to go`
      : `${Math.round(-winner.remaining).toLocaleString("en-IN")} ${unit} overdue`;

  return {
    schedule: s,
    basis: winner.basis,
    dueAtMeter: winner.dueAtMeter,
    dueOnDate: winner.dueOnDate,
    meterRemaining: winner.basis === "days" ? null : winner.remaining,
    daysRemaining: winner.basis === "days" ? winner.remaining : null,
    progressPct: winner.pct,
    status,
    label,
  };
}

/* ------------------------------ reliability ------------------------------ */

export type WoLite = {
  id: string;
  type: string; // PM | BREAKDOWN | REPAIR
  status: string;
  totalCost: number;
  downtimeHrs: number;
  reportedAt: Date;
  completedAt: Date | null;
};

export type Reliability = {
  breakdowns: number;
  pmJobs: number;
  repairs: number;
  totalCost: number;
  breakdownCost: number;
  downtimeHrs: number;
  /** Mean time between failures, in days. */
  mtbfDays: number | null;
  /** Mean time to repair, in hours. */
  mttrHours: number | null;
  /** Share of jobs that were planned rather than reactive — the health signal. */
  plannedRatio: number;
  openJobs: number;
  overdueOpen: number;
};

export function reliability(wos: WoLite[], windowDays: number, now = new Date()): Reliability {
  const breakdowns = wos.filter((w) => w.type === "BREAKDOWN");
  const pm = wos.filter((w) => w.type === "PM");
  const repairs = wos.filter((w) => w.type === "REPAIR");
  const open = wos.filter((w) => w.status === "Open" || w.status === "In-Progress");

  const completed = breakdowns.filter((w) => w.completedAt);
  const mttr = completed.length
    ? completed.reduce((s, w) => s + (w.completedAt!.getTime() - w.reportedAt.getTime()) / 3.6e6, 0) / completed.length
    : null;

  // MTBF over the observation window: a fleet with no failures reports null
  // rather than a misleadingly infinite figure.
  const mtbf = breakdowns.length > 0 ? windowDays / breakdowns.length : null;

  const total = wos.length;
  return {
    breakdowns: breakdowns.length,
    pmJobs: pm.length,
    repairs: repairs.length,
    totalCost: wos.reduce((s, w) => s + w.totalCost, 0),
    breakdownCost: breakdowns.reduce((s, w) => s + w.totalCost, 0),
    downtimeHrs: wos.reduce((s, w) => s + w.downtimeHrs, 0),
    mtbfDays: mtbf,
    mttrHours: mttr,
    plannedRatio: total > 0 ? (pm.length / total) * 100 : 0,
    openJobs: open.length,
    overdueOpen: open.filter((w) => (now.getTime() - w.reportedAt.getTime()) / 86400000 > 7).length,
  };
}

export type ServiceTier = "SERVICE_A" | "SERVICE_B" | "SERVICE_C" | "SERVICE_D";

export type ServiceTierMeta = {
  tier: ServiceTier;
  code: string;
  name: string;
  badgeColor: string;
  description: string;
};

export const SERVICE_TIERS: Record<ServiceTier, ServiceTierMeta> = {
  SERVICE_A: { tier: "SERVICE_A", code: "SERVICE_A", name: "Service A (250h / 10k km)", badgeColor: "bg-blue-100 text-blue-800 ring-blue-600/20", description: "Minor Lube & Engine Oil Change" },
  SERVICE_B: { tier: "SERVICE_B", code: "SERVICE_B", name: "Service B (500h / 20k km)", badgeColor: "bg-indigo-100 text-indigo-800 ring-indigo-600/20", description: "Intermediate Filters & Belts Check" },
  SERVICE_C: { tier: "SERVICE_C", code: "SERVICE_C", name: "Service C (1000h / 40k km)", badgeColor: "bg-amber-100 text-amber-800 ring-amber-600/20", description: "Major Hydraulics & Valve Clearance" },
  SERVICE_D: { tier: "SERVICE_D", code: "SERVICE_D", name: "Service D (2000h / 80k km)", badgeColor: "bg-purple-100 text-purple-800 ring-purple-600/20", description: "Full Overhaul & System Flush" },
};

export type PmKitItem = {
  description: string;
  partNo: string;
  qty: number;
  rate: number;
  kind: "PART" | "LABOUR" | "OUTSIDE";
};

export const PM_PARTS_KITS: Record<string, PmKitItem[]> = {
  "Engine oil & filter change": [
    { description: "Engine Oil 15W-40 (Heavy Duty)", partNo: "OIL-15W40-20L", qty: 1, rate: 4800, kind: "PART" },
    { description: "Spin-on Engine Oil Filter", partNo: "FLT-OIL-012", qty: 1, rate: 1200, kind: "PART" },
    { description: "Standard Service Labour", partNo: "LBR-STD-PM", qty: 2, rate: 1000, kind: "LABOUR" },
  ],
  "Brake inspection & adjustment": [
    { description: "Heavy Duty Brake Lining Set", partNo: "BRK-LNS-901", qty: 1, rate: 3500, kind: "PART" },
    { description: "Brake Fluid DOT4 1L", partNo: "FLD-BRK-DOT4", qty: 1, rate: 450, kind: "PART" },
    { description: "Mechanic Labour - Brakes", partNo: "LBR-BRK-ADJ", qty: 1.5, rate: 700, kind: "LABOUR" },
  ],
  "Hydraulic system service": [
    { description: "Hydraulic Oil ISO VG 68 20L", partNo: "OIL-HYD-VG68", qty: 2, rate: 5200, kind: "PART" },
    { description: "Hydraulic Return Line Filter", partNo: "FLT-HYD-RET", qty: 1, rate: 2800, kind: "PART" },
    { description: "Suction Strainer Screen", partNo: "FLT-HYD-SUC", qty: 1, rate: 1500, kind: "PART" },
    { description: "Hydraulic Specialist Labour", partNo: "LBR-HYD-SPEC", qty: 3, rate: 900, kind: "LABOUR" },
  ],
  "Undercarriage inspection": [
    { description: "Track Pin & Bush Lube", partNo: "LUB-TRK-P1", qty: 2, rate: 800, kind: "PART" },
    { description: "Track Tension Bolt Washers", partNo: "HRD-TRK-WSH", qty: 4, rate: 250, kind: "PART" },
    { description: "Undercarriage Specialist Tech", partNo: "LBR-UC-INSP", qty: 2, rate: 1200, kind: "LABOUR" },
  ],
  "Drum & chute service": [
    { description: "Mixer Gearbox Synthetic Oil 5L", partNo: "OIL-GBX-SYN", qty: 1, rate: 3200, kind: "PART" },
    { description: "Chute Roller Seal Kit", partNo: "KIT-CHT-SEAL", qty: 1, rate: 1800, kind: "PART" },
    { description: "Welding & Liner Labour", partNo: "LBR-WLD-DRM", qty: 4, rate: 850, kind: "LABOUR" },
  ],
};

export type FailureCode = {
  code: string;
  label: string;
  category: "HYDRAULIC" | "ENGINE" | "FUEL" | "ELECTRICAL" | "OPERATOR" | "WEAR" | "TYRE" | "BRAKE";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
};

export const FAILURE_CODES: FailureCode[] = [
  { code: "HYDRAULIC_HOSE_BURST", label: "Hydraulic Hose Burst / Pressure Leak", category: "HYDRAULIC", severity: "CRITICAL" },
  { code: "ENGINE_OVERHEATING", label: "Engine Overheating / Radiator Clogged", category: "ENGINE", severity: "CRITICAL" },
  { code: "FUEL_CONTAMINATION", label: "Fuel Contamination / Water in Diesel", category: "FUEL", severity: "HIGH" },
  { code: "ELECTRICAL_SHORT", label: "Electrical Short Circuit / Alternator Failure", category: "ELECTRICAL", severity: "HIGH" },
  { code: "OPERATOR_MISUSE", label: "Operator Rough Handling / Overload Impact", category: "OPERATOR", severity: "HIGH" },
  { code: "NORMAL_WEAR", label: "Normal Component Wear & End-of-Life", category: "WEAR", severity: "MEDIUM" },
  { code: "BRAKE_FAIL", label: "Brake Line Pressure Loss / Pad Exhaustion", category: "BRAKE", severity: "CRITICAL" },
  { code: "TYRE_PUNCTURE", label: "Tyre Sidewall Cut / Debris Puncture", category: "TYRE", severity: "MEDIUM" },
];

/** Default PM tasks per class, so the module ships usable. */
export const DEFAULT_PM_TASKS: { assetClass: string; taskName: string; serviceTier: ServiceTier; intervalKm: number; intervalHours: number; intervalDays: number; estimatedCost: number }[] = [
  { assetClass: "TIPPER", taskName: "Engine oil & filter change", serviceTier: "SERVICE_A", intervalKm: 10000, intervalHours: 0, intervalDays: 90, estimatedCost: 8000 },
  { assetClass: "TIPPER", taskName: "Brake inspection & adjustment", serviceTier: "SERVICE_B", intervalKm: 20000, intervalHours: 0, intervalDays: 180, estimatedCost: 5000 },
  { assetClass: "DUMPER", taskName: "Engine oil & filter change", serviceTier: "SERVICE_A", intervalKm: 10000, intervalHours: 0, intervalDays: 90, estimatedCost: 9000 },
  { assetClass: "DUMPER", taskName: "Hydraulic system service", serviceTier: "SERVICE_C", intervalKm: 30000, intervalHours: 0, intervalDays: 365, estimatedCost: 15000 },
  { assetClass: "TRUCK", taskName: "Engine oil & filter change", serviceTier: "SERVICE_A", intervalKm: 12000, intervalHours: 0, intervalDays: 90, estimatedCost: 7000 },
  { assetClass: "EXCAVATOR", taskName: "Engine oil & filter change", serviceTier: "SERVICE_A", intervalKm: 0, intervalHours: 250, intervalDays: 90, estimatedCost: 12000 },
  { assetClass: "EXCAVATOR", taskName: "Hydraulic oil & filter", serviceTier: "SERVICE_C", intervalKm: 0, intervalHours: 1000, intervalDays: 365, estimatedCost: 35000 },
  { assetClass: "EXCAVATOR", taskName: "Undercarriage inspection", serviceTier: "SERVICE_B", intervalKm: 0, intervalHours: 500, intervalDays: 180, estimatedCost: 6000 },
  { assetClass: "BACKHOE", taskName: "Engine oil & filter change", serviceTier: "SERVICE_A", intervalKm: 0, intervalHours: 250, intervalDays: 90, estimatedCost: 9000 },
  { assetClass: "GRADER", taskName: "Engine oil & filter change", serviceTier: "SERVICE_A", intervalKm: 0, intervalHours: 250, intervalDays: 90, estimatedCost: 11000 },
  { assetClass: "ROLLER", taskName: "Engine oil & filter change", serviceTier: "SERVICE_A", intervalKm: 0, intervalHours: 250, intervalDays: 90, estimatedCost: 8000 },
  { assetClass: "CRANE", taskName: "Wire rope & hook inspection", serviceTier: "SERVICE_B", intervalKm: 0, intervalHours: 500, intervalDays: 180, estimatedCost: 10000 },
  { assetClass: "TRANSIT_MIXER", taskName: "Drum & chute service", serviceTier: "SERVICE_B", intervalKm: 15000, intervalHours: 0, intervalDays: 120, estimatedCost: 9000 },
];

