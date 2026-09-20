import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateWeighbridgeWeights,
  reconcilePairs,
  MAX_REASONABLE_GROSS_KG,
  type TicketLite,
} from "./weighbridge";

describe("Weighbridge Validation Bounds", () => {
  test("accepts valid gross and tare weights and derives netKg", () => {
    const res = validateWeighbridgeWeights({ grossKg: 42_000, tareKg: 14_000 });
    assert.equal(res.valid, true);
    assert.equal(res.error, undefined);
    assert.equal(res.computedNetKg, 28_000);
  });

  test("rejects explicit netKg inconsistent with measured gross and tare", () => {
    const res = validateWeighbridgeWeights({ grossKg: 42_000, tareKg: 14_000, netKg: 27_900 });
    assert.equal(res.valid, false);
    assert.match(res.error!, /gross minus tare/);
  });

  test("rejects non-finite weights and negative net without silently deriving a replacement", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      assert.equal(validateWeighbridgeWeights({ grossKg: bad, tareKg: 0 }).valid, false);
      assert.equal(validateWeighbridgeWeights({ grossKg: 100, tareKg: 0, netKg: bad }).valid, false);
    }
    assert.equal(validateWeighbridgeWeights({ grossKg: 100, tareKg: 0, netKg: -1 }).valid, false);
    assert.equal(validateWeighbridgeWeights({ grossKg: 0, tareKg: 10 }).valid, false);
  });

  test("rejects negative gross weight", () => {
    const res = validateWeighbridgeWeights({ grossKg: -100, tareKg: 12_000 });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("cannot be negative"));
  });

  test("rejects negative tare weight", () => {
    const res = validateWeighbridgeWeights({ grossKg: 20_000, tareKg: -500 });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("cannot be negative"));
  });

  test("rejects gross weight less than tare weight", () => {
    const res = validateWeighbridgeWeights({ grossKg: 10_000, tareKg: 15_000 });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("cannot be less than empty tare weight"));
  });

  test("rejects unrealistic gross weight exceeding maximum limit", () => {
    const res = validateWeighbridgeWeights({ grossKg: MAX_REASONABLE_GROSS_KG + 100, tareKg: 15_000 });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("exceeds maximum permissible threshold"));
  });

  test("rejects unrealistic tare weight exceeding maximum limit", () => {
    const res = validateWeighbridgeWeights({ grossKg: 120_000, tareKg: MAX_REASONABLE_GROSS_KG + 1 });
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("exceeds maximum permissible threshold"));
  });
});

describe("Weighbridge Dispatch-Receipt Reconciliation", () => {
  const dTicket: TicketLite = {
    id: "d-ticket-1",
    ticketNo: "DISP-1001",
    kind: "DISPATCH",
    date: new Date(),
    material: "Aggregate 20mm",
    grossKg: 30000,
    tareKg: 10000,
    netKg: 20000,
    billedKg: 20000,
    rate: 500,
    amount: 10000,
    assetId: "truck-1",
    vendor: "Supplier A",
    pairedTicketNo: null,
  };

  test("matched receipt with minimal difference is status ok", () => {
    const rTicket: TicketLite = {
      ...dTicket,
      ticketNo: "REC-2001",
      kind: "RECEIPT",
      netKg: 19980, // 20kg difference (within SCALE_TOLERANCE_KG = 50)
      pairedTicketNo: "DISP-1001",
    };
    const res = reconcilePairs([dTicket, rTicket]);
    assert.equal(res.length, 1);
    assert.equal(res[0].status, "ok");
    assert.equal(res[0].shortageKg, 20);
  });

  test("unmatched dispatch is flagged as unmatched with 100% shortage", () => {
    const res = reconcilePairs([dTicket]);
    assert.equal(res.length, 1);
    assert.equal(res[0].status, "unmatched");
    assert.equal(res[0].shortageKg, 20000);
    assert.equal(res[0].shortagePct, 100);
    assert.equal(res[0].valueAtRisk, 10000);

    const dNoAmount = { ...dTicket, amount: 0, rate: 500, netKg: 20000 };
    const res2 = reconcilePairs([dNoAmount]);
    assert.equal(res2[0].valueAtRisk, 10_000_000, "derived from netKg * rate when amount is 0");
  });

  test("significant shortage triggers shortage status", () => {
    const rTicket: TicketLite = {
      ...dTicket,
      ticketNo: "REC-2002",
      kind: "RECEIPT",
      netKg: 19000, // 1,000 kg shortage (5% > 1.5% * 2)
      pairedTicketNo: "DISP-1001",
    };
    const res = reconcilePairs([dTicket, rTicket]);
    assert.equal(res.length, 1);
    assert.equal(res[0].status, "shortage");
    assert.equal(res[0].shortageKg, 1000);
    assert.equal(res[0].shortagePct, 5, "1000kg shortage on 20,000kg is 5%");
  });
});
