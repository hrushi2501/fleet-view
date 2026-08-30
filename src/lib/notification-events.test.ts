import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { driverAccidentNotification, driverFuelFillNotification, driverProblemNotification } from "./notification-events.ts";

const driver = { assetId: "asset-1", assetCode: "MH12AB1234", driverId: "driver-1", driverName: "Asha" };

describe("driver in-app notifications", () => {
  test("a driver fuel fill is a reportable Fuel notification", () => {
    const event = driverFuelFillNotification({ ...driver, quantity: 42.5, rate: 92.5 });
    assert.equal(event.category, "Fuel");
    assert.equal(event.severity, "Info");
    assert.equal(event.assetId, driver.assetId);
    assert.equal(event.driverId, driver.driverId);
    assert.match(event.message, /42\.5 L/);
  });

  test("an accident is always Critical and links the workshop", () => {
    const event = driverAccidentNotification({ ...driver, note: "Rear collision" });
    assert.equal(event.category, "Driver");
    assert.equal(event.severity, "Critical");
    assert.equal(event.actionUrl, "/maintenance?tab=workorders");
    assert.match(event.message, /Rear collision/);
  });

  test("a driver problem becomes a scoped operational notification", () => {
    const event = driverProblemNotification({ ...driver, kind: "Hydraulic leak", blocking: true });
    assert.equal(event.category, "Driver");
    assert.equal(event.severity, "Warning");
    assert.equal(event.assetId, driver.assetId);
    assert.match(event.title, /Breakdown reported/);
  });
});
