import assert from "node:assert/strict";
import test from "node:test";
import { DRIVER_POLICY_SUMMARY, POLICY_ISSUANCE_REQUIREMENTS, POLICY_SECTIONS, POLICY_VERSION } from "./policies.ts";

test("the internal policy centre covers every FleetView workforce-data boundary", () => {
  const ids = POLICY_SECTIONS.map((section) => section.id);
  assert.deepEqual(ids, ["scope", "privacy", "monitoring", "acceptable-use", "access", "retention", "rights"]);
  assert.ok(POLICY_SECTIONS.every((section) => section.summary.length > 30 && section.points.length >= 3));
});

test("driver policy summary stays short and available in English and Hindi", () => {
  assert.equal(DRIVER_POLICY_SUMMARY.en.length, 5);
  assert.equal(DRIVER_POLICY_SUMMARY.hi.length, 5);
  assert.ok(DRIVER_POLICY_SUMMARY.en.every((item) => item.length > 20));
  assert.ok(DRIVER_POLICY_SUMMARY.hi.every((item) => item.length > 20));
});

test("the policy cannot be treated as issued while company-specific governance is unnamed", () => {
  assert.equal(POLICY_VERSION, "1.0");
  assert.equal(POLICY_ISSUANCE_REQUIREMENTS.length, 4);
  assert.ok(POLICY_ISSUANCE_REQUIREMENTS.some((item) => item.includes("HR/privacy contact")));
  assert.ok(POLICY_ISSUANCE_REQUIREMENTS.some((item) => item.includes("retention schedules")));
});
