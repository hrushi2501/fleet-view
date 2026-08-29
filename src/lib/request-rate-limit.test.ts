import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { rateLimitDecision } from "./request-rate-limit.ts";

describe("rolling request limits", () => {
  const windowMs = 60_000;
  const now = 1_000_000;

  test("uses every allowed slot and then returns the precise retry delay", () => {
    const spent = [now - 20_000, now - 10_000];
    const decision = rateLimitDecision(spent, { limit: 2, windowMs }, now);

    assert.deepEqual(decision.verdict, { ok: false, remaining: 0, retryInSeconds: 40 });
    assert.deepEqual(decision.requests, spent);
  });

  test("lets a slot free exactly when the oldest request leaves the rolling window", () => {
    const decision = rateLimitDecision([now - windowMs], { limit: 1, windowMs }, now);

    assert.deepEqual(decision.verdict, { ok: true, remaining: 0 });
    assert.deepEqual(decision.requests, [now]);
  });

  test("does not count malformed, future, or expired timestamps", () => {
    const decision = rateLimitDecision([Number.NaN, now + 1, now - windowMs - 1], { limit: 1, windowMs }, now);

    assert.deepEqual(decision.verdict, { ok: true, remaining: 0 });
  });
});
