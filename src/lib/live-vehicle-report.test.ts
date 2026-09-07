import assert from "node:assert/strict";
import test from "node:test";
import { liveVehicleReportRows } from "./live-vehicle-report.ts";
import type { LiveVehicle } from "./fleet-edge-live.ts";

const vehicle: LiveVehicle = {
  id: "asset-1", code: "VEH-109", name: "Tipper 109", registrationNo: "RJ21GD0599",
  chassisNo: "MAT786N018E09639", modelLabel: "TATA TATA 912 LPK", assetClass: "TRUCK",
  status: "STOPPED", registerStatus: "ACTIVE", lat: 27.91601, lng: 73.84, headingDeg: null,
  lastUpdate: "2026-09-06T20:35:00.000Z", subscribed: true, onTrip: true,
  driverName: "Ramesh Kumar", projectCode: "SITE-01",
  live: {
    speedKph: 0, odometerKm: 83903, fuelLitres: null, fuelPct: null, fuelCapacityL: 200,
    defPct: null, batteryV: null, engineRunHours: null, ignitionOn: false, gear: null,
    satellites: null, gpsFix: true,
  },
  today: {
    distanceKm: 0, idlingMinutes: 0, stoppageMinutes: 0, unobservedMinutes: 63,
    engineRunHours: null, kmPerL: null, confidence: "LOW", confidenceReasons: ["Too few samples."],
  },
  service: { taskName: null, distanceToServiceKm: 1100, daysToService: 38, status: "OK" },
};

test("live vehicle report keeps unknown telemetry blank instead of exporting zero", () => {
  const rows = liveVehicleReportRows(vehicle, new Date("2026-09-07T00:00:00.000Z"));
  const value = (field: string) => rows.find((row) => row.Field === field)?.Value;

  assert.equal(value("Downloaded at (UTC)"), "2026-09-07T00:00:00.000Z");
  assert.equal(value("Primary fuel (L)"), "");
  assert.equal(value("Primary fuel (%)"), "");
  assert.equal(value("Speed (km/h)"), 0);
  assert.equal(value("On trip"), "Yes");
  assert.equal(value("Fuel-confidence notes"), "Too few samples.");
});
