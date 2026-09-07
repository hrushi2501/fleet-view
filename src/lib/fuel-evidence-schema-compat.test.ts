import assert from "node:assert/strict";
import test from "node:test";
import { legacyFuelEvidenceArgs, legacyNestedFuelEvidenceArgs } from "./fuel-evidence-schema-compat.ts";

test("legacy fuel reads retain relations while excluding the pending evidence column", () => {
  const args = legacyFuelEvidenceArgs("findMany", {
    where: { type: "ISSUE" },
    include: { asset: true, session: { select: { driver: true } } },
  }) as Record<string, unknown>;

  assert.equal("include" in args, false);
  const select = args.select as Record<string, unknown>;
  assert.equal(select.afterOdometerPhoto, undefined);
  assert.equal(select.odometerPhoto, true);
  assert.equal(select.asset, true);
  assert.deepEqual(select.session, { select: { driver: true } });
});

test("legacy fuel writes omit only the optional pending evidence capture", () => {
  const args = legacyFuelEvidenceArgs("create", {
    data: { quantity: 20, pumpPhoto: "/api/files/pump", afterOdometerPhoto: "/api/files/after" },
  }) as Record<string, unknown>;

  assert.deepEqual(args.data, { quantity: 20, pumpPhoto: "/api/files/pump" });
  assert.equal((args.select as Record<string, unknown>).afterOdometerPhoto, undefined);
});

test("legacy fuel filters do not query a column that old databases do not have", () => {
  const args = legacyFuelEvidenceArgs("findFirst", {
    where: { OR: [{ odometerPhoto: "a" }, { afterOdometerPhoto: "b" }] },
    select: { assetId: true, afterOdometerPhoto: true },
  }) as Record<string, unknown>;

  assert.deepEqual(args.where, { OR: [{ odometerPhoto: "a" }, {}] });
  assert.deepEqual(args.select, { assetId: true });
});

test("asset detail relations do not default-select the pending fuel evidence column", () => {
  const args = legacyNestedFuelEvidenceArgs({
    include: { project: true, fuelTxns: { where: { type: "ISSUE" }, take: 8 } },
  }) as Record<string, unknown>;

  const fuelTxns = (args.include as Record<string, unknown>).fuelTxns as Record<string, unknown>;
  assert.equal(fuelTxns.take, 8);
  assert.deepEqual(fuelTxns.where, { type: "ISSUE" });
  assert.equal((fuelTxns.select as Record<string, unknown>).afterOdometerPhoto, undefined);
  assert.equal((fuelTxns.select as Record<string, unknown>).pumpPhoto, true);
});
