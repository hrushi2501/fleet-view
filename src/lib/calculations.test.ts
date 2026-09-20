/**
 * Regression tests for the operational calculation modules — maintenance,
 * production, loss prevention, costing, master data and attendance.
 *
 * These cover the third audit pass. As with the fuel and data-integrity suites,
 * every case is written as a statement about what the business must never see,
 * because each one corresponds to a defect that was live: a number that looked
 * authoritative and was not.
 *
 * The recurring theme is the difference between *zero* and *unknown*. A service
 * schedule with no meter reading is not up to date; a workshop with no jobs has
 * not achieved perfect preventive discipline; a person nobody marked is not
 * absent. Each of those read as a reassuring number before.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { pmDue, reliability, type ScheduleLite, type WoLite } from "./maintenance.ts";
import { attendanceSummary } from "./master.ts";
import { projectPnL, replaceVsRepair, depreciation } from "./costing.ts";
import { supportedQty, type ContractLite, type LogLite } from "./hire.ts";
import { scorecard, scanSignals, DEFAULT_RULES } from "./loss-prevention.ts";
import { calendarDaysUntil } from "./utils.ts";

const now = new Date("2026-08-12T09:00:00.000Z");

// ---------------------------------------------------------------------------

describe("document expiry is counted in whole IST calendar days", () => {
  // A vehicle is legal to operate *through* its expiry date. Counting elapsed
  // milliseconds instead of calendar days stood machines down a day early —
  // and on a compliance screen that reads as "not legal to operate".
  test("a document expiring later today has not expired", () => {
    const expiresTonight = new Date("2026-08-12T18:00:00.000Z"); // 23:30 IST today
    assert.equal(calendarDaysUntil(expiresTonight, now), 0, "today is 0, not -1");
  });

  test("a document expiring earlier today has still not expired", () => {
    // 08:00 IST — already past at the 14:30 IST 'now', but the same IST day.
    const earlierToday = new Date("2026-08-12T02:30:00.000Z");
    assert.equal(calendarDaysUntil(earlierToday, now), 0);
  });

  test("yesterday is genuinely expired", () => {
    assert.equal(calendarDaysUntil(new Date("2026-08-11T09:00:00.000Z"), now), -1);
  });

  test("tomorrow is one day away", () => {
    assert.equal(calendarDaysUntil(new Date("2026-08-13T01:00:00.000Z"), now), 1);
  });

  test("the count does not shift across the UTC midnight boundary", () => {
    // 20:00 UTC on the 12th is 01:30 IST on the 13th — tomorrow in Jaipur,
    // still today in UTC. The business calendar is the one that governs.
    const lateUtc = new Date("2026-08-12T20:00:00.000Z");
    assert.equal(calendarDaysUntil(lateUtc, now), 1);
  });
});

// ---------------------------------------------------------------------------

describe("preventive maintenance — an unknown meter cannot certify a machine", () => {
  const schedule = (over: Partial<ScheduleLite> = {}): ScheduleLite => ({
    id: "s1", taskName: "Engine oil", intervalKm: 10_000, intervalHours: 0,
    intervalDays: 0, lastDoneMeter: 80_000, lastDoneDate: null, estimatedCost: 8_000,
    ...over,
  });

  test("a machine whose meter has never been recorded is not reported as 'ok'", () => {
    // currentMeter = 0 against lastDoneMeter = 80,000 used to compute
    // used = −80,000, i.e. hugely negative progress, and report "ok" on a
    // service that may be years overdue. Safety-relevant, and the wrong way up.
    const d = pmDue(schedule(), 0, false, now);
    assert.equal(d.assessable, false, "nothing could be judged, and it must say so");
    assert.ok(d.progressPct >= 0, "progress must never be negative");
  });

  test("a meter reading below the last service is not evidence either", () => {
    const d = pmDue(schedule(), 70_000, false, now);
    assert.equal(d.assessable, false);
  });

  test("a real meter reading still produces a real verdict", () => {
    // 9,000 km into a 10,000 km interval: 90% used, which is the warning
    // threshold — due, not yet overdue.
    const d = pmDue(schedule(), 89_000, false, now);
    assert.equal(d.assessable, true);
    assert.equal(d.status, "due");
    assert.equal(d.progressPct, 90);
    assert.equal(d.meterRemaining, 1_000);
  });

  test("an overdue service is reported as overdue, not merely due", () => {
    const d = pmDue(schedule(), 95_000, false, now);
    assert.equal(d.assessable, true);
    assert.equal(d.status, "overdue");
    assert.ok(d.meterRemaining != null && d.meterRemaining < 0);
  });

  test("with no interval configured at all, nothing is assessable", () => {
    const d = pmDue(schedule({ intervalKm: 0, intervalHours: 0, intervalDays: 0 }), 89_000, false, now);
    assert.equal(d.assessable, false);
  });

  test("day-based PM interval calculates progress and remaining days", () => {
    const lastDone = new Date(now.getTime() - 45 * 86400000); // 45 days ago
    const d = pmDue(schedule({ intervalKm: 0, intervalDays: 90, lastDoneDate: lastDone }), 80_000, false, now);
    assert.equal(d.assessable, true);
    assert.equal(d.daysRemaining, 45);
    assert.equal(d.progressPct, 50);

    // If intervalDays is configured but lastDoneDate is null, it cannot be assessed
    const unassessed = pmDue(schedule({ intervalKm: 0, intervalDays: 90, lastDoneDate: null }), 80_000, false, now);
    assert.equal(unassessed.assessable, false);

    // If intervalDays is 0 even if lastDoneDate is present, day basis is ignored
    const zeroDays = pmDue(schedule({ intervalKm: 0, intervalDays: 0, lastDoneDate: lastDone }), 80_000, false, now);
    assert.equal(zeroDays.assessable, false);
  });
});

describe("reliability — no work orders is not perfect discipline", () => {
  const wo = (over: Partial<WoLite> = {}): WoLite => ({
    id: "w1", type: "BREAKDOWN", status: "Closed", totalCost: 5_000, downtimeHrs: 4,
    reportedAt: new Date("2026-08-01T06:00:00.000Z"),
    completedAt: new Date("2026-08-01T10:00:00.000Z"),
    ...over,
  });

  test("an empty workshop reports null planned-ratio, not 0%", () => {
    const r = reliability([], 30, now);
    assert.equal(r.plannedRatio, null, "0% would read as a workshop that never plans");
    assert.equal(r.mtbfDays, null);
    assert.equal(r.mttrHours, null);
  });

  test("a job completed before it was reported does not shorten the mean repair time", () => {
    const good = reliability([wo()], 30, now);
    const withTypo = reliability([
      wo(),
      // Mistyped dates: completed a full day before it was reported. Its −24 h
      // would cancel most of the genuine 4 h repair in the average.
      wo({
        id: "w2",
        reportedAt: new Date("2026-08-02T10:00:00.000Z"),
        completedAt: new Date("2026-08-01T10:00:00.000Z"),
      }),
    ], 30, now);

    assert.equal(good.mttrHours, 4);
    assert.equal(withTypo.mttrHours, 4, "the impossible row is excluded, not averaged in");
    assert.ok(withTypo.mttrHours! > 0);
  });

  test("a zero-length window does not produce a reliability statistic", () => {
    const r = reliability([wo()], 0, now);
    assert.equal(r.mtbfDays, null, "'fails every 0 days' is not a statistic");
  });

  test("real jobs still produce real ratios", () => {
    const r = reliability([wo(), wo({ id: "w2", type: "PM" })], 30, now);
    assert.equal(r.plannedRatio, 50);
    assert.equal(r.mtbfDays, 30);
  });
});

describe("attendance — nobody marked is not everybody absent", () => {
  test("an empty register reports null, not 0% attendance", () => {
    const s = attendanceSummary([]);
    assert.equal(s.attendancePct, null, "0% would accuse a workforce of not turning up");
    assert.equal(s.days, 0);
  });

  test("a marked register reports a real percentage", () => {
    const s = attendanceSummary([
      { date: new Date("2026-08-01T06:00:00Z"), status: "PRESENT", hours: 8 },
      { date: new Date("2026-08-02T06:00:00Z"), status: "PRESENT", hours: 8 },
      { date: new Date("2026-08-03T06:00:00Z"), status: "ABSENT", hours: 0 },
    ]);
    assert.equal(s.days, 3);
    assert.ok(s.attendancePct != null);
    assert.ok(Math.abs(s.attendancePct! - 66.67) < 0.1, `got ${s.attendancePct}`);
  });
});

describe("project P&L — no revenue is not a 0% margin", () => {
  test("a project with no revenue entered reports null margin", () => {
    const p = projectPnL("p1", 0, [{ head: "FUEL", amount: 50_000 }], 0);
    assert.equal(p.marginPct, null, "0% margin would read as breaking even on a loss");
    assert.equal(p.budgetUsedPct, null);
    assert.equal(p.cost, 50_000, "the cost is still real and still reported");
  });

  test("real revenue produces a real margin", () => {
    const p = projectPnL("p1", 100_000, [{ head: "FUEL", amount: 40_000 }], 80_000);
    assert.equal(p.marginPct, 60);
    assert.equal(p.budgetUsedPct, 50);
    assert.equal(p.overBudget, false);
  });

  test("a loss-making project reports a negative margin rather than hiding it", () => {
    const p = projectPnL("p1", 100_000, [{ head: "FUEL", amount: 150_000 }], 100_000);
    assert.ok(p.marginPct != null && p.marginPct < 0);
    assert.equal(p.overBudget, true);
  });
});

describe("depreciation is bounded by physical reality", () => {
  const base = {
    acquisitionCost: 2_000_000, salvageValue: 200_000, usefulLifeYears: 10,
    method: "SLM", inServiceDate: new Date("2016-01-01T00:00:00Z"), yearMfg: 2016,
  };

  test("book value never falls below salvage, however old the machine", () => {
    const d = depreciation(base, new Date("2066-01-01T00:00:00Z"));
    assert.ok(d.bookValue >= base.salvageValue, `book ${d.bookValue} < salvage ${base.salvageValue}`);
    assert.ok(d.accumulated <= base.acquisitionCost - base.salvageValue);
  });

  test("a machine with no acquisition cost is not depreciated into nonsense", () => {
    const d = depreciation({ ...base, acquisitionCost: 0 });
    assert.equal(d.annual, 0);
    assert.ok(Number.isFinite(d.bookValue));
  });

  test("negative acquisition cost or negative salvage does not produce corrupt depreciation", () => {
    const dNegCost = depreciation({ ...base, acquisitionCost: -50_000 });
    assert.equal(dNegCost.known, false);
    assert.equal(dNegCost.annual, 0);

    const dNegSalvage = depreciation({ ...base, salvageValue: -10_000 });
    assert.ok(dNegSalvage.accumulated <= base.acquisitionCost);
  });

  test("WDV never produces a negative or NaN book value", () => {
    const d = depreciation({ ...base, method: "WDV" }, new Date("2036-01-01T00:00:00Z"));
    assert.ok(Number.isFinite(d.bookValue) && d.bookValue >= 0);
    assert.ok(Number.isFinite(d.annual));
  });

  test("calculates active straight-line and WDV depreciation from acquisition cost and yearMfg", () => {
    const slm = depreciation({
      acquisitionCost: 5_000_000,
      salvageValue: 500_000,
      usefulLifeYears: 10,
      method: "SLM",
      inServiceDate: null,
      yearMfg: 2021,
    }, new Date("2026-01-01T00:00:00Z"));

    assert.equal(slm.known, true);
    assert.equal(slm.annual, 450_000);
    assert.equal(slm.monthly, 37_500);
    assert.ok(slm.bookValue < 5_000_000);
    assert.ok(slm.bookValue > 500_000);
    assert.equal(slm.fullyDepreciated, false);

    // Depreciation edge cases
    assert.equal(depreciation({ acquisitionCost: 0, salvageValue: 0, usefulLifeYears: 10, method: "SLM", yearMfg: 2020, inServiceDate: new Date() }, now).known, false);
    assert.equal(depreciation({ acquisitionCost: 1000, salvageValue: 0, usefulLifeYears: 10, method: "SLM", inServiceDate: null, yearMfg: 0 }, now).known, false);

    const wdv = depreciation({
      acquisitionCost: 5_000_000,
      salvageValue: 500_000,
      usefulLifeYears: 10,
      method: "WDV",
      inServiceDate: new Date("2021-01-01T00:00:00Z"),
      yearMfg: 2021,
    }, new Date("2026-01-01T00:00:00Z"));
    assert.equal(wdv.known, true);
    assert.ok(wdv.bookValue > 500_000);
    assert.ok(Math.abs(wdv.bookValue - 1_581_388) < 2000, "WDV book value matches exponential salvage rate");
    assert.ok(Math.abs(wdv.annual - 325_246) < 2000, "WDV annual depreciation reflects calculated rate from salvage ratio");
  });
});

describe("hire contract billing supportedQty", () => {
  test("bills worked hours and standby hours when PER_HOUR is configured", () => {
    const contract: ContractLite = {
      id: "c1",
      vendor: "Vendor A",
      rateType: "PER_HOUR",
      rate: 1200,
      overtimeRate: 1500,
      idleBillable: true,
      breakdownBillable: false,
      minGuarantee: 0,
      guaranteeUnit: "NONE",
      fuelBorneBy: "CLIENT",
    };
    const logs: LogLite[] = [
      { date: new Date("2026-08-01"), source: "SITE", present: true, workedHours: 6, idleHours: 2, breakdownHours: 1, km: 120, trips: 4 },
      { date: new Date("2026-08-02"), source: "SITE", present: true, workedHours: 8, idleHours: 0, breakdownHours: 0, km: 160, trips: 6 },
    ];
    const res = supportedQty(contract, logs);
    assert.equal(res.workedHours, 14);
    assert.equal(res.idleHours, 2);
    assert.equal(res.breakdownHours, 1);
    assert.equal(res.km, 280, "accumulates total km across present days");
    assert.equal(res.trips, 10, "accumulates total trips across present days");
    assert.equal(res.qty, 16, "14 worked + 2 idle = 16 billable hours");
  });

  test("bills day rates when PER_DAY is configured", () => {
    const contract: ContractLite = {
      id: "c2",
      vendor: "Vendor B",
      rateType: "PER_DAY",
      rate: 8000,
      overtimeRate: 1000,
      idleBillable: false,
      breakdownBillable: false,
      minGuarantee: 0,
      guaranteeUnit: "NONE",
      fuelBorneBy: "CLIENT",
    };
    const logs: LogLite[] = [
      { date: new Date("2026-08-01"), source: "SITE", present: true, workedHours: 5, idleHours: 0, breakdownHours: 0, km: 50, trips: 2 },
      { date: new Date("2026-08-02"), source: "SITE", present: true, workedHours: 0, idleHours: 4, breakdownHours: 4, km: 0, trips: 0 },
      { date: new Date("2026-08-03"), source: "SITE", present: false, workedHours: 0, idleHours: 0, breakdownHours: 0, km: 0, trips: 0 },
    ];
    const res = supportedQty(contract, logs);
    assert.equal(res.presentDays, 2);
    assert.equal(res.km, 50);
    assert.equal(res.trips, 2);
    assert.equal(res.qty, 1, "only 1 day worked > 0; idle day without worked hours is non-billable when idleBillable is false");
  });
});

describe("hire supportedQty accounts for standby without misbilling breakdowns", () => {
  const contract = {
    id: "c-1",
    vendor: "Test Vendor",
    rateType: "PER_DAY" as const,
    rate: 5000,
    overtimeRate: 0,
    minGuarantee: 0,
    guaranteeUnit: null,
    fuelBorneBy: "OWNER",
    breakdownBillable: false,
    idleBillable: true,
  };

  const baseLog = {
    date: new Date("2026-08-01"),
    present: true,
    workedHours: 0,
    idleHours: 0,
    breakdownHours: 0,
    km: 0,
    trips: 0,
    source: "MANUAL",
  };

  test("standby day with 0 hours is billable when idle is billable and not broken down", () => {
    const res = supportedQty(contract, [baseLog]);
    assert.equal(res.qty, 1);
  });

  test("breakdown day with 0 worked hours is not billable when breakdown is not billable", () => {
    const res = supportedQty(contract, [{ ...baseLog, breakdownHours: 8 }]);
    assert.equal(res.qty, 0);
  });

  test("breakdown day is billable if contract explicitly marks breakdown billable", () => {
    const res = supportedQty({ ...contract, breakdownBillable: true }, [{ ...baseLog, breakdownHours: 8 }]);
    assert.equal(res.qty, 1);
  });
});

describe("replace-vs-repair does not divide by a written-off book value", () => {
  test("a fully depreciated machine yields no ratio rather than Infinity", () => {
    const dep = depreciation(
      { acquisitionCost: 1_000_000, salvageValue: 0, usefulLifeYears: 5, method: "SLM",
        inServiceDate: new Date("2000-01-01T00:00:00Z"), yearMfg: 2000 },
      now,
    );
    const advice = replaceVsRepair(200_000, dep, 300, 26, 5);
    assert.ok(advice.maintenanceToBookRatio === null || Number.isFinite(advice.maintenanceToBookRatio));
    assert.ok(["keep", "watch", "replace"].includes(advice.verdict));
  });
});

describe("loss-prevention scorecard", () => {
  test("no pursued cases yields a null recovery rate, not 0%", () => {
    const sc = scorecard([]);
    assert.equal(sc.recoveryRate, null, "0% recovered would read as a team failing to recover");
    assert.equal(sc.avgDaysToResolve, null);
  });
});

describe("loss-prevention signal scanning", () => {
  test("categorizes ASSET_EFFICIENCY as FUEL_EFFICIENCY_DROP", () => {
    const rules = DEFAULT_RULES.map((r) => ({
      code: r.code,
      enabled: true,
      threshold: r.threshold,
      severity: r.severity,
      autoCase: true,
    }));

    const signals = scanSignals({
      rules,
      dieselRate: 90,
      fuelAnomalies: [
        {
          id: "anom_eff_1",
          source: "ASSET_EFFICIENCY",
          severity: "MEDIUM",
          score: 65,
          litres: 45,
          valueAtRisk: 4050,
          reasons: "Burn rate 38% above norm",
          status: "OPEN",
          tankId: null,
          assetId: "ast_1",
        },
        {
          id: "anom_rec_1",
          source: "RECEIPT",
          severity: "HIGH",
          score: 80,
          litres: 60,
          valueAtRisk: 5400,
          reasons: "Short delivery detected",
          status: "OPEN",
          tankId: "tank_1",
          assetId: null,
        },
        {
          id: "anom_tank_1",
          source: "TANK_RECON",
          severity: "HIGH",
          score: 75,
          litres: 50,
          valueAtRisk: 4500,
          reasons: "Unaccounted dip drop",
          status: "OPEN",
          tankId: "tank_1",
          assetId: null,
        },
      ],
      uncontractedHired: [],
      meterRollbacks: [],
      noEvidenceFuel: [],
      expiredRunning: [],
    });

    const effSig = signals.find((s) => s.signalKey === "FUEL_ANOMALY:anom_eff_1");
    assert.ok(effSig, "Efficiency signal should be generated");
    assert.equal(effSig.ruleCode, "FUEL_EFFICIENCY_DROP");
    assert.ok(effSig.title.includes("Abnormal fuel consumption"));

    const recSig = signals.find((s) => s.signalKey === "FUEL_ANOMALY:anom_rec_1");
    assert.ok(recSig);
    assert.equal(recSig.ruleCode, "FUEL_SHORT_DELIVERY");

    const tankSig = signals.find((s) => s.signalKey === "FUEL_ANOMALY:anom_tank_1");
    assert.ok(tankSig);
    assert.equal(tankSig.ruleCode, "FUEL_TANK_GAP");
  });
});

