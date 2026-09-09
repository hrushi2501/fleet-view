import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeMovingAverageCost,
  isLowStock,
  totalStockQty,
  calculateReorderDeficit,
  evaluateLowStockAlerts,
  createPurchaseRequisition,
  issueInventoryToWorkOrder,
  returnWorkOrderInventory,
  receiveStock,
  transferStock,
  adjustStock,
  type DbClient,
} from "./inventory";
import { ActionError } from "./guard";

interface TxnData {
  type?: string;
  quantity?: number;
  unitCost?: number;
  totalCost?: number;
  refType?: string | null;
  refId?: string | null;
  by?: string | null;
}

describe("Inventory Domain Logic", () => {
  describe("computeMovingAverageCost", () => {
    test("returns incoming cost when initial stock is 0", () => {
      assert.equal(computeMovingAverageCost(0, 0, 10, 500), 500);
    });

    test("correctly weights incoming inventory with existing stock", () => {
      // 10 units @ 100 + 10 units @ 200 = 3000 / 20 = 150
      assert.equal(computeMovingAverageCost(10, 100, 10, 200), 150);
    });

    test("handles unequal stock ratios and rounds to 2 decimals", () => {
      // 5 units @ 120 (600) + 15 units @ 180 (2700) = 3300 / 20 = 165
      assert.equal(computeMovingAverageCost(5, 120, 15, 180), 165);

      // 7 units @ 99.50 (696.5) + 3 units @ 110.25 (330.75) = 1027.25 / 10 = 102.73
      assert.equal(computeMovingAverageCost(7, 99.5, 3, 110.25), 102.73);
    });

    test("preserves current average cost if incoming quantity is zero", () => {
      assert.equal(computeMovingAverageCost(50, 450, 0, 600), 450);
    });

    test("handles negative current stock gracefully as zero base", () => {
      assert.equal(computeMovingAverageCost(-5, 100, 10, 250), 250);
    });
  });

  describe("isLowStock", () => {
    test("returns true when quantity is at or below minimum threshold", () => {
      assert.equal(isLowStock(5, 5), true);
      assert.equal(isLowStock(3, 5), true);
      assert.equal(isLowStock(0, 5), true);
    });

    test("returns false when quantity is strictly above minimum threshold", () => {
      assert.equal(isLowStock(6, 5), false);
      assert.equal(isLowStock(100, 10), false);
    });
  });

  describe("calculateReorderDeficit", () => {
    test("returns not low when stock exceeds threshold", () => {
      const res = calculateReorderDeficit(20, 10);
      assert.equal(res.isLow, false);
      assert.equal(res.deficit, 0);
      assert.equal(res.suggestedOrderQty, 0);
    });

    test("calculates deficit and recommended order with safety multiplier", () => {
      // min = 10, current = 4 (bufferMultiplier 1.5 -> target = 15) -> deficit = 6, suggestedOrder = 15 - 4 = 11
      const res = calculateReorderDeficit(4, 10, 1.5);
      assert.equal(res.isLow, true);
      assert.equal(res.deficit, 6);
      assert.equal(res.suggestedOrderQty, 11);
      assert.equal(res.urgency, "WARNING");
    });

    test("marks completely exhausted stock as CRITICAL urgency", () => {
      const res = calculateReorderDeficit(0, 8, 2.0);
      assert.equal(res.isLow, true);
      assert.equal(res.deficit, 8);
      assert.equal(res.suggestedOrderQty, 16);
      assert.equal(res.urgency, "CRITICAL");
    });

    test("ignores items with no minStockLevel configured (min = 0)", () => {
      const res = calculateReorderDeficit(0, 0);
      assert.equal(res.isLow, false);
    });
  });

  describe("evaluateLowStockAlerts", () => {
    test("filters and sorts shortage items by urgency and deficit", () => {
      const items = [
        {
          id: "item-1",
          partNo: "OIL-15W40",
          name: "Engine Oil 15W-40",
          category: "LUBRICANT",
          unitOfMeasure: "LITRES",
          minStockLevel: 200,
          stocks: [{ quantity: 50, warehouse: { id: "wh-1", code: "CENTRAL", name: "Central" } }],
        },
        {
          id: "item-2",
          partNo: "FLT-001",
          name: "Fuel Filter",
          category: "PART",
          unitOfMeasure: "PCS",
          minStockLevel: 20,
          stocks: [{ quantity: 0, warehouse: { id: "wh-1", code: "CENTRAL", name: "Central" } }],
        },
        {
          id: "item-3",
          partNo: "BRK-PAD",
          name: "Brake Pad Set",
          category: "PART",
          unitOfMeasure: "SET",
          minStockLevel: 10,
          stocks: [{ quantity: 50, warehouse: { id: "wh-1", code: "CENTRAL", name: "Central" } }],
        },
      ];

      const shortages = evaluateLowStockAlerts(items);
      assert.equal(shortages.length, 2);
      // item-2 has 0 stock (CRITICAL), so it ranks first
      assert.equal(shortages[0].partNo, "FLT-001");
      assert.equal(shortages[0].urgency, "CRITICAL");
      assert.equal(shortages[1].partNo, "OIL-15W40");
      assert.equal(shortages[1].urgency, "WARNING");
    });
  });

  describe("totalStockQty", () => {
    test("sums quantities across warehouse stocks", () => {
      const stocks = [{ quantity: 12 }, { quantity: 8 }, { quantity: 25 }];
      assert.equal(totalStockQty(stocks), 45);
      assert.equal(totalStockQty([]), 0);
    });
  });
});

describe("Inventory DB Operations", () => {
  describe("issueInventoryToWorkOrder", () => {
    test("throws ActionError when quantity <= 0", async () => {
      const mockClient = {} as unknown as DbClient;
      await assert.rejects(
        async () => {
          await issueInventoryToWorkOrder(mockClient, {
            workOrderId: "wo-1",
            workOrderLineId: "line-1",
            itemId: "item-1",
            warehouseId: "wh-1",
            qty: 0,
            unitCost: 100,
          });
        },
        (err: unknown) => err instanceof ActionError && err.message.includes("greater than zero")
      );
    });

    test("throws ActionError when warehouse has insufficient stock", async () => {
      const mockClient = {
        inventoryItem: {
          findUnique: async () => ({ id: "item-1", partNo: "FLT-001", unitOfMeasure: "PCS" }),
        },
        inventoryWarehouse: {
          findUnique: async () => ({ id: "wh-1", code: "WH-MAIN", active: true }),
        },
        inventoryStock: {
          findUnique: async () => ({ itemId: "item-1", warehouseId: "wh-1", quantity: 3 }),
        },
      } as unknown as DbClient;

      await assert.rejects(
        async () => {
          await issueInventoryToWorkOrder(mockClient, {
            workOrderId: "wo-1",
            workOrderLineId: "line-1",
            itemId: "item-1",
            warehouseId: "wh-1",
            qty: 5,
            unitCost: 150,
          });
        },
        (err: unknown) => err instanceof ActionError && err.message.includes("Insufficient stock")
      );
    });

    test("successfully decrements stock and creates ISSUE transaction", async () => {
      let stockUpdated = false;
      let txnCreated: TxnData = {};

      const mockClient = {
        inventoryItem: {
          findUnique: async () => ({
            id: "item-1",
            partNo: "OIL-15W40",
            unitOfMeasure: "L",
            averageCost: 280,
          }),
        },
        inventoryWarehouse: {
          findUnique: async () => ({ id: "wh-1", code: "WH-SITE-A", active: true }),
        },
        inventoryStock: {
          findUnique: async () => ({ itemId: "item-1", warehouseId: "wh-1", quantity: 50 }),
          updateMany: async (args: { where: { quantity: { gte: number } }; data: { quantity: { decrement: number } } }) => {
            stockUpdated = true;
            assert.equal(args.where.quantity.gte, 20);
            assert.equal(args.data.quantity.decrement, 20);
            return { count: 1 };
          },
        },
        inventoryTransaction: {
          create: async (args: { data: Record<string, unknown> }) => {
            txnCreated = args.data as TxnData;
            return { id: "txn-1", ...args.data };
          },
        },
      } as unknown as DbClient;

      const result = await issueInventoryToWorkOrder(mockClient, {
        workOrderId: "wo-101",
        workOrderLineId: "line-101",
        itemId: "item-1",
        warehouseId: "wh-1",
        qty: 20,
        unitCost: 280,
        actor: "Mechanic Bob",
        description: "Engine oil change",
      });

      assert.equal(stockUpdated, true);
      assert.equal(txnCreated.type, "ISSUE");
      assert.equal(txnCreated.quantity, -20);
      assert.equal(txnCreated.unitCost, 280);
      assert.equal(txnCreated.totalCost, 5600);
      assert.equal(txnCreated.refType, "WORK_ORDER_LINE");
      assert.equal(txnCreated.refId, "line-101");
      assert.equal(txnCreated.by, "Mechanic Bob");
      assert.equal(result.id, "txn-1");
    });
  });

  describe("returnWorkOrderInventory", () => {
    test("refuses to guess a store if no exact prior issue exists", async () => {
      const mockClient = {
        inventoryTransaction: {
          findFirst: async () => null,
        },
      } as unknown as DbClient;

      await assert.rejects(returnWorkOrderInventory(mockClient, {
        workOrderId: "wo-1", workOrderLineId: "line-1", itemId: "item-1",
      }), /no exact stock issue reference/);
    });

    test("restores stock and logs reversal transaction", async () => {
      let updatedQty = 0;
      let txnCreated: TxnData = {};

      const mockClient = {
        inventoryTransaction: {
          findFirst: async (args: { where: { refType: string; refId: string } }) => {
            if (args.where.refType === "INVENTORY_RETURN") return null;
            assert.equal(args.where.refId, "line-1");
            return {
            id: "orig-1",
            warehouseId: "wh-1",
            quantity: -4,
            unitCost: 500,
          }; },
          create: async (args: { data: Record<string, unknown> }) => {
            txnCreated = args.data as TxnData;
            return { id: "txn-rev-1", ...args.data };
          },
        },
        inventoryStock: {
          findUnique: async () => ({ id: "stk-1", quantity: 6 }),
          update: async (args: { data: { quantity: { increment: number } } }) => {
            updatedQty = 6 + args.data.quantity.increment;
          },
        },
      } as unknown as DbClient;

      const res = await returnWorkOrderInventory(mockClient, {
        workOrderId: "wo-1",
            workOrderLineId: "line-1",
        itemId: "item-1",
        qty: 4,
        actor: "Admin",
      });

      assert.equal(updatedQty, 10);
      assert.equal(txnCreated.type, "ADJUSTMENT");
      assert.equal(txnCreated.quantity, 4);
      assert.equal(txnCreated.totalCost, 2000);
      assert.equal(res?.id, "txn-rev-1");
    });
  });

  describe("receiveStock", () => {
    test("updates moving-average cost and upserts warehouse stock", async () => {
      let newAvg = 0;
      let txn: TxnData = {};

      const mockClient = {
        inventoryItem: {
          findUnique: async () => ({
            id: "item-1",
            averageCost: 100,
            stocks: [{ quantity: 10 }],
          }),
          update: async (args: { data: { averageCost: number } }) => {
            newAvg = args.data.averageCost;
          },
        },
        inventoryWarehouse: {
          findUnique: async () => ({ id: "wh-1", active: true }),
        },
        inventoryStock: {
          upsert: async () => ({}),
        },
        inventoryTransaction: {
          create: async (args: { data: Record<string, unknown> }) => {
            txn = args.data as TxnData;
            return { id: "grn-1", ...args.data };
          },
        },
      } as unknown as DbClient;

      await receiveStock(mockClient, {
        itemId: "item-1",
        warehouseId: "wh-1",
        quantity: 10,
        unitCost: 200,
        actor: "Storekeeper",
      });

      // (10*100 + 10*200)/20 = 150
      assert.equal(newAvg, 150);
      assert.equal(txn.type, "RECEIPT");
      assert.equal(txn.quantity, 10);
      assert.equal(txn.unitCost, 200);
      assert.equal(txn.totalCost, 2000);
    });
  });

  describe("transferStock", () => {
    test("prevents transferring to the same warehouse", async () => {
      const mockClient = {} as unknown as DbClient;
      await assert.rejects(
        async () => {
          await transferStock(mockClient, {
            itemId: "item-1",
            fromWarehouseId: "wh-1",
            toWarehouseId: "wh-1",
            quantity: 5,
          });
        },
        (err: unknown) => err instanceof ActionError && err.message.includes("must be different")
      );
    });

    test("prevents transferring more stock than is available", async () => {
      const mockClient = {
        inventoryItem: { findUnique: async () => ({ id: "item-1", averageCost: 100 }) },
        inventoryWarehouse: {
          findUnique: async ({ where }: { where: { id: string } }) => ({
            id: where.id,
            code: where.id,
            active: true,
          }),
        },
        inventoryStock: {
          findUnique: async () => ({ quantity: 2 }),
        },
      } as unknown as DbClient;

      await assert.rejects(
        async () => {
          await transferStock(mockClient, {
            itemId: "item-1",
            fromWarehouseId: "wh-1",
            toWarehouseId: "wh-2",
            quantity: 10,
          });
        },
        (err: unknown) => err instanceof ActionError && err.message.includes("Insufficient stock")
      );
    });
  });

  describe("adjustStock", () => {
    test("prevents negative adjusted quantities", async () => {
      const mockClient = {} as unknown as DbClient;
      await assert.rejects(
        async () => {
          await adjustStock(mockClient, {
            itemId: "item-1",
            warehouseId: "wh-1",
            newQuantity: -5,
          });
        },
        (err: unknown) => err instanceof ActionError && err.message.includes("at least 0")
      );
    });

    test("records difference when physical count differs", async () => {
      let txn: TxnData = {};

      const mockClient = {
        inventoryItem: { findUnique: async () => ({ id: "item-1", averageCost: 50 }) },
        inventoryWarehouse: { findUnique: async () => ({ id: "wh-1", active: true }) },
        inventoryStock: {
          findUnique: async () => ({ quantity: 15 }),
          upsert: async () => ({}),
        },
        inventoryTransaction: {
          create: async (args: { data: Record<string, unknown> }) => {
            txn = args.data as TxnData;
            return { id: "adj-1", ...args.data };
          },
        },
      } as unknown as DbClient;

      await adjustStock(mockClient, {
        itemId: "item-1",
        warehouseId: "wh-1",
        newQuantity: 12,
        reason: "Damaged packaging",
        actor: "Auditor",
      });

      assert.equal(txn.type, "ADJUSTMENT");
      assert.equal(txn.quantity, -3);
      assert.equal(txn.totalCost, 150);
    });
  });

  describe("createPurchaseRequisition", () => {
    test("rejects non-positive suggested quantities", async () => {
      const mockClient = {} as unknown as DbClient;
      await assert.rejects(
        async () => {
          await createPurchaseRequisition(mockClient, {
            itemId: "item-1",
            warehouseId: "wh-1",
            suggestedQty: 0,
          });
        },
        (err: unknown) => err instanceof ActionError && err.message.includes("greater than zero")
      );
    });

    test("logs requisition transaction with refType PURCHASE_ORDER and zero quantity change", async () => {
      let createdTxn: Record<string, unknown> = {};

      const mockClient = {
        inventoryItem: {
          findUnique: async () => ({ id: "item-1", unitOfMeasure: "PCS", averageCost: 250 }),
        },
        inventoryWarehouse: {
          findUnique: async () => ({ id: "wh-1", code: "CENTRAL", active: true }),
        },
        inventoryTransaction: {
          create: async (args: { data: Record<string, unknown> }) => {
            createdTxn = args.data;
            return { id: "txn-po-1", ...args.data };
          },
        },
      } as unknown as DbClient;

      await createPurchaseRequisition(mockClient, {
        itemId: "item-1",
        warehouseId: "wh-1",
        suggestedQty: 15,
        supplier: "BOSCH India",
        reason: "Buffer replenishment",
        actor: "Workshop Supervisor",
      });

      assert.equal(createdTxn.refType, "PURCHASE_ORDER");
      assert.equal(createdTxn.quantity, 0);
      assert.equal(createdTxn.unitCost, 250);
      assert.equal(createdTxn.totalCost, 3750);
      assert.match(String(createdTxn.note), /Purchase Requisition: 15 PCS for store CENTRAL/);
      assert.match(String(createdTxn.note), /Vendor: BOSCH India/);
    });
  });
});

