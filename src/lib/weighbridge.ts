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
  dispatchedKg: number;
  receivedKg: number;
  shortageKg: number;
  shortagePct: number;
  trips: number;
  valueAtRisk: number;
};

export function byMaterial(pairs: PairResult[]): MaterialSummary[] {
  const m = new Map<string, MaterialSummary>();
  for (const p of pairs) {
    const key = p.dispatch.material || "Unspecified";
    const cur = m.get(key) ?? { material: key, dispatchedKg: 0, receivedKg: 0, shortageKg: 0, shortagePct: 0, trips: 0, valueAtRisk: 0 };
    cur.dispatchedKg += p.dispatch.netKg;
    cur.receivedKg += p.receipt?.netKg ?? 0;
    cur.shortageKg += Math.max(0, p.shortageKg);
    cur.valueAtRisk += p.valueAtRisk;
    cur.trips++;
    m.set(key, cur);
  }
  for (const v of m.values()) v.shortagePct = v.dispatchedKg > 0 ? (v.shortageKg / v.dispatchedKg) * 100 : 0;
  return [...m.values()].sort((a, b) => b.shortageKg - a.shortageKg);
}

export type VehicleSummary = { assetId: string; trips: number; shortageKg: number; shortagePct: number; dispatchedKg: number };

/** Shortage concentrated on particular vehicles is a stronger signal than fleet averages. */
export function byVehicle(pairs: PairResult[]): VehicleSummary[] {
  const m = new Map<string, VehicleSummary>();
  for (const p of pairs) {
    const id = p.dispatch.assetId;
    if (!id) continue;
    const cur = m.get(id) ?? { assetId: id, trips: 0, shortageKg: 0, shortagePct: 0, dispatchedKg: 0 };
    cur.trips++;
    cur.dispatchedKg += p.dispatch.netKg;
    cur.shortageKg += Math.max(0, p.shortageKg);
    m.set(id, cur);
  }
  for (const v of m.values()) v.shortagePct = v.dispatchedKg > 0 ? (v.shortageKg / v.dispatchedKg) * 100 : 0;
  return [...m.values()].filter((v) => v.shortageKg > 0).sort((a, b) => b.shortagePct - a.shortagePct);
}

export const MATERIALS = ["Earth", "GSB", "WMM", "Aggregate", "Sand", "Bitumen", "Concrete", "Debris", "Other"];
