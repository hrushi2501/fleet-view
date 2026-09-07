import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesActiveVehicleConfirmation } from "./trip-service";

test("damaged-QR checkout confirmation is exact to the active vehicle suffix", () => {
  assert.equal(matchesActiveVehicleConfirmation("1234", "RJ14 GA 1234", "TRUCK-A"), true);
  assert.equal(matchesActiveVehicleConfirmation("ga-1234", "RJ14 GA 1234", "TRUCK-A"), false);
  assert.equal(matchesActiveVehicleConfirmation("9999", "RJ14 GA 1234", "TRUCK-A"), false);
  assert.equal(matchesActiveVehicleConfirmation("123", "RJ14 GA 1234", "TRUCK-A"), false);
});

test("vehicle code is used only when a registration number is absent", () => {
  assert.equal(matchesActiveVehicleConfirmation("A123", null, "TRUCK-A123"), true);
  assert.equal(matchesActiveVehicleConfirmation("A123", "RJ14 GA 1234", "TRUCK-A123"), false);
});
