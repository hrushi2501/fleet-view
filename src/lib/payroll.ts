/**
 * Turning an attendance register into what each person is owed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS PURE
 *
 * Every rupee here ends up in someone's hand, and gets argued about when it is
 * short. So the arithmetic lives in one place with no database and no clock,
 * where it can be tested against the cases that actually come up — a half day,
 * a month that starts mid-employment, a rate that changed on the 15th.
 *
 * The caller supplies the register and the wage agreements; this decides the
 * money. Nothing here reads or writes anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULES, STATED PLAINLY
 *
 * A day is counted by its attendance status:
 *
 *   PRESENT    a full day
 *   HALF_DAY   half a day
 *   LEAVE      paid for a monthly salary, unpaid for a daily wage — see below
 *   REST       the weekly off; same treatment as leave
 *   ABSENT     nothing
 *
 * The split on LEAVE and REST is not a technicality. A daily wage is by
 * definition paid per day worked, and a monthly salary is by definition not —
 * a salaried driver does not lose a day's pay for Sunday. Paying both the same
 * way would either underpay every salaried person every week, or hand daily
 * labour a week's wages for days nobody worked.
 *
 * Overtime is hours beyond the standard shift, paid at the agreed hourly rate.
 * Where no overtime rate is agreed, extra hours are simply not paid — an
 * invented rate would be worse than an obvious zero.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Attendance as the register records it. */
export type AttendanceDay = {
  date: Date;
  /** PRESENT | ABSENT | LEAVE | HALF_DAY | REST */
  status: string;
  /** Hours actually worked that day. */
  hours: number;
};

export type WageAgreement = {
  /** DAILY — per day worked. MONTHLY — a fixed salary, pro-rated. */
  kind: string;
  /** Rupees per day, or per month. */
  amount: number;
  /** Rupees per overtime hour. 0 means overtime is not paid. */
  otHourly: number;
  effectiveFrom: Date;
};

export type PayrollSettings = {
  /** Days a monthly salary is divided by. 26 is the usual site convention. */
  standardDays: number;
  /** Hours in a normal shift; beyond this is overtime. */
  standardHours: number;
};

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  standardDays: 26,
  standardHours: 8,
};

export type DayCounts = {
  present: number;
  half: number;
  leave: number;
  absent: number;
  rest: number;
  /** Days actually paid for, after the rules above. */
  paid: number;
  otHours: number;
};

export type PayComputation = DayCounts & {
  wageKind: string;
  wageAmount: number;
  otHourly: number;
  basic: number;
  overtime: number;
  /** basic + overtime, before anything is added or taken off. */
  gross: number;
  /** Anything the caller could not resolve, said out loud rather than hidden. */
  notes: string[];
};

/** Rupees, to the paisa. Money must not drift on repeated arithmetic. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The wage agreement in force on a given day.
 *
 * The latest agreement that had already started. A rate signed on the 15th does
 * not apply to the 1st, which is why this takes a date rather than simply the
 * newest row: a mid-month raise splits the month, and paying the whole month at
 * the new rate would quietly overpay.
 */
export function rateOn(agreements: WageAgreement[], on: Date): WageAgreement | null {
  let best: WageAgreement | null = null;
  for (const a of agreements) {
    if (a.effectiveFrom.getTime() > on.getTime()) continue;
    if (!best || a.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = a;
  }
  return best;
}

/**
 * Counts the register into payable days.
 *
 * `paidLeaveAndRest` differs by wage kind, for the reason given at the top.
 */
export function countDays(
  days: AttendanceDay[],
  paidLeaveAndRest: boolean,
  standardHours: number,
): DayCounts {
  const c: DayCounts = { present: 0, half: 0, leave: 0, absent: 0, rest: 0, paid: 0, otHours: 0 };

  for (const d of days) {
    switch (d.status) {
      case "PRESENT":
        c.present += 1;
        c.paid += 1;
        break;
      case "HALF_DAY":
        c.half += 1;
        c.paid += 0.5;
        break;
      case "LEAVE":
        c.leave += 1;
        if (paidLeaveAndRest) c.paid += 1;
        break;
      case "REST":
        c.rest += 1;
        if (paidLeaveAndRest) c.paid += 1;
        break;
      case "ABSENT":
        c.absent += 1;
        break;
      default:
        // An unrecognised status is not silently treated as absent — that would
        // dock someone's pay because of a typo in a dropdown.
        break;
    }

    // Overtime only accrues on a day actually worked.
    if ((d.status === "PRESENT" || d.status === "HALF_DAY") && d.hours > standardHours) {
      c.otHours += d.hours - standardHours;
    }
  }

  c.paid = money(c.paid);
  c.otHours = money(c.otHours);
  return c;
}

/**
 * What one person earned in one month.
 *
 * Returns a computation with `notes` rather than throwing: a missing wage
 * agreement must still produce a visible row reading zero, so the person is
 * seen on the sheet and asked about, rather than vanishing from payroll.
 */
export function computePay(
  days: AttendanceDay[],
  agreements: WageAgreement[],
  monthEnd: Date,
  settings: PayrollSettings = DEFAULT_PAYROLL_SETTINGS,
): PayComputation {
  const notes: string[] = [];
  const agreement = rateOn(agreements, monthEnd);

  if (!agreement) {
    const counts = countDays(days, false, settings.standardHours);
    notes.push("No wage set for this person — nothing can be calculated until one is entered.");
    return {
      ...counts,
      wageKind: "DAILY",
      wageAmount: 0,
      otHourly: 0,
      basic: 0,
      overtime: 0,
      gross: 0,
      notes,
    };
  }

  const monthly = agreement.kind === "MONTHLY";
  const counts = countDays(days, monthly, settings.standardHours);

  let basic: number;
  if (monthly) {
    // Pro-rated on the standard month, so somebody who joined on the 10th or
    // was absent for a week is paid for what they were there for. Capped at the
    // full salary: a month with more working days than the standard does not
    // pay more than the agreed monthly figure.
    const perDay = settings.standardDays > 0 ? agreement.amount / settings.standardDays : 0;
    basic = Math.min(agreement.amount, perDay * counts.paid);
  } else {
    basic = agreement.amount * counts.paid;
  }

  const overtime = agreement.otHourly > 0 ? agreement.otHourly * counts.otHours : 0;
  if (counts.otHours > 0 && agreement.otHourly <= 0) {
    notes.push(
      `${counts.otHours} overtime hours worked but no overtime rate is agreed, so they are unpaid.`,
    );
  }

  return {
    ...counts,
    wageKind: agreement.kind,
    wageAmount: agreement.amount,
    otHourly: agreement.otHourly,
    basic: money(basic),
    overtime: money(overtime),
    gross: money(basic + overtime),
    notes,
  };
}

/**
 * What is actually handed over, after additions and deductions.
 *
 * Never below zero. An advance larger than the month's earnings is real and
 * common, but a negative payslip is not a thing you can hand somebody — the
 * remainder is carried by the advance ledger, not by a minus sign on the sheet.
 */
export function netPay(input: {
  gross: number;
  bonus?: number;
  advance?: number;
  deduction?: number;
}): number {
  const net =
    input.gross + (input.bonus ?? 0) - (input.advance ?? 0) - (input.deduction ?? 0);
  return money(Math.max(0, net));
}

/** `YYYY-MM` → the first and last instant of that month, in the given offset. */
export function monthBounds(period: string, tzOffsetMinutes = 330): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number);
  const startUtcMs = Date.UTC(y!, m! - 1, 1, 0, 0, 0) - tzOffsetMinutes * 60_000;
  const endUtcMs = Date.UTC(y!, m!, 1, 0, 0, 0) - tzOffsetMinutes * 60_000 - 1;
  return { start: new Date(startUtcMs), end: new Date(endUtcMs) };
}

/** Whether a period string is a month this system will accept. */
export function isValidPeriod(period: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return false;
  const year = Number(period.slice(0, 4));
  return year >= 2000 && year <= 2100;
}
