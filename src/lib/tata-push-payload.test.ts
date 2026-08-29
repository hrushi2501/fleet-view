/**
 * The adapter reads a Fleet Edge *push* body, not only a pull response.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS PINNED
 *
 * `TataFleetEdgeAdapter` was written against the Basic Pull API, which answers
 * `{ vehicles: [...] }`. The Basic Push (Webhook) spec posts a single bare
 * `VehicleTelemetry` object instead. The two share a model, so one parser
 * serves both — but that is a claim worth holding still, because the failure is
 * silent: a shape the parser does not recognise yields zero readings, the route
 * answers politely, and the feed looks healthy while nothing is stored.
 *
 * The payload below is built from the field list in the spec (4pp, v1.6),
 * including its capitalisation, which differs from what the live pull sends.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TataFleetEdgeAdapter } from "./telematics-adapters.ts";

/** One vehicle, exactly as the push spec documents it. */
const PUSH_BODY = {
  vehicleId: "MAT567005R3C08725",
  registrationNumber: "RJ21GE3220",
  imei: "864636050279999",
  eventDateTime: "2026-08-22T12:11:38.000+05:30",
  gpsLatitude: 27.9881,
  gpsLongitude: 73.7749,
  gpsAltitude: 245,
  gpsCourseInDegrees: 187,
  gpsSignalQuality: 4,
  gpsFix: true,
  ignitionOn: true,
  crankOn: false,
  speed: 42.5,
  odometer: 262817,
  noOfFuelTanks: 1,
  // The spec capitalises these; the live pull does not.
  PrimaryFuelLevel: 176,
  primaryFuelTankCapacity: 300,
  defLevel: 0,
  vehicleBatteryVoltage: 27.4,
  vehicleStatus: "RUNNING",
  engineRunHour: 10577.8,
  fuelLevelPercent: 58.7,
};

describe("a Fleet Edge push body is understood", () => {
  test("a bare VehicleTelemetry object yields one reading", async () => {
    // The pull wraps vehicles in an array; the push does not. A parser that
    // only handled the wrapper would return nothing here and store nothing.
    const pings = await new TataFleetEdgeAdapter().parsePayload(PUSH_BODY);
    assert.equal(pings.length, 1);
  });

  test("the identifiers the route matches vehicles on are all extracted", async () => {
    const [p] = await new TataFleetEdgeAdapter().parsePayload(PUSH_BODY);
    assert.equal(p!.identifiers?.registrationNo, "RJ21GE3220");
    assert.equal(p!.identifiers?.chassisNo, "MAT567005R3C08725");
    assert.equal(p!.identifiers?.imei, "864636050279999");
  });

  test("a vehicle identified only by chassis number is still resolvable", async () => {
    // `vehicleId` is the spec's FIRST field and it is documented as "Chassis
    // Number of the vehicle" — registrationNumber sits near the bottom and is
    // not marked required. A push that carries only the chassis must still
    // produce something the route can match on, or that vehicle silently
    // reports nothing.
    //
    // This is not theoretical: of the thirteen vehicles subscribed to push,
    // twelve had no chassis number stored until it was taken from Tata's own
    // subscription report. The parser was always right; the register was not.
    const chassisOnly = { ...PUSH_BODY, registrationNumber: undefined, imei: undefined };
    const [p] = await new TataFleetEdgeAdapter().parsePayload(chassisOnly);
    assert.equal(p!.identifiers?.chassisNo, "MAT567005R3C08725");
    assert.equal(p!.identifiers?.registrationNo, null);
  });

  test("the timestamp format the spec actually prints is parsed", async () => {
    // The spec's own example is `2023-09-14T12:11:38.0000009` — seven
    // fractional digits and no zone. Date's tolerance for that is not
    // something to assume: a timestamp that came back Invalid would either
    // throw or silently become "now", and every reading would carry the moment
    // it arrived instead of the moment it was measured. Every distance and
    // fuel figure is derived from the interval between readings.
    const [p] = await new TataFleetEdgeAdapter().parsePayload({
      ...PUSH_BODY,
      eventDateTime: "2023-09-14T12:11:38.0000009",
    });
    assert.ok(p!.timestamp instanceof Date);
    assert.ok(!Number.isNaN(p!.timestamp.getTime()), "timestamp must not be Invalid Date");
    // Truncated to milliseconds and read as UTC — which the live feed confirms:
    // were it read as local time, the measured push lag would be hours, not the
    // three seconds observed in production.
    assert.equal(p!.timestamp.toISOString(), "2023-09-14T12:11:38.000Z");
  });

  test("the tank size the vehicle reports is carried, not dropped", async () => {
    // The pull path already learned tank capacity from the payload; the push
    // path did not. So ten trucks that arrived only over push sat at a
    // capacity of zero while every message they sent said 300 L — estimated
    // range undividable, the refuel detector with no threshold, and a vehicle
    // page reporting "tank size not recorded" about a truck that states its
    // tank size every minute.
    const [p] = await new TataFleetEdgeAdapter().parsePayload(PUSH_BODY);
    assert.equal(p!.fuelCapacityLitres, 300);
  });

  test("a zero tank with the ignition off is withheld, not recorded as empty", async () => {
    // RJ21GD0598 reported 133.0 L running at 11:28:47 and 0.0 L stopped at
    // 11:29:47. Thirty-six seconds. Across the fleet the correlation is total:
    // every zero-litre reading has the ignition off and not one has it on —
    // these senders are unpowered with the key out and send 0 rather than
    // nothing.
    //
    // Recorded, it shows an empty tank on a truck that is three-quarters full,
    // and the step back to 133 when the engine restarts reads as a 133-litre
    // refuel. One such phantom fill was already in the data.
    const asleep = { ...PUSH_BODY, ignitionOn: false, PrimaryFuelLevel: 0, primaryFuelLevel: 0, fuelLevelPercent: 0 };
    const [p] = await new TataFleetEdgeAdapter().parsePayload(asleep);
    assert.equal(p!.fuelLevelLitres, null, "litres must be withheld, not zero");
    assert.equal(p!.fuelLevelPct, null, "percent arrives separately and must be withheld too");
  });

  test("a zero tank with the ignition ON is still reported", async () => {
    // A dry tank on a running engine is a real and reportable state. Only the
    // unpowered case is ambiguous, so only that one is withheld.
    const dry = { ...PUSH_BODY, ignitionOn: true, PrimaryFuelLevel: 0, primaryFuelLevel: 0, fuelLevelPercent: 0 };
    const [p] = await new TataFleetEdgeAdapter().parsePayload(dry);
    assert.equal(p!.fuelLevelLitres, 0);
  });

  test("the capitalised fuel field in the spec is read", async () => {
    // Documented as `PrimaryFuelLevel`, sent by the live pull as
    // `primaryFuelLevel`. Reading only one spelling loses the tank entirely,
    // and fuel-theft detection has nothing left to measure.
    const [p] = await new TataFleetEdgeAdapter().parsePayload(PUSH_BODY);
    assert.equal(p!.fuelLevelLitres, 176);
  });

  test("position, speed and odometer survive", async () => {
    const [p] = await new TataFleetEdgeAdapter().parsePayload(PUSH_BODY);
    assert.equal(p!.latitude, 27.9881);
    assert.equal(p!.longitude, 73.7749);
    assert.equal(p!.speedKph, 42.5);
    assert.equal(p!.odometerKm, 262817);
    assert.equal(p!.ignitionState, true);
  });

  test("the timestamp is the event's, not the moment it arrived", async () => {
    // A push that stamped arrival time would reorder the series around network
    // latency and make every gap look like the vehicle went quiet.
    const [p] = await new TataFleetEdgeAdapter().parsePayload(PUSH_BODY);
    assert.equal(p!.timestamp.toISOString(), "2026-08-22T06:41:38.000Z");
  });

  test("engineRunHour echoing the odometer is still discarded", async () => {
    // 10577.8 against an odometer of 262817 is a real hour count and is kept;
    // the guard only fires when the two track each other. Pinned because the
    // push carries the same quirk as the pull and it must not be re-learned.
    const [p] = await new TataFleetEdgeAdapter().parsePayload(PUSH_BODY);
    assert.equal(p!.engineHours, 10577.8);

    const [echoed] = await new TataFleetEdgeAdapter().parsePayload({
      ...PUSH_BODY,
      engineRunHour: 262817.6,
    });
    assert.equal(echoed!.engineHours, null);
  });

  test("a stale fix contributes no position", async () => {
    // gpsFix false means the last known point, which on a map is
    // indistinguishable from the vehicle being there, and would feed a false
    // distance into theft detection.
    const [p] = await new TataFleetEdgeAdapter().parsePayload({ ...PUSH_BODY, gpsFix: false });
    assert.equal(p!.latitude, null);
    assert.equal(p!.longitude, null);
  });

  test("a batch is still accepted, so pull and push share one parser", async () => {
    const pings = await new TataFleetEdgeAdapter().parsePayload({ vehicles: [PUSH_BODY, PUSH_BODY] });
    assert.equal(pings.length, 2);
  });
});
