import assert from "node:assert/strict";
import test from "node:test";
import { toUserFriendlyError, isNextNavigationError } from "./friendly-error";
import { ActionError, safe } from "./guard";
import { apiErrorResponse } from "./api-error";

test("toUserFriendlyError preserves ActionError messages", () => {
  const err = new ActionError("Asset code is already assigned to another machine.");
  const result = toUserFriendlyError(err);
  assert.equal(result.message, "Asset code is already assigned to another machine.");
  assert.match(result.ref, /^REF-[A-Z0-9]{6}$/);
});

test("toUserFriendlyError translates Prisma unique constraint violation (P2002)", () => {
  const prismaErr = Object.assign(new Error("Unique constraint failed on the fields: (`serialNo`)"), {
    code: "P2002",
    meta: { target: ["serialNo"] },
  });

  const result = toUserFriendlyError(prismaErr);
  assert.match(result.message, /serial number already exists/);
  assert.match(result.ref, /^REF-[A-Z0-9]{6}$/);
});

test("toUserFriendlyError translates Prisma foreign key constraint violation (P2003)", () => {
  const prismaErr = Object.assign(new Error("Foreign key constraint failed"), {
    code: "P2003",
  });

  const result = toUserFriendlyError(prismaErr);
  assert.match(result.message, /linked item/);
  assert.match(result.ref, /^REF-[A-Z0-9]{6}$/);
});

test("toUserFriendlyError translates Prisma record not found (P2025)", () => {
  const prismaErr = Object.assign(new Error("Record to update not found."), {
    code: "P2025",
  });

  const result = toUserFriendlyError(prismaErr);
  assert.match(result.message, /could not be found/);
  assert.match(result.ref, /^REF-[A-Z0-9]{6}$/);
});

test("toUserFriendlyError translates Prisma connection and timeout errors", () => {
  const timeoutErr = Object.assign(new Error("Timed out fetching a new connection from the pool"), {
    code: "P2024",
  });

  const result = toUserFriendlyError(timeoutErr);
  assert.match(result.message, /took too long to respond/);
  assert.match(result.ref, /^REF-[A-Z0-9]{6}$/);
});

test("toUserFriendlyError translates network and fetch errors", () => {
  const netErr = new Error("fetch failed: ECONNREFUSED");
  const result = toUserFriendlyError(netErr);
  assert.match(result.message, /Could not connect to the external service/);
  assert.match(result.ref, /^REF-[A-Z0-9]{6}$/);
});

test("toUserFriendlyError generates a friendly incident reference code for unknown errors", () => {
  const mysteryErr = new Error("Unexpected pointer nil dereference at core/sys.c:482");
  const result = toUserFriendlyError(mysteryErr);

  // Must not leak the internal technical jargon to the user
  assert.doesNotMatch(result.message, /pointer nil dereference/);
  assert.doesNotMatch(result.message, /sys\.c/);
  // Must include a clean reference code
  assert.match(result.message, /REF-[A-Z0-9]{6}/);
  assert.match(result.ref, /^REF-[A-Z0-9]{6}$/);
});

test("isNextNavigationError accurately identifies redirect and notFound errors", () => {
  const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/dashboard;307;" });
  const notFoundErr = Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  const normalErr = new Error("Database query failed");

  assert.equal(isNextNavigationError(redirectErr), true);
  assert.equal(isNextNavigationError(notFoundErr), true);
  assert.equal(isNextNavigationError(normalErr), false);
  assert.equal(isNextNavigationError(null), false);
});

test("safe wrapper intercepts unexpected errors and returns user-friendly error object", async () => {
  const failingAction = safe(async () => {
    throw Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["code"] },
    });
  });

  const res = await failingAction();
  assert.ok("error" in res);
  // Should translate gracefully and never throw out
  assert.match(res.error, /already exists/);
});

test("safe wrapper re-throws Next.js redirect errors so navigation succeeds", async () => {
  const redirectingAction = safe(async () => {
    const err = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/login" });
    throw err;
  });

  await assert.rejects(async () => {
    await redirectingAction();
  }, (err: unknown) => {
    return isNextNavigationError(err);
  });
});

test("apiErrorResponse formats consistent friendly JSON response", async () => {
  const netErr = new Error("fetch failed");
  const response = apiErrorResponse(netErr, 502);

  assert.equal(response.status, 502);
  const data = await response.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /Could not connect to the external service/);
  assert.match(data.ref, /^REF-[A-Z0-9]{6}$/);
});
