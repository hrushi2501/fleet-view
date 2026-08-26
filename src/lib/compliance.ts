// M13 — Compliance & document management.
//
// The demo could list documents and colour the expired ones red. The gap it left
// is the dangerous one: a vehicle with **no PUC record at all** looks clean,
// because there is nothing on the screen to go red. Absence of evidence reads as
// compliance. This module treats a missing mandatory document as a finding in
// its own right, and answers one blunt question per machine — is it legal to
// send out today?

import { calendarDaysUntil } from "./utils";

export type DocLite = {
  id: string;
  docType: string;
  /// Null where the source register records expiry only — which is the common
  /// case. Neither field is read by the rules below; both are carried so a
  /// caller can render the document without a second query.
  number: string | null;
  issueDate: Date | null;
  expiryDate: Date;
  reminderDays: number;
  documentUrl: string | null;
};

export type DocState = "valid" | "expiring" | "expired" | "missing";

/** Documents a machine must hold to be legally operable in India. */
export const REQUIRED_DOCS: Record<string, string[]> = {
  VEHICLE: ["RC", "Insurance", "Fitness", "Permit", "PUC", "RoadTax"],
  // Yard equipment isn't road-registered; insurance is still expected.
  EQUIPMENT: ["Insurance"],
};

/**
 * Per-class overrides, because "VEHICLE" covers a tipper and a staff scooter and
 * the law does not ask the same of both.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A permit is a commercial-carriage document. Demanding one from a motorbike
 * produces a "missing mandatory document" that can never be satisfied, and a
 * machine permanently marked not-operable is one people learn to ignore — which
 * costs exactly the signal this module exists to give. The same goes for asking
 * a stationary asphalt plant for a pollution certificate: it has no engine, no
 * registration and no tailpipe.
 *
 * Anything not listed here falls back to its category, so the strict commercial
 * set stays the default for trucks.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const REQUIRED_DOCS_BY_CLASS: Record<string, string[]> = {
  // Fixed and towed plant. Insured, but never registered or driven.
  PLANT: ["Insurance"],
  CRUSHER: ["Insurance"],
  // Private and staff vehicles: registered and insured, pollution tested. No
  // commercial permit; fitness is not required for a private vehicle until it
  // is fifteen years old.
  BIKE: ["RC", "Insurance", "PUC"],
  CAR: ["RC", "Insurance", "PUC"],
  PICKUP: ["RC", "Insurance", "PUC"],
};

/** The documents this particular machine has to hold. */
export function requiredDocsFor(category: string, assetClass?: string | null): string[] {
  if (assetClass && REQUIRED_DOCS_BY_CLASS[assetClass]) return REQUIRED_DOCS_BY_CLASS[assetClass];
  return REQUIRED_DOCS[category] ?? REQUIRED_DOCS.VEHICLE;
}

/** Documents whose absence stops the machine, versus those that are advisory. */
export const BLOCKING_DOCS = new Set(["RC", "Insurance", "Fitness", "Permit", "PUC"]);

export const DOC_LABEL: Record<string, string> = {
  RC: "Registration (RC)", Insurance: "Insurance", Fitness: "Fitness Certificate",
  Permit: "Permit", PUC: "Pollution (PUC)", RoadTax: "Road Tax",
};

/**
 * A statutory document is valid *through* the whole of its expiry date. Counting
 * elapsed milliseconds instead of calendar days made every document read as
 * expired from the first minute of its final day, so machines were being marked
 * illegal to operate — and pulled off site — a day early.
 */
export function docState(expiry: Date, reminderDays = 30, now = new Date()): { state: DocState; days: number } {
  const days = calendarDaysUntil(expiry, now);
  if (days < 0) return { state: "expired", days };
  if (days <= reminderDays) return { state: "expiring", days };
  return { state: "valid", days };
}

export type DocFinding = {
  docType: string;
  state: DocState;
  days: number | null;
  doc: DocLite | null;
  blocking: boolean;
  message: string;
};

export type AssetCompliance = {
  assetId: string;
  /** Legal to operate right now — no blocking document expired or missing. */
  operable: boolean;
  findings: DocFinding[];
  expired: number;
  expiring: number;
  missing: number;
  /** 0–100; 100 means every required document present and in date. */
  score: number;
  worstDays: number | null;
};

/**
 * Assess one machine against the documents it is required to hold.
 * Only the latest document of each type counts — renewals supersede.
 */
export function assetCompliance(
  assetId: string,
  category: string,
  docs: DocLite[],
  now = new Date(),
  /** Optional, and it should be passed: it narrows the requirement to the class. */
  assetClass?: string | null
): AssetCompliance {
  const required = requiredDocsFor(category, assetClass);

  // Latest expiry per type wins; an old renewed copy shouldn't mark the asset expired.
  const latest = new Map<string, DocLite>();
  for (const d of docs) {
    const cur = latest.get(d.docType);
    if (!cur || d.expiryDate > cur.expiryDate) latest.set(d.docType, d);
  }

  const findings: DocFinding[] = [];

  for (const type of required) {
    const doc = latest.get(type) ?? null;
    const blocking = BLOCKING_DOCS.has(type);

    if (!doc) {
      findings.push({
        docType: type,
        state: "missing",
        days: null,
        doc: null,
        blocking,
        message: `No ${DOC_LABEL[type] ?? type} on record at all — it may exist on paper, but nothing here proves it.`,
      });
      continue;
    }

    const { state, days } = docState(doc.expiryDate, doc.reminderDays, now);
    findings.push({
      docType: type,
      state,
      days,
      doc,
      blocking,
      message:
        state === "expired"
          ? `${DOC_LABEL[type] ?? type} expired ${Math.abs(days)} days ago.`
          : state === "expiring"
            ? `${DOC_LABEL[type] ?? type} expires in ${days} days.`
            : `${DOC_LABEL[type] ?? type} valid for ${days} more days.`,
    });
  }

  // Documents held beyond the required list still get reported.
  for (const [type, doc] of latest) {
    if (required.includes(type)) continue;
    const { state, days } = docState(doc.expiryDate, doc.reminderDays, now);
    findings.push({
      docType: type,
      state,
      days,
      doc,
      blocking: false,
      message: state === "expired" ? `${type} expired ${Math.abs(days)} days ago.` : `${type} valid for ${days} more days.`,
    });
  }

  const expired = findings.filter((f) => f.state === "expired").length;
  const expiring = findings.filter((f) => f.state === "expiring").length;
  const missing = findings.filter((f) => f.state === "missing").length;

  const blockingProblems = findings.filter((f) => f.blocking && (f.state === "expired" || f.state === "missing"));
  const requiredCount = Math.max(1, required.length);
  // The score measures what the header promises: every required document held
  // and in date *today*. A certificate expiring in three weeks is still in
  // date, so counting only "valid" scored a fully legal machine at 0% during
  // its renewal window and dragged the fleet audit average down with it. The
  // approaching expiry is already reported as its own finding.
  const good = findings.filter(
    (f) => required.includes(f.docType) && (f.state === "valid" || f.state === "expiring")
  ).length;

  const dated = findings.filter((f) => f.days != null).map((f) => f.days!);

  return {
    assetId,
    operable: blockingProblems.length === 0,
    findings: findings.sort((a, b) => {
      const rank = (s: DocState) => (s === "expired" ? 0 : s === "missing" ? 1 : s === "expiring" ? 2 : 3);
      return rank(a.state) - rank(b.state);
    }),
    expired,
    expiring,
    missing,
    score: Math.round((good / requiredCount) * 100),
    worstDays: dated.length ? Math.min(...dated) : null,
  };
}

/** Renewal cost forecast for everything falling due inside `days`. */
export function renewalForecast(
  docs: { docType: string; expiryDate: Date; cost: number }[],
  days: number,
  now = new Date()
): { total: number; count: number; byType: { docType: string; count: number; cost: number }[] } {
  const cutoff = new Date(now.getTime() + days * 86400000);
  const due = docs.filter((d) => d.expiryDate <= cutoff);
  const byType = new Map<string, { docType: string; count: number; cost: number }>();
  for (const d of due) {
    const cur = byType.get(d.docType) ?? { docType: d.docType, count: 0, cost: 0 };
    cur.count++;
    cur.cost += d.cost;
    byType.set(d.docType, cur);
  }
  return {
    total: due.reduce((s, d) => s + d.cost, 0),
    count: due.length,
    byType: [...byType.values()].sort((a, b) => b.count - a.count),
  };
}
