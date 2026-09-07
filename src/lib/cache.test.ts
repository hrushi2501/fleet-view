import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { serverCache, createCacheStore, RedisCacheStore } from "./cache";

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

describe("the cache tells the truth about what it is", () => {
  test("no credentials means memory, and it says so", () => {
    assert.equal(createCacheStore({}).type, "memory");
  });

  test("a URL with no token stays on memory rather than pretending", () => {
    // Half a credential used to build a store that called itself Redis and then
    // failed every call. Silent and untraceable; this is the guard against it.
    const half = { UPSTASH_REDIS_REST_URL: "https://example.upstash.io" };
    assert.equal(createCacheStore(half).type, "memory");
  });

  test("both halves present means a real Redis store", () => {
    const full = {
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "t",
    };
    assert.equal(createCacheStore(full).type, "redis");
  });
});

describe("an unreachable Redis must not take a page down", () => {
  /** Every call fails, the way an outage looks from inside a request. */
  function brokenRedis() {
    const store = new RedisCacheStore("https://unreachable.invalid", "t");
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    return { store, restore: () => { globalThis.fetch = original; } };
  }

  test("reads report a miss instead of throwing", async () => {
    const { store, restore } = brokenRedis();
    try {
      assert.equal(await store.get("anything"), null);
      assert.equal(await store.has("anything"), false);
    } finally { restore(); }
  });

  test("writes and deletes are swallowed", async () => {
    const { store, restore } = brokenRedis();
    try {
      await store.set("k", { a: 1 }, 60);
      await store.del(["k", "j"]);
      assert.equal(await store.invalidatePrefix("k"), 0);
    } finally { restore(); }
  });

  test("wrap still returns the computed answer", async () => {
    const { store, restore } = brokenRedis();
    try {
      // This is the whole point: the caller gets its data, just not cached.
      assert.equal(await store.wrap("k", async () => "computed", 60), "computed");
    } finally { restore(); }
  });
});
