import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  tyreHealth,
  detectSwaps,
  componentHealth,
  LEGAL_MIN_TREAD_MM,
  TYRE_POSITIONS,
  COMPONENT_TYPES,
  type TyreLite,
  type EventLite,
  type ComponentLite,
} from "./tyres.ts";

const sampleTyre: TyreLite = {
  id: "tyre-1",
  serialNo: "MRF-99281",
  make: "MRF",
  size: "295/80R22.5",
  status: "IN_USE",
  assetId: "asset-101",
  position: "FL",
  cost: 24000,
  treadNewMm: 16.0,
  currentTreadMm: 10.0,
  expectedLifeKm: 80000,
  fittedMeter: 10000,
  totalKm: 5000,
  retreadCount: 0,
  purchaseDate: new Date("2026-01-01"),
};

describe("tyre health calculations & safety boundaries", () => {
  test("new tyre with full tread is good status and low wear", () => {
    const brandNew: TyreLite = { ...sampleTyre, currentTreadMm: 16.0, totalKm: 0, fittedMeter: 10000 };
    const h = tyreHealth(brandNew, 10000);
    assert.equal(h.wearPct, 0);
    assert.equal(h.treadRemainingMm, 16.0 - LEGAL_MIN_TREAD_MM);
    assert.equal(h.status, "good");
  });

  test("tread at or below 1.6 mm legal limit is marked unsafe", () => {
    const unsafe: TyreLite = { ...sampleTyre, currentTreadMm: 1.5 };
    const h = tyreHealth(unsafe, 20000);
    assert.equal(h.status, "unsafe");
    assert.ok(h.flags.some((f) => f.includes("legal minimum")));
  });

  test("tread between 1.6 mm and 3 mm is marked for replacement", () => {
    const replace: TyreLite = { ...sampleTyre, currentTreadMm: 2.8 };
    const h = tyreHealth(replace, 20000);
    assert.equal(h.status, "replace");
    assert.ok(h.flags.some((f) => f.includes("plan replacement now")));
  });

  test("wear percentage above 70% is marked monitor", () => {
    // Usable = 16 - 1.6 = 14.4. Remaining = 5 - 1.6 = 3.4.
    // Wear = (14.4 - 3.4) / 14.4 = 76.4%
    const monitor: TyreLite = { ...sampleTyre, currentTreadMm: 5.0 };
    const h = tyreHealth(monitor, 20000);
    assert.equal(h.status, "monitor");
  });

  test("calculates kmRun from fitment meter and total carried km", () => {
    // totalKm = 5000, fittedMeter = 10000, currentAssetMeter = 16000
    // kmRun = 5000 + (16000 - 10000) = 11000
    const h = tyreHealth(sampleTyre, 16000);
    assert.equal(h.kmRun, 11000);
    assert.equal(h.lifeUsedPct, (11000 / 80000) * 100);
    assert.equal(h.costPerKm, 24000 / 11000);
  });

  test("a tyre not currently in use does not accrue km from asset meter", () => {
    const spare: TyreLite = { ...sampleTyre, status: "SPARE", totalKm: 2000, fittedMeter: 10000 };
    const h = tyreHealth(spare, 15000);
    assert.equal(h.kmRun, 2000, "spare tyre should not accumulate asset km");
  });

  test("detects fast wear and flags alignment or overload issues", () => {
    // Wear is 50%, but only run 10,000 km -> projected full life = 20,000 km
    // Expected is 80,000 km. 20,000 < 80,000 * 0.7 (56,000 km).
    const fastWear: TyreLite = {
      ...sampleTyre,
      treadNewMm: 11.6, // usable = 10mm
      currentTreadMm: 6.6, // remaining = 5mm -> 50% wear
      totalKm: 0,
      fittedMeter: 0,
      expectedLifeKm: 80000,
    };
    const h = tyreHealth(fastWear, 10000);
    assert.ok(h.flags.some((f) => f.includes("Wearing fast")));
  });

  test("flags tyre marked in use but without an asset assigned", () => {
    const orphaned: TyreLite = { ...sampleTyre, status: "IN_USE", assetId: null };
    const h = tyreHealth(orphaned, null);
    assert.ok(h.flags.some((f) => f.includes("Marked in use but not fitted to any machine")));
  });
});

describe("tyre swap and theft detection", () => {
  test("detects tread increase without a retread event as a suspected swap", () => {
    const tyres: TyreLite[] = [sampleTyre];
    const events: EventLite[] = [
      {
        tyreId: sampleTyre.id,
        kind: "INSPECT",
        date: new Date("2026-05-01"),
        assetId: "asset-101",
        position: "FL",
        treadMm: 6.0,
      },
      {
        tyreId: sampleTyre.id,
        kind: "INSPECT",
        date: new Date("2026-06-01"),
        assetId: "asset-101",
        position: "FL",
        treadMm: 11.0, // Rose by 5mm with no RETREAD!
      },
    ];

    const swaps = detectSwaps(tyres, events);
    assert.equal(swaps.length, 1);
    assert.ok(swaps[0].reason.includes("Tread rose from 6 mm to 11 mm with no retread"));
  });

  test("detects tyre appearing on a different vehicle without removal or fitment", () => {
    const tyres: TyreLite[] = [sampleTyre];
    const events: EventLite[] = [
      {
        tyreId: sampleTyre.id,
        kind: "INSPECT",
        date: new Date("2026-05-01"),
        assetId: "asset-101",
        position: "FL",
        treadMm: 10.0,
      },
      {
        tyreId: sampleTyre.id,
        kind: "INSPECT",
        date: new Date("2026-06-01"),
        assetId: "asset-999", // Moved to another asset without FIT/REMOVE
        position: "FR",
        treadMm: 9.5,
      },
    ];

    const swaps = detectSwaps(tyres, events);
    assert.equal(swaps.length, 1);
    assert.ok(swaps[0].reason.includes("Appears on a different machine with no removal or fitment"));
  });

  test("legitimate retread does not trigger swap alert", () => {
    const tyres: TyreLite[] = [sampleTyre];
    const events: EventLite[] = [
      {
        tyreId: sampleTyre.id,
        kind: "INSPECT",
        date: new Date("2026-05-01"),
        assetId: "asset-101",
        position: "FL",
        treadMm: 4.0,
      },
      {
        tyreId: sampleTyre.id,
        kind: "RETREAD",
        date: new Date("2026-05-15"),
        assetId: null,
        position: null,
        treadMm: 14.0,
      },
      {
        tyreId: sampleTyre.id,
        kind: "INSPECT",
        date: new Date("2026-06-01"),
        assetId: "asset-101",
        position: "FL",
        treadMm: 13.5,
      },
    ];

    const swaps = detectSwaps(tyres, events);
    assert.equal(swaps.length, 0, "retread explains the tread increase");
  });
});

describe("component health tracking", () => {
  const comp: ComponentLite = {
    id: "comp-1",
    serialNo: "BCK-4001",
    type: "BUCKET",
    status: "IN_USE",
    cost: 150000,
    fittedMeter: 2000,
    expectedLifeHours: 5000,
    hoursUsed: 1000,
    rebuildCount: 0,
  };

  test("calculates component hoursRun and life percentage", () => {
    // hoursUsed = 1000, fittedMeter = 2000, currentAssetMeter = 3500
    // hoursRun = 1000 + (3500 - 2000) = 2500 -> 50% of 5000
    const h = componentHealth(comp, 3500);
    assert.equal(h.hoursRun, 2500);
    assert.equal(h.lifeUsedPct, 50);
    assert.equal(h.status, "good");
    assert.equal(h.costPerHour, 150000 / 2500);
  });

  test("marks component monitor at 80% and replace at 100%", () => {
    const monitor = componentHealth({ ...comp, hoursUsed: 4200, fittedMeter: 0 }, 0);
    assert.equal(monitor.status, "monitor");

    const replace = componentHealth({ ...comp, hoursUsed: 5100, fittedMeter: 0 }, 0);
    assert.equal(replace.status, "replace");
  });

  test("flags missing expected life on record", () => {
    const unjudged = componentHealth({ ...comp, expectedLifeHours: 0 }, 2000);
    assert.equal(unjudged.lifeUsedPct, null);
    assert.ok(unjudged.flags.some((f) => f.includes("No expected life on record")));
  });

  test("constants expose standard tyre positions and component types", () => {
    assert.ok(TYRE_POSITIONS.includes("FL"));
    assert.ok(TYRE_POSITIONS.includes("SPARE"));
    assert.ok(COMPONENT_TYPES.includes("BUCKET"));
    assert.ok(COMPONENT_TYPES.includes("UNDERCARRIAGE"));
  });
});
