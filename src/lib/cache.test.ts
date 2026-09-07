import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { serverCache } from "./cache";

describe("Redis-Ready Server Cache Abstraction", () => {
  test("stores and retrieves cached values", async () => {
    await serverCache.set("test:key1", { name: "Excavator", code: "EX-01" }, 60);
    const result = await serverCache.get<{ name: string; code: string }>("test:key1");
    assert.deepEqual(result, { name: "Excavator", code: "EX-01" });
  });

  test("returns null for non-existent or expired keys", async () => {
    const missing = await serverCache.get("test:non-existent");
    assert.equal(missing, null);

    // Test TTL expiration (1 millisecond simulation)
    await serverCache.set("test:expiring", "quick-value", -1);
    const expired = await serverCache.get("test:expiring");
    assert.equal(expired, null);
  });

  test("wrap executes fetcher only on cache miss", async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return { count: 42 };
    };

    const first = await serverCache.wrap("test:wrap", fetcher, 60);
    assert.deepEqual(first, { count: 42 });
    assert.equal(callCount, 1);

    const second = await serverCache.wrap("test:wrap", fetcher, 60);
    assert.deepEqual(second, { count: 42 });
    assert.equal(callCount, 1, "Fetcher should not be called again on cache hit");
  });

  test("invalidates by prefix pattern", async () => {
    await serverCache.set("fleet:asset:1", "data1");
    await serverCache.set("fleet:asset:2", "data2");
    await serverCache.set("fuel:reading:1", "data3");

    const purged = await serverCache.invalidatePrefix("fleet:asset:");
    assert.equal(purged, 2);

    assert.equal(await serverCache.get("fleet:asset:1"), null);
    assert.equal(await serverCache.get("fleet:asset:2"), null);
    assert.equal(await serverCache.get("fuel:reading:1"), "data3");
  });
});
