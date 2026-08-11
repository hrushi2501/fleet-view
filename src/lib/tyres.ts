// M17 — Tyre & major-component lifecycle.
//
// On a construction fleet tyres are the second-largest consumable after diesel,
// and — like buckets and undercarriage — they are a prime swap-theft target: a
// nearly-new tyre quietly exchanged for a worn one is invisible unless each
// casing is tracked by serial.
//
// Two questions this module answers:
//   1. What is each tyre costing per kilometre, and how much life is left?
//   2. Did anything move between machines without a recorded fitment?

export type TyreLite = {
  id: string;
  serialNo: string;
  make: string;
  size: string;
  status: string;
  assetId: string | null;
  position: string | null;
  cost: number;
  treadNewMm: number;
  currentTreadMm: number;
  expectedLifeKm: number;
  fittedMeter: number;
  totalKm: number;
  retreadCount: number;
  purchaseDate: Date | null;
};

export type TyreHealth = {
  tyre: TyreLite;
  /** Percentage of usable tread consumed. */
  wearPct: number;
  treadRemainingMm: number;
  kmRun: number;
  lifeUsedPct: number;
  /** Rupees per kilometre actually delivered. */
  costPerKm: number | null;
  /** Projected total km at the current wear rate. */
  projectedLifeKm: number | null;
  status: "good" | "monitor" | "replace" | "unsafe";
  flags: string[];
};

/** Legal minimum tread in India is 1.6 mm; we warn well before that. */
export const LEGAL_MIN_TREAD_MM = 1.6;
const REPLACE_AT_MM = 3;

/**
 * Tyre health from tread and distance run.
 * `currentAssetMeter` lets us count km since fitment without a removal event.
 */
export function tyreHealth(t: TyreLite, currentAssetMeter: number | null): TyreHealth {
  const usableNew = Math.max(0.1, t.treadNewMm - LEGAL_MIN_TREAD_MM);
  const treadRemainingMm = Math.max(0, t.currentTreadMm - LEGAL_MIN_TREAD_MM);
  const wearPct = Math.min(100, Math.max(0, ((usableNew - treadRemainingMm) / usableNew) * 100));

  // km on this fitment, plus km carried from earlier fitments
  const sinceFit = t.status === "IN_USE" && currentAssetMeter != null && t.fittedMeter != null
    ? Math.max(0, currentAssetMeter - t.fittedMeter)
    : 0;
  const kmRun = t.totalKm + sinceFit;

  const lifeUsedPct = t.expectedLifeKm > 0 ? (kmRun / t.expectedLifeKm) * 100 : 0;
  const costPerKm = kmRun > 0 && t.cost > 0 ? t.cost / kmRun : null;
  // Extrapolate: if x% of tread is gone after kmRun, full life is kmRun / (x/100).
  const projectedLifeKm = wearPct > 5 && kmRun > 0 ? kmRun / (wearPct / 100) : null;

  const flags: string[] = [];
  let status: TyreHealth["status"] = "good";

  if (t.currentTreadMm <= LEGAL_MIN_TREAD_MM) {
    status = "unsafe";
    flags.push(`Tread ${t.currentTreadMm} mm is at or below the ${LEGAL_MIN_TREAD_MM} mm legal minimum — not roadworthy.`);
  } else if (t.currentTreadMm <= REPLACE_AT_MM) {
    status = "replace";
    flags.push(`Tread ${t.currentTreadMm} mm — plan replacement now.`);
  } else if (wearPct > 70) {
    status = "monitor";
  }

  if (projectedLifeKm && t.expectedLifeKm > 0 && projectedLifeKm < t.expectedLifeKm * 0.7) {
    if (status === "good") status = "monitor";
    flags.push(
      `Wearing fast: on track for ~${Math.round(projectedLifeKm).toLocaleString("en-IN")} km against an expected ${t.expectedLifeKm.toLocaleString("en-IN")} km. Check alignment, pressure or overloading.`
    );
  }
  if (t.retreadCount > 2) flags.push(`Retreaded ${t.retreadCount} times — casing life is limited.`);
  if (t.status === "IN_USE" && !t.assetId) flags.push("Marked in use but not fitted to any machine.");

  return { tyre: t, wearPct, treadRemainingMm, kmRun, lifeUsedPct, costPerKm, projectedLifeKm, status, flags };
}

/* ------------------------------ swap detection ------------------------------ */

export type EventLite = { tyreId: string; kind: string; date: Date; assetId: string | null; position: string | null; treadMm: number };

export type SwapSignal = { tyreId: string; serialNo: string; reason: string; date: Date };

/**
 * Movements a tyre made between machines with no FIT/REMOVE event to explain them,
 * plus tread that increased without a retread — the classic signature of a
 * worn casing being swapped for a good one.
 */
export function detectSwaps(tyres: TyreLite[], events: EventLite[]): SwapSignal[] {
  const out: SwapSignal[] = [];
  const byTyre = new Map<string, EventLite[]>();
  for (const e of events) {
    const arr = byTyre.get(e.tyreId) ?? [];
    arr.push(e);
    byTyre.set(e.tyreId, arr);
  }

  for (const t of tyres) {
    const evs = (byTyre.get(t.id) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime());

    for (let i = 1; i < evs.length; i++) {
      const prev = evs[i - 1], cur = evs[i];

      // Tread cannot grow back unless the casing was retreaded.
      if (cur.treadMm > prev.treadMm + 0.5 && cur.kind !== "RETREAD" && prev.kind !== "RETREAD") {
        out.push({
          tyreId: t.id,
          serialNo: t.serialNo,
          reason: `Tread rose from ${prev.treadMm} mm to ${cur.treadMm} mm with no retread recorded — the casing on this serial may have been swapped.`,
          date: cur.date,
        });
      }

      // Appearing on a different machine without a removal in between.
      if (prev.assetId && cur.assetId && prev.assetId !== cur.assetId && cur.kind !== "FIT" && prev.kind !== "REMOVE") {
        out.push({
          tyreId: t.id,
          serialNo: t.serialNo,
          reason: "Appears on a different machine with no removal or fitment recorded in between.",
          date: cur.date,
        });
      }
    }
  }
  return out;
}

/* ---------------------------- major components ---------------------------- */

export type ComponentLite = {
  id: string;
  serialNo: string;
  type: string;
  status: string;
  cost: number;
  fittedMeter: number;
  expectedLifeHours: number;
  hoursUsed: number;
  rebuildCount: number;
};

export type ComponentHealth = {
  component: ComponentLite;
  hoursRun: number;
  lifeUsedPct: number;
  costPerHour: number | null;
  status: "good" | "monitor" | "replace";
  flags: string[];
};

export function componentHealth(c: ComponentLite, currentAssetMeter: number | null): ComponentHealth {
  const sinceFit =
    c.status === "IN_USE" && currentAssetMeter != null && c.fittedMeter != null
      ? Math.max(0, currentAssetMeter - c.fittedMeter)
      : 0;
  const hoursRun = c.hoursUsed + sinceFit;
  const lifeUsedPct = c.expectedLifeHours > 0 ? (hoursRun / c.expectedLifeHours) * 100 : 0;

  const flags: string[] = [];
  let status: ComponentHealth["status"] = "good";
  if (lifeUsedPct >= 100) { status = "replace"; flags.push(`Past its ${c.expectedLifeHours.toLocaleString("en-IN")}-hour expected life.`); }
  else if (lifeUsedPct >= 80) { status = "monitor"; flags.push(`${lifeUsedPct.toFixed(0)}% of expected life used — plan the rebuild.`); }
  if (c.rebuildCount > 1) flags.push(`Rebuilt ${c.rebuildCount} times.`);

  return {
    component: c,
    hoursRun,
    lifeUsedPct,
    costPerHour: hoursRun > 0 && c.cost > 0 ? c.cost / hoursRun : null,
    status,
    flags,
  };
}

export const TYRE_POSITIONS = ["FL", "FR", "RL1", "RL2", "RR1", "RR2", "SPARE"];
export const COMPONENT_TYPES = ["BUCKET", "UNDERCARRIAGE", "ENGINE", "TRANSMISSION", "BOOM", "DRUM", "OTHER"];
