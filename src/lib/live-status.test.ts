/**
 * A parked truck is not a lost truck.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OFFLINE is meant to mean "we have lost this vehicle". It was reached after
 * fifteen minutes of silence, a figure chosen when telemetry was pulled every
 * two minutes and a gap could only mean a missed poll.
 *
 * On push the vehicle decides when to speak, and the two cases are an order of
 * magnitude apart. Measured across 24 hours of live data:
 *
 *   engine running   p50 1 min · p90 2 min · p99 12 min · max 59 min
 *   parked           p50 1 min · p90 62 min · p99 107 min · max 127 min
 *
 * So fifteen minutes reported most yard-parked machines as offline. Fleet
 * Edge's own panel counted 2 offline of 13 at the same moment this system
 * counted 5 — and the three it added were simply parked.
 *
 * That is the expensive kind of wrong: a screen that cries "lost" about every
 * parked truck teaches people to ignore it, and the vehicle that has genuinely
 * gone silent — RJ21GC7857, quiet since 27 August — is the one that then gets
 * missed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { deriveStatus } from "./fleet-edge-live.ts";

const NOW = new Date("2026-08-29T13:00:00.000Z");
const agoMin = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("a parked vehicle is not called offline for being quiet", () => {
  test("parked and silent for 53 minutes is STOPPED, not OFFLINE", () => {
    // RJ21GE1658's real position when Fleet Edge still showed it as Stopped.
    assert.equal(deriveStatus("Active", agoMin(53), 0, false, NOW), "STOPPED");
  });

  test("parked and silent for 107 minutes — the measured p99 — is still STOPPED", () => {
    assert.equal(deriveStatus("Active", agoMin(107), 0, false, NOW), "STOPPED");
  });

  test("parked and silent beyond three hours is OFFLINE", () => {
    // Past every gap observed in the live data, so silence this long is a fault.
    assert.equal(deriveStatus("Active", agoMin(200), 0, false, NOW), "OFFLINE");
  });

  test("a vehicle silent for two days is OFFLINE", () => {
    // RJ21GC7857. This is the case the whole signal exists for.
    assert.equal(deriveStatus("Active", agoMin(60 * 53), 0, false, NOW), "OFFLINE");
  });

  test("a vehicle that has never reported is OFFLINE", () => {
    assert.equal(deriveStatus("Active", null, null, null, NOW), "OFFLINE");
  });
});

describe("a running vehicle is held to a much shorter silence", () => {
  test("running and silent for 12 minutes — the measured p99 — is still IDLING", () => {
    assert.equal(deriveStatus("Active", agoMin(12), 0, true, NOW), "IDLING");
  });

  test("running and silent for 45 minutes is OFFLINE", () => {
    // An engine that is running should speak within minutes; three quarters of
    // an hour of silence from a running truck is a fault, not a nap.
    assert.equal(deriveStatus("Active", agoMin(45), 20, true, NOW), "OFFLINE");
  });
});

describe("the other states still hold", () => {
  test("moving beats idling", () => {
    assert.equal(deriveStatus("Active", agoMin(1), 42, true, NOW), "MOVING");
  });

  test("engine on and stationary is IDLING, which is what burns diesel for nothing", () => {
    assert.equal(deriveStatus("Active", agoMin(1), 0, true, NOW), "IDLING");
  });

  test("a breakdown in the register outranks any ping", () => {
    // The workshop has taken it off the road; a stale "Stopped" would hide that.
    assert.equal(deriveStatus("Breakdown", agoMin(1), 40, true, NOW), "BREAKDOWN");
  });
});
