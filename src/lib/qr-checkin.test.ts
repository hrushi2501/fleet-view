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
