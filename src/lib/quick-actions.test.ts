import assert from "node:assert/strict";
import test from "node:test";
import { quickActionsFor } from "./quick-actions.ts";

const forPermissions = (permissions: string[], group: "ADMIN" | "SUPERVISOR" | "DRIVER" = "SUPERVISOR") =>
  quickActionsFor({ group, can: (code) => permissions.includes("*") || permissions.includes(code) });

test("fuel clerks receive only their operational fuel and weighbridge actions", () => {
  assert.deepEqual(
    forPermissions(["fuel.view", "fuel.issue", "fuel.receipt", "weighbridge.view", "weighbridge.edit"]).map((action) => action.id),
    ["issue_diesel", "receive_diesel", "weighbridge_ticket"],
  );
});

test("finance receives finance work, not operational shortcuts", () => {
  assert.deepEqual(
    forPermissions(["cost.view", "cost.edit", "reports.view", "reports.export"]).map((action) => action.id),
    ["record_cost", "export_reports"],
  );
});

test("an action requires both the destination view and the actual work permission", () => {
  assert.deepEqual(forPermissions(["fuel.issue"]).map((action) => action.id), []);
  assert.deepEqual(forPermissions(["fuel.view", "fuel.issue"]).map((action) => action.id), ["issue_diesel"]);
});

test("drivers retain their separate minimal mobile workflow", () => {
  assert.deepEqual(forPermissions(["*"], "DRIVER"), []);
});
