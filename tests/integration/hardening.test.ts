import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";

// Refuse before importing the database singleton. Never load .env.local here.
const configured = process.env.TEST_DATABASE_URL;
if (!configured) throw new Error("TEST_DATABASE_URL is required; use an isolated localhost test database.");
const url = new URL(configured);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.endsWith("_test")) {
  throw new Error("Integration tests require a localhost database with a name ending in _test.");
}
process.env.DATABASE_URL = configured;
process.env.DATABASE_URL_UNPOOLED = configured;
process.env.PRISMA_CONNECTION_LIMIT = "4";
const { rawDb } = await import("../../src/lib/db");
const { businessTransaction, auditedTransaction } = await import("../../src/lib/business-transaction");
const { PrismaClient } = await import("@prisma/client");
const { issueInventoryToWorkOrder, returnWorkOrderInventory, receiveStock } = await import("../../src/lib/inventory");
const { completeDuty } = await import("../../src/lib/trip-service");
const { assertRecordAccess } = await import("../../src/lib/record-access");
const { changeWorkOrderStatus } = await import("../../src/lib/work-order-service");
const { reserveRateLimit } = await import("../../src/lib/request-rate-limit");
import type { Access } from "../../src/lib/access";

after(async () => { await rawDb.$disconnect(); });
const tag = () => `test-${randomUUID()}`;
async function stock() {
  const item = await rawDb.inventoryItem.create({ data: { partNo: tag(), name: "Test filter", category: "FILTER", unitOfMeasure: "PCS", averageCost: 100 } });
  const a = await rawDb.inventoryWarehouse.create({ data: { code: tag(), name: "Test store A" } });
  const b = await rawDb.inventoryWarehouse.create({ data: { code: tag(), name: "Test store B" } });
  await rawDb.inventoryStock.createMany({ data: [{ itemId: item.id, warehouseId: a.id, quantity: 10 }, { itemId: item.id, warehouseId: b.id, quantity: 10 }] });
  return { item, a, b };
}
async function machine(primaryMeter = "ODOMETER") {
  const project = await rawDb.project.create({ data: { code: tag(), name: "Test site", location: "Test", client: "Test" } });
  const driver = await rawDb.driver.create({ data: { empCode: tag(), name: "Test driver", phone: "0", type: "Operator", licenseNo: tag(), licenseExpiry: new Date("2030-01-01") } });
  const asset = await rawDb.asset.create({ data: { code: tag(), name: "Test machine", assetClass: "TIPPER", category: "Vehicle", ownershipType: "OWNED", make: "Test", model: "Test", yearMfg: 2020, primaryMeter, projectId: project.id, driverId: driver.id, meterValue: 100 } });
  const session = await rawDb.tripSession.create({ data: { assetId: asset.id, driverId: driver.id, projectId: project.id, startOdometer: 100 } });
  return { asset, driver, project, session };
}

test("business writes and audit share one connection and roll back together", async () => {
  const singleUrl = new URL(configured);
  singleUrl.searchParams.set("connection_limit", "1");
  const single = new PrismaClient({ datasourceUrl: singleUrl.toString() });
  try {
  const code = tag();
  await assert.rejects(single.$transaction(async raw => {
    const tx = auditedTransaction(raw, null);
    const row = await tx.inventoryWarehouse.create({ data: { code, name: "Rollback store" } });
    assert.equal(await tx.auditEvent.count({ where: { entityId: row.id } }), 1);
    throw new Error("deliberate rollback");
  }), /deliberate rollback/);
  assert.equal(await rawDb.inventoryWarehouse.count({ where: { code } }), 0);
  await businessTransaction(null, tx => tx.inventoryWarehouse.create({ data: { code, name: "Committed store" } }));
  const row = await rawDb.inventoryWarehouse.findUniqueOrThrow({ where: { code } });
  assert.equal(await rawDb.auditEvent.count({ where: { entityId: row.id } }), 1);
  } finally { await single.$disconnect(); }
});

test("competing part issues cannot oversell a warehouse", async () => {
  const { item, a } = await stock();
  const results = await Promise.allSettled([1, 2].map(() => businessTransaction(null, tx => issueInventoryToWorkOrder(tx, {
    workOrderId: tag(), workOrderLineId: tag(), itemId: item.id, warehouseId: a.id, qty: 7, unitCost: 100,
  }))));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await rawDb.inventoryStock.findUniqueOrThrow({ where: { itemId_warehouseId: { itemId: item.id, warehouseId: a.id } } })).quantity, 3);
  assert.equal(await rawDb.inventoryTransaction.count({ where: { itemId: item.id, type: "ISSUE" } }), 1);
});

test("same SKU on two lines returns to the exact store, once only", async () => {
  const { item, a, b } = await stock();
  const wo = tag(), lineA = tag(), lineB = tag();
  for (const [line, warehouse] of [[lineA, a], [lineB, b]] as const) await businessTransaction(null, tx => issueInventoryToWorkOrder(tx, { workOrderId: wo, workOrderLineId: line, itemId: item.id, warehouseId: warehouse.id, qty: 2, unitCost: 100 }));
  await Promise.all([1, 2].map(() => businessTransaction(null, tx => returnWorkOrderInventory(tx, { workOrderId: wo, workOrderLineId: lineA, itemId: item.id, qty: 2 }))));
  const balances = await rawDb.inventoryStock.findMany({ where: { itemId: item.id } });
  assert.equal(balances.find(s => s.warehouseId === a.id)?.quantity, 10);
  assert.equal(balances.find(s => s.warehouseId === b.id)?.quantity, 8);
  assert.equal(await rawDb.inventoryTransaction.count({ where: { itemId: item.id, refType: "INVENTORY_RETURN" } }), 1);
});

test("concurrent receipts retain quantities and weighted valuation", async () => {
  const { item, a } = await stock();
  await Promise.all([200, 300].map(unitCost => businessTransaction(null, tx => receiveStock(tx, { itemId: item.id, warehouseId: a.id, quantity: 10, unitCost }))));
  assert.equal((await rawDb.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).averageCost, 175);
  assert.equal((await rawDb.inventoryStock.aggregate({ where: { itemId: item.id }, _sum: { quantity: true } }))._sum.quantity, 40);
});

test("duplicate checkouts create one trip and one meter reading", async () => {
  const { session, asset } = await machine();
  await Promise.all([1, 2].map(() => businessTransaction(null, tx => completeDuty(tx, session.id, null, { endedBy: "DRIVER", odometer: 110 }))));
  assert.equal(await rawDb.trip.count({ where: { assetId: asset.id } }), 1);
  assert.equal(await rawDb.meterReading.count({ where: { refId: session.id } }), 1);
  assert.equal((await rawDb.asset.findUniqueOrThrow({ where: { id: asset.id } })).meterValue, 110);
});

test("hour-meter difference is hours, not invented kilometres", async () => {
  const { session, asset } = await machine("SMU");
  await businessTransaction(null, tx => completeDuty(tx, session.id, null, { endedBy: "ADMIN", odometer: 105 }));
  const trip = await rawDb.trip.findFirstOrThrow({ where: { assetId: asset.id } });
  assert.equal(trip.engineHours, 5);
  assert.equal(trip.distanceKm, 0);
  assert.equal(trip.gpsVerified, false);
});

test("work-order scope, checklist and asset restoration are enforced together", async () => {
  const { asset, project } = await machine();
  const wo = await rawDb.workOrder.create({ data: { woNo: tag(), assetId: asset.id, type: "BREAKDOWN", priority: "High", status: "In-Progress", description: "Test failure", checklist: { create: { task: "Safety check", critical: true, done: false } } } });
  const access = { group: "SUPERVISOR", projectIds: [project.id], driverId: null, session: { id: tag(), name: "Test", role: "SiteManager", email: "test@example.invalid" }, codes: ["maintenance.edit"], can: () => true } as Access;
  await assert.rejects(assertRecordAccess({ ...access, projectIds: ["other"] }, "workOrder", wo.id), /outside your assigned/);
  await assert.rejects(changeWorkOrderStatus(access, wo.id, "Completed"), /critical safety checklist/);
  assert.equal((await rawDb.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).status, "In-Progress");
  await rawDb.jobCardItem.updateMany({ where: { workOrderId: wo.id }, data: { done: true } });
  await rawDb.asset.update({ where: { id: asset.id }, data: { status: "Breakdown" } });
  await changeWorkOrderStatus(access, wo.id, "Completed", { failureCode: "TEST", rcaNote: "Verified" });
  assert.equal((await rawDb.asset.findUniqueOrThrow({ where: { id: asset.id } })).status, "Active");
  assert.match((await rawDb.workOrder.findUniqueOrThrow({ where: { id: wo.id } })).description, /RCA: Verified/);
});

test("shared limiter never grants more than its budget", async () => {
  const subject = tag();
  const results = await Promise.all(Array.from({ length: 6 }, () => reserveRateLimit({ scope: "integration", subject, limit: 3, windowMs: 60_000 })));
  assert.equal(results.filter(r => r.ok).length, 3);
});
