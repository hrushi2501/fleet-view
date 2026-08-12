// M8 — Hire / rental & contractor billing verification.
//
// The control this module provides: a vendor invoice is never approved on the
// vendor's word. Every claimed day, hour, km or trip is checked against what the
// site actually logged, the contract's own terms are applied (minimum guarantee,
// non-billable breakdown time), and any diesel we issued that the vendor is
// contractually meant to bear is deducted.
//
//   payable = min(claimed, supported-by-logs, contract terms) − deductions
//
// The gap between `claimed` and `payable` is the recoverable amount.

export type RateType = "PER_DAY" | "PER_HOUR" | "PER_KM" | "PER_TRIP" | "MONTHLY";

export type ContractLite = {
  id: string;
  vendor: string;
  rateType: RateType;
  rate: number;
  overtimeRate: number;
  minGuarantee: number;
  guaranteeUnit: string | null;
  fuelBorneBy: string;
  breakdownBillable: boolean;
  idleBillable: boolean;
};

export type LogLite = {
  date: Date;
  present: boolean;
  workedHours: number;
  idleHours: number;
  breakdownHours: number;
  km: number;
  trips: number;
  source: string;
};

export const RATE_UNIT: Record<RateType, string> = {
  PER_DAY: "days",
  PER_HOUR: "hours",
  PER_KM: "km",
  PER_TRIP: "trips",
  MONTHLY: "months",
};

/** Label for the quantity a rate type bills on. */
export function unitOf(rateType: string): string {
  return RATE_UNIT[rateType as RateType] ?? "units";
}

/**
 * Billable quantity supported by the site logs, in the contract's own unit.
 *
 * Hours are the subtle case: a machine that was present but idle may still be
 * billable (many hire contracts pay for availability, not utilisation), while
 * breakdown time usually is not. Both are contract flags rather than assumptions.
 */
export function supportedQty(contract: ContractLite, logs: LogLite[]): { qty: number; workedHours: number; presentDays: number; breakdownHours: number; idleHours: number; km: number; trips: number } {
  const present = logs.filter((l) => l.present);
  const presentDays = present.length;
  const workedHours = present.reduce((s, l) => s + l.workedHours, 0);
  const idleHours = present.reduce((s, l) => s + l.idleHours, 0);
  const breakdownHours = logs.reduce((s, l) => s + l.breakdownHours, 0);
  const km = present.reduce((s, l) => s + l.km, 0);
  const trips = present.reduce((s, l) => s + l.trips, 0);

  let qty = 0;
  switch (contract.rateType) {
    case "PER_DAY": {
      // A day with no worked hours and no distance isn't a billable day, even if
      // someone marked the machine "present".
      qty = present.filter((l) => l.workedHours > 0 || l.km > 0 || l.trips > 0 || (contract.idleBillable && l.idleHours > 0)).length;
      break;
    }
    case "PER_HOUR": {
      qty = workedHours + (contract.idleBillable ? idleHours : 0);
      if (contract.breakdownBillable) qty += breakdownHours;
      // Apply the daily minimum guarantee per present day, not to the total.
      if (contract.minGuarantee > 0 && contract.guaranteeUnit === "HOURS_PER_DAY") {
        qty = present.reduce((s, l) => {
          const h = l.workedHours + (contract.idleBillable ? l.idleHours : 0) + (contract.breakdownBillable ? l.breakdownHours : 0);
          return s + Math.max(h, contract.minGuarantee);
        }, 0);
      }
      break;
    }
    case "PER_KM":
      qty = km;
      break;
    case "PER_TRIP":
      qty = trips;
      break;
    case "MONTHLY":
      qty = presentDays > 0 ? 1 : 0;
      break;
  }

  // Monthly-guarantee contracts float the day count up to the guaranteed minimum.
  if (contract.rateType === "PER_DAY" && contract.minGuarantee > 0 && contract.guaranteeUnit === "DAYS_PER_MONTH") {
    qty = Math.max(qty, Math.min(contract.minGuarantee, logs.length));
  }

  return { qty, workedHours, presentDays, breakdownHours, idleHours, km, trips };
}

/**
 * Hours in a working day, used as the denominator for utilisation.
 *
 * Configurable because it is a commercial assumption, not a fact: a single-shift
 * site and a double-shift quarry produce very different utilisation from the
 * identical logs, and the figure is used to argue about hire contracts.
 */
export const WORKING_HOURS_PER_DAY = Number(process.env.WORKING_HOURS_PER_DAY) > 0
  ? Number(process.env.WORKING_HOURS_PER_DAY)
  : 8;

/** Utilisation of a hired machine — low utilisation on a day-rate contract is money burnt. */
export function utilisation(contract: ContractLite, logs: LogLite[], periodDays: number) {
  const sup = supportedQty(contract, logs);
  const capacityHours = periodDays * WORKING_HOURS_PER_DAY;
  return {
    presentDays: sup.presentDays,
    periodDays,
    workedHours: sup.workedHours,
    idleHours: sup.idleHours,
    breakdownHours: sup.breakdownHours,
    /** Null when the period is unknown — never 0%, which reads as "never turned up". */
    presencePct: periodDays > 0 ? (sup.presentDays / periodDays) * 100 : null,
    utilPct: capacityHours > 0 ? (sup.workedHours / capacityHours) * 100 : null,
    workingHoursPerDay: WORKING_HOURS_PER_DAY,
  };
}
