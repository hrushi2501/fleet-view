import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { detectedFillsCacheKey } from "./fuel-fill-reconcile";

describe("detected fuel fill cache isolation", () => {
  test("equivalent scopes share a key regardless of object key order", () => {
    const first = detectedFillsCacheKey({ projectId: { in: ["p1", "p2"] }, status: "Active" }, { DIESEL: 97.46, PETROL: 113 }, 14);
    const second = detectedFillsCacheKey({ status: "Active", projectId: { in: ["p1", "p2"] } }, { DIESEL: 97.46, PETROL: 113 }, 14);
    assert.equal(first, second);
  });

  test("scope, window and price changes cannot reuse another result", () => {
    const rates = { DIESEL: 97.46, PETROL: 113 };
    const base = detectedFillsCacheKey({ projectId: "p1" }, rates, 14);
    assert.notEqual(base, detectedFillsCacheKey({ projectId: "p2" }, rates, 14));
    assert.notEqual(base, detectedFillsCacheKey({ projectId: "p1" }, { ...rates, PETROL: 114 }, 14));
    assert.notEqual(base, detectedFillsCacheKey({ projectId: "p1" }, rates, 7));
  });
});
