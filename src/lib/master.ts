// M1 + M2 — Asset and personnel master data.
//
// Two things the demo could not do:
//
//   1. Carry both meters. A backhoe has an odometer *and* an hour-meter, and the
//      demo had one `meterValue` field, so whichever you recorded overwrote the
//      other and neither could be trusted.
//   2. Say how complete its own master data is. "Asset data completeness %" is
//      the first KPI in the design doc for a reason — every downstream number
//      (depreciation, cost/km, PM due dates) is only as good as the master
//      record it reads from, and a fleet that quietly has no acquisition costs
//      will report a depreciation of zero and look profitable.

import { businessDay } from "./business-time";
import { calendarDaysUntil } from "./utils";

export type MeterType = "ODOMETER" | "HOURS";

export type ReadingLite = {
  id: string;
  meterType: string;
  value: number;
  date: Date;
  source: string;
};

/** Largest plausible jump between two readings, per meter type. */
const MAX_DAILY = { ODOMETER: 1200, HOURS: 24 } as const;

export type MeterCheck = {
  ok: boolean;
  isRollback: boolean;
  implausible: boolean;
  message: string | null;
  previous: ReadingLite | null;
};

/**
 * Validate a proposed reading against the asset's history for the same meter.
 * Returns rather than throws, so the caller can record the reading *and* flag it
 * — refusing the entry outright just teaches people to fudge the number.
 */
export function checkReading(
  meterType: MeterType,
  value: number,
  date: Date,
  history: ReadingLite[]
): MeterCheck {
  const prior = history
    .filter((r) => r.meterType === meterType && r.date <= date)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const previous = prior[0] ?? null;

  if (!previous) return { ok: true, isRollback: false, implausible: false, message: null, previous: null };

  if (value < previous.value) {
    return {
      ok: false,
      isRollback: true,
      implausible: false,
      previous,
      // This message is quoted back at an operator accused of a rollback, so the
      // date has to be the one he would recognise from his own shift, not the
      // UTC day the server happens to be in.
      message: `Reading ${value.toLocaleString("en-IN")} is below the previous ${previous.value.toLocaleString("en-IN")} recorded on ${businessDay(previous.date)}. A meter does not run backwards.`,
    };
  }

  const days = Math.max(1, (date.getTime() - previous.date.getTime()) / 86400000);
  const jump = value - previous.value;
  const cap = MAX_DAILY[meterType] * days;
  if (jump > cap) {
    return {
      ok: false,
      isRollback: false,
      implausible: true,
      previous,
      message: `Jump of ${Math.round(jump).toLocaleString("en-IN")} over ${days.toFixed(0)} day(s) exceeds the plausible maximum of ${Math.round(cap).toLocaleString("en-IN")}. Check for a digit typed twice.`,
    };
  }

  return { ok: true, isRollback: false, implausible: false, message: null, previous };
}

/* --------------------------- data completeness --------------------------- */

export type AssetForCompleteness = {
  registrationNo: string | null;
  chassisNo: string | null;
  engineNo: string | null;
  make: string;
  model: string;
  yearMfg: number;
  acquisitionCost: number;
  insuredValue: number;
  meterValue: number;
  fuelCapacity: number;
  projectId: string | null;
  driverId: string | null;
  commissionedOn: Date | null;
  inServiceDate: Date | null;
};

export type CompletenessField = { field: string; label: string; filled: boolean; weight: number; why: string };

export type Completeness = { score: number; filled: number; total: number; missing: CompletenessField[]; fields: CompletenessField[] };

/**
 * Weighted, because the fields are not equally important: without an
 * acquisition cost the whole TCO module reports zero and nobody notices.
 */
export function assetCompleteness(a: AssetForCompleteness): Completeness {
  const fields: CompletenessField[] = [
    { field: "registrationNo", label: "Registration number", filled: !!a.registrationNo, weight: 3, why: "Needed to match RTO records and compliance documents." },
    { field: "chassisNo", label: "Chassis number", filled: !!a.chassisNo, weight: 2, why: "The identity that survives a re-registration." },
    { field: "engineNo", label: "Engine number", filled: !!a.engineNo, weight: 1, why: "Needed for warranty and engine-swap disputes." },
    { field: "make", label: "Make", filled: !!a.make, weight: 1, why: "Drives parts and service benchmarks." },
    { field: "model", label: "Model", filled: !!a.model, weight: 1, why: "Drives parts and service benchmarks." },
    { field: "yearMfg", label: "Year of manufacture", filled: a.yearMfg > 1970, weight: 2, why: "Without it, age and depreciation fall back to guesswork." },
    { field: "acquisitionCost", label: "Acquisition cost", filled: a.acquisitionCost > 0, weight: 4, why: "Depreciation, book value and TCO all read zero without it." },
    { field: "insuredValue", label: "Insured value", filled: a.insuredValue > 0, weight: 1, why: "Needed to judge whether cover is adequate." },
    { field: "meterValue", label: "Current meter", filled: a.meterValue > 0, weight: 3, why: "Preventive service intervals cannot be computed without it." },
    { field: "fuelCapacity", label: "Tank capacity", filled: a.fuelCapacity > 0, weight: 2, why: "Used to flag a fill larger than the tank can hold." },
    { field: "projectId", label: "Assigned project", filled: !!a.projectId, weight: 2, why: "Costs cannot be attributed to a project without it." },
    { field: "driverId", label: "Assigned driver", filled: !!a.driverId, weight: 1, why: "Links behaviour and fuel to a person." },
    { field: "commissionedOn", label: "Commissioned date", filled: !!(a.commissionedOn ?? a.inServiceDate), weight: 2, why: "Anchors depreciation and warranty." },
  ];

  const total = fields.reduce((s, f) => s + f.weight, 0);
  const filled = fields.filter((f) => f.filled).reduce((s, f) => s + f.weight, 0);

  return {
    score: Math.round((filled / total) * 100),
    filled,
    total,
    missing: fields.filter((f) => !f.filled).sort((a, b) => b.weight - a.weight),
    fields,
  };
}

/* ------------------------------- personnel ------------------------------- */

export type AttendanceLite = { date: Date; status: string; hours: number };

export type AttendanceSummary = {
  days: number;
  present: number;
  absent: number;
  leave: number;
  halfDays: number;
  hours: number;
  /**
   * Null when the period holds no working days at all. 0% reads as a person who
   * never turned up — which is what a payroll clerk would act on — when in fact
   * nobody has marked the register yet.
   */
  attendancePct: number | null;
};

export function attendanceSummary(records: AttendanceLite[]): AttendanceSummary {
  const present = records.filter((r) => r.status === "PRESENT").length;
  const half = records.filter((r) => r.status === "HALF_DAY").length;
  const absent = records.filter((r) => r.status === "ABSENT").length;
  const leave = records.filter((r) => r.status === "LEAVE").length;
  // Rest days are not counted against attendance.
  const workingDays = records.filter((r) => r.status !== "REST").length;
  const credited = present + half * 0.5;

  return {
    days: records.length,
    present,
    absent,
    leave,
    halfDays: half,
    hours: records.reduce((s, r) => s + r.hours, 0),
    attendancePct: workingDays > 0 ? (credited / workingDays) * 100 : null,
  };
}

export type PersonDocLite = { docType: string; expiryDate: Date | null };

/** Documents a person is expected to hold; missing ones are reported, as in M13. */
export const REQUIRED_PERSON_DOCS = ["LICENSE", "AADHAAR", "MEDICAL"];
export const PERSON_DOC_LABEL: Record<string, string> = {
  LICENSE: "Driving licence", AADHAAR: "Aadhaar", MEDICAL: "Medical fitness",
  POLICE_VERIFICATION: "Police verification", TRAINING: "Training certificate", CONTRACT: "Contract",
};

export type PersonDocFinding = { docType: string; state: "valid" | "expiring" | "expired" | "missing" | "no-expiry"; days: number | null };

export function personDocStatus(docs: PersonDocLite[], now = new Date()): { findings: PersonDocFinding[]; expired: number; missing: number } {
  const latest = new Map<string, PersonDocLite>();
  for (const d of docs) {
    const cur = latest.get(d.docType);
    if (!cur || (d.expiryDate && (!cur.expiryDate || d.expiryDate > cur.expiryDate))) latest.set(d.docType, d);
  }

  const findings: PersonDocFinding[] = REQUIRED_PERSON_DOCS.map((t) => {
    const d = latest.get(t);
    if (!d) return { docType: t, state: "missing" as const, days: null };
    if (!d.expiryDate) return { docType: t, state: "no-expiry" as const, days: null };
    // Whole IST calendar days — a medical or a licence is valid through the
    // whole of its expiry date. See docState in M13 for the same rule.
    const days = calendarDaysUntil(d.expiryDate, now);
    return { docType: t, state: days < 0 ? ("expired" as const) : days <= 30 ? ("expiring" as const) : ("valid" as const), days };
  });

  return {
    findings,
    expired: findings.filter((f) => f.state === "expired").length,
    missing: findings.filter((f) => f.state === "missing").length,
  };
}
