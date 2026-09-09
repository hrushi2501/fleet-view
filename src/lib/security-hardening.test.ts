import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clientIp, rateLimitDecision, rateLimitResponse } from "./request-rate-limit";

describe("Cyber Security Hardening — Rate Limiting & Abuse Prevention", () => {
  describe("clientIp extraction", () => {
    test("extracts the first originating IP from a multi-proxy x-forwarded-for header", () => {
      const headers = new Headers();
      headers.set("x-forwarded-for", "203.0.113.195, 70.41.3.18, 150.172.238.178");
      assert.equal(clientIp(headers), "203.0.113.195");
    });

    test("extracts a single IP from x-forwarded-for", () => {
      const req = new Request("https://fleetview.example.com/api/test", {
        headers: { "x-forwarded-for": "198.51.100.42" },
      });
      assert.equal(clientIp(req), "198.51.100.42");
    });

    test("falls back to x-real-ip when x-forwarded-for is missing", () => {
      const req = new Request("https://fleetview.example.com/api/test", {
        headers: { "x-real-ip": "192.0.2.1" },
      });
      assert.equal(clientIp(req), "192.0.2.1");
    });

    test("returns 'unknown' when no client IP header is present", () => {
      const req = new Request("https://fleetview.example.com/api/test");
      assert.equal(clientIp(req), "unknown");
    });

    test("uses a Next-style header reader directly even when it also has a headers member", () => {
      const nextHeadersLike = {
        // `ReadonlyHeaders` can satisfy both shapes. The direct `get` is the
        // one Next server actions must use; its `headers` member is not a
        // Fetch `Headers` object.
        headers: {},
        get(name: string) {
          return name === "x-forwarded-for" ? "203.0.113.77" : null;
        },
      } as unknown as Headers;

      assert.equal(clientIp(nextHeadersLike), "203.0.113.77");
    });

    test("does not let an unreadable header wrapper abort authentication", () => {
      const unreadableHeaders = {
        get() {
          throw new TypeError("header wrapper is unavailable");
        },
      } as unknown as Headers;

      assert.equal(clientIp(unreadableHeaders), "unknown");
    });
  });

  describe("rateLimitDecision sliding window mechanics", () => {
    test("allows requests up to the configured limit", () => {
      const windowMs = 60_000;
      const limit = 3;
      let timestamps: number[] = [];
      const now = 1_000_000;

      for (let i = 0; i < limit; i++) {
        const result = rateLimitDecision(timestamps, { limit, windowMs }, now);
        assert.equal(result.verdict.ok, true);
        timestamps = result.requests;
      }
      assert.equal(timestamps.length, limit);
    });

    test("rejects requests that exceed the limit with accurate retryInSeconds", () => {
      const windowMs = 60_000;
      const limit = 2;
      const now = 1_000_000;
      const previous = [now - 30_000, now - 10_000]; // oldest is at now - 30_000

      const result = rateLimitDecision(previous, { limit, windowMs }, now);
      assert.equal(result.verdict.ok, false);
      if (!result.verdict.ok) {
        assert.equal(result.verdict.remaining, 0);
        // Retry should be remaining time of oldest request: 60s - 30s = 30s
        assert.equal(result.verdict.retryInSeconds, 30);
      }
    });

    test("slides window forward and prunes expired request timestamps", () => {
      const windowMs = 60_000;
      const limit = 2;
      const now = 1_000_000;
      const previous = [now - 70_000, now - 65_000]; // both expired (> 60s ago)

      const result = rateLimitDecision(previous, { limit, windowMs }, now);
      assert.equal(result.verdict.ok, true);
      assert.equal(result.requests.length, 1); // old pruned, current added
      assert.equal(result.verdict.remaining, 1);
    });

    test("validates configuration parameters", () => {
      assert.throws(() => rateLimitDecision([], { limit: 0, windowMs: 1000 }), /positive integer/);
      assert.throws(() => rateLimitDecision([], { limit: 5, windowMs: -10 }), /positive/);
    });
  });

  describe("rateLimitResponse formatting", () => {
    test("produces HTTP 429 with standard Retry-After header", async () => {
      const res = rateLimitResponse(45, "Rate limit reached. Try again soon.");
      assert.equal(res.status, 429);
      assert.equal(res.headers.get("Retry-After"), "45");

      const body = await res.json();
      assert.equal(body.error, "Rate limit reached. Try again soon.");
      assert.equal(body.retryInSeconds, 45);
    });
  });

  describe("API Endpoint Rate Limiting Policies", () => {
    const now = 10_000_000;

    test("enforces payroll-export rate limiting (10 req / 300s)", () => {
      const config = { limit: 10, windowMs: 300_000 };
      let timestamps: number[] = [];

      // First 10 requests allowed
      for (let i = 0; i < 10; i++) {
        const decision = rateLimitDecision(timestamps, config, now + i * 1000);
        assert.equal(decision.verdict.ok, true);
        timestamps = decision.requests;
      }
      assert.equal(timestamps.length, 10);

      // 11th request rejected
      const blocked = rateLimitDecision(timestamps, config, now + 10_000);
      assert.equal(blocked.verdict.ok, false);
      if (!blocked.verdict.ok) {
        assert.equal(blocked.verdict.remaining, 0);
        // Retry delay calculated relative to oldest request
        assert.ok(blocked.verdict.retryInSeconds > 0 && blocked.verdict.retryInSeconds <= 300);
      }
    });

    test("enforces stats-query and fuel-query rate limiting (30 req / 60s)", () => {
      const config = { limit: 30, windowMs: 60_000 };
      let timestamps: number[] = [];

      for (let i = 0; i < 30; i++) {
        const decision = rateLimitDecision(timestamps, config, now + i * 500);
        assert.equal(decision.verdict.ok, true);
        timestamps = decision.requests;
      }

      const blocked = rateLimitDecision(timestamps, config, now + 15_000);
      assert.equal(blocked.verdict.ok, false);
      if (!blocked.verdict.ok) {
        assert.equal(blocked.verdict.remaining, 0);
        assert.ok(blocked.verdict.retryInSeconds > 0 && blocked.verdict.retryInSeconds <= 60);
      }
    });

    test("enforces assets-query and file-stream rate limiting (60 req / 60s)", () => {
      const config = { limit: 60, windowMs: 60_000 };
      let timestamps: number[] = [];

      for (let i = 0; i < 60; i++) {
        const decision = rateLimitDecision(timestamps, config, now + i * 200);
        assert.equal(decision.verdict.ok, true);
        timestamps = decision.requests;
      }

      const blocked = rateLimitDecision(timestamps, config, now + 12_000);
      assert.equal(blocked.verdict.ok, false);
      if (!blocked.verdict.ok) {
        assert.equal(blocked.verdict.remaining, 0);
        assert.ok(blocked.verdict.retryInSeconds > 0 && blocked.verdict.retryInSeconds <= 60);
      }
    });
  });

  describe("Input Sanitization & Physical Boundaries", () => {
    test("validates GPS coordinates within physical earth bounds", () => {
      const isValid = (lat: number, lng: number) =>
        isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

      assert.equal(isValid(26.9124, 75.7873), true); // Jaipur
      assert.equal(isValid(91.0, 75.0), false);     // Invalid latitude > 90
      assert.equal(isValid(-91.0, 75.0), false);    // Invalid latitude < -90
      assert.equal(isValid(20.0, 185.0), false);    // Invalid longitude > 180
      assert.equal(isValid(20.0, -185.0), false);   // Invalid longitude < -180
      assert.equal(isValid(NaN, 75.0), false);
    });

    test("clamps telemetry speeds to plausible operational bounds", () => {
      const clampSpeed = (speed: number) => Math.max(0, Math.min(300, speed));

      assert.equal(clampSpeed(45), 45);
      assert.equal(clampSpeed(-15), 0);
      assert.equal(clampSpeed(450), 300);
    });

    test("sanitizes cabin sticker QR tokens against control character injection", () => {
      const isValidToken = (token: string) =>
        Boolean(token) && token.length <= 48 && !/[\r\n\t\0]/.test(token);

      assert.equal(isValidToken("VEH-STICKER-AB12-99"), true);
      assert.equal(isValidToken("VEH-STICKER\nINJECTION"), false);
      assert.equal(isValidToken("VEH-STICKER\0NULLBYTE"), false);
      assert.equal(isValidToken("A".repeat(50)), false);
    });

    test("sanitizes search query input length and control characters", () => {
      const sanitizeQuery = (q: string) =>
        q.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();

      assert.equal(sanitizeQuery("  Hydraulic Pump \x00\x1b  "), "Hydraulic Pump");
      assert.equal(sanitizeQuery("Tata Signa 4825.TK").length <= 100, true);
    });
  });
});
