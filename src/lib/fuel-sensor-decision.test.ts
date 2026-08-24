/**
 * A vehicle that reports its own fuel level is not sent for review.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PROTECTS
 *
 * Two paths put a fuel level into the ledger. A tank sender reports litres
 * unprompted; a driver photographs the dashboard and a model reads the needle.
 * The photo path holds anything under 85% confidence for a person to confirm,
 * which is right when there is no sender and actively harmful when there is —
 * it delays a number the instrument already gave, and invites somebody to
 * overrule a measurement with an estimate.
 *
 * The risk in the change is the opposite mistake: silently auto-accepting for a
 * vehicle that has *no* sender, which would put model guesses into the ledger
 * as fact. So both directions are pinned here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { sensorGaugeDecision, decideGaugeReading, AUTO_VERIFY_CONFIDENCE } from "./telematics.ts";

const TANK = 300;
const at = new Date("2026-08-24T10:00:00.000Z");

describe("a reporting tank sender settles it", () => {
  test("the reading is accepted with no review", () => {
    const d = sensorGaugeDecision({ levelL: 176, levelPct: null, at }, TANK);
    assert.equal(d.status, "VERIFIED");
    assert.equal(d.needsReview, false);
  });

  test("litres come from the sender, not from the photo", () => {
    const d = sensorGaugeDecision({ levelL: 176, levelPct: null, at }, TANK);
    assert.equal(d.litres, 176);
  });

  test("percentage is derived from litres when the sender does not send one", () => {
    // 176 of 300 L. Derived rather than left null, because the asset's cached
    // level and several screens are expressed as a percentage.
    const d = sensorGaugeDecision({ levelL: 176, levelPct: null, at }, TANK);
    assert.equal(d.levelPct, 58.7);
  });

  test("a percentage the sender does send is preferred over a derived one", () => {
    const d = sensorGaugeDecision({ levelL: 176, levelPct: 59, at }, TANK);
    assert.equal(d.levelPct, 59);
  });

  test("the reason says where the number came from", () => {
    // Somebody reading the ledger months later has to be able to tell an
    // instrument reading from a confirmed photograph.
    const d = sensorGaugeDecision({ levelL: 176, levelPct: null, at }, TANK);
    assert.match(d.reasons.join(" "), /tank sender/i);
    assert.match(d.reasons.join(" "), /No review needed/i);
  });

  test("an unknown tank size still yields a decision", () => {
    // Capacity is optional on the asset record; a missing one must not turn
    // into a division that produces NaN in the ledger.
    const d = sensorGaugeDecision({ levelL: 176, levelPct: null, at }, 0);
    assert.equal(d.status, "VERIFIED");
    assert.equal(d.levelPct, null);
    assert.equal(d.litres, 176);
  });
});

describe("vehicles without a sender still get reviewed", () => {
  test("a low-confidence photo is still held", () => {
    // The whole safeguard: this path must be unchanged for the trucks that
    // depend on it.
    const d = decideGaugeReading(
      { levelPct: 40, odometerKm: 1000, confidence: 0.5, gaugeType: "ANALOG_NEEDLE", reasoning: null },
      TANK,
    );
    assert.equal(d.status, "PENDING");
    assert.equal(d.needsReview, true);
  });

  test("a clear photo is still auto-accepted", () => {
    const d = decideGaugeReading(
      { levelPct: 40, odometerKm: 1000, confidence: AUTO_VERIFY_CONFIDENCE, gaugeType: "DIGITAL", reasoning: null },
      TANK,
    );
    assert.equal(d.status, "VERIFIED");
  });

  test("an unexplained jump is still held", () => {
    // A needle does not go from a quarter to full without a fill, whatever the
    // model's confidence says.
    const d = decideGaugeReading(
      { levelPct: 95, odometerKm: 1000, confidence: 0.99, gaugeType: "DIGITAL", reasoning: null },
      TANK,
      25,
      1,
    );
    assert.equal(d.status, "PENDING");
    assert.match(d.reasons.join(" "), /rose/i);
  });
});
