"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { DEFAULT_PM_TASKS, PM_PARTS_KITS } from "@/lib/maintenance";
import { requireAction, ActionError, safe } from "@/lib/guard";
import { changeWorkOrderStatus, editableWorkOrder, recalculateWorkOrder } from "@/lib/work-order-service";
import { businessTransaction } from "@/lib/business-transaction";
import { assertFormAccess, assertRecordAccess, assertGlobalAccess, recordScope } from "@/lib/record-access";
import { formNumber, positiveNumber, finiteNumber, nonNegativeNumber, boundedNumber, oneOf, safeParseDate, sanitizeString } from "@/lib/input-validation";
import { randomUUID } from "node:crypto";
import {
  issueInventoryToWorkOrder,
  returnWorkOrderInventory,
  receiveStock,
  transferStock,
  adjustStock,
} from "@/lib/inventory";
import { audit } from "@/lib/audit";

const s = (fd: FormData, k: string) => sanitizeString(fd.get(k), k);
const n = formNumber;
const b = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";

function refresh() {
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/tyres");
  revalidatePath("/maintenance/reminders");
  revalidatePath("/maintenance/inventory");
  revalidatePath("/tyres");
  revalidatePath("/costs");
  revalidatePath("/fleet");
}

/* ------------------------------- PM schedules ------------------------------- */

async function saveSchedule__impl(id: string | null, fd: FormData) {
  const access = await requireAction("maintenance.edit");
  if (id) await assertRecordAccess(access, "maintenanceSchedule", id);
  await assertFormAccess(access, fd);
  const data = {
    assetId: s(fd, "assetId") || null,
    assetClass: s(fd, "assetClass") || null,
    taskName: s(fd, "taskName"),
    taskCode: s(fd, "taskCode") || null,
    intervalKm: nonNegativeNumber(fd.get("intervalKm"), "Interval km", { max: 1_000_000, fallback: 0 }),
    intervalHours: nonNegativeNumber(fd.get("intervalHours"), "Interval hours", { max: 50_000, fallback: 0 }),
    intervalDays: boundedNumber(fd.get("intervalDays"), "Interval days", { min: 0, max: 3650, integer: true, fallback: 0 }),
    lastDoneMeter: nonNegativeNumber(fd.get("lastDoneMeter"), "Last done meter", { max: 10_000_000, fallback: 0 }),
    lastDoneDate: safeParseDate(fd.get("lastDoneDate"), "Last done date"),
    estimatedCost: nonNegativeNumber(fd.get("estimatedCost"), "Estimated cost", { max: 10_000_000, fallback: 0 }),
    estimatedHours: nonNegativeNumber(fd.get("estimatedHours"), "Estimated hours", { max: 500, fallback: 0 }),
    active: fd.get("active") == null ? true : b(fd, "active"),
    notes: s(fd, "notes") || null,
  };
  if (!data.taskName) throw new ActionError("Task name is required");
  if (id) await db.maintenanceSchedule.update({ where: { id }, data });
  else await db.maintenanceSchedule.create({ data });
  refresh();
}

async function deleteSchedule__impl(id: string) {
  const access = await requireAction("maintenance.edit");
  await assertRecordAccess(access, "maintenanceSchedule", id);
  await db.maintenanceSchedule.delete({ where: { id } });
  refresh();
}

/** Applies the shipped PM task templates to every matching asset. */
async function seedPmSchedules__impl() {
  const access = await requireAction("maintenance.edit");
  const assets = await db.asset.findMany({ where: recordScope("asset", access), select: { id: true, assetClass: true, meterValue: true } });
  let created = 0;
  for (const t of DEFAULT_PM_TASKS) {
    for (const a of assets.filter((x) => x.assetClass === t.assetClass)) {
      const exists = await db.maintenanceSchedule.findFirst({ where: { assetId: a.id, taskName: t.taskName } });
      if (exists) continue;
      await db.maintenanceSchedule.create({
        data: {
          assetId: a.id,
          assetClass: t.assetClass,
          taskName: t.taskName,
          intervalKm: t.intervalKm,
          intervalHours: t.intervalHours,
          intervalDays: t.intervalDays,
          estimatedCost: t.estimatedCost,
          // Anchor to the current meter so nothing shows as instantly overdue.
          lastDoneMeter: a.meterValue,
          lastDoneDate: new Date(),
        },
      });
      created++;
    }
  }
  refresh();
  return { ok: true as const, created };
}

/** Raise a work order straight from a due schedule, auto-populating parts kit lines. */
async function raiseWoFromSchedule__impl(scheduleId: string) {
  const access = await requireAction("maintenance.edit");
  await assertRecordAccess(access, "maintenanceSchedule", scheduleId);
  const sch = await db.maintenanceSchedule.findUnique({ where: { id: scheduleId }, include: { asset: true } });
  if (!sch || !sch.assetId || !sch.asset) throw new ActionError("Schedule has no asset");

  const woNo = `WO-${randomUUID()}`;
  
  // Check if a pre-defined spare parts kit exists for this PM task name
  const kitItems = PM_PARTS_KITS[sch.taskName] || [];
  const initialPartsCost = kitItems.filter((k) => k.kind !== "LABOUR").reduce((sum, k) => sum + k.qty * k.rate, 0);
  const initialLaborCost = kitItems.filter((k) => k.kind === "LABOUR").reduce((sum, k) => sum + k.qty * k.rate, 0);

  const wo = await db.workOrder.create({
    data: {
      woNo,
      assetId: sch.assetId,
      projectId: sch.asset.projectId,
      type: "PM",
      priority: "Medium",
      status: "Open",
      description: sch.taskName,
      scheduleId: sch.id,
      meterAtService: sch.asset.meterValue,
      partsCost: initialPartsCost,
      laborCost: initialLaborCost,
      totalCost: initialPartsCost + initialLaborCost,
      lines: kitItems.length > 0 ? {
        create: kitItems.map((item) => ({
          kind: item.kind,
          description: item.description,
          partNo: item.partNo,
          qty: item.qty,
          rate: item.rate,
          amount: item.qty * item.rate,
        })),
      } : undefined,
    },
  });
  refresh();
  return wo.id;
}

/** Close a PM or Breakdown work order and roll its schedule forward if applicable. */
async function completeWorkOrder__impl(id: string, fd: FormData) {
  const access = await requireAction("maintenance.edit");
  await assertFormAccess(access, fd);
  await changeWorkOrderStatus(access, id, "Completed", {
    laborCost: n(fd, "laborCost"), partsCost: n(fd, "partsCost"),
    ...(s(fd, "meterAtService") ? { meterAtService: n(fd, "meterAtService") } : {}),
    downtimeHrs: n(fd, "downtimeHrs"),
    technician: s(fd, "technician") || access.session.name,
    failureCode: s(fd, "failureCode"), rcaNote: s(fd, "rcaNote"),
  });
  refresh();
}

/** Submit a daily operator pre-operational inspection checklist. */
async function submitPreOpChecklist__impl(fd: FormData) {
  const access = await requireAction("maintenance.edit");
  await assertFormAccess(access, fd);
  const assetId = s(fd, "assetId");
  if (!assetId) throw new ActionError("Asset selection is required for Pre-Op Inspection");

  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ActionError("Asset not found");

  const checks = [
    { name: "Fluid Levels (Oil/Coolant)", pass: b(fd, "check_fluids") },
    { name: "Hydraulic System & Leaks", pass: b(fd, "check_hydraulics") },
    { name: "Belts & Tension", pass: b(fd, "check_belts") },
    { name: "Tyres / Tracks & Undercarriage", pass: b(fd, "check_undercarriage") },
    { name: "Brakes & Emergency Controls", pass: b(fd, "check_brakes") },
  ];

  const failedChecks = checks.filter((c) => !c.pass);

  if (failedChecks.length > 0) {
    await businessTransaction(access.session, async tx => {
      await assertRecordAccess(access, "asset", asset.id, tx);
    // Automatically raise an urgent Breakdown Work Order for failed safety checks
    const woNo = `WO-${randomUUID()}`;
    const issueSummary = failedChecks.map((f) => f.name).join(", ");

    await tx.workOrder.create({
      data: {
        woNo,
        assetId: asset.id,
        projectId: asset.projectId,
        type: "BREAKDOWN",
        priority: "High",
        status: "Open",
        description: `Pre-Op Inspection Failed: ${issueSummary}`,
        meterAtService: asset.meterValue,
      },
    });

    // Mark vehicle as in Breakdown so it cannot be claimed or operated unsafe
    await tx.asset.update({
      where: { id: asset.id },
      data: { status: "Breakdown" },
    });

    // Create a critical alert
    await tx.alert.create({
      data: {
        category: "Maintenance",
        severity: "Critical",
        title: `Pre-Op Inspection Failed — ${asset.code}`,
        message: `Machine ${asset.code} (${asset.name}) failed daily pre-op check for: ${issueSummary}`,
        assetId: asset.id,
        status: "Open",
      },
    });
    });
  }

  refresh();
  return { ok: true, failedCount: failedChecks.length };
}

/* ------------------------------ lines & checklist ------------------------------ */

async function addWoLine__impl(workOrderId: string, fd: FormData) {
  const access = await requireAction("maintenance.edit");
  await assertFormAccess(access, fd);
  const qty = positiveNumber(fd.get("qty"), "Quantity");
  const kind = oneOf(s(fd, "kind") || "PART", ["PART", "LABOUR", "OUTSIDE"], "line kind");
  const inventoryItemId = s(fd, "inventoryItemId") || null;
  const warehouseId = s(fd, "warehouseId") || null;
  if (inventoryItemId && (kind !== "PART" || !warehouseId)) throw new ActionError("A cataloged part requires a source store and the Part line kind.");
  if (!s(fd, "description")) throw new ActionError("Description is required.");
  await businessTransaction(access.session, async tx => {
    await assertRecordAccess(access, "workOrder", workOrderId, tx);
    await editableWorkOrder(tx, workOrderId);
    if (warehouseId) await assertRecordAccess(access, "inventoryWarehouse", warehouseId, tx);
    const item = inventoryItemId ? await tx.inventoryItem.findUnique({ where: { id: inventoryItemId } }) : null;
    if (inventoryItemId && !item) throw new ActionError("Inventory item not found.");
    const rate = item ? item.averageCost : finiteNumber(fd.get("rate"), "Rate", { min: 0 });
    const line = await tx.workOrderLine.create({ data: {
      workOrderId, kind, description: s(fd, "description"), partNo: item?.partNo ?? (s(fd, "partNo") || null),
      qty, rate, amount: Math.round(qty * rate * 100) / 100, vendor: s(fd, "vendor") || null, inventoryItemId,
    } });
    if (inventoryItemId && warehouseId) await issueInventoryToWorkOrder(tx, {
      workOrderId, workOrderLineId: line.id, itemId: inventoryItemId, warehouseId, qty, unitCost: rate,
      actor: access.session.name, description: line.description,
    });
    await recalculateWorkOrder(tx, workOrderId);
  });
  refresh();
}

async function deleteWoLine__impl(id: string) {
  const access = await requireAction("maintenance.edit");
  await businessTransaction(access.session, async tx => {
    const line = await tx.workOrderLine.findUnique({ where: { id } });
    if (!line) return;
    await assertRecordAccess(access, "workOrder", line.workOrderId, tx);
    await editableWorkOrder(tx, line.workOrderId);
    if (line.inventoryItemId) await returnWorkOrderInventory(tx, {
      workOrderId: line.workOrderId, workOrderLineId: line.id,
      itemId: line.inventoryItemId, qty: line.qty, actor: access.session.name,
    });
    await tx.workOrderLine.delete({ where: { id } });
    await recalculateWorkOrder(tx, line.workOrderId);
  });
  refresh();
}

async function addChecklistItem__impl(workOrderId: string, fd: FormData) {
  const access = await requireAction("maintenance.edit");
  await assertRecordAccess(access, "workOrder", workOrderId);
  await assertFormAccess(access, fd);
  await businessTransaction(access.session, async tx => {
    await editableWorkOrder(tx, workOrderId);
    await tx.jobCardItem.create({ data: { workOrderId, task: s(fd, "task"), critical: b(fd, "critical") } });
  });
  refresh();
}

async function toggleChecklistItem__impl(id: string, done: boolean) {
  const access = await requireAction("maintenance.edit");
  await assertRecordAccess(access, "jobCardItem", id);
  const session = await getSession();
  await businessTransaction(access.session, async tx => {
    const item = await tx.jobCardItem.findUniqueOrThrow({ where: { id } });
    await editableWorkOrder(tx, item.workOrderId);
    await tx.jobCardItem.update({ where: { id }, data: { done, doneBy: done ? session?.name ?? null : null, doneAt: done ? new Date() : null } });
  });
  refresh();
}

/* ------------------------------ inventory management ------------------------------ */

async function saveInventoryItem__impl(id: string | null, fd: FormData) {
  const access = await requireAction("maintenance.edit");
  assertGlobalAccess(access);
  await assertFormAccess(access, fd);
  const partNo = s(fd, "partNo");
  const name = s(fd, "name");
  if (!partNo || !name) throw new ActionError("Part number and name are required.");

  const data = {
    partNo,
    name,
    description: s(fd, "description") || null,
    category: s(fd, "category") || "PART",
    unitOfMeasure: s(fd, "unitOfMeasure") || "PCS",
    minStockLevel: finiteNumber(n(fd, "minStockLevel"), "Minimum stock", { min: 0 }),
    averageCost: finiteNumber(n(fd, "averageCost"), "Average cost", { min: 0 }),
  };

  const session = await getSession();

  if (id) {
    const { averageCost: _averageCost, ...catalogData } = data;
    await db.inventoryItem.update({ where: { id }, data: catalogData });
    await audit({
      action: "UPDATE",
      module: "MAINTENANCE",
      entity: "InventoryItem",
      entityId: id,
      summary: `Updated inventory item ${partNo} — ${name} by ${session?.name || "System"}`,
    });
  } else {
    const existing = await db.inventoryItem.findUnique({ where: { partNo } });
    if (existing) throw new ActionError(`Part number ${partNo} already exists in inventory.`);
    const created = await db.inventoryItem.create({ data });
    await audit({
      action: "CREATE",
      module: "MAINTENANCE",
      entity: "InventoryItem",
      entityId: created.id,
      summary: `Created inventory item ${partNo} — ${name} by ${session?.name || "System"}`,
    });
  }
  refresh();
}

async function receiveStockAction__impl(fd: FormData) {
  const access = await requireAction("maintenance.edit");
  await assertFormAccess(access, fd);
  const itemId = s(fd, "itemId");
  const warehouseId = s(fd, "warehouseId");
  const quantity = n(fd, "quantity");
  const unitCost = n(fd, "unitCost");
  const note = s(fd, "note");

  if (!itemId || !warehouseId) throw new ActionError("Item and warehouse are required.");
  if (quantity <= 0) throw new ActionError("Received quantity must be greater than zero.");
  if (unitCost < 0) throw new ActionError("Unit cost cannot be negative.");

  const session = await getSession();
  await businessTransaction(access.session, async (tx) => {
    await receiveStock(tx, {
      itemId,
      warehouseId,
      quantity,
      unitCost,
      actor: session?.name,
      note,
    });
  });
  refresh();
}

async function transferStockAction__impl(fd: FormData) {
  const access = await requireAction("maintenance.edit");
  await assertFormAccess(access, fd);
  const itemId = s(fd, "itemId");
  const fromWarehouseId = s(fd, "fromWarehouseId");
  const toWarehouseId = s(fd, "toWarehouseId");
  const quantity = n(fd, "quantity");
  const note = s(fd, "note");

  if (!itemId || !fromWarehouseId || !toWarehouseId) {
    throw new ActionError("Item, source warehouse, and destination warehouse are required.");
  }

  const session = await getSession();
  await businessTransaction(access.session, async (tx) => {
    await transferStock(tx, {
      itemId,
      fromWarehouseId,
      toWarehouseId,
      quantity,
      actor: session?.name,
      note,
    });
  });
  refresh();
}

async function adjustStockAction__impl(fd: FormData) {
  const access = await requireAction("maintenance.edit");
  await assertFormAccess(access, fd);
  const itemId = s(fd, "itemId");
  const warehouseId = s(fd, "warehouseId");
  const newQuantity = n(fd, "newQuantity");
  const reason = s(fd, "reason");

  if (!itemId || !warehouseId) throw new ActionError("Item and warehouse are required.");
  if (newQuantity < 0) throw new ActionError("Count cannot be negative.");

  const session = await getSession();
  await businessTransaction(access.session, async (tx) => {
    await adjustStock(tx, {
      itemId,
      warehouseId,
      newQuantity,
      reason,
      actor: session?.name,
    });
  });
  refresh();
}

async function saveWarehouse__impl(id: string | null, fd: FormData) {
  const access = await requireAction("maintenance.edit");
  if (id) await assertRecordAccess(access, "inventoryWarehouse", id);
  await assertFormAccess(access, fd);
  const code = s(fd, "code");
  const name = s(fd, "name");
  if (!code || !name) throw new ActionError("Warehouse code and name are required.");

  const data = {
    code,
    name,
    location: s(fd, "location") || null,
    projectId: s(fd, "projectId") || null,
    active: fd.get("active") == null ? true : b(fd, "active"),
  };

  if (id) {
    await db.inventoryWarehouse.update({ where: { id }, data });
  } else {
    const existing = await db.inventoryWarehouse.findUnique({ where: { code } });
    if (existing) throw new ActionError(`Warehouse code ${code} already exists.`);
    await db.inventoryWarehouse.create({ data });
  }
  refresh();
}

/* ---------------------------------------------------------------------------
 * Exported actions.
 * ------------------------------------------------------------------------- */
export const saveSchedule = safe(saveSchedule__impl);
export const deleteSchedule = safe(deleteSchedule__impl);
export const seedPmSchedules = safe(seedPmSchedules__impl);
export const raiseWoFromSchedule = safe(raiseWoFromSchedule__impl);
export const completeWorkOrder = safe(completeWorkOrder__impl);
export const submitPreOpChecklist = safe(submitPreOpChecklist__impl);
export const addWoLine = safe(addWoLine__impl);
export const deleteWoLine = safe(deleteWoLine__impl);
export const addChecklistItem = safe(addChecklistItem__impl);
export const toggleChecklistItem = safe(toggleChecklistItem__impl);

// Inventory actions
export const saveInventoryItem = safe(saveInventoryItem__impl);
export const receiveStockAction = safe(receiveStockAction__impl);
export const transferStockAction = safe(transferStockAction__impl);
export const adjustStockAction = safe(adjustStockAction__impl);
export const saveWarehouse = safe(saveWarehouse__impl);
