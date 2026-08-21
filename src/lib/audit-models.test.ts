/**
 * What the audit log keeps, and what would drown it.
 *
 * The failure these prevent is not a crash — it is an audit log that becomes
 * useless. This fleet syncs telemetry on a two-minute cron, so auditing
 * `TelemetryReading` would bury every hire-rate change and fuel approval under
 * hundreds of thousands of sensor rows. An audit trail nobody can search is the
 * same as not having one, and it costs storage to be useless.
 *
 * The other direction matters just as much: a business model that quietly stops
 * being audited is invisible until an auditor asks the question it would have
 * answered.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { auditableModel, moduleForModel, NEVER_AUDITED } from "./audit-models.ts";

describe("machine-written data stays out of the audit log", () => {
  test("telemetry is never audited", () => {
    // The 2-minute worker writes these for every tracked vehicle.
    for (const model of ["TelemetryReading", "FuelLevelReading", "TripSession", "MeterReading"]) {
      assert.equal(auditableModel(model), false, `${model} must not be audited`);
    }
  });

  test("the audit log does not audit itself", () => {
    // Without this the first write recurses until something gives out.
    assert.equal(auditableModel("AuditEvent"), false);
  });

  test("swept and regenerated records are not audited", () => {
    for (const model of ["Alert", "UnifiedAnomaly", "FuelAnomaly"]) {
      assert.equal(auditableModel(model), false, `${model} is regenerated, not decided`);
    }
  });

  test("the key/value store is excluded because auth counters live there now", () => {
    // Session revocation epochs and failed-login counters change on every
    // sign-in attempt. The security events that matter are audited explicitly.
    assert.equal(auditableModel("Setting"), false);
  });
});

describe("decisions are audited", () => {
  test("money and asset movements are kept", () => {
    for (const model of [
      "FuelTransaction", "FuelReceipt", "TankDip", "FuelReconciliation",
      "HireContract", "HireInvoice", "CostTransaction", "ProjectRevenue",
      "WorkOrder", "ComplianceDoc", "WeighbridgeTicket", "FraudCase",
      "Asset", "Driver", "User", "Role",
    ]) {
      assert.equal(auditableModel(model), true, `${model} must be audited`);
    }
  });

  test("an unclassified new model is audited by default", () => {
    // The safe default for a record of decisions is to keep it. A new model
    // that nobody thought about should show up in the log, not vanish from it.
    assert.equal(auditableModel("SomeModelAddedNextYear"), true);
  });

  test("nothing is audited when there is no model", () => {
    assert.equal(auditableModel(undefined), false);
  });
});

describe("events are filed under a module a person would look in", () => {
  test("fuel models land in FUEL", () => {
    assert.equal(moduleForModel("FuelTransaction"), "FUEL");
    assert.equal(moduleForModel("TankDip"), "FUEL");
  });

  test("money models land in COST", () => {
    assert.equal(moduleForModel("CostTransaction"), "COST");
    assert.equal(moduleForModel("ProjectRevenue"), "COST");
  });

  test("an unmapped model still gets a findable heading", () => {
    assert.equal(moduleForModel("SomethingNew"), "SOMETHINGNEW");
  });
});

describe("the exclusion list is deliberate", () => {
  test("it stays small — every entry is a decision to lose visibility", () => {
    assert.ok(
      NEVER_AUDITED.size <= 15,
      `${NEVER_AUDITED.size} excluded models; if this is growing, the audit log is quietly shrinking`,
    );
  });
});
