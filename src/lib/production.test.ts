import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  unitFor,
  assetProductivity,
  projectProduction,
  DEFAULT_PROD_NORMS,
  type LogLite,
  type AssetLite,
  type Norm,
} from "./production.ts";

const assetDumper: AssetLite = {
  id: "asset-1",
  code: "DMP-01",
  name: "Tata Dumper",
  assetClass: "DUMPER",
  category: "Vehicle",
};

const assetExcavator: AssetLite = {
  id: "asset-2",
  code: "EXC-01",
  name: "Komatsu PC210",
  assetClass: "EXCAVATOR",
  category: "Equipment",
};

const assetCrusher: AssetLite = {
  id: "asset-3",
  code: "CRU-01",
  name: "Metso Crusher",
  assetClass: "CRUSHER",
  category: "Plant",
};

const assetRoller: AssetLite = {
  id: "asset-4",
  code: "ROL-01",
  name: "HAMM Roller",
  assetClass: "ROLLER",
  category: "Equipment",
};

describe("production unit resolution", () => {
  test("resolves natural production units for known equipment classes", () => {
    assert.equal(unitFor("DUMPER"), "TRIPS_PER_DAY");
    assert.equal(unitFor("TIPPER"), "TRIPS_PER_DAY");
    assert.equal(unitFor("EXCAVATOR"), "M3_PER_HOUR");
    assert.equal(unitFor("BACKHOE"), "M3_PER_HOUR");
    assert.equal(unitFor("CRUSHER"), "TONNES_PER_DAY");
    assert.equal(unitFor("PLANT"), "TONNES_PER_DAY");
    assert.equal(unitFor("ROLLER"), "CYCLES_PER_HOUR");
    assert.equal(unitFor("CRANE"), "CYCLES_PER_HOUR");
  });

  test("falls back to TRIPS_PER_DAY for unknown or generic asset classes", () => {
    assert.equal(unitFor("UNKNOWN_CLASS"), "TRIPS_PER_DAY");
    assert.equal(unitFor(""), "TRIPS_PER_DAY");
  });
});

describe("asset productivity rollup", () => {
  test("an asset with no logs reports null output, not 0", () => {
    const p = assetProductivity(assetDumper, [], 0, 0, null);
    assert.equal(p.days, 0);
    assert.equal(p.output, null, "no shifts logged means output is unmeasured (null), not 0");
    assert.equal(p.status, "na");
    assert.equal(p.utilPct, null);
    assert.equal(p.idlePct, null);
    assert.equal(p.litresPerTrip, null);
    assert.equal(p.costPerTrip, null);
  });

  test("calculates trips per day correctly for haulage assets", () => {
    const logs: LogLite[] = [
      {
        assetId: assetDumper.id,
        date: new Date("2026-09-01T04:00:00Z"), // 09:30 IST
        shift: "DAY",
        trips: 10,
        tonnage: 200,
        volumeM3: 120,
        cycles: 0,
        workedHours: 8,
        idleHours: 2,
        distanceKm: 80,
        leadKm: 4,
        material: "Aggregates",
        projectId: "proj-1",
        driverId: "drv-1",
        source: "WEIGHBRIDGE",
      },
      {
        assetId: assetDumper.id,
        date: new Date("2026-09-02T04:00:00Z"),
        shift: "DAY",
        trips: 8,
        tonnage: 160,
        volumeM3: 96,
        cycles: 0,
        workedHours: 7,
        idleHours: 1,
        distanceKm: 64,
        leadKm: 4,
        material: "Aggregates",
        projectId: "proj-1",
        driverId: "drv-1",
        source: "WEIGHBRIDGE",
      },
    ];

    const norm: Norm = { unit: "TRIPS_PER_DAY", targetLow: 6, targetHigh: 12 };
    const p = assetProductivity(assetDumper, logs, 180, 16200, norm);

    assert.equal(p.days, 2);
    assert.equal(p.trips, 18);
    assert.equal(p.output, 9, "18 trips / 2 days = 9 trips/day");
    assert.equal(p.status, "on", "9 is within target band 6-12");
    assert.equal(p.workedHours, 15);
    assert.equal(p.idleHours, 3);
    assert.equal(p.idlePct, (3 / 18) * 100);
    assert.equal(p.litresPerTrip, 180 / 18); // 10 L/trip
    assert.equal(p.costPerTrip, 16200 / 18); // 900 Rs/trip
    assert.equal(p.litresPerTonne, 180 / 360); // 0.5 L/t
    assert.equal(p.costPerTonne, 16200 / 360); // 45 Rs/t
    assert.equal(p.distanceKm, 144);
  });

  test("calculates m3 per hour for excavators and checks low output alert", () => {
    const logs: LogLite[] = [
      {
        assetId: assetExcavator.id,
        date: new Date("2026-09-01T04:00:00Z"),
        shift: "DAY",
        trips: 0,
        tonnage: 0,
        volumeM3: 200,
        cycles: 0,
        workedHours: 10,
        idleHours: 0,
        distanceKm: 2,
        leadKm: 0,
        material: "Soil",
        projectId: "proj-1",
        driverId: "drv-2",
        source: "TELEMATICS",
      },
    ];

    const norm: Norm = { unit: "M3_PER_HOUR", targetLow: 40, targetHigh: 90 };
    const p = assetProductivity(assetExcavator, logs, 150, 13500, norm);

    assert.equal(p.output, 20, "200 m3 / 10 hrs = 20 m3/hr");
    assert.equal(p.status, "below", "20 is below targetLow 40");
    assert.ok(p.flags.some((f) => f.includes("below the 40–90 target band")));
  });

  test("calculates tonnes per day for crushers and detects idle burn", () => {
    const logs: LogLite[] = [
      {
        assetId: assetCrusher.id,
        date: new Date("2026-09-01T04:00:00Z"),
        shift: "DAY",
        trips: 0,
        tonnage: 500,
        volumeM3: 0,
        cycles: 0,
        workedHours: 5,
        idleHours: 5, // 50% idle
        distanceKm: 0,
        leadKm: 0,
        material: "Stone",
        projectId: "proj-1",
        driverId: null,
        source: "MANUAL",
      },
    ];

    const norm: Norm = { unit: "TONNES_PER_DAY", targetLow: 150, targetHigh: 400 };
    const p = assetProductivity(assetCrusher, logs, 200, 18000, norm);

    assert.equal(p.output, 500);
    assert.equal(p.status, "above", "500 is above targetHigh 400");
    assert.equal(p.idlePct, 50);
    assert.ok(p.flags.some((f) => f.includes("50% of logged time was idle")));
    assert.ok(p.flags.some((f) => f.includes("All production logs were entered manually")));
  });

  test("calculates cycles per hour for rollers", () => {
    const logs: LogLite[] = [
      {
        assetId: assetRoller.id,
        date: new Date("2026-09-01T04:00:00Z"),
        shift: "DAY",
        trips: 0,
        tonnage: 0,
        volumeM3: 0,
        cycles: 48,
        workedHours: 8,
        idleHours: 0,
        distanceKm: 15,
        leadKm: 0,
        material: null,
        projectId: "proj-1",
        driverId: "drv-3",
        source: "GPS",
      },
    ];

    const p = assetProductivity(assetRoller, logs, 60, 5400, null);
    assert.equal(p.output, 6, "48 cycles / 8 hrs = 6 cycles/hr");
  });

  test("flags diesel consumption with zero output", () => {
    const logs: LogLite[] = [
      {
        assetId: assetDumper.id,
        date: new Date("2026-09-01T04:00:00Z"),
        shift: "DAY",
        trips: 0,
        tonnage: 0,
        volumeM3: 0,
        cycles: 0,
        workedHours: 4,
        idleHours: 4,
        distanceKm: 0,
        leadKm: 0,
        material: null,
        projectId: "proj-1",
        driverId: null,
        source: "MANUAL",
      },
    ];

    const p = assetProductivity(assetDumper, logs, 120, 10800, null);
    assert.ok(p.flags.some((f) => f.includes("120 L consumed with no production recorded")));
  });
});

describe("project production summary", () => {
  test("aggregates tonnage, volume, trips and breaks down by material", () => {
    const logs: LogLite[] = [
      {
        assetId: "a1",
        date: new Date(),
        shift: "DAY",
        trips: 5,
        tonnage: 100,
        volumeM3: 60,
        cycles: 0,
        workedHours: 6,
        idleHours: 1,
        distanceKm: 50,
        leadKm: 5,
        material: "Gravel",
        projectId: "proj-A",
        driverId: null,
        source: "WEIGHBRIDGE",
      },
      {
        assetId: "a2",
        date: new Date(),
        shift: "DAY",
        trips: 4,
        tonnage: 80,
        volumeM3: 50,
        cycles: 0,
        workedHours: 5,
        idleHours: 0,
        distanceKm: 40,
        leadKm: 5,
        material: "Sand",
        projectId: "proj-A",
        driverId: null,
        source: "WEIGHBRIDGE",
      },
      {
        assetId: "a3",
        date: new Date(),
        shift: "DAY",
        trips: 3,
        tonnage: 60,
        volumeM3: 35,
        cycles: 0,
        workedHours: 4,
        idleHours: 0,
        distanceKm: 30,
        leadKm: 5,
        material: "Gravel",
        projectId: "proj-A",
        driverId: null,
        source: "WEIGHBRIDGE",
      },
      {
        assetId: "a4",
        date: new Date(),
        shift: "DAY",
        trips: 10,
        tonnage: 200,
        volumeM3: 120,
        cycles: 0,
        workedHours: 8,
        idleHours: 1,
        distanceKm: 100,
        leadKm: 5,
        material: "Stone",
        projectId: "proj-OTHER",
        driverId: null,
        source: "WEIGHBRIDGE",
      },
    ];

    const res = projectProduction("proj-A", logs);
    assert.equal(res.projectId, "proj-A");
    assert.equal(res.tonnage, 240, "100 + 80 + 60 = 240");
    assert.equal(res.volumeM3, 145, "60 + 50 + 35 = 145");
    assert.equal(res.trips, 12, "5 + 4 + 3 = 12");
    assert.equal(res.workedHours, 15, "6 + 5 + 4 = 15");
    assert.equal(res.machines, 3, "a1, a2, a3 = 3 machines");
    assert.equal(res.byMaterial.length, 2);
    assert.equal(res.byMaterial[0].material, "Gravel");
    assert.equal(res.byMaterial[0].tonnage, 160);
    assert.equal(res.byMaterial[1].material, "Sand");
    assert.equal(res.byMaterial[1].tonnage, 80);
  });

  test("default production norms cover all core asset classes", () => {
    assert.ok(DEFAULT_PROD_NORMS.length >= 10);
    const classes = DEFAULT_PROD_NORMS.map((n) => n.assetClass);
    assert.ok(classes.includes("TIPPER"));
    assert.ok(classes.includes("EXCAVATOR"));
    assert.ok(classes.includes("CRUSHER"));
    assert.ok(classes.includes("ROLLER"));
  });
});
