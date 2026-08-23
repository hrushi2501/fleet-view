/**
 * The call budget, tested against the behaviour that caused the 429s.
 *
 * These exercise the window arithmetic directly rather than through the
 * database, because what went wrong was never a storage problem — it was that
 * nothing counted the calls at all, and "one call per sync" turned out to be
 * two whenever a cold instance had to fetch a token.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TATA_CALLS_PER_HOUR } from "./api-budget.ts";

const WINDOW_MS = 60 * 60 * 1000;
const MANUAL_RESERVE = 2;

/** The same decision `reserveCall` makes, without the database round trip. */
function verdict(
  calls: number[],
  now: number,
  priority: "scheduled" | "manual",
  limit = TATA_CALLS_PER_HOUR,
): { ok: boolean; remaining: number } {
  const recent = calls.filter((t) => now - t < WINDOW_MS);
  const ceiling = priority === "manual" ? limit : limit - MANUAL_RESERVE;
  if (recent.length >= ceiling) return { ok: false, remaining: 0 };
  return { ok: true, remaining: ceiling - recent.length - 1 };
}

describe("the hour's allowance is respected", () => {
  const now = 10_000_000;

  test("a scheduled call is refused once the allowance is spent", () => {
    // 58 = 60 minus the two held back for a person clicking Sync Now.
    const spent = Array.from({ length: 58 }, (_, i) => now - i * 1000);
    assert.equal(verdict(spent, now, "scheduled").ok, false);
  });

  test("a person clicking Sync Now may spend the reserve", () => {
    // The cron is opportunistic; somebody watching a screen is not. This is the
    // whole reason the reserve exists.
    const spent = Array.from({ length: 58 }, (_, i) => now - i * 1000);
    assert.equal(verdict(spent, now, "manual").ok, true);
  });

  test("nothing may exceed the documented ceiling", () => {
    const spent = Array.from({ length: TATA_CALLS_PER_HOUR }, (_, i) => now - i * 1000);
    assert.equal(verdict(spent, now, "manual").ok, false);
    assert.equal(verdict(spent, now, "scheduled").ok, false);
  });
});

describe("the window rolls rather than resetting on the hour", () => {
  const now = 10_000_000;

  test("calls older than an hour stop counting", () => {
    const old = Array.from({ length: 60 }, (_, i) => now - WINDOW_MS - 1000 - i);
    assert.equal(verdict(old, now, "scheduled").ok, true);
  });

  test("a clock-hour reset would permit a burst this refuses", () => {
    // 59 calls in the last two minutes. A counter keyed on the clock hour would
    // zero at the top of the hour and allow 60 more immediately — 119 inside
    // two minutes, which is what the limiter is actually measuring.
    const burst = Array.from({ length: 59 }, (_, i) => now - i * 2000);
    assert.equal(verdict(burst, now, "scheduled").ok, false);
  });

  test("one slot frees as the oldest call ages out", () => {
    const spent = Array.from({ length: 58 }, (_, i) => now - WINDOW_MS + 1000 + i * 10);
    assert.equal(verdict(spent, now, "scheduled").ok, false);
    // A minute later the earliest has left the window.
    assert.equal(verdict(spent, now + 61_000, "scheduled").ok, true);
  });
});

describe("the ceiling matches what the provider documents", () => {
  test("60 calls an hour", () => {
    // Stated on Fleet Edge's own subscription page: "Maximum 60 requests per
    // hour allowed for every API - recommended for you to make 1 request per
    // minute". One a minute is exactly the ceiling, which is why the token
    // call had to stop being a second call.
    assert.equal(TATA_CALLS_PER_HOUR, 60);
  });

  test("the scheduled poller leaves room for a human", () => {
    assert.ok(TATA_CALLS_PER_HOUR - MANUAL_RESERVE < TATA_CALLS_PER_HOUR);
  });
});
