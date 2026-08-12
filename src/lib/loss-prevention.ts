// M6 — Loss prevention & fraud controls.
//
// M5 and M8 each detect problems inside their own domain. M6 is the layer above:
// it pulls signals from every module into one scored queue, tracks each one as a
// case through to a rupee recovered, and builds repeat-offender profiles that no
// single module could see on its own.
//
// The scan is deliberately idempotent: every signal carries a stable `signalKey`,
// so re-running it updates existing cases instead of spawning duplicates.

import { businessDay } from "./business-time";
import { calendarDaysUntil } from "./utils";

export type Domain = "FUEL" | "HIRE" | "MAINTENANCE" | "METER" | "COMPLIANCE" | "TRIP";

export type Signal = {
  signalKey: string;
  ruleCode: string;
  domain: Domain;
  title: string;
  summary: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  score: number;
  amountAtRisk: number;
  assetId?: string | null;
  driverId?: string | null;
  vendor?: string | null;
  projectId?: string | null;
  evidence: { kind: string; refId?: string | null; label: string; detail?: string; url?: string | null }[];
};

/** Rules shipped by default. Thresholds are editable by the client at runtime. */
export const DEFAULT_RULES = [
  { code: "FUEL_TANK_GAP", name: "Unaccounted tank fuel", domain: "FUEL", severity: "HIGH", threshold: 25, thresholdUnit: "litres",
    description: "Physical dip disagrees with the book balance beyond tolerance — fuel has left the tank without a record." },
  { code: "FUEL_SHORT_DELIVERY", name: "Short delivery from supplier", domain: "FUEL", severity: "HIGH", threshold: 50, thresholdUnit: "litres",
    description: "Supplier invoiced more litres than were actually dipped into the tank." },
  { code: "FUEL_EFFICIENCY_DROP", name: "Abnormal fuel burn", domain: "FUEL", severity: "MEDIUM", threshold: 30, thresholdUnit: "% off norm",
    description: "An asset is consuming well outside its consumption norm for the work it did." },
  { code: "HIRE_OVERBILL", name: "Vendor overbilling", domain: "HIRE", severity: "HIGH", threshold: 5000, thresholdUnit: "₹",
    description: "A hire invoice claims more days, hours or kilometres than the site logs support." },
  { code: "HIRE_NO_CONTRACT", name: "Hired asset without contract", domain: "HIRE", severity: "MEDIUM", threshold: 0, thresholdUnit: "",
    description: "A hired or contractor asset is in use with no active contract, so its invoices cannot be validated." },
  { code: "HIRE_UNVERIFIABLE", name: "Invoice with no site logs", domain: "HIRE", severity: "MEDIUM", threshold: 0, thresholdUnit: "",
    description: "A vendor invoice covers a period with no day logs at all — nothing to verify it against." },
  { code: "METER_ROLLBACK", name: "Odometer / hour-meter rollback", domain: "METER", severity: "HIGH", threshold: 0, thresholdUnit: "",
    description: "A meter reading went backwards between fuel entries — tampering or a falsified reading." },
  { code: "FUEL_NO_EVIDENCE", name: "Fuel issued without evidence", domain: "FUEL", severity: "LOW", threshold: 0, thresholdUnit: "",
    description: "Diesel was booked against an asset with no odometer or pump photo to support it." },
  { code: "COMPLIANCE_EXPIRED_RUNNING", name: "Expired document, asset still active", domain: "COMPLIANCE", severity: "HIGH", threshold: 0, thresholdUnit: "",
    description: "An asset with an expired statutory document is still shown as operating — a legal and financial exposure." },
] as const;

export type RuleLite = { code: string; enabled: boolean; threshold: number; severity: string; autoCase: boolean };

const ruleOf = (rules: RuleLite[], code: string) => rules.find((r) => r.code === code);
const on = (rules: RuleLite[], code: string) => ruleOf(rules, code)?.enabled !== false;
const thr = (rules: RuleLite[], code: string, fallback: number) => ruleOf(rules, code)?.threshold ?? fallback;

/* --------------------------------- inputs --------------------------------- */

export type ScanInput = {
  rules: RuleLite[];
  dieselRate: number;
  fuelAnomalies: { id: string; source: string; severity: string; score: number; litres: number; valueAtRisk: number; reasons: string; status: string; tankId: string | null; assetId: string | null }[];
  uncontractedHired: { id: string; code: string; name: string; registrationNo: string | null }[];
  meterRollbacks: { assetId: string; assetCode: string; txnId: string; from: number; to: number; date: Date }[];
  noEvidenceFuel: { assetId: string | null; assetCode: string; count: number; litres: number; amount: number }[];
  expiredRunning: { assetId: string; assetCode: string; docType: string; expiry: Date }[];
};

/* --------------------------------- scanning --------------------------------- */

/**
 * Turn everything the other modules know into a single list of scored signals.
 * Pure function — the caller owns all database access, which keeps this testable.
 */
export function scanSignals(input: ScanInput, now: Date = new Date()): Signal[] {
  const { rules, dieselRate } = input;
  const out: Signal[] = [];

  // --- FUEL: tank gaps and short deliveries already scored by M5 ---
  if (on(rules, "FUEL_TANK_GAP") || on(rules, "FUEL_SHORT_DELIVERY")) {
    for (const a of input.fuelAnomalies) {
      if (a.status === "FALSE_POSITIVE" || a.status === "CLOSED") continue;
      const code = a.source === "RECEIPT" ? "FUEL_SHORT_DELIVERY" : "FUEL_TANK_GAP";
      if (!on(rules, code)) continue;
      if (a.litres < thr(rules, code, 25)) continue;

      out.push({
        signalKey: `FUEL_ANOMALY:${a.id}`,
        ruleCode: code,
        domain: "FUEL",
        title: code === "FUEL_SHORT_DELIVERY" ? `Short delivery — ${a.litres.toFixed(0)} L not received` : `Unaccounted fuel — ${a.litres.toFixed(0)} L`,
        summary: a.reasons,
        severity: (a.severity as Signal["severity"]) ?? "MEDIUM",
        score: a.score,
        amountAtRisk: a.valueAtRisk || a.litres * dieselRate,
        assetId: a.assetId,
        evidence: [{ kind: "FUEL_ANOMALY", refId: a.id, label: "Fuel anomaly record", detail: a.reasons }],
      });
    }
  }

  // --- HIRE: assets running with no contract at all ---
  if (on(rules, "HIRE_NO_CONTRACT")) {
    for (const a of input.uncontractedHired) {
      out.push({
        signalKey: `HIRE_NO_CONTRACT:${a.id}`,
        ruleCode: "HIRE_NO_CONTRACT",
        domain: "HIRE",
        title: `No hire contract — ${a.code}`,
        summary: `${a.code} (${a.registrationNo ?? a.name}) is a hired asset with no active contract, so any invoice for it has to be taken on trust.`,
        severity: "MEDIUM",
        score: 40,
        amountAtRisk: 0,
        assetId: a.id,
        evidence: [{ kind: "NOTE", refId: a.id, label: "Hired asset without an active contract" }],
      });
    }
  }

  // --- METER: rollbacks are near-always deliberate ---
  if (on(rules, "METER_ROLLBACK")) {
    for (const m of input.meterRollbacks) {
      const drop = m.from - m.to;
      out.push({
        signalKey: `METER_ROLLBACK:${m.txnId}`,
        ruleCode: "METER_ROLLBACK",
        domain: "METER",
        title: `Meter rollback — ${m.assetCode} (−${drop.toFixed(0)})`,
        summary: `Reading fell from ${m.from.toFixed(0)} to ${m.to.toFixed(0)} between fuel entries. A meter cannot go backwards on its own.`,
        severity: "HIGH",
        score: 80,
        amountAtRisk: 0,
        assetId: m.assetId,
        evidence: [{ kind: "FUEL_TXN", refId: m.txnId, label: `Fuel entry with reading ${m.to.toFixed(0)}`, detail: `Previous reading ${m.from.toFixed(0)}` }],
      });
    }
  }

  // --- FUEL: issues with no photo evidence at all ---
  if (on(rules, "FUEL_NO_EVIDENCE")) {
    for (const e of input.noEvidenceFuel) {
      if (e.count < 3) continue; // one-off misses are noise; a pattern is not
      out.push({
        signalKey: `FUEL_NO_EVIDENCE:${e.assetId ?? e.assetCode}`,
        ruleCode: "FUEL_NO_EVIDENCE",
        domain: "FUEL",
        title: `${e.count} fuel entries without photos — ${e.assetCode}`,
        summary: `${e.count} issues totalling ${e.litres.toFixed(0)} L (₹${Math.round(e.amount).toLocaleString("en-IN")}) were booked with neither an odometer nor a pump photo.`,
        severity: "LOW",
        score: Math.min(60, 20 + e.count * 3),
        amountAtRisk: e.amount,
        assetId: e.assetId,
        evidence: [{ kind: "NOTE", label: `${e.count} unevidenced fuel issues`, detail: `${e.litres.toFixed(0)} L` }],
      });
    }
  }

  // --- COMPLIANCE: expired paper on a working machine ---
  if (on(rules, "COMPLIANCE_EXPIRED_RUNNING")) {
    for (const c of input.expiredRunning) {
      // Whole IST calendar days, and the expiry date printed in the calendar the
      // RTO and the insurer use. This text is quoted in a fraud case file.
      const daysOver = -calendarDaysUntil(c.expiry, now);
      if (daysOver <= 0) continue; // valid through its expiry date — not a finding yet
      const expiredOn = businessDay(c.expiry);
      out.push({
        signalKey: `COMPLIANCE_EXPIRED:${c.assetId}:${c.docType}`,
        ruleCode: "COMPLIANCE_EXPIRED_RUNNING",
        domain: "COMPLIANCE",
        title: `${c.docType} expired ${daysOver}d — ${c.assetCode} still active`,
        summary: `${c.assetCode} is operating with ${c.docType} expired since ${expiredOn}. Exposure to seizure, fines and a void insurance claim.`,
        severity: "HIGH",
        score: Math.min(100, 50 + Math.floor(daysOver / 3)),
        amountAtRisk: 0,
        assetId: c.assetId,
        evidence: [{ kind: "NOTE", label: `${c.docType} expired`, detail: `Expiry ${expiredOn}, ${daysOver} days overdue` }],
      });
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

/* ------------------------------ offender profiles ------------------------------ */

export type Offender = {
  key: string;
  kind: "VENDOR" | "ASSET" | "DRIVER";
  label: string;
  cases: number;
  openCases: number;
  atRisk: number;
  recovered: number;
  topDomain: string;
};

export type CaseLite = {
  domain: string;
  status: string;
  amountAtRisk: number;
  amountRecovered: number;
  vendor: string | null;
  assetId: string | null;
  driverId: string | null;
};

/**
 * Aggregate cases by the party they're against. A vendor with one dispute is
 * noise; the same vendor across five machines is a pattern worth acting on.
 */
export function offenderProfiles(
  cases: CaseLite[],
  assetLabel: (id: string) => string,
  driverLabel: (id: string) => string
): Offender[] {
  const map = new Map<string, Offender>();

  const bump = (key: string, kind: Offender["kind"], label: string, c: CaseLite) => {
    const cur = map.get(key) ?? { key, kind, label, cases: 0, openCases: 0, atRisk: 0, recovered: 0, topDomain: c.domain };
    cur.cases++;
    if (c.status === "OPEN" || c.status === "INVESTIGATING" || c.status === "PENDING_APPROVAL") cur.openCases++;
    cur.atRisk += c.amountAtRisk;
    cur.recovered += c.amountRecovered;
    map.set(key, cur);
  };

  for (const c of cases) {
    if (c.status === "FALSE_POSITIVE") continue;
    if (c.vendor) bump(`V:${c.vendor}`, "VENDOR", c.vendor, c);
    if (c.assetId) bump(`A:${c.assetId}`, "ASSET", assetLabel(c.assetId), c);
    if (c.driverId) bump(`D:${c.driverId}`, "DRIVER", driverLabel(c.driverId), c);
  }

  return [...map.values()].filter((o) => o.cases > 1).sort((a, b) => b.atRisk - a.atRisk || b.cases - a.cases);
}

/* -------------------------------- scorecard -------------------------------- */

export type Scorecard = {
  totalCases: number;
  openCases: number;
  atRisk: number;
  recovered: number;
  writtenOff: number;
  falsePositives: number;
  /** Null with no cases on the books — there is no denominator to be a share of. */
  falsePositiveRate: number | null;
  /** Null when nothing has been pursued. 0% recovery of nothing is not a failure to recover. */
  recoveryRate: number | null;
  /** Null until at least one case has actually been closed. */
  avgDaysToResolve: number | null;
  byDomain: { domain: string; cases: number; atRisk: number; recovered: number }[];
};

export function scorecard(
  cases: { domain: string; status: string; amountAtRisk: number; amountRecovered: number; openedAt: Date; closedAt: Date | null }[]
): Scorecard {
  const total = cases.length;
  const openStatuses = ["OPEN", "INVESTIGATING", "PENDING_APPROVAL"];
  const open = cases.filter((c) => openStatuses.includes(c.status));
  const fp = cases.filter((c) => c.status === "FALSE_POSITIVE");
  const wo = cases.filter((c) => c.status === "WRITTEN_OFF");

  // Only count exposure that is still live; a recovered case is no longer "at risk".
  const atRisk = open.reduce((s, c) => s + c.amountAtRisk, 0);
  const recovered = cases.reduce((s, c) => s + c.amountRecovered, 0);
  const writtenOff = wo.reduce((s, c) => s + c.amountAtRisk, 0);

  // "Avg time to resolve: 0.0d" is the headline the loss-prevention dashboard
  // prints when not one case has ever been closed. It reads as same-day
  // resolution — the best possible number — for the worst possible situation.
  // A case cannot close before it opened either; such a row is a bad date.
  const resolutionDays = cases
    .filter((c) => c.closedAt)
    .map((c) => (c.closedAt!.getTime() - c.openedAt.getTime()) / 86400000)
    .filter((d) => d >= 0);
  const avgDays = resolutionDays.length
    ? resolutionDays.reduce((s, d) => s + d, 0) / resolutionDays.length
    : null;

  // Recovery rate is measured against what was actually pursued (excludes false positives).
  const pursued = cases.filter((c) => c.status !== "FALSE_POSITIVE").reduce((s, c) => s + c.amountAtRisk, 0);

  const domains = new Map<string, { domain: string; cases: number; atRisk: number; recovered: number }>();
  for (const c of cases) {
    const d = domains.get(c.domain) ?? { domain: c.domain, cases: 0, atRisk: 0, recovered: 0 };
    d.cases++;
    d.atRisk += c.amountAtRisk;
    d.recovered += c.amountRecovered;
    domains.set(c.domain, d);
  }

  return {
    totalCases: total,
    openCases: open.length,
    atRisk,
    recovered,
    writtenOff,
    falsePositives: fp.length,
    falsePositiveRate: total > 0 ? (fp.length / total) * 100 : null,
    recoveryRate: pursued > 0 ? (recovered / pursued) * 100 : null,
    avgDaysToResolve: avgDays,
    byDomain: [...domains.values()].sort((a, b) => b.atRisk - a.atRisk),
  };
}

/** Sequential, human-readable case number: FV-2026-0001 */
export function nextCaseNo(year: number, seq: number): string {
  return `FV-${year}-${String(seq + 1).padStart(4, "0")}`;
}
