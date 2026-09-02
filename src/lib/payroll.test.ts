/**
 * Payroll arithmetic, pinned against the cases that cause arguments.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every number here ends up in somebody's hand. The failures that matter are
 * not crashes — they are a quiet half-day, a rest day paid to the wrong kind of
 * worker, or a rate change applied to the whole month instead of half of it.
 * Each of those is somebody being short-paid, noticing, and no longer trusting
 * the sheet. So they are all pinned.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  computePay,
  countDays,
  rateOn,
  netPay,
  monthBounds,
  isValidPeriod,
  DEFAULT_PAYROLL_SETTINGS,
  type AttendanceDay,
  type WageAgreement,
} from "./payroll.ts";

const d = (day: number, status: string, hours = 8): AttendanceDay => ({
  date: new Date(Date.UTC(2026, 7, day)),
  status,
  hours,
});

const daily: WageAgreement = {
  kind: "DAILY",
  amount: 600,
  otHourly: 0,
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
};

const monthlySalary: WageAgreement = {
  kind: "MONTHLY",
  amount: 26000,
  otHourly: 0,
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
};

const monthEnd = new Date("2026-08-31T18:29:59Z");

describe("a daily wage is paid for days worked", () => {
  test("twenty-six present days at 600 is 15,600", () => {
    const days = Array.from({ length: 26 }, (_, i) => d(i + 1, "PRESENT"));
    assert.equal(computePay(days, [daily], monthEnd).basic, 15600);
  });

  test("a half day is half a day's pay", () => {
    const pay = computePay([d(1, "PRESENT"), d(2, "HALF_DAY")], [daily], monthEnd);
    assert.equal(pay.paid, 1.5);
    assert.equal(pay.basic, 900);
  });

  test("absent days are not paid", () => {
    const pay = computePay([d(1, "PRESENT"), d(2, "ABSENT")], [daily], monthEnd);
    assert.equal(pay.basic, 600);
  });

  test("rest days are NOT paid on a daily wage", () => {
    // A daily wage is paid per day worked. Paying Sunday would hand out roughly
    // four extra days a month to every labourer on site.
    const pay = computePay([d(1, "PRESENT"), d(2, "REST")], [daily], monthEnd);
    assert.equal(pay.paid, 1);
    assert.equal(pay.basic, 600);
  });

  test("leave is not paid on a daily wage", () => {
    const pay = computePay([d(1, "PRESENT"), d(2, "LEAVE")], [daily], monthEnd);
    assert.equal(pay.basic, 600);
  });
});

describe("a monthly salary is not docked for the weekly off", () => {
  test("rest days ARE paid on a monthly salary", () => {
    // The opposite mistake: docking a salaried driver for Sunday takes about
    // four days' pay off him every month.
    const pay = computePay([d(1, "PRESENT"), d(2, "REST")], [monthlySalary], monthEnd);
    assert.equal(pay.paid, 2);
  });

  test("a full standard month pays the whole salary", () => {
    const days = Array.from({ length: 26 }, (_, i) => d(i + 1, "PRESENT"));
    assert.equal(computePay(days, [monthlySalary], monthEnd).basic, 26000);
  });

  test("a month with more working days than standard does not overpay", () => {
    // 30 present days against a 26-day standard must still pay 26,000, not
    // 30,000 — the agreement is a monthly figure.
    const days = Array.from({ length: 30 }, (_, i) => d(i + 1, "PRESENT"));
    assert.equal(computePay(days, [monthlySalary], monthEnd).basic, 26000);
  });

  test("joining mid-month is pro-rated, not paid in full", () => {
    const days = Array.from({ length: 13 }, (_, i) => d(i + 18, "PRESENT"));
    assert.equal(computePay(days, [monthlySalary], monthEnd).basic, 13000);
  });
});

describe("overtime", () => {
  const withOt: WageAgreement = { ...daily, otHourly: 100 };

  test("hours beyond the shift are paid at the agreed rate", () => {
    const pay = computePay([d(1, "PRESENT", 11)], [withOt], monthEnd);
    assert.equal(pay.otHours, 3);
    assert.equal(pay.overtime, 300);
  });

  test("a short day creates no overtime", () => {
    assert.equal(computePay([d(1, "PRESENT", 6)], [withOt], monthEnd).otHours, 0);
  });

  test("with no agreed rate the hours are unpaid, and it says so", () => {
    // Inventing an overtime rate would be worse than an obvious zero.
    const pay = computePay([d(1, "PRESENT", 12)], [daily], monthEnd);
    assert.equal(pay.overtime, 0);
    assert.match(pay.notes.join(" "), /no overtime rate/i);
  });

  test("overtime is not earned on a day nobody worked", () => {
    const pay = computePay([d(1, "ABSENT", 12)], [withOt], monthEnd);
    assert.equal(pay.otHours, 0);
  });
});

describe("a rate change applies from its own date, not the whole month", () => {
  const raised: WageAgreement[] = [
    { kind: "DAILY", amount: 600, otHourly: 0, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
    { kind: "DAILY", amount: 750, otHourly: 0, effectiveFrom: new Date("2026-08-15T00:00:00Z") },
  ];

  test("the rate in force on a date is the latest one already started", () => {
    assert.equal(rateOn(raised, new Date("2026-08-10T00:00:00Z"))!.amount, 600);
    assert.equal(rateOn(raised, new Date("2026-08-20T00:00:00Z"))!.amount, 750);
  });

  test("a future rate is not applied early", () => {
    assert.equal(rateOn(raised, new Date("2026-07-01T00:00:00Z"))!.amount, 600);
  });

  test("no agreement yet returns nothing rather than guessing", () => {
    assert.equal(rateOn(raised, new Date("2025-01-01T00:00:00Z")), null);
  });
});

describe("somebody with no wage set is still visible", () => {
  test("the row is produced, reading zero, with the reason", () => {
    // Dropping them from the sheet is how a person silently goes unpaid.
    const pay = computePay([d(1, "PRESENT")], [], monthEnd);
    assert.equal(pay.basic, 0);
    assert.equal(pay.present, 1);
    assert.match(pay.notes.join(" "), /No wage set/i);
  });
});

describe("what is actually handed over", () => {
  test("advances and deductions come off the gross", () => {
    assert.equal(netPay({ gross: 15600, advance: 5000, deduction: 200 }), 10400);
  });

  test("a bonus is added", () => {
    assert.equal(netPay({ gross: 15600, bonus: 1000 }), 16600);
  });

  test("an advance larger than the month cannot produce a negative payslip", () => {
    // Real and common. The remainder is carried by the advance ledger, not
    // printed as a minus sign on something handed to a person with cash.
    assert.equal(netPay({ gross: 5000, advance: 9000 }), 0);
  });
});

describe("the month is the business month, not a UTC one", () => {
  test("August starts at midnight IST, not midnight UTC", () => {
    const { start } = monthBounds("2026-08");
    assert.equal(start.toISOString(), "2026-07-31T18:30:00.000Z");
  });

  test("and ends the instant before September begins", () => {
    const { end } = monthBounds("2026-08");
    assert.equal(end.toISOString(), "2026-08-31T18:29:59.999Z");
  });

  test("a shift logged at 1am IST on the 1st belongs to that month", () => {
    // The bug this prevents: anchoring on UTC midnight puts the 00:00–05:30 IST
    // band into the previous month, moving a night shift's pay.
    const { start, end } = monthBounds("2026-08");
    const nightShift = new Date("2026-07-31T19:30:00Z"); // 01:00 IST, 1 Aug
    assert.ok(nightShift >= start && nightShift <= end);
  });
});

describe("period validation", () => {
  test("accepts a real month", () => {
    assert.equal(isValidPeriod("2026-08"), true);
  });

  test("rejects a thirteenth month and loose formats", () => {
    for (const bad of ["2026-13", "2026-00", "2026-8", "26-08", "2026/08", ""]) {
      assert.equal(isValidPeriod(bad), false, `${bad} should be rejected`);
    }
  });
});

describe("day counting", () => {
  test("an unrecognised status does not silently dock pay", () => {
    // A typo in a dropdown must not be read as absence.
    const counts = countDays([d(1, "PRESENT"), d(2, "WEIRD")], false, 8);
    assert.equal(counts.paid, 1);
    assert.equal(counts.absent, 0);
  });

  test("counts are reported separately so the sheet can be checked by eye", () => {
    const counts = countDays(
      [d(1, "PRESENT"), d(2, "HALF_DAY"), d(3, "LEAVE"), d(4, "ABSENT"), d(5, "REST")],
      false,
      DEFAULT_PAYROLL_SETTINGS.standardHours,
    );
    assert.deepEqual(
      { p: counts.present, h: counts.half, l: counts.leave, a: counts.absent, r: counts.rest },
      { p: 1, h: 1, l: 1, a: 1, r: 1 },
    );
  });
});
