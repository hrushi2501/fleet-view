// M4 + M11 — Project sites, allocation and mobilisation.
//
// Three questions this answers that the demo could not:
//
//   1. Is the same machine committed to two projects at once? Both cannot be
//      billed for it, so an overlap is either a booking error or a billing one.
//   2. Is the machine physically where it was allocated? A geofence turns that
//      from a matter of trust into a measurement.
//   3. What did the project plan to need, versus what is actually standing on
//      site? Over-allocation is cost; under-allocation is delay.

import { businessDay } from "./business-time";

export type AllocationLite = {
  id: string;
  assetId: string;
  projectId: string;
  siteId: string | null;
  fromDate: Date;
  toDate: Date | null;
  status: string;
  ratePerDay: number;
};

export type SiteLite = { id: string; code: string; name: string; lat: number; lng: number; radiusM: number };

/* ------------------------------ overlap check ------------------------------ */

export type OverlapFinding = {
  assetId: string;
  a: AllocationLite;
  b: AllocationLite;
  fromDate: Date;
  toDate: Date | null;
  days: number | null;
  message: string;
};

/** Open-ended allocations (`toDate: null`) are treated as running to infinity. */
function overlaps(a: AllocationLite, b: AllocationLite): { from: Date; to: Date | null } | null {
  const aEnd = a.toDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = b.toDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const start = Math.max(a.fromDate.getTime(), b.fromDate.getTime());
  const end = Math.min(aEnd, bEnd);
  if (start >= end) return null;
  return { from: new Date(start), to: Number.isFinite(end) ? new Date(end) : null };
}

/**
 * Same asset committed to more than one project over overlapping dates.
 * Cancelled and released allocations are ignored — only live commitments conflict.
 */
export function allocationConflicts(allocations: AllocationLite[]): OverlapFinding[] {
  const live = allocations.filter((a) => a.status === "PLANNED" || a.status === "ACTIVE");
  const byAsset = new Map<string, AllocationLite[]>();
  for (const a of live) {
    const arr = byAsset.get(a.assetId) ?? [];
    arr.push(a);
    byAsset.set(a.assetId, arr);
  }

  const out: OverlapFinding[] = [];
  for (const [assetId, list] of byAsset) {
    const sorted = [...list].sort((x, y) => x.fromDate.getTime() - y.fromDate.getTime());
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j];
        if (a.projectId === b.projectId) continue; // same project re-booking is not a conflict
        const ov = overlaps(a, b);
        if (!ov) continue;
        const days = ov.to ? Math.ceil((ov.to.getTime() - ov.from.getTime()) / 86400000) : null;
        out.push({
          assetId, a, b, fromDate: ov.from, toDate: ov.to, days,
          message: days != null
            ? `Committed to two projects for ${days} overlapping day${days === 1 ? "" : "s"} — only one of them can legitimately be billed.`
            // businessDay, not toISOString: this date goes into a billing
            // dispute, and an overlap starting at 01:00 IST must not be quoted
            // as the previous day back to the vendor.
            : `Committed to two projects from ${businessDay(ov.from)} with no end date on at least one — only one can legitimately be billed.`,
        });
      }
    }
  }
  return out;
}

/* -------------------------------- geofence -------------------------------- */

/** Metres between two lat/lng points (haversine). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type GeofenceCheck = {
  inside: boolean;
  distanceM: number;
  overshootM: number;
  /** True when we simply don't have coordinates to judge with. */
  unknown: boolean;
  message: string;
};

export function geofenceCheck(assetLat: number, assetLng: number, site: SiteLite): GeofenceCheck {
  // 0,0 is in the Gulf of Guinea — treat it as "never reported" rather than a real position.
  if ((!assetLat && !assetLng) || (!site.lat && !site.lng)) {
    return { inside: false, distanceM: 0, overshootM: 0, unknown: true, message: "No position recorded for the machine or the site." };
  }
  const d = distanceM(assetLat, assetLng, site.lat, site.lng);
  const inside = d <= site.radiusM;
  return {
    inside,
    distanceM: d,
    overshootM: Math.max(0, d - site.radiusM),
    unknown: false,
    message: inside
      ? `Inside ${site.name} (${Math.round(d)} m from centre, fence ${site.radiusM} m).`
      : `${(d / 1000).toFixed(1)} km from ${site.name} — ${Math.round(d - site.radiusM)} m outside its fence.`,
  };
}

/* ----------------------------- plan vs actual ----------------------------- */

export type PlanLite = { assetClass: string; plannedCount: number; budgetPerDay: number };

export type PlanVsActual = {
  assetClass: string;
  planned: number;
  actual: number;
  variance: number;
  status: "short" | "matched" | "over";
  dailyBudget: number;
  message: string;
};

export function planVsActual(
  plans: PlanLite[],
  allocatedByClass: Map<string, number>
): PlanVsActual[] {
  const classes = new Set<string>([...plans.map((p) => p.assetClass), ...allocatedByClass.keys()]);

  return [...classes].map((assetClass): PlanVsActual => {
    const plan = plans.find((p) => p.assetClass === assetClass);
    const planned = plan?.plannedCount ?? 0;
    const actual = allocatedByClass.get(assetClass) ?? 0;
    const variance = actual - planned;

    return {
      assetClass,
      planned,
      actual,
      variance,
      dailyBudget: (plan?.budgetPerDay ?? 0) * planned,
      status: variance < 0 ? "short" : variance > 0 ? "over" : "matched",
      message:
        variance < 0
          ? `${Math.abs(variance)} short of plan — work fronts may be waiting.`
          : variance > 0
            ? planned === 0
              ? `${actual} allocated with no plan on record.`
              : `${variance} more than planned — costing money against an unbudgeted line.`
            : "Matches plan.",
    };
  }).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
}

/* ------------------------------ mobilisation ------------------------------ */

export type MobLite = {
  id: string;
  status: string;
  requestedDate: Date;
  dispatchDate: Date | null;
  arrivalDate: Date | null;
  cost: number;
  distanceKm: number;
  transportMode: string;
};

export type MobStats = {
  inTransit: number;
  pending: number;
  completed: number;
  totalCost: number;
  avgTransitDays: number | null;
  /** Days between requesting a move and it actually leaving. */
  avgWaitDays: number | null;
  stale: MobLite[];
};

/** Moves requested but not dispatched after this many days are chased. */
const STALE_DAYS = 7;

export function mobilizationStats(orders: MobLite[], now = new Date()): MobStats {
  const inTransit = orders.filter((o) => o.status === "IN_TRANSIT");
  const pending = orders.filter((o) => o.status === "REQUESTED" || o.status === "APPROVED");
  const done = orders.filter((o) => o.arrivalDate && o.dispatchDate);

  // A machine cannot arrive before it left, or leave before it was requested.
  // Those rows are data-entry errors, and a negative duration in the average
  // silently cancels out a real delay elsewhere in the fleet — the mean transit
  // time comes back looking better than any individual move actually was.
  const transit = done
    .map((o) => (o.arrivalDate!.getTime() - o.dispatchDate!.getTime()) / 86400000)
    .filter((d) => d >= 0);
  const waited = orders
    .filter((o) => o.dispatchDate)
    .map((o) => (o.dispatchDate!.getTime() - o.requestedDate.getTime()) / 86400000)
    .filter((d) => d >= 0);

  return {
    inTransit: inTransit.length,
    pending: pending.length,
    completed: done.length,
    totalCost: orders.reduce((s, o) => s + o.cost, 0),
    avgTransitDays: transit.length ? transit.reduce((s, x) => s + x, 0) / transit.length : null,
    avgWaitDays: waited.length ? waited.reduce((s, x) => s + x, 0) / waited.length : null,
    stale: pending.filter((o) => (now.getTime() - o.requestedDate.getTime()) / 86400000 > STALE_DAYS),
  };
}

export const SITE_TYPES = ["QUARRY", "CAMP", "PLANT", "STORE", "WORK_FRONT", "WEIGHBRIDGE"];
export const SITE_TYPE_LABEL: Record<string, string> = {
  QUARRY: "Quarry", CAMP: "Camp", PLANT: "Batching plant", STORE: "Store", WORK_FRONT: "Work front", WEIGHBRIDGE: "Weighbridge",
};
export const TRANSPORT_MODES = ["SELF_DRIVE", "LOW_BED", "TRAILER", "CRANE"];
export const TRANSPORT_LABEL: Record<string, string> = {
  SELF_DRIVE: "Self-driven", LOW_BED: "Low-bed trailer", TRAILER: "Trailer", CRANE: "Crane-lifted",
};
