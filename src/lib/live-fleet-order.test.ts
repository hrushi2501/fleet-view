import assert from "node:assert/strict";
import test from "node:test";
import { sortLiveVehiclesByStatus } from "./live-fleet-order.ts";

test("the dispatcher list puts active work before stopped and offline assets", () => {
  const rows = sortLiveVehiclesByStatus([
    { status: "OFFLINE", registrationNo: "RJ21EA2676" },
    { status: "STOPPED", registrationNo: "RJ21EA5176" },
    { status: "IDLING", registrationNo: "RJ21EA5196" },
    { status: "MOVING", registrationNo: "RJ21EA1741" },
  ]);

  assert.deepEqual(rows.map((row) => row.status), ["MOVING", "IDLING", "STOPPED", "OFFLINE"]);
});

test("vehicles are predictably ordered inside their status group", () => {
  const rows = sortLiveVehiclesByStatus([
    { status: "MOVING", registrationNo: "RJ21EA20" },
    { status: "MOVING", registrationNo: "RJ21EA3" },
  ]);

  assert.deepEqual(rows.map((row) => row.registrationNo), ["RJ21EA3", "RJ21EA20"]);
});
