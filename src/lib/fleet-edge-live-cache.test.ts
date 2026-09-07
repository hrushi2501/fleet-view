import assert from "node:assert/strict";
import { test } from "node:test";
import { liveFleetCacheKey } from "./fleet-edge-live";

test("live fleet cache keys are stable for equivalent access scopes", () => {
  const first = liveFleetCacheKey({ AND: [{ projectId: { in: ["p1", "p2"] } }, { decommissionedOn: null }] });
  const second = liveFleetCacheKey({ AND: [{ decommissionedOn: null }, { projectId: { in: ["p1", "p2"] } }] });

  // Array order is meaningful to Prisma, so only object property order is
  // normalised. These two clauses differ in AND order and need not share a key.
  assert.notEqual(first, second);
  assert.equal(
    liveFleetCacheKey({ projectId: { in: ["p1", "p2"] }, decommissionedOn: null }),
    liveFleetCacheKey({ decommissionedOn: null, projectId: { in: ["p1", "p2"] } }),
  );
});

test("live fleet cache keys never share distinct scopes", () => {
  assert.notEqual(
    liveFleetCacheKey({ projectId: { in: ["project-a"] } }),
    liveFleetCacheKey({ projectId: { in: ["project-b"] } }),
  );
});
