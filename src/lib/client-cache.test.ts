import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clientCache, withClientCache } from "./client-cache";

describe("Client-Side SWR Cache Manager", () => {
  beforeEach(() => {
    clientCache.clear();
  });

  test("stores and retrieves client cache entries", () => {
    clientCache.set("fleet:list", [{ id: "A1", code: "EX-01" }], { ttlMs: 5000 });
    const cached = clientCache.get<{ id: string; code: string }[]>("fleet:list");

    assert.ok(cached);
    assert.equal(cached.isStale, false);
    assert.deepEqual(cached.data, [{ id: "A1", code: "EX-01" }]);
  });

  test("flags stale data after TTL expires", async () => {
    clientCache.set("fleet:stale-test", "val", { ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 10));

    const entry = clientCache.get<string>("fleet:stale-test");
    assert.ok(entry);
    assert.equal(entry.isStale, true);
    assert.equal(entry.data, "val");
  });

  test("withClientCache resolves instantly from fresh cache", async () => {
    let networkCalls = 0;
    const fetcher = async () => {
      networkCalls++;
      return { status: "FRESH_DATA" };
    };

    const first = await withClientCache("query:swr", fetcher, { ttlMs: 10_000 });
    assert.deepEqual(first, { status: "FRESH_DATA" });
    assert.equal(networkCalls, 1);

    const second = await withClientCache("query:swr", fetcher, { ttlMs: 10_000 });
    assert.deepEqual(second, { status: "FRESH_DATA" });
    assert.equal(networkCalls, 1, "Fetcher should not run on fresh cache hit");
  });

  test("invalidates cached keys", () => {
    clientCache.set("alerts:active", 5);
    clientCache.set("alerts:resolved", 20);

    clientCache.invalidate("alerts:*");
    assert.equal(clientCache.get("alerts:active"), null);
    assert.equal(clientCache.get("alerts:resolved"), null);
  });
});
