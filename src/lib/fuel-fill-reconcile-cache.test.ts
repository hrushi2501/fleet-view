import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { detectedFillsCacheKey } from "./fuel-fill-reconcile";

describe("detected fuel fill cache isolation", () => {
  test("equivalent scopes share a key regardless of object key order", () => {
    const first = detectedFillsCacheKey({ projectId: { in: ["p1", "p2"] }, status: "Active" }, 92.5, 14);
    const second = detectedFillsCacheKey({ status: "Active", projectId: { in: ["p1", "p2"] } }, 92.5, 14);
    assert.equal(first, second);
  });

  test("scope, window and price changes cannot reuse another result", () => {
    const base = detectedFillsCacheKey({ projectId: "p1" }, 92.5, 14);
    assert.notEqual(base, detectedFillsCacheKey({ projectId: "p2" }, 92.5, 14));
    assert.notEqual(base, detectedFillsCacheKey({ projectId: "p1" }, 95, 14));
    assert.notEqual(base, detectedFillsCacheKey({ projectId: "p1" }, 92.5, 7));
  });
});
