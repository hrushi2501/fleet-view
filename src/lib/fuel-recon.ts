// M5 — Fuel reconciliation engine.
//
// The closed loop this module enforces:
//
//   source → tank → asset → work done
//
// Two independent reconciliations run over that chain:
//
//   1. TANK  : openingDip + receipts − issues = expectedClosing, compared to the
//              physical closing dip. The gap is unexplained fuel.
//   2. ASSET : litres issued vs litres the asset *should* have burnt for the
//              metered work it did (norm × km or engine-hours).
//
// Anything either side can't explain becomes a scored anomaly.

export type TankLite = { id: string; name: string; location: string; capacity: number; minLevel: number };
export type ReceiptLite = { id: string; date: Date; qtyInvoiced: number; qtyReceived: number; amount: number; supplier: string; shortfall: number };
export type DipLite = { id: string; date: Date; level: number };
export type IssueLite = { id: string; date: Date; quantity: number; assetId: string | null; amount: number };

/** Litres of variance below which we don't cry wolf — covers thermal expansion and dip-reading error. */
export const DIP_TOLERANCE_L = 25;
/** Fraction of throughput that is considered normal shrinkage (evaporation, meter drift). */
export const NORMAL_SHRINKAGE_PCT = 0.5;

export type TankRecon = {
  tank: TankLite;
  periodStart: Date;
  periodEnd: Date;
  openingDip: number;
  closingDip: number | null;
  receiptsL: number;
  issuesL: number;
  expectedClosing: number;
  varianceL: number;      // closingDip - expectedClosing (negative = fuel missing)
  variancePct: number;    // against throughput, not capacity
  throughput: number;
  status: "ok" | "watch" | "critical" | "insufficient";
  receipts: ReceiptLite[];
  issues: IssueLite[];
  shortDeliveryL: number; // invoiced but never received
  reasons: string[];
};

/**
 * Reconcile one tank between its first and last dip in the window.
 *
 * We deliberately anchor the period to *dips*, not calendar dates: a dip is the
 * only physical measurement in the chain, so a period without a closing dip
 * cannot be reconciled at all (status "insufficient") rather than being reported
 * as a false zero-variance.
 */
export function reconcileTank(
  tank: TankLite,
  receipts: ReceiptLite[],
  issues: IssueLite[],
  dips: DipLite[],
  from?: Date,
  to?: Date
): TankRecon {
  const inWin = <T extends { date: Date }>(rows: T[]) =>
    rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to)).sort((a, b) => a.date.getTime() - b.date.getTime());

  const d = inWin(dips);
  const opening = d[0] ?? null;
  const closing = d.length > 1 ? d[d.length - 1] : null;

  // Only count movements strictly between the two physical measurements.
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
    const missing = -varianceL; // positive when fuel is unaccounted for
    if (missing > DIP_TOLERANCE_L && Math.abs(variancePct) > NORMAL_SHRINKAGE_PCT) {
      status = missing > DIP_TOLERANCE_L * 4 || Math.abs(variancePct) > 3 ? "critical" : "watch";
      reasons.push(`${missing.toFixed(0)} L unaccounted for (${Math.abs(variancePct).toFixed(2)}% of throughput).`);
    } else if (varianceL > DIP_TOLERANCE_L) {
      status = "watch";
      reasons.push(`Tank holds ${varianceL.toFixed(0)} L more than the book — check for unrecorded receipts or under-recorded issues.`);
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
    periodStart: opening?.date ?? from ?? new Date(0),
    periodEnd: closing?.date ?? to ?? new Date(),
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

/** Running book balance for a tank, newest first — the tank ledger view. */
export type LedgerRow = {
  date: Date;
  kind: "RECEIPT" | "ISSUE" | "DIP";
  label: string;
  inL: number;
  outL: number;
  balance: number;
  /** For DIP rows: measured level minus running book balance at that moment. */
  drift: number | null;
};

export function tankLedger(
  openingLevel: number,
  receipts: ReceiptLite[],
  issues: IssueLite[],
  dips: DipLite[],
  assetLabel: (id: string | null) => string
): LedgerRow[] {
  type Ev = { date: Date; kind: LedgerRow["kind"]; label: string; inL: number; outL: number; level?: number };
  const events: Ev[] = [
    ...receipts.map((r) => ({ date: r.date, kind: "RECEIPT" as const, label: `${r.supplier}${r.shortfall > 0 ? ` — short ${r.shortfall.toFixed(0)} L` : ""}`, inL: r.qtyReceived, outL: 0 })),
    ...issues.map((i) => ({ date: i.date, kind: "ISSUE" as const, label: assetLabel(i.assetId), inL: 0, outL: i.quantity })),
    ...dips.map((p) => ({ date: p.date, kind: "DIP" as const, label: "Physical dip", inL: 0, outL: 0, level: p.level })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  let balance = openingLevel;
  const rows: LedgerRow[] = [];
  for (const e of events) {
    balance += e.inL - e.outL;
    const drift = e.kind === "DIP" && e.level != null ? e.level - balance : null;
    // A dip is ground truth: re-anchor the book to the physical measurement so
    // later rows show drift since the *last* dip rather than cumulative error.
    if (e.kind === "DIP" && e.level != null) balance = e.level;
    rows.push({ date: e.date, kind: e.kind, label: e.label, inL: e.inL, outL: e.outL, balance, drift });
  }
  return rows.reverse();
}

/* ------------------------- asset-side expectation ------------------------- */

export type Norm = { unit: "KMPL" | "LPH"; normLow: number; normHigh: number; tolerancePct: number };

/**
 * Litres the asset should have consumed for the work it actually did.
 * `meterDelta` is km for road vehicles, engine-hours for equipment.
 */
export function expectedLitres(meterDelta: number, norm: Norm): number {
  if (meterDelta <= 0) return 0;
  const mid = (norm.normLow + norm.normHigh) / 2;
  if (mid <= 0) return 0;
  return norm.unit === "LPH" ? meterDelta * mid : meterDelta / mid;
}

export type IssueVariance = {
  expected: number | null;
  actual: number;
  /** Null when there is no metered work to compare against — not 0%. */
  variancePct: number | null;
  beyondTolerance: boolean;
  /** Why a comparison could not be made, when it could not. */
  reason?: string;
};

/**
 * Litres issued against litres the metered work justifies.
 *
 * When the meter did not move — no reading taken, or the machine genuinely did
 * nothing — there is no expectation to compare against. That used to return
 * "0% variance", which reads on screen as *verified correct* and is the
 * opposite of the truth: it is the case we know least about.
 */
export function issueVariance(actualL: number, meterDelta: number, norm: Norm): IssueVariance {
  const expected = expectedLitres(meterDelta, norm);
  if (expected <= 0) {
    return {
      expected: null,
      actual: actualL,
      variancePct: null,
      beyondTolerance: false,
      reason:
        meterDelta <= 0
          ? "No metered work between fills — nothing to compare the issue against."
          : "No usable consumption norm for this class.",
    };
  }
  const variancePct = ((actualL - expected) / expected) * 100;
  return { expected, actual: actualL, variancePct, beyondTolerance: Math.abs(variancePct) > norm.tolerancePct };
}

/* ------------------------------ anomaly scoring ------------------------------ */

export type ScoredAnomaly = {
  source: "ISSUE" | "RECEIPT" | "TANK_RECON" | "ASSET_EFFICIENCY";
  refId: string;
  assetId?: string | null;
  tankId?: string | null;
  severity: "HIGH" | "MEDIUM" | "LOW";
  score: number;
  litres: number;
  valueAtRisk: number;
  reasons: string[];
};

/**
 * Turn a reconciliation result into a scored anomaly, or null when clean.
 * Score is capped at 100 and weighted by both absolute litres and % of throughput,
 * so a 200 L gap on a small tank outranks the same gap on a depot tank.
 */
export function scoreTankRecon(r: TankRecon, dieselRate: number): ScoredAnomaly | null {
  if (r.status === "ok" || r.status === "insufficient") return null;
  const missing = Math.max(0, -r.varianceL) + r.shortDeliveryL;
  if (missing <= 0 && r.varianceL <= DIP_TOLERANCE_L) return null;

  const litres = missing > 0 ? missing : Math.abs(r.varianceL);
  const pctWeight = Math.min(60, Math.abs(r.variancePct) * 15);
  const volWeight = Math.min(40, (litres / Math.max(1, r.tank.capacity)) * 200);
  const score = Math.round(Math.min(100, pctWeight + volWeight));

  return {
    source: "TANK_RECON",
    refId: `${r.tank.id}:${r.periodEnd.toISOString().slice(0, 10)}`,
    tankId: r.tank.id,
    severity: score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW",
    score,
    litres,
    valueAtRisk: litres * dieselRate,
    reasons: r.reasons,
  };
}

/**
 * Validate a fuel issue request against basic sanity and vehicle tank capacity.
 */
export function validateFuelIssue(
  quantity: number,
  fuelCapacity?: number | null
): { valid: boolean; error?: string } {
  if (quantity <= 0) {
    return { valid: false, error: "Fuel quantity must be greater than 0 litres." };
  }
  if (fuelCapacity != null && fuelCapacity > 0 && quantity > fuelCapacity * 1.5) {
    return {
      valid: false,
      error: `Fuel quantity (${quantity} L) exceeds plausible tank capacity (${fuelCapacity} L).`,
    };
  }
  return { valid: true };
}
