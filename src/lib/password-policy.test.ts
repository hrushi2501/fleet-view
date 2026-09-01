import { describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

import { isHashed, passwordPolicyError, verifyPassword } from "./auth.ts";

describe("password policy", () => {
  test("requires length, letters, numbers, and symbols", () => {
    assert.match(passwordPolicyError("short1!") ?? "", /at least 12/i);
    assert.match(passwordPolicyError("OnlyLetters!!!") ?? "", /number/i);
    assert.match(passwordPolicyError("123456789012!") ?? "", /letter/i);
    assert.match(passwordPolicyError("LettersAnd123") ?? "", /symbol/i);
    assert.equal(passwordPolicyError("LongEnough1!"), null);
  });

  test("accepts only well-formed bcrypt hashes", () => {
    assert.equal(isHashed("$2b$10$p1f5XPDNBz92g9Hztpm8iOEVBQSVbc1Kqlo/XWaT/VBXfLJfkCOym"), true);
    assert.equal(isHashed("$2b$10$not-a-valid-hash"), false);
    assert.equal(isHashed("legacy-plaintext-password"), false);
  });

  test("never accepts a legacy plaintext password", async () => {
    assert.equal(await verifyPassword("legacy-plaintext-password", "legacy-plaintext-password"), false);
  });

  test("still accepts the correct bcrypt password", async () => {
    const hash = await bcrypt.hash("LongEnough1!", 10);
    assert.equal(await verifyPassword("LongEnough1!", hash), true);
    assert.equal(await verifyPassword("wrong-password", hash), false);
  });
});
