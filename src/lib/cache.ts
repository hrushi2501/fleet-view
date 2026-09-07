/**
 * Server-side cache, shared across instances when Redis is configured.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACED
 *
 * The previous `RedisCacheStore` reported `type: "redis"` and delegated every
 * method to an in-memory Map. Setting `UPSTASH_REDIS_REST_URL` therefore moved
 * the app into "Redis mode" without changing a single thing: each serverless
 * instance still kept its own private cache, and anything reading `.type` was
 * told there was distributed caching when there was none. A cache that lies
 * about being shared is worse than no cache, because it is trusted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT MUST FAIL OPEN
 *
 * Every Redis call here is wrapped so that a network error, a timeout, or an
 * Upstash outage returns "no cached value" rather than throwing. The caller
 * then computes the answer the slow way and the screen still renders. The
 * alternative — a cache whose outage takes the site down — trades a fast site
 * for a fragile one, which is the wrong trade for a yard that is trying to
 * dispatch trucks.
 *
 * Writes that fail are swallowed for the same reason: failing to record a
 * cached copy is not a reason to fail the request that produced it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KEYS ARE NAMESPACED
 *
 * Every key is prefixed with `fleetview:`. The Upstash database may be shared
 * with something else, now or later, and `clear()` scans that namespace rather
 * than issuing FLUSHDB — which would wipe whatever else lives there.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Just the two variables this module reads, so a test need not fake all of `process.env`. */
type CacheEnv = { UPSTASH_REDIS_REST_URL?: string; UPSTASH_REDIS_REST_TOKEN?: string };

/** Prefix on every key this app writes, so a shared database stays safe. */
const NAMESPACE = "fleetview:";

/**
 * How long a single Redis round trip may take before it is treated as a miss.
 *
 * The Asia replica answers in about 50 ms. A second is far beyond that and is
 * there to catch a hang, not to wait out slowness: the whole point of the cache
 * is to be faster than the query it stands in front of, and the database answers
 * in roughly 13 ms. Waiting longer than this would make the cache the reason
 * the page is slow.
 */
const REDIS_TIMEOUT_MS = 1_000;

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string | string[]): Promise<void>;
  has(key: string): Promise<boolean>;
  wrap<T>(key: string, fn: () => Promise<T>, ttlSeconds?: number): Promise<T>;
  invalidatePrefix(prefix: string): Promise<number>;
  clear(): Promise<void>;
  type: "memory" | "redis";
  /**
   * Whether the store is actually answering.
   *
   * On the diagnostics screen this is the difference between "configured" and
   * "working" — the distinction the previous stub erased by reporting itself as
   * Redis no matter what.
   */
  healthy(): Promise<boolean>;
}

interface MemoryCacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

export class MemoryCacheStore implements CacheStore {
  readonly type = "memory" as const;
  private store = new Map<string, MemoryCacheEntry<unknown>>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key) as MemoryCacheEntry<T> | undefined;
    if (!entry) return null;

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  async del(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) this.store.delete(k);
  }

  async has(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== null;
  }

  async wrap<T>(key: string, fn: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const fresh = await fn();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    let count = 0;
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  /** Memory is reachable whenever the process is running. */
  async healthy(): Promise<boolean> {
    return true;
  }
}

/**
 * Upstash Redis over its REST API.
 *
 * REST rather than a TCP client because this runs on serverless functions that
 * are created and destroyed constantly; a connection pool has nowhere to live,
 * and a TCP handshake per invocation would cost more than the query it saves.
 */
export class RedisCacheStore implements CacheStore {
  readonly type = "redis" as const;

  // Written out rather than declared as constructor parameter properties: the
  // test runner strips types without compiling them, and that syntax needs a
  // real compiler.
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/+$/, "");
    this.token = token;
  }

  /**
   * One Redis command. Returns `undefined` when Redis could not answer, which
   * every caller treats as "no cached value" — never as an error to propagate.
   */
  private async command<T>(...args: (string | number)[]): Promise<T | undefined> {
    const abort = AbortSignal.timeout(REDIS_TIMEOUT_MS);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args.map(String)),
        signal: abort,
        cache: "no-store",
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { result?: T; error?: string };
      if (body.error) return undefined;
      return body.result;
    } catch {
      // Timeout, DNS, TLS, outage — all of it means the same thing to a cache.
      return undefined;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.command<string | null>("GET", NAMESPACE + key);
    if (raw === undefined || raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A value written by something else, or a half-written one. Not ours to
      // interpret, and not worth failing a page over.
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    // A non-positive TTL means "already expired" in the in-memory store, so
    // honour that here rather than writing a key that never expires.
    if (ttlSeconds !== undefined && ttlSeconds <= 0) return;
    if (ttlSeconds === undefined) {
      await this.command("SET", NAMESPACE + key, payload);
    } else {
      await this.command("SET", NAMESPACE + key, payload, "EX", Math.ceil(ttlSeconds));
    }
  }

  async del(key: string | string[]): Promise<void> {
    const keys = (Array.isArray(key) ? key : [key]).map((k) => NAMESPACE + k);
    if (keys.length === 0) return;
    await this.command("DEL", ...keys);
  }

  async has(key: string): Promise<boolean> {
    const n = await this.command<number>("EXISTS", NAMESPACE + key);
    return n === 1;
  }

  async wrap<T>(key: string, fn: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const fresh = await fn();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  /**
   * Deletes every key under a prefix.
   *
   * SCAN rather than KEYS: KEYS walks the whole keyspace in one blocking call,
   * which on a shared instance stalls every other client for as long as it
   * takes. SCAN returns in bounded pieces and lets other work through between
   * them.
   */
  async invalidatePrefix(prefix: string): Promise<number> {
    let cursor = "0";
    let removed = 0;
    do {
      const page = await this.command<[string, string[]]>(
        "SCAN", cursor, "MATCH", `${NAMESPACE}${prefix}*`, "COUNT", 200,
      );
      if (!page) return removed;         // Redis unreachable — report what we did
      const [next, keys] = page;
      if (keys.length > 0) {
        const deleted = await this.command<number>("DEL", ...keys);
        removed += deleted ?? 0;
      }
      cursor = next;
    } while (cursor !== "0");
    return removed;
  }

  /** Clears only this app's namespace, never the whole database. */
  async clear(): Promise<void> {
    await this.invalidatePrefix("");
  }

  /** Whether Redis is actually answering right now. For diagnostics. */
  async healthy(): Promise<boolean> {
    return (await this.command<string>("PING")) === "PONG";
  }
}

/**
 * Redis when it is configured, memory otherwise.
 *
 * Both halves of the credential are required. A URL with no token would build a
 * store that reports itself as Redis and then fails every call — the same lie
 * this file exists to remove — so an incomplete configuration stays on memory,
 * which at least behaves the way it claims to.
 */
export function createCacheStore(
  env: CacheEnv = process.env as CacheEnv,
): CacheStore {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisCacheStore(url, token);
  return new MemoryCacheStore();
}

export const serverCache: CacheStore = createCacheStore();
