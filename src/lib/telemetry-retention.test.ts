/**
 * Old payloads get smaller without losing what settles an argument.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The payload column is 85% of the telemetry table, so it is the obvious thing
 * to delete. It is also the evidence: on 2 September these raw messages proved
 * that three faulty fuel senders are faulty on Tata's side and not in our
 * parsing, and that complaint is still open.
 *
 * So the fields that did that proving are pinned here by name. If somebody
 * later trims the kept list to save more space, these tests are what stops the
 * proof going with it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  slimPayload,
  alreadySlim,
  isDueForSlimming,
  KEPT_RAW_FIELDS,
  FULL_PAYLOAD_DAYS,
} from "./telemetry-retention.ts";

/** A real payload, as Fleet Edge sends it. */
const payload = {
  imei: "869128060472528",
  vehicleId: "MAT567005R3B03384",
  registrationNumber: "RJ21GE1657",
  eventDateTime: "2026-09-01T13:47:56.0000000",
  primaryFuelLevel: 33.6,
  primaryFuelTankCapacity: 300,
  noOfFuelTanks: 1,
  secondaryFuelLevel1: 1500,
  secondaryFuelTankCapacity1: 55555,
  defLevel: 74,
  defQuality: 32,
  vehicleBatteryVoltage: 28.26,
  backupBatteryVoltage: 4.1,
  vehicleStatus: "RUNNING",
  gpsFix: true,
  gpsSignalQuality: 4,
  gpsAltitude: 431,
  noOfSatForFix: 11,
  gpsCourseInDegrees: 187,
  gpsLatitude: 26.9,
  gpsLongitude: 75.8,
  speed: 0,
  odometer: 106314,
  ignitionOn: true,
  engineRunHour: 106314.2,
  currentGear: 0,
  crankOn: false,
  acStatus: false,
  accelX: 0.01, accelY: -0.02, accelZ: 0.98,
  gyroX: 0.0, gyroY: 0.0, gyroZ: 0.0,
};

describe("what proved the sender faults is kept", () => {
  const { slimmed } = slimPayload(payload);

  test("the fuel figure exactly as the provider sent it", () => {
    // The whole argument was our stored value against theirs. Lose this and it
    // cannot be re-checked.
    assert.equal(slimmed.primaryFuelLevel, 33.6);
  });

  test("the tank configuration that ruled out the innocent explanation", () => {
    // `noOfFuelTanks: 1` is what disproved "two tanks reported alternately".
    assert.equal(slimmed.noOfFuelTanks, 1);
    assert.equal(slimmed.primaryFuelTankCapacity, 300);
  });

  test("which device and which vehicle sent it", () => {
    assert.equal(slimmed.imei, "869128060472528");
    assert.equal(slimmed.vehicleId, "MAT567005R3B03384");
    assert.equal(slimmed.registrationNumber, "RJ21GE1657");
  });

  test("the provider's own timestamp, beside ours", () => {
    assert.equal(slimmed.eventDateTime, "2026-09-01T13:47:56.0000000");
  });

  test("the health signals a dropout gets blamed on", () => {
    assert.equal(slimmed.vehicleBatteryVoltage, 28.26);
    assert.equal(slimmed.gpsFix, true);
    assert.equal(slimmed.defLevel, 74);
  });
});

describe("the bulk goes", () => {
  const { slimmed, dropped } = slimPayload(payload);

  test("motion sensors nothing in this system reads", () => {
    for (const field of ["accelX", "accelY", "accelZ", "gyroX", "gyroY", "gyroZ"]) {
      assert.ok(!(field in slimmed), `${field} should have been dropped`);
      assert.ok(dropped.includes(field));
    }
  });

  test("the payload really does get smaller", () => {
    const before = JSON.stringify(payload).length;
    const after = JSON.stringify(slimmed).length;
    assert.ok(after < before * 0.6, `only shrank from ${before} to ${after} bytes`);
  });

  test("nothing outside the kept list survives", () => {
    for (const key of Object.keys(slimmed)) {
      assert.ok((KEPT_RAW_FIELDS as readonly string[]).includes(key), `${key} leaked through`);
    }
  });
});

describe("a field that was never sent stays absent", () => {
  test("missing is not rewritten as null", () => {
    // "The provider did not send DEF" and "the provider sent DEF as null" are
    // different facts, and these payloads get read precisely for that kind of
    // difference.
    const { slimmed } = slimPayload({ imei: "123", primaryFuelLevel: 40 });
    assert.ok(!("defLevel" in slimmed));
  });
});

describe("running it twice does no extra work", () => {
  test("an already-reduced payload is recognised", () => {
    const { slimmed } = slimPayload(payload);
    assert.equal(alreadySlim(slimmed), true);
  });

  test("a full payload is not", () => {
    assert.equal(alreadySlim(payload), false);
  });

  test("odd values are treated as nothing to do rather than crashing", () => {
    for (const odd of [null, undefined, 42, "text", []]) {
      assert.equal(alreadySlim(odd), true);
      assert.deepEqual(slimPayload(odd).slimmed, {});
    }
  });
});

describe("only genuinely old readings are touched", () => {
  const now = new Date("2026-11-01T00:00:00Z");

  test("a reading from today is left alone", () => {
    assert.equal(isDueForSlimming(new Date("2026-10-31T00:00:00Z"), now), false);
  });

  test("one just inside the window is left alone", () => {
    const justInside = new Date(now.getTime() - (FULL_PAYLOAD_DAYS - 1) * 86_400_000);
    assert.equal(isDueForSlimming(justInside, now), false);
  });

  test("one past the window is reduced", () => {
    const past = new Date(now.getTime() - (FULL_PAYLOAD_DAYS + 1) * 86_400_000);
    assert.equal(isDueForSlimming(past, now), true);
  });

  test("the window outlives a provider dispute", () => {
    // The open sender complaint was raised on 2 Sep against readings from
    // 20 Aug. Thirty days would have put the oldest evidence out of reach
    // before a reply arrived.
    assert.ok(FULL_PAYLOAD_DAYS >= 60, "too short to survive an open dispute");
  });
});
