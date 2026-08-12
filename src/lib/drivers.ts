// M12 — Driver & operator management, safety scoring, assignment eligibility.
//
// Two things this adds over a people list:
//
//   1. A safety score that is *computed* from what actually happened, with old
//      events decaying, rather than a number somebody typed once.
//   2. An eligibility check that can refuse an assignment — expired licence, or
//      no competency for that class of machine. An excavator operator is not
//      automatically a crane operator, and the system shouldn't pretend otherwise.

import { calendarDaysUntil } from "./utils";

export type ViolationLite = {
  id: string;
  type: string;
  severity: string;
  points: number;
  date: Date;
  penalty: number;
  status: string;
};

export type CompetencyLite = {
  assetClass: string;
  level: string;
  expiresOn: Date | null;
};

export type DriverLite = {
  id: string;
  empCode: string;
  name: string;
  type: string; // DRIVER | OPERATOR
  licenseNo: string;
  licenseExpiry: Date;
  status: string;
};

/** Points by severity when a violation doesn't carry its own weighting. */
export const SEVERITY_POINTS: Record<string, number> = { MINOR: 2, MAJOR: 6, CRITICAL: 15 };

export const VIOLATION_LABEL: Record<string, string> = {
  OVERSPEED: "Overspeeding", HARSH_BRAKING: "Harsh braking", IDLING: "Excessive idling",
  NO_SEATBELT: "No seatbelt", PHONE_USE: "Phone use while driving", ACCIDENT: "Accident",
  FUEL_MISUSE: "Fuel misuse", DOCUMENT: "Document violation", OTHER: "Other",
};

/** Violations older than this stop counting entirely. */
export const DECAY_WINDOW_DAYS = 365;

/**
 * Safety score out of 100, starting from a clean 100 and deducting weighted
 * points. Recent events weigh full; older ones fade linearly to zero across the
 * window, so a driver can actually recover from a bad patch.
 */
export function safetyScore(violations: ViolationLite[], now = new Date()): { score: number; weightedPoints: number; recent: number } {
  let weighted = 0;
  let recent = 0;

  for (const v of violations) {
    if (v.status === "DISMISSED") continue;
    const ageDays = (now.getTime() - v.date.getTime()) / 86400000;
    if (ageDays > DECAY_WINDOW_DAYS) continue;

    const points = v.points || SEVERITY_POINTS[v.severity] || 1;
    const decay = 1 - ageDays / DECAY_WINDOW_DAYS; // 1.0 today → 0 at the window edge
    weighted += points * decay;
    if (ageDays <= 90) recent++;
  }

  return { score: Math.max(0, Math.round(100 - weighted)), weightedPoints: weighted, recent };
}

export type EligibilityResult = {
  eligible: boolean;
  blockers: string[];
  warnings: string[];
};

/**
 * Can this person be assigned to this machine today?
 * Returns blockers separately from warnings so the caller can decide whether to
 * hard-stop or merely flag.
 */
export function eligibility(
  driver: DriverLite,
  assetClass: string,
  competencies: CompetencyLite[],
  score: number,
  now = new Date()
): EligibilityResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (driver.status !== "Active") blockers.push(`Marked ${driver.status} — not available for assignment.`);

  // Counted in whole IST calendar days: a licence is valid through its expiry
  // date, and refusing a driver an assignment on his last legal day is both
  // wrong and, on a construction site, expensive.
  const licDays = calendarDaysUntil(driver.licenseExpiry, now);
  if (licDays < 0) blockers.push(`Licence expired ${Math.abs(licDays)} days ago.`);
  else if (licDays <= 30) warnings.push(`Licence expires in ${licDays} days.`);

  const comp = competencies.find((c) => c.assetClass === assetClass);
  if (!comp) {
    blockers.push(`No recorded competency for this machine class.`);
  } else if (comp.expiresOn) {
    const cDays = calendarDaysUntil(comp.expiresOn, now);
    if (cDays < 0) blockers.push(`Competency certificate expired ${Math.abs(cDays)} days ago.`);
    else if (cDays <= 30) warnings.push(`Competency certificate expires in ${cDays} days.`);
  }

  if (score < 40) blockers.push(`Safety score ${score} is below the acceptable threshold.`);
  else if (score < 60) warnings.push(`Safety score ${score} — supervision recommended.`);

  return { eligible: blockers.length === 0, blockers, warnings };
}

export type DriverScorecard = {
  driver: DriverLite;
  score: number;
  band: "excellent" | "good" | "watch" | "critical";
  violations: number;
  recentViolations: number;
  accidents: number;
  penalties: number;
  competencies: CompetencyLite[];
  licenceDays: number;
  licenceState: "valid" | "expiring" | "expired";
  flags: string[];
};

export function driverScorecard(
  driver: DriverLite,
  violations: ViolationLite[],
  competencies: CompetencyLite[],
  now = new Date()
): DriverScorecard {
  const { score, recent } = safetyScore(violations, now);
  // The scorecard is a statement about the last year — that is the window the
  // score itself decays over, and the flag below says "in the last year" in so
  // many words. Counting every violation ever recorded against a driver whose
  // score has already forgiven them contradicts the number beside it, and an
  // accident from four years ago is not evidence for today's assignment.
  const counted = violations.filter(
    (v) => v.status !== "DISMISSED" && (now.getTime() - v.date.getTime()) / 86400000 <= DECAY_WINDOW_DAYS
  );
  const accidents = counted.filter((v) => v.type === "ACCIDENT").length;
  const licenceDays = calendarDaysUntil(driver.licenseExpiry, now);

  const flags: string[] = [];
  if (licenceDays < 0) flags.push(`Licence expired ${Math.abs(licenceDays)} days ago — must not be assigned.`);
  else if (licenceDays <= 30) flags.push(`Licence expires in ${licenceDays} days.`);
  if (competencies.length === 0) flags.push("No competencies recorded — cannot be cleared for any machine class.");
  if (accidents > 0) flags.push(`${accidents} accident${accidents === 1 ? "" : "s"} on record in the last year.`);
  if (recent >= 3) flags.push(`${recent} violations in the last 90 days — a pattern, not a slip.`);

  return {
    driver,
    score,
    band: score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "watch" : "critical",
    violations: counted.length,
    recentViolations: recent,
    accidents,
    penalties: counted.reduce((s, v) => s + v.penalty, 0),
    competencies,
    licenceDays,
    licenceState: licenceDays < 0 ? "expired" : licenceDays <= 30 ? "expiring" : "valid",
    flags,
  };
}
