import type { Prisma } from "@prisma/client";
import { ActionError } from "./action-error";
import { finiteNumber, positiveNumber } from "./input-validation";

export type DbClient = Prisma.TransactionClient;

/**
 * Recalculates weighted moving-average cost for inventory stock.
 * Formula: ((currentStock * currentAvgCost) + (incomingQty * incomingUnitCost)) / (currentStock + incomingQty)
 */
export function computeMovingAverageCost(
  currentQty: number,
  currentAvgCost: number,
  incomingQty: number,
  incomingUnitCost: number
): number {
  if (incomingQty <= 0) return Math.max(0, currentAvgCost);
  const effectiveCurrentQty = Math.max(0, currentQty);
  const totalQty = effectiveCurrentQty + incomingQty;
  if (totalQty <= 0) return Math.max(0, incomingUnitCost);

  const totalValue = effectiveCurrentQty * Math.max(0, currentAvgCost) + incomingQty * Math.max(0, incomingUnitCost);
  const avg = totalValue / totalQty;
  return Math.round(avg * 100) / 100;
}

/**
 * Checks if stock level is at or below minimum threshold.
 */
export function isLowStock(quantity: number, minStockLevel: number): boolean {
  return quantity <= minStockLevel;
}

export interface StockShortage {
  itemId: string;
  partNo: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  minStockLevel: number;
  currentStock: number;
  deficit: number;
  suggestedOrderQty: number;
  urgency: "CRITICAL" | "WARNING" | "NORMAL";
  warehouseBreakdown: Array<{
    warehouseId: string;
    warehouseCode: string;
    quantity: number;
  }>;
}

/**
 * Computes whether an item has breached its reorder threshold and calculates
 * the recommended restock purchase quantity with safety buffer.
 *
 * Buffer multiplier defaults to 1.5x of minStockLevel (standard economic batching).
 */
export function calculateReorderDeficit(
  currentQty: number,
  minStockLevel: number,
  bufferMultiplier = 1.5
): { isLow: boolean; deficit: number; suggestedOrderQty: number; urgency: "CRITICAL" | "WARNING" | "NORMAL" } {
  if (minStockLevel <= 0) {
    return { isLow: false, deficit: 0, suggestedOrderQty: 0, urgency: "NORMAL" };
  }

  const isLow = currentQty <= minStockLevel;
  if (!isLow) {
    return { isLow: false, deficit: 0, suggestedOrderQty: 0, urgency: "NORMAL" };
  }

  const deficit = Math.max(0, minStockLevel - currentQty);
  const targetStock = Math.ceil(minStockLevel * Math.max(1, bufferMultiplier));
  const suggestedOrderQty = Math.max(1, targetStock - Math.max(0, currentQty));
  const urgency = currentQty <= 0 ? "CRITICAL" : currentQty <= minStockLevel * 0.5 ? "WARNING" : "NORMAL";

  return { isLow: true, deficit, suggestedOrderQty, urgency };
}

/**
 * Scans item list and returns all parts with stock deficits across warehouses.
 */
export function evaluateLowStockAlerts(
  items: Array<{
    id: string;
    partNo: string;
    name: string;
    category: string;
    unitOfMeasure: string;
    minStockLevel: number;
    stocks: Array<{
      quantity: number;
      warehouseId?: string;
      warehouse?: { id?: string; code?: string; name?: string };
    }>;
  }>
): StockShortage[] {
  const shortages: StockShortage[] = [];

  for (const item of items) {
    const totalQty = totalStockQty(item.stocks);
    const { isLow, deficit, suggestedOrderQty, urgency } = calculateReorderDeficit(totalQty, item.minStockLevel);

    if (isLow) {
      shortages.push({
        itemId: item.id,
        partNo: item.partNo,
        name: item.name,
        category: item.category,
        unitOfMeasure: item.unitOfMeasure,
        minStockLevel: item.minStockLevel,
        currentStock: totalQty,
        deficit,
        suggestedOrderQty,
        urgency,
        warehouseBreakdown: (item.stocks || []).map((s) => ({
          warehouseId: s.warehouseId ?? s.warehouse?.id ?? "",
          warehouseCode: s.warehouse?.code ?? "SITE",
          quantity: s.quantity,
        })),
      });
    }
  }

  return shortages.sort((a, b) => (b.urgency === "CRITICAL" ? 1 : 0) - (a.urgency === "CRITICAL" ? 1 : 0) || b.deficit - a.deficit);
}

/**
 * Sums stock quantities across warehouses.
 */
export function totalStockQty(stocks: { quantity: number }[]): number {
  return stocks.reduce((sum, s) => sum + s.quantity, 0);
}

/**
 * Records a formal Purchase Requisition / Stock replenishment request in the inventory ledger.
 * Uses refType: "PURCHASE_ORDER" so it is fully traceable in the audit trail without schema changes.
 */
export async function createPurchaseRequisition(
  client: DbClient,
  params: {
    itemId: string;
    warehouseId: string;
    suggestedQty: number;
    supplier?: string | null;
    unitPrice?: number;
    reason?: string | null;
    actor?: string | null;
  }
) {
  const { itemId, warehouseId, suggestedQty, supplier, unitPrice, reason, actor } = params;
  positiveNumber(suggestedQty, "Requisition quantity");

  const item = await client.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new ActionError("Selected inventory item does not exist");

  const warehouse = await client.inventoryWarehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse || !warehouse.active) throw new ActionError("Selected warehouse does not exist or is inactive");

  const rate = unitPrice != null && unitPrice >= 0 ? unitPrice : item.averageCost;
  const note = [
    `Purchase Requisition: ${suggestedQty} ${item.unitOfMeasure} for store ${warehouse.code}`,
    supplier ? `Vendor: ${supplier}` : null,
    reason ? `Reason: ${reason}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return await client.inventoryTransaction.create({
    data: {
      type: "ADJUSTMENT",
      itemId,
      warehouseId,
      quantity: 0, // Quantity 0 preserves stock balance until receipt
      unitCost: rate,
      totalCost: Math.round(suggestedQty * rate * 100) / 100,
      refType: "PURCHASE_ORDER",
      note,
      by: actor ?? null,
    },
  });
}

/**
 * Atomically issues inventory parts to a maintenance Work Order.
 * Validates available stock, decrements warehouse stock, and logs an ISSUE transaction.
 */
export async function issueInventoryToWorkOrder(
  client: DbClient,
  params: {
    workOrderId: string;
    workOrderLineId: string;
    itemId: string;
    warehouseId: string;
    qty: number;
    unitCost: number;
    actor?: string | null;
    description?: string;
  }
) {
  const { workOrderId, itemId, warehouseId, qty, unitCost, actor, description } = params;

  positiveNumber(qty, "Quantity");
  finiteNumber(unitCost, "Unit cost", { min: 0 });

  // Check item exists
  const item = await client.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new ActionError("Selected inventory item does not exist");

  // Check warehouse exists
  const warehouse = await client.inventoryWarehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse || !warehouse.active) {
    throw new ActionError("Selected warehouse does not exist or is inactive");
  }

  // Check stock availability
  const currentStock = await client.inventoryStock.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId } },
  });

  const available = currentStock?.quantity ?? 0;
  if (available < qty) {
    throw new ActionError(
      `Insufficient stock in ${warehouse.code} for part ${item.partNo}: requested ${qty} ${item.unitOfMeasure}, but only ${available} available.`
    );
  }

  // Decrement stock
  const deducted = await client.inventoryStock.updateMany({
    where: { itemId, warehouseId, quantity: { gte: qty } },
    data: { quantity: { decrement: qty } },
  });
  if (deducted.count !== 1) throw new ActionError("Stock changed while issuing this part. Please try again.");

  // Record transaction
  const rate = unitCost > 0 ? unitCost : item.averageCost;
  return await client.inventoryTransaction.create({
    data: {
      type: "ISSUE",
      itemId,
      warehouseId,
      quantity: -qty, // negative for deductions
      unitCost: rate,
      totalCost: Math.round(qty * rate * 100) / 100,
      refType: "WORK_ORDER_LINE",
      refId: params.workOrderLineId,
      note: description ? `WO Part Issue: ${description}` : `Issued to Work Order ${workOrderId}`,
      by: actor ?? null,
    },
  });
}

/**
 * Returns inventory parts back to the warehouse when a Work Order Line is deleted.
 */
export async function returnWorkOrderInventory(
  client: DbClient,
  params: {
    workOrderId: string;
    workOrderLineId: string;
    itemId: string;
    qty?: number;
    actor?: string | null;
  }
) {
  const { workOrderId, itemId, qty, actor } = params;

  // Find the original ISSUE transaction for this work order & item
  const issueTxn = await client.inventoryTransaction.findFirst({
    where: {
      refType: "WORK_ORDER_LINE",
      refId: params.workOrderLineId,
      itemId,
      type: "ISSUE",
    },
    orderBy: { date: "desc" },
  });

  if (!issueTxn) {
    // Older cataloged lines do not identify their source store. Never guess.
    throw new ActionError("This older part line has no exact stock issue reference. Ask the store manager to reconcile it before removal.");
  }

  const previousReturn = await client.inventoryTransaction.findFirst({ where: { refType: "INVENTORY_RETURN", refId: issueTxn.id } });
  if (previousReturn) return previousReturn;
  const returnQty = qty ?? Math.abs(issueTxn.quantity);
  if (returnQty !== Math.abs(issueTxn.quantity)) throw new ActionError("The line quantity no longer matches its original issue.");
  if (returnQty <= 0) return null;

  // Restore stock to warehouse
  const stock = await client.inventoryStock.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId: issueTxn.warehouseId } },
  });

  if (stock) {
    await client.inventoryStock.update({
      where: { id: stock.id },
      data: { quantity: { increment: returnQty } },
    });
  } else {
    await client.inventoryStock.create({
      data: { itemId, warehouseId: issueTxn.warehouseId, quantity: returnQty },
    });
  }

  // Record reversal transaction
  return await client.inventoryTransaction.create({
    data: {
      type: "ADJUSTMENT",
      itemId,
      warehouseId: issueTxn.warehouseId,
      quantity: returnQty,
      unitCost: issueTxn.unitCost,
      totalCost: Math.round(returnQty * issueTxn.unitCost * 100) / 100,
      refType: "INVENTORY_RETURN",
      refId: issueTxn.id,
      note: `Stock return: Work Order ${workOrderId} line removed (${returnQty} units)`,
      by: actor ?? null,
    },
  });
}

/**
 * Goods Receipt Note (GRN): receives new stock into a warehouse and updates moving-average cost.
 */
export async function receiveStock(
  client: DbClient,
  params: {
    itemId: string;
    warehouseId: string;
    quantity: number;
    unitCost: number;
    actor?: string | null;
    note?: string | null;
  }
) {
  const { itemId, warehouseId, quantity, unitCost, actor, note } = params;
  positiveNumber(quantity, "Receipt quantity");
  finiteNumber(unitCost, "Unit cost", { min: 0 });

  const item = await client.inventoryItem.findUnique({
    where: { id: itemId },
    include: { stocks: true },
  });
  if (!item) throw new ActionError("Inventory item not found");

  const warehouse = await client.inventoryWarehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse || !warehouse.active) throw new ActionError("Warehouse is inactive or does not exist");

  const totalCurrentQty = totalStockQty(item.stocks);
  const newAvgCost = computeMovingAverageCost(totalCurrentQty, item.averageCost, quantity, unitCost);

  // Update item average cost
  await client.inventoryItem.update({
    where: { id: itemId },
    data: { averageCost: newAvgCost },
  });

  // Upsert warehouse stock
  await client.inventoryStock.upsert({
    where: { itemId_warehouseId: { itemId, warehouseId } },
    create: { itemId, warehouseId, quantity },
    update: { quantity: { increment: quantity } },
  });

  // Create transaction
  return await client.inventoryTransaction.create({
    data: {
      type: "RECEIPT",
      itemId,
      warehouseId,
      quantity,
      unitCost,
      totalCost: Math.round(quantity * unitCost * 100) / 100,
      note: note || "Goods Receipt (GRN)",
      by: actor ?? null,
    },
  });
}

/**
 * Inter-warehouse stock transfer.
 */
export async function transferStock(
  client: DbClient,
  params: {
    itemId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    quantity: number;
    actor?: string | null;
    note?: string | null;
  }
) {
  const { itemId, fromWarehouseId, toWarehouseId, quantity, actor, note } = params;
  positiveNumber(quantity, "Transfer quantity");
  if (fromWarehouseId === toWarehouseId) throw new ActionError("Source and destination warehouses must be different");

  const item = await client.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new ActionError("Inventory item not found");

  const [fromWh, toWh] = await Promise.all([
    client.inventoryWarehouse.findUnique({ where: { id: fromWarehouseId } }),
    client.inventoryWarehouse.findUnique({ where: { id: toWarehouseId } }),
  ]);
  if (!fromWh || !fromWh.active) throw new ActionError("Source warehouse not found or inactive");
  if (!toWh || !toWh.active) throw new ActionError("Destination warehouse not found or inactive");

  const sourceStock = await client.inventoryStock.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId: fromWarehouseId } },
  });
  const available = sourceStock?.quantity ?? 0;
  if (available < quantity) {
    throw new ActionError(
      `Insufficient stock at ${fromWh.code}: ${quantity} requested, only ${available} available.`
    );
  }

  // Deduct from source
  const deducted = await client.inventoryStock.updateMany({
    where: { itemId, warehouseId: fromWarehouseId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  if (deducted.count !== 1) throw new ActionError("Stock changed during the transfer. Please try again.");

  // Increment at destination
  await client.inventoryStock.upsert({
    where: { itemId_warehouseId: { itemId, warehouseId: toWarehouseId } },
    create: { itemId, warehouseId: toWarehouseId, quantity },
    update: { quantity: { increment: quantity } },
  });

  // Log transfer
  return await client.inventoryTransaction.create({
    data: {
      type: "TRANSFER",
      itemId,
      warehouseId: fromWarehouseId,
      toWarehouseId,
      quantity: -quantity,
      unitCost: item.averageCost,
      totalCost: Math.round(quantity * item.averageCost * 100) / 100,
      note: note || `Transferred from ${fromWh.code} to ${toWh.code}`,
      by: actor ?? null,
    },
  });
}

/**
 * Stock adjustment for physical audits, damages, or stocktake corrections.
 */
export async function adjustStock(
  client: DbClient,
  params: {
    itemId: string;
    warehouseId: string;
    newQuantity: number;
    reason?: string | null;
    actor?: string | null;
  }
) {
  const { itemId, warehouseId, newQuantity, reason, actor } = params;
  finiteNumber(newQuantity, "Adjusted stock quantity", { min: 0 });
  if (!reason?.trim()) throw new ActionError("A reason is required for a stock adjustment.");
  const warehouse = await client.inventoryWarehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse?.active) throw new ActionError("Warehouse is inactive or does not exist");

  const item = await client.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new ActionError("Inventory item not found");

  const currentStock = await client.inventoryStock.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId } },
  });
  const currentQty = currentStock?.quantity ?? 0;
  const delta = newQuantity - currentQty;

  if (delta === 0) return null; // no change

  await client.inventoryStock.upsert({
    where: { itemId_warehouseId: { itemId, warehouseId } },
    create: { itemId, warehouseId, quantity: newQuantity },
    update: { quantity: newQuantity },
  });

  return await client.inventoryTransaction.create({
    data: {
      type: "ADJUSTMENT",
      itemId,
      warehouseId,
      quantity: delta,
      unitCost: item.averageCost,
      totalCost: Math.round(Math.abs(delta) * item.averageCost * 100) / 100,
      refType: "ADJUSTMENT",
      note: reason || `Stock audit adjustment: count changed from ${currentQty} to ${newQuantity}`,
      by: actor ?? null,
    },
  });
}
