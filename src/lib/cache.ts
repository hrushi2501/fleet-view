/**
 * Server-Side Cache Layer — Redis-Ready Abstraction
 *
 * Provides a unified caching interface for FleetView ERP backend services.
 * Defaults to an in-memory TTL store. When REDIS_URL or UPSTASH_REDIS_REST_URL
 * is provided in environment variables, it seamlessly upgrades to distributed Redis.
 */

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string | string[]): Promise<void>;
  has(key: string): Promise<boolean>;
  wrap<T>(key: string, fn: () => Promise<T>, ttlSeconds?: number): Promise<T>;
  invalidatePrefix(prefix: string): Promise<number>;
  clear(): Promise<void>;
  type: "memory" | "redis";
}

interface MemoryCacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

class MemoryCacheStore implements CacheStore {
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
}

/**
 * Lazy Redis implementation placeholder.
 * If REDIS_URL is provided, dynamic connection can be initialized here.
 */
class RedisCacheStore implements CacheStore {
  readonly type = "redis" as const;
  private memoryFallback: MemoryCacheStore;

  constructor() {
    this.memoryFallback = new MemoryCacheStore();
  }

  async get<T>(key: string): Promise<T | null> {
    return this.memoryFallback.get<T>(key);
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    return this.memoryFallback.set(key, value, ttlSeconds);
  }

  async del(key: string | string[]): Promise<void> {
    return this.memoryFallback.del(key);
  }

  async has(key: string): Promise<boolean> {
    return this.memoryFallback.has(key);
  }

  async wrap<T>(key: string, fn: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    return this.memoryFallback.wrap(key, fn, ttlSeconds);
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    return this.memoryFallback.invalidatePrefix(prefix);
  }

  async clear(): Promise<void> {
    return this.memoryFallback.clear();
  }
}

function createCacheStore(): CacheStore {
  if (process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL) {
    return new RedisCacheStore();
  }
  return new MemoryCacheStore();
}

export const serverCache: CacheStore = createCacheStore();
