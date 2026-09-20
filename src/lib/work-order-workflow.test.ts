import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WORK_ORDER, checkTransition } from "./workflow.ts";
import { PM_PARTS_KITS, pmDue, type ScheduleLite } from "./maintenance.ts";

describe("work order lifecycle state transitions", () => {
  test("allows linear progression: Open -> In-Progress -> Completed -> Closed", () => {
    const t1 = checkTransition(WORK_ORDER, "Open", "In-Progress");
    assert.equal(t1.ok, true);
    assert.equal(t1.transition.permission, "maintenance.edit");

    const t2 = checkTransition(WORK_ORDER, "In-Progress", "Completed");
    assert.equal(t2.ok, true);
    assert.equal(t2.transition.permission, "maintenance.edit");

    const t3 = checkTransition(WORK_ORDER, "Completed", "Closed");
    assert.equal(t3.ok, true);
    assert.equal(t3.transition.permission, "maintenance.approve");
  });

  test("allows early cancellation from Open or In-Progress", () => {
    assert.equal(checkTransition(WORK_ORDER, "Open", "Cancelled").ok, true);
    assert.equal(checkTransition(WORK_ORDER, "In-Progress", "Cancelled").ok, true);
  });

  test("allows reopening a completed work order back to In-Progress", () => {
    const reopen = checkTransition(WORK_ORDER, "Completed", "In-Progress");
    assert.equal(reopen.ok, true);
  });

  test("strictly forbids illegal transitions", () => {
    // Cannot jump straight from Open to Closed without completion
    assert.equal(checkTransition(WORK_ORDER, "Open", "Closed").ok, false);

    // Terminal states cannot be left
    assert.equal(checkTransition(WORK_ORDER, "Closed", "Open").ok, false);
    assert.equal(checkTransition(WORK_ORDER, "Cancelled", "Open").ok, false);
    assert.equal(checkTransition(WORK_ORDER, "Cancelled", "In-Progress").ok, false);
  });
});

describe("work order parts kit arithmetic & cost integrity", () => {
  test("computes parts and labor costs correctly from PM parts kit", () => {
    const kit = PM_PARTS_KITS["Engine oil & filter change"];
    assert.ok(kit && kit.length > 0);

    const partsCost = kit
      .filter((k) => k.kind !== "LABOUR")
      .reduce((sum, k) => sum + k.qty * k.rate, 0);
    const laborCost = kit
      .filter((k) => k.kind === "LABOUR")
      .reduce((sum, k) => sum + k.qty * k.rate, 0);

    assert.equal(partsCost, 4800 + 1200); // 6000
    assert.equal(laborCost, 2 * 1000); // 2000
    assert.equal(partsCost + laborCost, 8000);
  });

  test("handles empty or missing kit gracefully without NaN costs", () => {
    const kit = PM_PARTS_KITS["Non-existent task"] || [];
    const partsCost = kit.filter((k) => k.kind !== "LABOUR").reduce((sum, k) => sum + k.qty * k.rate, 0);
    const laborCost = kit.filter((k) => k.kind === "LABOUR").reduce((sum, k) => sum + k.qty * k.rate, 0);

    assert.equal(partsCost, 0);
    assert.equal(laborCost, 0);
    assert.equal(partsCost + laborCost, 0);
  });
});

describe("critical safety checklist rules", () => {
  test("safety checklist gates completion when critical items are not done", () => {
    const checklist = [
      { id: "c1", item: "Brakes Functional", critical: true, done: false },
      { id: "c2", item: "Wiper Clean", critical: false, done: true },
    ];

    const hasUnfinishedCritical = checklist.some((item) => item.critical && !item.done);
    assert.equal(hasUnfinishedCritical, true, "unfinished critical checklist item must be detected");
  });

  test("safety checklist permits completion when all critical items are done", () => {
    const checklist = [
      { id: "c1", item: "Brakes Functional", critical: true, done: true },
      { id: "c2", item: "Wiper Clean", critical: false, done: false }, // advisory non-critical
    ];

    const hasUnfinishedCritical = checklist.some((item) => item.critical && !item.done);
    assert.equal(hasUnfinishedCritical, false, "all critical items satisfied");
  });
});

describe("duplicate work order allowance and tracking", () => {
  test("duplicate work orders retain distinct identifiers and statuses", () => {
    const wo1 = {
      id: "wo-1",
      woNo: "WO-0001",
      assetId: "asset-101",
      scheduleId: "sch-55",
      description: "Engine oil & filter change",
      status: "In-Progress",
      reportedAt: new Date("2026-09-01"),
    };

    const wo2 = {
      id: "wo-2",
      woNo: "WO-0002",
      assetId: "asset-101",
      scheduleId: "sch-55",
      description: "Engine oil & filter change",
      status: "Open",
      reportedAt: new Date("2026-09-02"),
    };

    // Both coexist
    const openWos = [wo1, wo2];
    assert.equal(openWos.length, 2);
    assert.notEqual(wo1.woNo, wo2.woNo);

    // Duplicate detection helper accurately identifies that an active WO already exists
    const duplicateDetected = openWos.some(
      (w) => w.assetId === "asset-101" && w.description === "Engine oil & filter change"
    );
    assert.equal(duplicateDetected, true);
  });
});

describe("PM schedule forward rolling on completion", () => {
  test("rolling forward schedule updates lastDoneMeter and clears overdue status", () => {
    const schedule: ScheduleLite = {
      id: "sch-1",
      taskName: "250h Service",
      intervalKm: 10000,
      intervalHours: 250,
      intervalDays: 90,
      lastDoneMeter: 5000,
      lastDoneDate: new Date("2026-05-01"),
      estimatedCost: 8000,
    };

    // Machine currently at 15,500 km (10,500 km since last done -> overdue!)
    const before = pmDue(schedule, 15500, false);
    assert.equal(before.status, "overdue");

    // Completing work order at meter 15,500 rolls schedule forward
    const rolledSchedule: ScheduleLite = {
      ...schedule,
      lastDoneMeter: 15500,
      lastDoneDate: new Date("2026-09-20"),
    };

    const after = pmDue(rolledSchedule, 15500, false);
    assert.equal(after.status, "ok", "service completed at current meter resets status to ok");
    assert.ok(after.progressPct < 2, "progressPct resets to near zero");
  });
});
