import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSmoothZoomStep,
  clampZoom,
  installSmoothWheelZoom,
} from "./leaflet-smooth-wheel-zoom";

describe("Smooth Wheel Zoom Math", () => {
  test("clamps zoom levels cleanly to min and max", () => {
    assert.equal(clampZoom(15, 3, 19), 15);
    assert.equal(clampZoom(2.5, 3, 19), 3);
    assert.equal(clampZoom(22, 3, 19), 19);
  });

  test("smoothly interpolates towards goal zoom without snapping", () => {
    const current = 7.0;
    const goal = 8.0;
    const next = computeSmoothZoomStep(current, goal, 0.28);

    assert.ok(next > current, "Zoom should increase towards goal");
    assert.ok(next < goal, "Step should be a fractional interpolation, not a discrete jump");
    assert.equal(next, 7.28);

    // Subsequent steps converge towards goal
    const step2 = computeSmoothZoomStep(next, goal, 0.28);
    assert.ok(step2 > next && step2 < goal);
  });

  test("settles cleanly to exact goal when delta is microscopic", () => {
    const nearGoal = 8.0004;
    const goal = 8.0;
    const settled = computeSmoothZoomStep(nearGoal, goal, 0.28);
    assert.equal(settled, goal);
  });

  test("installSmoothWheelZoom executes safely without throwing in server/test environments", () => {
    assert.doesNotThrow(() => {
      installSmoothWheelZoom();
    });
  });
});
