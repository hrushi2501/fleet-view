import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { num, inr } from "./utils.ts";
describe("a wrong number must not break the page it is on", () => {
  // A tank was saved with a capacity of 1e142 litres before capacity was
  // bounded. Formatted the old way it was 213 characters of digits and commas
  // with no space in it — one token the browser cannot break — and it pushed
  // the Site Tanks layout apart and spilled across the ledger beside it.
  const ABSURD = 1e142;

  test("no figure is ever long enough to overflow its column", () => {
    for (const value of [ABSURD, 1e29, -1e40, Number.MAX_SAFE_INTEGER * 1e10]) {
      assert.ok(num(value).length <= 20, `num(${value}) is ${num(value).length} chars`);
      assert.ok(inr(value).length <= 22, `inr(${value}) is ${inr(value).length} chars`);
      assert.ok(
        inr(value, { compact: true }).length <= 22,
        `compact inr(${value}) is ${inr(value, { compact: true }).length} chars`,
      );
    }
  });

  test("an absurd figure is shown as one, not as a plausible quantity", () => {
    assert.equal(num(ABSURD), "1E142");
    assert.match(inr(ABSURD), /^₹1E142$/);
  });

  test("compact currency never mixes crores with an exponent", () => {
    // `toFixed` falls back to JS exponential past 1e21, which is short enough
    // to pass a length check and still reads as "₹1e+22 Cr".
    assert.doesNotMatch(inr(1e29, { compact: true }), /e\+/);
    assert.doesNotMatch(inr(ABSURD, { compact: true }), /Cr/);
  });

  test("ordinary figures are untouched", () => {
    assert.equal(num(300), "300");
    assert.equal(num(500_000), "5,00,000");
    assert.equal(inr(1_00_00_000, { compact: true }), "₹1.00 Cr");
    assert.equal(num(0), "0");
  });

  test("a broken calculation is still a dash, not a number", () => {
    assert.equal(num(NaN), "—");
    assert.equal(num(Infinity), "—");
    assert.equal(inr(NaN), "—");
  });
});
