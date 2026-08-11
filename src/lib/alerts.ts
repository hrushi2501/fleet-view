// M18 — Alert & notification engine.
//
// Fifteen modules can each detect something worth telling somebody about. Left
// alone that becomes noise, and an alert nobody can turn down is an alert
// everybody ignores. So:
//
//   - rules are data, with thresholds the client can tune and a switch to quiet them
//   - every alert carries a stable dedupeKey, so a repeat sweep updates rather
//     than posting the same thing again tomorrow
//   - unacknowledged alerts escalate on a clock, because the ones that matter
//     are precisely the ones nobody wanted to deal with

export type Severity = "Info" | "Warning" | "Critical";

export type AlertRuleLite = {
  code: string;
  enabled: boolean;
  threshold: number;
  severity: string;
  escalateAfterHours: number;
  channels: string;
};

export type Candidate = {
  dedupeKey: string;
  ruleCode: string;
  category: string;
  severity: Severity;
  title: string;
  message: string;
  assetId?: string | null;
  driverId?: string | null;
  dueDate?: Date | null;
  actionUrl?: string | null;
};

export const DEFAULT_ALERT_RULES = [
  { code: "DOC_EXPIRING", name: "Document expiring", category: "Compliance", severity: "Warning", threshold: 30, thresholdUnit: "days notice",
    description: "A statutory document is approaching expiry.", escalateAfterHours: 48, escalateToRole: "FleetManager" },
  { code: "DOC_EXPIRED", name: "Document expired", category: "Compliance", severity: "Critical", threshold: 0, thresholdUnit: "",
    description: "A machine is operating with an expired statutory document.", escalateAfterHours: 12, escalateToRole: "Admin" },
  { code: "LICENCE_EXPIRING", name: "Driving licence expiring", category: "Driver", severity: "Warning", threshold: 30, thresholdUnit: "days notice",
    description: "A driver's licence is approaching expiry.", escalateAfterHours: 48, escalateToRole: "FleetManager" },
  { code: "PM_OVERDUE", name: "Service overdue", category: "Maintenance", severity: "Critical", threshold: 0, thresholdUnit: "",
    description: "A preventive service has passed its interval.", escalateAfterHours: 24, escalateToRole: "Workshop" },
  { code: "TANK_LOW", name: "Diesel tank below reorder", category: "Fuel", severity: "Warning", threshold: 0, thresholdUnit: "",
    description: "A site tank has dropped below its reorder level.", escalateAfterHours: 24, escalateToRole: "SiteManager" },
  { code: "FUEL_ANOMALY_OPEN", name: "Unresolved fuel anomaly", category: "Fuel", severity: "Critical", threshold: 100, thresholdUnit: "litres",
    description: "A significant fuel gap is still open.", escalateAfterHours: 24, escalateToRole: "Admin" },
  { code: "TYRE_UNSAFE", name: "Tyre below legal tread", category: "Maintenance", severity: "Critical", threshold: 1.6, thresholdUnit: "mm",
    description: "A fitted tyre is at or below the legal minimum tread.", escalateAfterHours: 12, escalateToRole: "Workshop" },
  { code: "ALLOC_CONFLICT", name: "Machine double-booked", category: "Operations", severity: "Warning", threshold: 0, thresholdUnit: "",
    description: "A machine is committed to two projects over the same dates.", escalateAfterHours: 48, escalateToRole: "FleetManager" },
  { code: "MOB_STALE", name: "Mobilisation not dispatched", category: "Operations", severity: "Warning", threshold: 7, thresholdUnit: "days",
    description: "A requested machine move has not left.", escalateAfterHours: 72, escalateToRole: "FleetManager" },
  { code: "CASE_AGEING", name: "Loss-prevention case ageing", category: "Loss", severity: "Warning", threshold: 14, thresholdUnit: "days",
    description: "An open case has had no disposition for too long.", escalateAfterHours: 72, escalateToRole: "Admin" },
] as const;

const on = (rules: AlertRuleLite[], code: string) => rules.find((r) => r.code === code)?.enabled !== false;
const thr = (rules: AlertRuleLite[], code: string, fallback: number) => rules.find((r) => r.code === code)?.threshold ?? fallback;
const sev = (rules: AlertRuleLite[], code: string, fallback: Severity): Severity =>
  (rules.find((r) => r.code === code)?.severity as Severity) ?? fallback;

/* ---------------------------------- inputs ---------------------------------- */

export type SweepInput = {
  rules: AlertRuleLite[];
  docs: { id: string; assetId: string; assetCode: string; docType: string; expiryDate: Date }[];
  drivers: { id: string; name: string; licenseExpiry: Date; status: string }[];
  pmDue: { scheduleId: string; assetId: string; assetCode: string; taskName: string; overdue: boolean }[];
  tanks: { id: string; name: string; currentLevel: number; minLevel: number }[];
  fuelAnomalies: { id: string; litres: number; status: string; reasons: string }[];
  tyres: { id: string; serialNo: string; assetId: string | null; assetCode: string | null; treadMm: number }[];
  allocConflicts: { assetId: string; assetCode: string; message: string }[];
  staleMobs: { id: string; assetId: string; assetCode: string; days: number }[];
  ageingCases: { id: string; caseNo: string; title: string; days: number }[];
};

/**
 * Sweep every module for conditions worth an alert. Pure — the caller owns all
 * database access, which keeps this testable and cheap to re-run.
 */
export function sweepAlerts(input: SweepInput, now = new Date()): Candidate[] {
  const { rules } = input;
  const out: Candidate[] = [];
  const days = (d: Date) => Math.floor((d.getTime() - now.getTime()) / 86400000);

  for (const d of input.docs) {
    const left = days(d.expiryDate);
    if (left < 0 && on(rules, "DOC_EXPIRED")) {
      out.push({
        dedupeKey: `DOC_EXPIRED:${d.id}`, ruleCode: "DOC_EXPIRED", category: "Compliance",
        severity: sev(rules, "DOC_EXPIRED", "Critical"),
        title: `${d.docType} expired — ${d.assetCode}`,
        message: `${d.docType} expired ${Math.abs(left)} days ago. The machine is not legal to operate.`,
        assetId: d.assetId, dueDate: d.expiryDate, actionUrl: "/compliance/audit",
      });
    } else if (left >= 0 && left <= thr(rules, "DOC_EXPIRING", 30) && on(rules, "DOC_EXPIRING")) {
      out.push({
        dedupeKey: `DOC_EXPIRING:${d.id}`, ruleCode: "DOC_EXPIRING", category: "Compliance",
        severity: sev(rules, "DOC_EXPIRING", "Warning"),
        title: `${d.docType} expiring — ${d.assetCode}`,
        message: `${d.docType} expires in ${left} days. Renew before it lapses.`,
        assetId: d.assetId, dueDate: d.expiryDate, actionUrl: "/compliance/audit",
      });
    }
  }

  if (on(rules, "LICENCE_EXPIRING")) {
    for (const dr of input.drivers) {
      if (dr.status !== "Active") continue;
      const left = days(dr.licenseExpiry);
      if (left <= thr(rules, "LICENCE_EXPIRING", 30)) {
        out.push({
          dedupeKey: `LICENCE:${dr.id}`, ruleCode: "LICENCE_EXPIRING", category: "Driver",
          severity: left < 0 ? "Critical" : sev(rules, "LICENCE_EXPIRING", "Warning"),
          title: left < 0 ? `Licence expired — ${dr.name}` : `Licence expiring — ${dr.name}`,
          message: left < 0
            ? `Licence expired ${Math.abs(left)} days ago. This driver must not be assigned.`
            : `Licence expires in ${left} days.`,
          driverId: dr.id, dueDate: dr.licenseExpiry, actionUrl: "/drivers/safety",
        });
      }
    }
  }

  if (on(rules, "PM_OVERDUE")) {
    for (const p of input.pmDue.filter((x) => x.overdue)) {
      out.push({
        dedupeKey: `PM:${p.scheduleId}`, ruleCode: "PM_OVERDUE", category: "Maintenance",
        severity: sev(rules, "PM_OVERDUE", "Critical"),
        title: `Service overdue — ${p.assetCode}`,
        message: `${p.taskName} has passed its interval.`,
        assetId: p.assetId, actionUrl: "/maintenance?tab=preventive",
      });
    }
  }

  if (on(rules, "TANK_LOW")) {
    for (const t of input.tanks) {
      if (t.minLevel > 0 && t.currentLevel < t.minLevel) {
        out.push({
          dedupeKey: `TANK:${t.id}`, ruleCode: "TANK_LOW", category: "Fuel",
          severity: sev(rules, "TANK_LOW", "Warning"),
          title: `Diesel low — ${t.name}`,
          message: `${Math.round(t.currentLevel)} L against a reorder level of ${Math.round(t.minLevel)} L.`,
          actionUrl: "/fuel/tanks",
        });
      }
    }
  }

  if (on(rules, "FUEL_ANOMALY_OPEN")) {
    const min = thr(rules, "FUEL_ANOMALY_OPEN", 100);
    for (const a of input.fuelAnomalies) {
      if (a.status !== "OPEN" && a.status !== "INVESTIGATING") continue;
      if (a.litres < min) continue;
      out.push({
        dedupeKey: `FUELANOM:${a.id}`, ruleCode: "FUEL_ANOMALY_OPEN", category: "Fuel",
        severity: sev(rules, "FUEL_ANOMALY_OPEN", "Critical"),
        title: `${Math.round(a.litres)} L unaccounted for`,
        message: a.reasons.split("\n")[0] ?? "Fuel gap still open.",
        actionUrl: "/fuel/anomalies",
      });
    }
  }

  if (on(rules, "TYRE_UNSAFE")) {
    const legal = thr(rules, "TYRE_UNSAFE", 1.6);
    for (const t of input.tyres) {
      if (t.treadMm > legal) continue;
      out.push({
        dedupeKey: `TYRE:${t.id}`, ruleCode: "TYRE_UNSAFE", category: "Maintenance",
        severity: sev(rules, "TYRE_UNSAFE", "Critical"),
        title: `Tyre below legal tread — ${t.assetCode ?? t.serialNo}`,
        message: `Tyre ${t.serialNo} at ${t.treadMm} mm, legal minimum ${legal} mm. Not roadworthy.`,
        assetId: t.assetId, actionUrl: "/tyres",
      });
    }
  }

  if (on(rules, "ALLOC_CONFLICT")) {
    for (const c of input.allocConflicts) {
      out.push({
        dedupeKey: `ALLOC:${c.assetId}`, ruleCode: "ALLOC_CONFLICT", category: "Operations",
        severity: sev(rules, "ALLOC_CONFLICT", "Warning"),
        title: `Double-booked — ${c.assetCode}`,
        message: c.message, assetId: c.assetId, actionUrl: "/operations",
      });
    }
  }

  if (on(rules, "MOB_STALE")) {
    const min = thr(rules, "MOB_STALE", 7);
    for (const m of input.staleMobs) {
      if (m.days < min) continue;
      out.push({
        dedupeKey: `MOB:${m.id}`, ruleCode: "MOB_STALE", category: "Operations",
        severity: sev(rules, "MOB_STALE", "Warning"),
        title: `Move not dispatched — ${m.assetCode}`,
        message: `Requested ${Math.round(m.days)} days ago and still not on the road.`,
        assetId: m.assetId, actionUrl: "/operations",
      });
    }
  }

  if (on(rules, "CASE_AGEING")) {
    const min = thr(rules, "CASE_AGEING", 14);
    for (const c of input.ageingCases) {
      if (c.days < min) continue;
      out.push({
        dedupeKey: `CASE:${c.id}`, ruleCode: "CASE_AGEING", category: "Loss",
        severity: sev(rules, "CASE_AGEING", "Warning"),
        title: `Case open ${Math.round(c.days)} days — ${c.caseNo}`,
        message: c.title, actionUrl: `/loss-prevention/${c.id}`,
      });
    }
  }

  const order: Record<Severity, number> = { Critical: 0, Warning: 1, Info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/* -------------------------------- escalation -------------------------------- */

export type OpenAlert = { id: string; ruleCode: string | null; severity: string; createdAt: Date; status: string; escalatedAt: Date | null; title: string };

/** Alerts that have sat unacknowledged past their rule's patience. */
export function dueForEscalation(alerts: OpenAlert[], rules: AlertRuleLite[], now = new Date()): OpenAlert[] {
  return alerts.filter((a) => {
    if (a.status !== "Open") return false;
    if (a.escalatedAt) return false;
    const rule = rules.find((r) => r.code === a.ruleCode);
    const hours = rule?.escalateAfterHours ?? 24;
    return (now.getTime() - a.createdAt.getTime()) / 3.6e6 > hours;
  });
}

export type AlertStats = {
  open: number;
  critical: number;
  acknowledged: number;
  resolved: number;
  escalated: number;
  avgAckHours: number | null;
  byCategory: { category: string; count: number }[];
};

export function alertStats(
  alerts: { category: string; severity: string; status: string; createdAt: Date; acknowledgedAt: Date | null; escalatedAt: Date | null }[]
): AlertStats {
  const open = alerts.filter((a) => a.status === "Open");
  const acked = alerts.filter((a) => a.acknowledgedAt);
  const cats = new Map<string, number>();
  for (const a of alerts.filter((x) => x.status === "Open")) cats.set(a.category, (cats.get(a.category) ?? 0) + 1);

  return {
    open: open.length,
    critical: open.filter((a) => a.severity === "Critical").length,
    acknowledged: alerts.filter((a) => a.status === "Acknowledged").length,
    resolved: alerts.filter((a) => a.status === "Resolved").length,
    escalated: alerts.filter((a) => a.escalatedAt).length,
    avgAckHours: acked.length
      ? acked.reduce((s, a) => s + (a.acknowledgedAt!.getTime() - a.createdAt.getTime()) / 3.6e6, 0) / acked.length
      : null,
    byCategory: [...cats.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
  };
}
