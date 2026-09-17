import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { calculateFleetEfficiency, countsTowardFleetEfficiency } from "./fleet-usage.ts";

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

  test("calculates total eligible distance divided by total eligible burn", () => {
    const result = calculateFleetEfficiency([
      { category: "VEHICLE", usage: workingWindow },
      {
        category: "VEHICLE",
        usage: { distanceKm: 200, litresBurned: 100, avgKmPerL: 2, insufficientData: false },
      },
      {
        category: "EQUIPMENT",
        usage: { distanceKm: 500, litresBurned: 500, avgKmPerL: 1, insufficientData: false },
      },
      {
        category: "VEHICLE",
        usage: { distanceKm: 100, litresBurned: 2_000, avgKmPerL: 0.05, insufficientData: true },
      },
    ]);

    assert.equal(result.included.length, 2);
    assert.equal(result.distanceKm, 284);
    assert.equal(result.litresBurned, 118);
    assert.equal(result.avgKmPerL, 2.41);
  });
});
