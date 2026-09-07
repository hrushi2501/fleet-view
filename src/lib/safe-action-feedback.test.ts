/**
 * Client actions wrapped in `safe()` resolve an error object instead of
 * throwing.  A `try/catch` alone is therefore not enough: it can turn a
 * rejected save into a false success UI.  Keep a small structural regression
 * test over the audited call sites so future edits retain the result guard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const audited: Array<{ file: string; calls: string[] }> = [
  { file: "src/components/FuelForms.tsx", calls: ["saveTank", "saveReceipt", "saveDip", "updateAnomaly", "saveNorm"] },
  { file: "src/components/OpsForms.tsx", calls: ["saveSite", "saveEquipmentPlan", "saveAllocation", "updateAllocationStatus", "saveMobilization", "updateMobilization"] },
  { file: "src/components/HireForms.tsx", calls: ["saveContract", "saveLog", "saveHireInspection", "saveContractAmendment", "saveHirePayment", "approveHireLog"] },
  { file: "src/components/MaintTyreForms.tsx", calls: ["saveSchedule", "raiseWoFromSchedule", "completeWorkOrder", "addWoLine", "toggleChecklistItem", "addChecklistItem", "saveTyre", "saveComponent", "transferComponent"] },
  { file: "src/components/ProdCostForms.tsx", calls: ["saveProduction", "saveProdNorm", "saveCost", "saveRevenue", "saveDepreciation"] },
  { file: "src/components/MasterForms.tsx", calls: ["saveReading", "saveAssetMaster", "saveLifecycleEvent", "saveAttendance", "savePersonDoc", "savePersonMaster"] },
  { file: "src/components/PeopleDocForms.tsx", calls: ["saveCompetency", "saveViolation", "updateViolation", "saveDocument"] },
  { file: "src/components/LossForms.tsx", calls: ["updateRule", "createCase", "updateCase", "addNote", "addEvidence", "addRecovery"] },
  { file: "src/components/ReminderForms.tsx", calls: ["snoozeAlert", "acknowledgeAlert", "resolveAlert", "createWoFromReminder"] },
  { file: "src/components/AccountForms.tsx", calls: ["changeOwnPassword", "adminResetUserPassword"] },
  { file: "src/components/AdminWeighForms.tsx", calls: ["saveRole", "assignRole", "linkUserToDriver", "saveTicket"] },
  { file: "src/components/MaintenanceKanban.tsx", calls: ["updateWorkOrderStatus"] },
  { file: "src/components/DriverFuelWizard.tsx", calls: ["saveFuel", "saveServicePhotos"] },
  { file: "src/components/EntryForms.tsx", calls: ["deleteAsset", "deleteDriver", "deleteUser", "saveFuel", "updateFuel", "deleteFuel", "updateWorkOrderStatus", "saveCompliance", "deleteProject"] },
  { file: "src/components/AttendanceBatchMatrix.tsx", calls: ["batchSaveAttendance"] },
];

for (const { file, calls } of audited) {
  test(`${file} guards safe action results before success UI`, () => {
    const source = readFileSync(join(root, file), "utf8");
    assert.match(source, /isActionError/, `${file} must import and use isActionError`);

    for (const call of calls) {
      const at = source.indexOf(`await ${call}(`);
      assert.notEqual(at, -1, `${file} no longer contains expected action call ${call}`);
      const window = source.slice(at, at + 320);
      assert.match(window, /isActionError\(/, `${file}: ${call} must inspect its resolved result before success UI`);
    }
  });
}
