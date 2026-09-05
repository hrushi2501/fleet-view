import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { shouldRestoreAssetStatus, shouldMoveAssetToBreakdown } from "./maintenance.ts";
import { validateFuelIssue } from "./fuel-recon.ts";
import { validateOdometerAtScan, validateOdometerAtCheckout, isAssetCheckinAllowed } from "./telematics.ts";

describe("Super Audit — Maintenance & Breakdown Lifecycle", () => {
  test("shouldRestoreAssetStatus: recovers machine to Active when all breakdowns are resolved", () => {
    assert.equal(shouldRestoreAssetStatus("Breakdown", 0), true);
    assert.equal(shouldRestoreAssetStatus("Under-Maintenance", 0), true);
  });

  test("shouldRestoreAssetStatus: keeps machine in Breakdown if other breakdown work orders remain open", () => {
    assert.equal(shouldRestoreAssetStatus("Breakdown", 1), false);
    assert.equal(shouldRestoreAssetStatus("Breakdown", 2), false);
    assert.equal(shouldRestoreAssetStatus("Under-Maintenance", 1), false);
  });

  test("shouldRestoreAssetStatus: does nothing for already Active or Idle assets", () => {
    assert.equal(shouldRestoreAssetStatus("Active", 0), false);
    assert.equal(shouldRestoreAssetStatus("Idle", 0), false);
  });

  test("shouldMoveAssetToBreakdown: flags breakdown or critical issues", () => {
    assert.equal(shouldMoveAssetToBreakdown("BREAKDOWN", "High"), true);
    assert.equal(shouldMoveAssetToBreakdown("REPAIR", "Critical"), true);
    assert.equal(shouldMoveAssetToBreakdown("PM", "Medium"), false);
  });
});

describe("Super Audit — Fuel Issue Sanitation", () => {
  test("validateFuelIssue: rejects non-positive fuel quantities", () => {
    const zero = validateFuelIssue(0, 300);
    assert.equal(zero.valid, false);
    assert.match(zero.error ?? "", /greater than 0 litres/);

    const negative = validateFuelIssue(-50, 300);
    assert.equal(negative.valid, false);
  });

  test("validateFuelIssue: rejects fuel volume exceeding plausible tank capacity", () => {
    const overflow = validateFuelIssue(500, 300); // 500L into 300L tank (> 1.5x)
    assert.equal(overflow.valid, false);
    assert.match(overflow.error ?? "", /exceeds plausible tank capacity/);
  });

  test("validateFuelIssue: accepts valid fills within capacity", () => {
    const normal = validateFuelIssue(250, 300);
    assert.equal(normal.valid, true);

    const noCapacityRecorded = validateFuelIssue(100, 0);
    assert.equal(noCapacityRecorded.valid, true);
  });
});

describe("Super Audit — Check-In Lockouts & Anti-Rollback Safeguards", () => {
  test("isAssetCheckinAllowed: strictly blocks damaged or undergoing maintenance vehicles", () => {
    assert.equal(isAssetCheckinAllowed("Breakdown").allowed, false);
    assert.equal(isAssetCheckinAllowed("Under-Maintenance").allowed, false);
    assert.equal(isAssetCheckinAllowed("Off-hired").allowed, false);
    assert.equal(isAssetCheckinAllowed("Active").allowed, true);
  });

  test("odometer anti-rollback: prevents odometer reverse clocking", () => {
    // Starting meter lower than recorded meter
    const startCheck = validateOdometerAtScan(12000, 12500);
    assert.equal(startCheck.valid, false);

    // Ending meter lower than starting meter
    const endCheck = validateOdometerAtCheckout(12400, 12500);
    assert.equal(endCheck.valid, false);

    // Legitimate shift progression
    const validShift = validateOdometerAtCheckout(12750, 12500);
    assert.equal(validShift.valid, true);
  });
});
