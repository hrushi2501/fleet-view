/**
 * Tests for session token signing.
 *
 * The bug these exist to prevent: the session cookie used to be the user's id
 * in plaintext, so `document.cookie = "fv_session=<id>"` signed you in as
 * anyone, Admin included. Each test below is a statement about something the
 * server must never accept from a browser.
 *
 * Written against the pure token layer — no database, no `next/headers` — so
 * they run in the normal suite and fail loudly if signing is ever weakened.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

// The signing key is read at call time, so setting it here is enough. Without
// it the derivation falls back to the database URL, which is absent in tests.
before(() => {
  process.env.AUTH_SECRET = "test-secret-value-long-enough-to-be-real";
});

const { issueToken, verifyToken, isRevoked, assertAuthSecretConfigured, SESSION_TTL_MS } = await import("./session-token.ts");

describe("production session configuration", () => {
  test("does not derive a production session key from DATABASE_URL", () => {
    const env = process.env as Record<string, string | undefined>;
    const previousNodeEnv = env.NODE_ENV;
    const previousSecret = env.AUTH_SECRET;
    const previousUrl = env.DATABASE_URL;
    env.NODE_ENV = "production";
    delete env.AUTH_SECRET;
    env.DATABASE_URL = "postgresql://user:very-secret-password@example.test/database";

    try {
      assert.throws(() => assertAuthSecretConfigured(), /AUTH_SECRET/);
    } finally {
      if (previousNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = previousNodeEnv;
      if (previousSecret === undefined) delete env.AUTH_SECRET;
      else env.AUTH_SECRET = previousSecret;
      if (previousUrl === undefined) delete env.DATABASE_URL;
      else env.DATABASE_URL = previousUrl;
    }
  });
});

describe("a browser cannot author a session", () => {
  test("a bare user id is not a valid token", () => {
    // Exactly the old cookie format, and the whole reason this module exists.
    const result = verifyToken("clx0000000000000000000000");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "malformed");
  });

  test("a token with an edited payload is rejected", () => {
    const token = issueToken("user-a");
    const [version, , mac] = token.split(".");
    // Swap in a payload claiming to be somebody else, keep the real signature.
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: "user-b", iat: Date.now(), exp: Date.now() + SESSION_TTL_MS }),
    ).toString("base64url");

    const result = verifyToken(`${version}.${forgedPayload}.${mac}`);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "bad-signature");
  });

  test("a token signed with a different key is rejected", () => {
    const token = issueToken("user-a");
    process.env.AUTH_SECRET = "a-completely-different-secret-value";
    const result = verifyToken(token);
    process.env.AUTH_SECRET = "test-secret-value-long-enough-to-be-real";

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "bad-signature");
  });

  test("empty and malformed cookies are refused, not crashed on", () => {
    for (const bad of ["", undefined, null, "v1", "v1.a", "a.b.c.d", "v2.abc.def"]) {
      const result = verifyToken(bad as string | undefined);
      assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be refused`);
    }
  });
});

describe("a genuine token round-trips", () => {
  test("the subject survives signing and verification", () => {
    const result = verifyToken(issueToken("user-42"));
    assert.equal(result.ok, true);
    assert.equal(result.ok === true && result.payload.sub, "user-42");
  });

  test("two tokens for the same user differ, so one leak is not every session", () => {
    const a = issueToken("user-42", 1_000_000);
    const b = issueToken("user-42", 2_000_000);
    assert.notEqual(a, b);
  });
});

describe("expiry is decided by the server", () => {
  test("a token past its expiry is refused even though the signature is good", () => {
    const issuedAt = 1_000_000;
    const token = issueToken("user-a", issuedAt);
    const result = verifyToken(token, issuedAt + SESSION_TTL_MS + 1);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "expired");
  });

  test("a token inside its window is accepted", () => {
    const issuedAt = 1_000_000;
    const token = issueToken("user-a", issuedAt);
    const result = verifyToken(token, issuedAt + SESSION_TTL_MS - 1);
    assert.equal(result.ok, true);
  });
});

describe("revocation kills tokens already in the wild", () => {
  test("no epoch set means nothing is revoked", () => {
    assert.equal(isRevoked({ sub: "u", iat: 5_000, exp: 9_000 }, null), false);
  });

  test("a token issued before the epoch is dead", () => {
    // "Sign out everywhere" / deactivation: the cookie is still signed and
    // unexpired, and must still stop working.
    assert.equal(isRevoked({ sub: "u", iat: 5_000, exp: 9_000 }, 6_000), true);
  });

  test("a token issued after the epoch still works", () => {
    assert.equal(isRevoked({ sub: "u", iat: 7_000, exp: 9_000 }, 6_000), false);
  });
});
