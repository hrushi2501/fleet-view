// M24 — Weighbridge reconciliation.
//
// Material leaves a quarry weighed, and arrives at site weighed. The gap between
// those two numbers is the oldest leakage route in earthwork and aggregate
// haulage — a tonne short on every trip is invisible per trip and enormous per
// month.
//
// Three checks:
//   1. Dispatch vs receipt per matched pair (transit loss).
//   2. Net weight vs gross − tare (arithmetic that doesn't add up).
//   3. Received vs billed (paying for material that never arrived).

export type TicketLite = {
  id: string;
  ticketNo: string;
  kind: string; // DISPATCH | RECEIPT
  date: Date;
  material: string;
  grossKg: number;
  tareKg: number;
  netKg: number;
  billedKg: number;
  rate: number;
  amount: number;
  assetId: string | null;
  vendor: string | null;
  pairedTicketNo: string | null;
};

/** Below this, treat the difference as scale tolerance rather than loss. */
export const SCALE_TOLERANCE_KG = 50;
/** Transit loss above this fraction is a finding, not moisture and spillage. */
export const TRANSIT_LOSS_PCT = 1.5;

export type PairResult = {
  dispatch: TicketLite;
  receipt: TicketLite | null;
  shortageKg: number;
  shortagePct: number;
  valueAtRisk: number;
  status: "ok" | "watch" | "shortage" | "unmatched";
  reasons: string[];
};

/**
 * Match dispatch tickets to their receipts and measure what went missing.
 * A dispatch with no receipt at all is the worst case, so it is called out
 * separately rather than being silently excluded from the average.
 */
export function reconcilePairs(tickets: TicketLite[]): PairResult[] {
  const dispatches = tickets.filter((t) => t.kind === "DISPATCH");
  const receipts = tickets.filter((t) => t.kind === "RECEIPT");

  const byPairedNo = new Map<string, TicketLite>();
  for (const r of receipts) if (r.pairedTicketNo) byPairedNo.set(r.pairedTicketNo, r);

  return dispatches.map((d) => {
    const receipt = byPairedNo.get(d.ticketNo) ?? null;
    const reasons: string[] = [];

    if (!receipt) {
      return {
        dispatch: d,
        receipt: null,
        shortageKg: d.netKg,
        shortagePct: 100,
        valueAtRisk: d.amount || d.netKg * d.rate,
        status: "unmatched",
        reasons: [`Dispatched ${(d.netKg / 1000).toFixed(2)} t on ticket ${d.ticketNo} with no receipt recorded at the destination.`],
      };
    }

    const shortageKg = d.netKg - receipt.netKg;
    const shortagePct = d.netKg > 0 ? (shortageKg / d.netKg) * 100 : 0;

    let status: PairResult["status"] = "ok";
    if (shortageKg > SCALE_TOLERANCE_KG && shortagePct > TRANSIT_LOSS_PCT) {
      status = shortagePct > TRANSIT_LOSS_PCT * 2 ? "shortage" : "watch";
      reasons.push(`${shortageKg.toFixed(0)} kg (${shortagePct.toFixed(2)}%) less arrived than was dispatched.`);
    } else if (shortageKg < -SCALE_TOLERANCE_KG) {
      status = "watch";
      reasons.push(`${Math.abs(shortageKg).toFixed(0)} kg more arrived than was dispatched — check which slip is wrong.`);
    }

    // Arithmetic check on both slips: net should equal gross − tare.
    for (const [label, t] of [["Dispatch", d], ["Receipt", receipt]] as const) {
      if (t.grossKg > 0 && t.tareKg > 0) {
        const computed = t.grossKg - t.tareKg;
        if (Math.abs(computed - t.netKg) > SCALE_TOLERANCE_KG) {
          status = status === "ok" ? "watch" : status;
          reasons.push(`${label} slip ${t.ticketNo}: net ${t.netKg.toFixed(0)} kg doesn't match gross − tare (${computed.toFixed(0)} kg).`);
        }
      }
    }

    // Paying for more than arrived.
    if (receipt.billedKg > 0 && receipt.billedKg - receipt.netKg > SCALE_TOLERANCE_KG) {
      status = "shortage";
      const over = receipt.billedKg - receipt.netKg;
      reasons.push(`Billed ${(receipt.billedKg / 1000).toFixed(2)} t against ${(receipt.netKg / 1000).toFixed(2)} t received — ${over.toFixed(0)} kg overbilled.`);
    }

    const lossValue = Math.max(0, shortageKg) * (d.rate || receipt.rate);
    return { dispatch: d, receipt, shortageKg, shortagePct, valueAtRisk: lossValue, status, reasons };
  });
}

export type MaterialSummary = {
  material: string;
  /** Dispatched on trips that were actually matched to a receipt. */
  dispatchedKg: number;
  receivedKg: number;
  shortageKg: number;
  /** Measured transit loss. Null when no trip of this material could be paired. */
  shortagePct: number | null;
  trips: number;
  /** Trips with a receipt — the only ones a loss percentage can be computed on. */
  matchedTrips: number;
  /** Dispatched tonnage with no receipt at all. A paperwork gap, not a measured loss. */
  unmatchedTrips: number;
  unmatchedKg: number;
  valueAtRisk: number;
};

/**
 * Loss by material.
 *
 * Matched and unmatched trips are kept apart on purpose. A dispatch with no
 * receipt is not "100% of the load lost in transit" — it is a missing slip, and
 * the material has very likely arrived. Averaging those two things together
 * produced shortage percentages that looked like mass theft whenever the site
 * office was behind on its paperwork, and that number is the basis of a claim
 * against a haulier.
 */
export function byMaterial(pairs: PairResult[]): MaterialSummary[] {
  const m = new Map<string, MaterialSummary>();
  for (const p of pairs) {
    const key = p.dispatch.material || "Unspecified";
    const cur = m.get(key) ?? {
      material: key, dispatchedKg: 0, receivedKg: 0, shortageKg: 0, shortagePct: null,
      trips: 0, matchedTrips: 0, unmatchedTrips: 0, unmatchedKg: 0, valueAtRisk: 0,
    };
    cur.trips++;
    cur.valueAtRisk += p.valueAtRisk;

    if (p.receipt) {
      cur.matchedTrips++;
      cur.dispatchedKg += p.dispatch.netKg;
      cur.receivedKg += p.receipt.netKg;
      cur.shortageKg += Math.max(0, p.shortageKg);
    } else {
      cur.unmatchedTrips++;
      cur.unmatchedKg += p.dispatch.netKg;
    }
    m.set(key, cur);
  }
  for (const v of m.values()) {
    v.shortagePct = v.dispatchedKg > 0 ? (v.shortageKg / v.dispatchedKg) * 100 : null;
  }
  return [...m.values()].sort((a, b) => b.shortageKg - a.shortageKg);
}

export type VehicleSummary = {
  assetId: string;
  trips: number;
  shortageKg: number;
  shortagePct: number | null;
  dispatchedKg: number;
  unmatchedTrips: number;
};

/**
 * Shortage concentrated on particular vehicles is a stronger signal than fleet
 * averages — this list names a driver's vehicle, so only *measured* pairs count
 * towards its percentage. Missing paperwork is reported alongside, not as loss.
 */
export function byVehicle(pairs: PairResult[]): VehicleSummary[] {
  const m = new Map<string, VehicleSummary>();
  for (const p of pairs) {
    const id = p.dispatch.assetId;
    if (!id) continue;
    const cur = m.get(id) ?? { assetId: id, trips: 0, shortageKg: 0, shortagePct: null, dispatchedKg: 0, unmatchedTrips: 0 };
    cur.trips++;
    if (p.receipt) {
      cur.dispatchedKg += p.dispatch.netKg;
      cur.shortageKg += Math.max(0, p.shortageKg);
    } else {
      cur.unmatchedTrips++;
    }
    m.set(id, cur);
  }
  for (const v of m.values()) v.shortagePct = v.dispatchedKg > 0 ? (v.shortageKg / v.dispatchedKg) * 100 : null;
  return [...m.values()]
    .filter((v) => v.shortageKg > 0)
    .sort((a, b) => (b.shortagePct ?? 0) - (a.shortagePct ?? 0));
}

export const MATERIALS = ["Earth", "GSB", "WMM", "Aggregate", "Sand", "Bitumen", "Concrete", "Debris", "Other"];

/** Highest plausible gross weight for any commercial truck configuration (150 metric tonnes). */
export const MAX_REASONABLE_GROSS_KG = 150_000;

export type WeightValidationResult = {
  valid: boolean;
  error?: string;
  computedNetKg: number;
};

/**
 * Validates physically possible weighbridge boundaries:
 * - Weights cannot be negative.
 * - Gross weight cannot exceed realistic maximums (e.g. 150t).
 * - Gross weight must be >= tare weight if both are positive.
 * - Computes or validates net weight.
 */
export function validateWeighbridgeWeights(params: {
  grossKg: number;
  tareKg: number;
  netKg?: number;
}): WeightValidationResult {
  const { grossKg, tareKg, netKg } = params;
  if (![grossKg, tareKg, ...(netKg === undefined ? [] : [netKg])].every(Number.isFinite)) {
    return { valid: false, error: "Weights must be finite numbers.", computedNetKg: 0 };
  }
  if (netKg !== undefined && (netKg < 0 || netKg > MAX_REASONABLE_GROSS_KG)) {
    return { valid: false, error: "Net weight must be between 0 and 150,000 kg.", computedNetKg: 0 };
  }

  if (grossKg < 0 || tareKg < 0) {
    return { valid: false, error: "Gross and tare weights cannot be negative.", computedNetKg: 0 };
  }

  if (grossKg > MAX_REASONABLE_GROSS_KG) {
    return {
      valid: false,
      error: `Gross weight (${grossKg.toLocaleString("en-IN")} kg) exceeds maximum permissible threshold of ${MAX_REASONABLE_GROSS_KG.toLocaleString("en-IN")} kg.`,
      computedNetKg: 0,
    };
  }

  if (tareKg > MAX_REASONABLE_GROSS_KG) {
    return {
      valid: false,
      error: `Tare weight (${tareKg.toLocaleString("en-IN")} kg) exceeds maximum permissible threshold of ${MAX_REASONABLE_GROSS_KG.toLocaleString("en-IN")} kg.`,
      computedNetKg: 0,
    };
  }

  if (grossKg < tareKg) {
    return {
      valid: false,
      error: `Gross weight (${grossKg.toLocaleString("en-IN")} kg) cannot be less than empty tare weight (${tareKg.toLocaleString("en-IN")} kg).`,
      computedNetKg: 0,
    };
  }

  const derived = grossKg - tareKg;
  if (grossKg > 0 && netKg !== undefined && Math.abs(netKg - derived) > 0.01) {
    return { valid: false, error: "Net weight must equal gross minus tare weight.", computedNetKg: 0 };
  }
  const computed = netKg ?? derived;
  return { valid: true, computedNetKg: computed };
}
