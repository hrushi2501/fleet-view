"use server";

/**
 * Preparing, adjusting and signing off a month's payroll.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The rules these actions exist to enforce, all of which protect the same
 * thing — that a payslip handed to somebody stays the payslip they were handed:
 *
 *   · A wage is never edited. Setting a new one records a fresh agreement from
 *     a date, so last month's sheet still shows last month's rate.
 *   · A DRAFT run can be rebuilt from the register as often as you like.
 *   · A FINALISED run is closed. No line changes, no rebuild, no delete.
 *   · Preparing and finalising need different permissions.
 *
 * Everything that touches money is written to the audit log, because "who
 * changed his pay, and when" is a question that gets asked months later.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction, ActionError, safe } from "@/lib/guard";
import { audit } from "@/lib/audit";
import {
  computePay,
  netPay,
  monthBounds,
  isValidPeriod,
  type AttendanceDay,
  type WageAgreement,
} from "@/lib/payroll";

type Result = { ok: true; message: string };

/**
 * Records a new wage agreement for someone, effective from a date.
 *
 * Deliberately an insert, never an update. Editing the number in place would
 * silently restate every payslip already produced from it.
 */
async function setWage__impl(input: {
  driverId: string;
  kind: string;
  amount: number;
  otHourly: number;
  effectiveFrom: string;
  note?: string;
}): Promise<Result> {
  const access = await requireAction("payroll.edit");

  if (!["DAILY", "MONTHLY"].includes(input.kind)) {
    throw new ActionError("Wage must be either daily or monthly.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new ActionError("Enter a wage amount greater than zero.");
  }
  if (!Number.isFinite(input.otHourly) || input.otHourly < 0) {
    throw new ActionError("Overtime rate cannot be negative.");
  }
  const effectiveFrom = new Date(input.effectiveFrom);
  if (Number.isNaN(effectiveFrom.getTime())) {
    throw new ActionError("Enter a valid date for when this wage starts.");
  }

  const driver = await db.driver.findUnique({
    where: { id: input.driverId },
    select: { id: true, name: true, empCode: true },
  });
  if (!driver) throw new ActionError("That person no longer exists.");

  await db.wageRate.create({
    data: {
      driverId: driver.id,
      kind: input.kind,
      amount: input.amount,
      otHourly: input.otHourly,
      effectiveFrom,
      note: input.note?.trim() || null,
      createdBy: access.session.name,
    },
  });

  await audit({
    action: "CREATE",
    module: "PAYROLL",
    entity: "WageRate",
    entityId: driver.id,
    summary: `Wage for ${driver.name} (${driver.empCode}) set to ₹${input.amount} ${
      input.kind === "MONTHLY" ? "per month" : "per day"
    } from ${effectiveFrom.toISOString().slice(0, 10)}`,
  });

  revalidatePath("/people/payroll");
  return { ok: true, message: `Wage saved for ${driver.name}.` };
}

/**
 * Builds (or rebuilds) a month's payroll from the attendance register.
 *
 * Rebuilding a DRAFT is safe and expected — attendance gets corrected after the
 * month closes. Any manual adjustment already made to a line is carried across,
 * because a rebuild should refresh the days worked without quietly discarding
 * an advance somebody recorded.
 */
async function buildRun__impl(period: string): Promise<Result> {
  const access = await requireAction("payroll.edit");

  if (!isValidPeriod(period)) {
    throw new ActionError("Choose a month in the form 2026-08.");
  }

  const existing = await db.payrollRun.findUnique({
    where: { period },
    include: { lines: true },
  });
  if (existing?.status === "FINALISED") {
    throw new ActionError(`Payroll for ${period} is already finalised and cannot be rebuilt.`);
  }

  const { start, end } = monthBounds(period);

  const [people, attendance, wages] = await Promise.all([
    db.driver.findMany({
      where: { status: "Active" },
      select: { id: true, name: true, empCode: true },
      orderBy: { empCode: "asc" },
    }),
    db.attendance.findMany({
      where: { date: { gte: start, lte: end } },
      select: { driverId: true, date: true, status: true, hours: true },
    }),
    db.wageRate.findMany({
      select: { driverId: true, kind: true, amount: true, otHourly: true, effectiveFrom: true },
    }),
  ]);

  if (people.length === 0) {
    throw new ActionError("There are no active people to pay.");
  }

  const daysBy = new Map<string, AttendanceDay[]>();
  for (const a of attendance) {
    const list = daysBy.get(a.driverId) ?? [];
    list.push({ date: a.date, status: a.status, hours: a.hours });
    daysBy.set(a.driverId, list);
  }

  const wagesBy = new Map<string, WageAgreement[]>();
  for (const w of wages) {
    const list = wagesBy.get(w.driverId) ?? [];
    list.push({ kind: w.kind, amount: w.amount, otHourly: w.otHourly, effectiveFrom: w.effectiveFrom });
    wagesBy.set(w.driverId, list);
  }

  const keptAdjustments = new Map(
    (existing?.lines ?? []).map((l): [string, {bonus:number;advance:number;deduction:number;adjustedBy:string|null;adjustedNote:string|null}] => [
      l.driverId,
      { bonus: l.bonus, advance: l.advance, deduction: l.deduction, adjustedBy: l.adjustedBy, adjustedNote: l.adjustedNote },
    ]),
  );

  const run =
    existing ??
    (await db.payrollRun.create({
      data: { period, createdBy: access.session.name },
    }));

  const settings = { standardDays: run.standardDays, standardHours: run.standardHours };

  // Worked out in memory first, then written in one statement. A create() per
  // person inside the transaction is a round trip per person — fine for the
  // handful here today, an obvious stall on a full labour roll, and it holds a
  // write transaction open for the whole time.
  const rows = people.map((person) => {
    const pay = computePay(daysBy.get(person.id) ?? [], wagesBy.get(person.id) ?? [], end, settings);
    const kept = keptAdjustments.get(person.id);
    return {
          runId: run.id,
          driverId: person.id,
          empCode: person.empCode,
          name: person.name,
          wageKind: pay.wageKind,
          wageAmount: pay.wageAmount,
          otHourly: pay.otHourly,
          daysPresent: pay.present,
          daysHalf: pay.half,
          daysLeave: pay.leave,
          daysAbsent: pay.absent,
          daysRest: pay.rest,
          daysPaid: pay.paid,
          otHours: pay.otHours,
          basic: pay.basic,
          overtime: pay.overtime,
          bonus: kept?.bonus ?? 0,
          advance: kept?.advance ?? 0,
          deduction: kept?.deduction ?? 0,
          net: netPay({
            gross: pay.gross,
            bonus: kept?.bonus ?? 0,
            advance: kept?.advance ?? 0,
            deduction: kept?.deduction ?? 0,
          }),
          adjustedBy: kept?.adjustedBy ?? null,
          adjustedNote: kept?.adjustedNote ?? null,
    };
  });

  await db.$transaction([
    db.payrollLine.deleteMany({ where: { runId: run.id } }),
    db.payrollLine.createMany({ data: rows }),
  ]);

  await audit({
    action: "UPDATE",
    module: "PAYROLL",
    entity: "PayrollRun",
    entityId: run.id,
    summary: `Payroll for ${period} ${existing ? "rebuilt" : "prepared"} from attendance — ${people.length} people`,
  });

  revalidatePath("/people/payroll");
  return {
    ok: true,
    message: `${period} ${existing ? "rebuilt" : "prepared"} — ${people.length} people.`,
  };
}

/** Records an advance, deduction or bonus against one person's month. */
async function adjustLine__impl(input: {
  lineId: string;
  bonus: number;
  advance: number;
  deduction: number;
  note?: string;
}): Promise<Result> {
  const access = await requireAction("payroll.edit");

  for (const [label, value] of [
    ["Bonus", input.bonus],
    ["Advance", input.advance],
    ["Deduction", input.deduction],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new ActionError(`${label} must be zero or more.`);
    }
  }

  const line = await db.payrollLine.findUnique({
    where: { id: input.lineId },
    include: { run: { select: { status: true, period: true } } },
  });
  if (!line) throw new ActionError("That payroll row no longer exists.");
  if (line.run.status === "FINALISED") {
    throw new ActionError(`${line.run.period} is finalised and cannot be changed.`);
  }

  const net = netPay({
    gross: line.basic + line.overtime,
    bonus: input.bonus,
    advance: input.advance,
    deduction: input.deduction,
  });

  await db.payrollLine.update({
    where: { id: line.id },
    data: {
      bonus: input.bonus,
      advance: input.advance,
      deduction: input.deduction,
      net,
      adjustedBy: access.session.name,
      adjustedNote: input.note?.trim() || null,
    },
  });

  await audit({
    action: "UPDATE",
    module: "PAYROLL",
    entity: "PayrollLine",
    entityId: line.id,
    summary:
      `${line.name} (${line.empCode}) ${line.run.period}: ` +
      `advance ₹${line.advance}→₹${input.advance}, deduction ₹${line.deduction}→₹${input.deduction}, ` +
      `bonus ₹${line.bonus}→₹${input.bonus}, net ₹${line.net}→₹${net}` +
      (input.note?.trim() ? ` — ${input.note.trim()}` : ""),
  });

  revalidatePath("/people/payroll");
  return { ok: true, message: `Updated ${line.name}.` };
}

/**
 * Closes the month for payment.
 *
 * Separate permission from preparing it, and one way only — there is no
 * unfinalise, because a sheet that can be reopened is not a record of what was
 * paid. A mistake found afterwards is corrected in the next month, which is
 * also how it would be handled on paper.
 */
async function finaliseRun__impl(runId: string): Promise<Result> {
  const access = await requireAction("payroll.approve");

  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { lines: { select: { net: true } } },
  });
  if (!run) throw new ActionError("That payroll run no longer exists.");
  if (run.status === "FINALISED") {
    throw new ActionError(`${run.period} is already finalised.`);
  }
  if (run.lines.length === 0) {
    throw new ActionError("Prepare the payroll before finalising it.");
  }

  const total = run.lines.reduce((s, l) => s + l.net, 0);

  await db.payrollRun.update({
    where: { id: run.id },
    data: {
      status: "FINALISED",
      finalisedAt: new Date(),
      finalisedBy: access.session.name,
    },
  });

  await audit({
    action: "APPROVE",
    module: "PAYROLL",
    entity: "PayrollRun",
    entityId: run.id,
    summary: `Payroll ${run.period} finalised for payment — ${run.lines.length} people, ₹${Math.round(total)}`,
  });

  revalidatePath("/people/payroll");
  return { ok: true, message: `${run.period} finalised — ₹${Math.round(total).toLocaleString("en-IN")}.` };
}

// Wrapped so a thrown ActionError reaches the form as a message the person can
// act on, rather than as a stack trace or a silent failure.
export const setWage = safe(setWage__impl);
export const buildRun = safe(buildRun__impl);
export const adjustLine = safe(adjustLine__impl);
export const finaliseRun = safe(finaliseRun__impl);
