import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  isTataEnabled,
  missingConfigKeys,
  TataFleetEdgeError,
  invalidateToken,
  TATA_PROVIDER_CODE,
} from "./tata-fleet-edge.ts";

describe("Tata Fleet Edge integration", () => {
  test("provider code is standard constant", () => {
    assert.equal(TATA_PROVIDER_CODE, "TATA_FLEET_EDGE");
  });

  test("missingConfigKeys lists unconfigured required env variables", () => {
    const origEnv = { ...process.env };
    try {
      delete process.env.TATA_FLEET_EDGE_CLIENT_ID;
      delete process.env.TATA_FLEET_EDGE_CLIENT_SECRET;
      delete process.env.TATA_FLEET_EDGE_TOKEN_URL;
      delete process.env.TATA_FLEET_EDGE_BASE_URL;
      delete process.env.TATA_FLEET_EDGE_POSITIONS_PATH;

      const missing = missingConfigKeys();
      assert.ok(missing.includes("TATA_FLEET_EDGE_CLIENT_ID"));
      assert.ok(missing.includes("TATA_FLEET_EDGE_CLIENT_SECRET"));
      assert.ok(missing.includes("TATA_FLEET_EDGE_TOKEN_URL"));
      assert.ok(missing.includes("TATA_FLEET_EDGE_BASE_URL"));
      assert.ok(missing.includes("TATA_FLEET_EDGE_POSITIONS_PATH"));
      assert.equal(isTataEnabled(), false);
    } finally {
      process.env = origEnv;
    }
  });

  test("TataFleetEdgeError exposes HTTP status and body text", () => {
    const err = new TataFleetEdgeError("Rate limit exceeded", 429, '{"error":"too_many_requests"}');
    assert.equal(err.name, "TataFleetEdgeError");
    assert.equal(err.message, "Rate limit exceeded");
    assert.equal(err.status, 429);
    assert.equal(err.body, '{"error":"too_many_requests"}');
  });

  test("invalidateToken safely clears token cache", () => {
    assert.doesNotThrow(() => invalidateToken());
  });
});
