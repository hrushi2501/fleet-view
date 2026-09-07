import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluateScan, makeQrToken, SESSION_STALE_HOURS, type SessionLite } from "./telematics.ts";

const now = new Date("2026-08-30T08:00:00.000Z");
const active = (id: string, assetId: string, driverId: string, startedAt = now): SessionLite => ({ id, assetId, driverId, startedAt, endedAt: null, status: "ACTIVE" });

describe("cabin QR check-in policy", () => {
  test("resumes the driver's existing vehicle rather than creating a second trip", () => {
    assert.deepEqual(evaluateScan("asset-a", "driver-a", [active("session-a", "asset-a", "driver-a")], now), {
      ok: true, action: "RESUME", message: "You are already checked in to this vehicle.",
    });
  });

  test("cannot assign a vehicle that another current driver holds", () => {
    const result = evaluateScan("asset-a", "driver-b", [active("session-a", "asset-a", "driver-a")], now);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.blockingSessionId, "session-a");
  });

  test("moves the driver cleanly from their previous vehicle", () => {
    assert.deepEqual(evaluateScan("asset-b", "driver-a", [active("session-a", "asset-a", "driver-a")], now), {
      ok: true, action: "START", message: "Checked in. Your previous vehicle has been checked out automatically.", releaseSessionId: "session-a",
    });
  });

  test("does not let a forgotten old session block a real check-in", () => {
    const old = new Date(now.getTime() - (SESSION_STALE_HOURS + 1) * 3_600_000);
    assert.deepEqual(evaluateScan("asset-a", "driver-b", [active("old", "asset-a", "driver-a", old)], now), {
      ok: true, action: "START", message: "Checked in.",
    });
  });

  test("cabin sticker tokens are opaque, fixed-length FV values", () => {
    assert.equal(makeQrToken(new Uint8Array(10).fill(0)), "FV-AAAAAAAAAA");
    assert.match(makeQrToken(new Uint8Array(10).fill(255)), /^FV-[A-Z2-9]{10}$/);
  });
});

describe("vehicle health and status eligibility for check-in", () => {
  test("rejects check-in if vehicle is under breakdown or maintenance", async () => {
    const { isAssetCheckinAllowed } = await import("./telematics.ts");
    assert.deepEqual(isAssetCheckinAllowed("Breakdown"), {
      allowed: false,
      reason: "This vehicle is currently under maintenance / breakdown and cannot be checked in.",
    });
    assert.deepEqual(isAssetCheckinAllowed("Under-Maintenance"), {
      allowed: false,
      reason: "This vehicle is currently under maintenance / breakdown and cannot be checked in.",
    });
  });

  test("rejects check-in if vehicle is decommissioned or disposed", async () => {
    const { isAssetCheckinAllowed } = await import("./telematics.ts");
    assert.equal(isAssetCheckinAllowed("Disposed").allowed, false);
    assert.equal(isAssetCheckinAllowed("Off-hired").allowed, false);
    assert.equal(isAssetCheckinAllowed("Active", new Date()).allowed, false);
  });

  test("permits check-in for operable vehicles", async () => {
    const { isAssetCheckinAllowed } = await import("./telematics.ts");
    assert.deepEqual(isAssetCheckinAllowed("Active"), { allowed: true });
    assert.deepEqual(isAssetCheckinAllowed("Idle"), { allowed: true });
  });
});

describe("odometer anti-rollback & sanity checks", () => {
  test("validateOdometerAtScan rejects starting odometer lower than recorded meter", async () => {
    const { validateOdometerAtScan } = await import("./telematics.ts");
    const invalid = validateOdometerAtScan(15000, 15200);
    assert.equal(invalid.valid, false);
    assert.match(invalid.error ?? "", /cannot be lower than the vehicle's last recorded meter/);

    const valid = validateOdometerAtScan(15200, 15200);
    assert.equal(valid.valid, true);

    const higher = validateOdometerAtScan(15300, 15200);
    assert.equal(higher.valid, true);

    const omitted = validateOdometerAtScan(null, 15200);
    assert.equal(omitted.valid, true);
  });

  test("validateOdometerAtCheckout protects against rollback and implausible single-shift spikes", async () => {
    const { validateOdometerAtCheckout } = await import("./telematics.ts");

    // Rollback attempt
    const rollback = validateOdometerAtCheckout(15100, 15200);
    assert.equal(rollback.valid, false);
    assert.match(rollback.error ?? "", /cannot be lower than starting odometer/);

    // Single-shift delta > 2,000 km
    const spike = validateOdometerAtCheckout(18000, 15200);
    assert.equal(spike.valid, false);
    assert.match(spike.error ?? "", /implausibly high for a single shift/);

    // Normal shift
    const valid = validateOdometerAtCheckout(15350, 15200);
    assert.equal(valid.valid, true);

    // Omitted
    const omitted = validateOdometerAtCheckout(null, 15200);
    assert.equal(omitted.valid, true);
  });
});
