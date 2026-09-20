import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAssets,
  filterMachines,
  type MachineOption,
  type NormalizedMachine,
} from "./machine-select-helpers.ts";

describe("machine select option normalization", () => {
  test("normalizes legacy id-label pair into code and name", () => {
    const legacy = [{ id: "m1", label: "RJ21GE1659 — Tata Prima 2528.K" }];
    const normalized = normalizeAssets(legacy);

    assert.equal(normalized[0].code, "RJ21GE1659");
    assert.equal(normalized[0].name, "Tata Prima 2528.K");
    assert.equal(normalized[0].category, "General Fleet");
  });

  test("preserves rich MachineOption metadata including category and active work orders", () => {
    const rich: MachineOption[] = [
      {
        id: "m2",
        code: "EXC-01",
        name: "CAT 320D",
        category: "Excavator",
        status: "Active",
        activeWorkOrders: [
          { id: "wo-1", woNo: "WO-9901", description: "Hydraulic hose repair", status: "Open" },
        ],
      },
    ];

    const normalized = normalizeAssets(rich);
    assert.equal(normalized[0].code, "EXC-01");
    assert.equal(normalized[0].category, "Excavator");
    assert.equal(normalized[0].activeWorkOrders.length, 1);
    assert.equal(normalized[0].activeWorkOrders[0].woNo, "WO-9901");
  });
});

describe("category filtering and search query matching", () => {
  const fleet: NormalizedMachine[] = [
    { id: "1", code: "TIP-101", name: "Tata 2518", category: "Tipper", activeWorkOrders: [] },
    { id: "2", code: "TIP-102", name: "Ashok Leyland 2820", registrationNo: "RJ21GA9900", category: "Tipper", activeWorkOrders: [] },
    { id: "3", code: "EXC-201", name: "Komatsu PC210", category: "Excavator", activeWorkOrders: [] },
    { id: "4", code: "CRU-301", name: "Metso Crusher", category: "Crusher", activeWorkOrders: [] },
  ];

  test("category filter isolates specific equipment class", () => {
    const tippers = filterMachines(fleet, "Tipper", "");
    assert.equal(tippers.length, 2);
    assert.ok(tippers.every((m) => m.category === "Tipper"));

    const excavators = filterMachines(fleet, "Excavator", "");
    assert.equal(excavators.length, 1);
    assert.equal(excavators[0].code, "EXC-201");
  });

  test("search query matches machine code case-insensitively", () => {
    const matches = filterMachines(fleet, "ALL", "tip-101");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].code, "TIP-101");
  });

  test("search query matches vehicle registration number", () => {
    const matches = filterMachines(fleet, "ALL", "RJ21GA");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].code, "TIP-102");
  });

  test("search query matches model name", () => {
    const matches = filterMachines(fleet, "ALL", "Komatsu");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].code, "EXC-201");
  });

  test("combining category and query filters both dimensions", () => {
    const matches = filterMachines(fleet, "Tipper", "Tata");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].code, "TIP-101");

    const noMatches = filterMachines(fleet, "Excavator", "Tata");
    assert.equal(noMatches.length, 0);
  });
});
