import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { countsTowardFleetEfficiency } from "./fleet-usage.ts";

const vehicle = { category: "VEHICLE" };
const equipment = { category: "EQUIPMENT" };
const workingWindow = {
  distanceKm: 84,
  litresBurned: 18,
  avgKmPerL: 4.67,
  insufficientData: false,
};

describe("fleet efficiency eligibility", () => {
  test("counts a credible Tata road-vehicle work window", () => {
    assert.equal(countsTowardFleetEfficiency(vehicle, workingWindow), true);
  });

  test("does not turn equipment fuel burn into road-vehicle km/L", () => {
    assert.equal(countsTowardFleetEfficiency(equipment, workingWindow), false);
  });

  test("excludes parked, unmeasurable, and low-quality vehicle windows", () => {
    assert.equal(countsTowardFleetEfficiency(vehicle, { ...workingWindow, distanceKm: 2 }), false);
    assert.equal(countsTowardFleetEfficiency(vehicle, { ...workingWindow, avgKmPerL: null }), false);
    assert.equal(countsTowardFleetEfficiency(vehicle, { ...workingWindow, insufficientData: true }), false);
  });
});
