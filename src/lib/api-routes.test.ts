import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GET as healthGet } from "@/app/api/health/route";
import { GET as statsGet } from "@/app/api/stats/route";

describe("/api/health endpoint system behavior", () => {
  test("health check returns structured status without leaking database secrets or host details", async () => {
    const res = await healthGet();
    // Either 200 (if local db connected) or 500 (if db offline in unit test environment)
    assert.ok([200, 500].includes(res.status), `status should be 200 or 500, got ${res.status}`);

    const data = await res.json();
    assert.ok("ok" in data);
    assert.ok("db" in data);

    // Critical security assertion: never leak database URL, password, or driver internal stack to client
    const jsonStr = JSON.stringify(data);
    assert.ok(!jsonStr.includes("postgres://"));
    assert.ok(!jsonStr.includes("password"));
    assert.ok(!jsonStr.includes("prisma"));
    assert.ok(!jsonStr.includes("/Users/"));
  });
});

describe("/api/stats endpoint authorization gate", () => {
  test("unauthenticated request is rejected with 401 Unauthorized", async () => {
    const res = await statsGet();
    assert.equal(res.status, 401);

    const body = await res.json();
    assert.ok(body.error, "must return error message on unauthenticated access");
  });
});
