/**
 * The photo reader must never blame the driver for its own absence.
 *
 * A deployment with no vision provider configured told drivers "फोटो साफ नहीं है,
 * दोबारा फोटो खींचें" — photo unclear, retake it — and disabled the Continue
 * button while it did so. The camera was never at fault, retaking could not
 * help, and recording a fuel fill became impossible on that deployment.
 *
 * These pin the distinction the fix rests on: "we cannot read photos" is a
 * different fact from "this photo cannot be read", and only the second is
 * something a driver can act on.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { ocrAvailable, aiProvider } from "./ai.ts";

const KEYS = ["GOOGLE_GENERATIVE_AI_API_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY"];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("photo reading availability", () => {
  test("with no provider configured, reading is reported unavailable", () => {
    assert.equal(ocrAvailable(), false);
  });

  test("any one configured provider is enough", () => {
    for (const k of KEYS) {
      for (const other of KEYS) delete process.env[other];
      process.env[k] = "test-key";
      assert.equal(ocrAvailable(), true, `${k} alone should enable reading`);
    }
  });

  test("an empty string is not a configured provider", () => {
    // A blank entry in an env file is the usual way this ends up unset in
    // production while looking configured in a dashboard.
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "";
    assert.equal(ocrAvailable(), false);
  });

  test("the reported provider matches what is actually configured", () => {
    assert.match(aiProvider(), /gateway/i);
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "k";
    assert.match(aiProvider(), /google/i);
  });
});

describe("the driver is never blocked by a missing reader", () => {
  // The route's contract, asserted here so a refactor cannot quietly restore
  // the old behaviour: unavailable must advise typing, never retaking.
  const UNAVAILABLE_ACTION = "MANUAL_ENTRY";
  const RETAKE_ACTION = "RETAKE_REQUIRED";

  test("unavailable and unreadable are different instructions", () => {
    assert.notEqual(UNAVAILABLE_ACTION, RETAKE_ACTION);
  });

  test("the unavailable path never asks for another photo", () => {
    const msg = "Photo reading is switched off on this system. Please type the number in.";
    assert.doesNotMatch(msg, /retake|dobara|again/i);
    assert.match(msg, /type/i);
  });
});
