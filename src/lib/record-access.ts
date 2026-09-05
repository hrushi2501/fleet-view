import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { assetScope, projectScope, projectIdScope, type Access } from "./access";
import { ActionError } from "./action-error";

export function isRestricted(access: Access): boolean {
  return access.group !== "ADMIN" && (access.group === "DRIVER" || access.projectIds !== null);
}

/** Unassigned/global business records are reserved for unrestricted office accounts. */
export function recordScope(model: string, access: Access): Record<string, unknown> {
  if (!isRestricted(access)) return {};
  const asset = assetScope(access);
  const project = projectIdScope(access);
  switch (model) {
    case "asset": return asset;
    case "project": return projectScope(access);
    case "driver": return access.group === "DRIVER" ? { id: access.driverId ?? "__none__" } : { assets: { some: asset } };
    case "workOrder": case "maintenanceSchedule": case "complianceDoc": case "trip": case "tripSession":
    case "meterReading": case "fuelLevelReading": case "fuelTransaction": case "productionLog": case "hireContract": return { asset };
    case "costTransaction": case "weighbridgeTicket": case "fraudCase":
      return { OR: [{ asset }, { assetId: null, ...project }] };
    case "mobilizationOrder": return { asset };
    case "inventoryWarehouse": case "site": case "allocation":
    case "equipmentPlan": case "projectRevenue": case "fuelTank": return project;
    case "inventoryStock": case "inventoryTransaction": return { warehouse: project };
    case "workOrderLine": case "jobCardItem": return { workOrder: { asset } };
    case "hireLog": case "hireInvoice": case "hirePayment": case "hireInspection": case "hireContractAmendment": return { contract: { asset } };
    case "fuelReceipt": case "tankDip": case "fuelReconciliation": return { tank: project };
    case "caseEvidence": case "caseAction": case "caseRecovery": return { case: recordScope("fraudCase", access) };
    case "tyre": case "majorComponent": return { OR: [{ asset }, { warehouse: project }] };
    case "tyreEvent": return { tyre: recordScope("tyre", access) };
    case "attendance": case "personDocument": case "competency": case "violation": return { driver: recordScope("driver", access) };
    default: return { id: "__none__" };
  }
}

export function assertGlobalAccess(access: Access): void {
  if (isRestricted(access)) throw new ActionError("An administrator or an unrestricted manager must change this shared record.");
}

/** FuelAnomaly has scalar references, not Prisma relations; resolve visible IDs first. */
export async function fuelAnomalyScope(access: Access, client: Prisma.TransactionClient = db): Promise<Prisma.FuelAnomalyWhereInput> {
  if (!isRestricted(access)) return {};
  const [assets, tanks] = await Promise.all([
    client.asset.findMany({ where: assetScope(access), select: { id: true } }),
    client.fuelTank.findMany({ where: recordScope("fuelTank", access), select: { id: true } }),
  ]);
  return { OR: [{ assetId: { in: assets.map(row => row.id) } }, { assetId: null, tankId: { in: tanks.map(row => row.id) } }] };
}

type Lookup = { findFirst(args: { where: Record<string, unknown>; select: { id: true } }): Promise<{ id: string } | null> };

export async function assertRecordAccess(access: Access, model: string, id: string, client: Prisma.TransactionClient = db): Promise<void> {
  const delegate = (client as unknown as Record<string, Lookup>)[model];
  if (!delegate) throw new Error(`Unknown access model: ${model}`);
  const row = await delegate.findFirst({ where: { id, ...recordScope(model, access) }, select: { id: true } });
  if (!row) throw new ActionError("This record is unavailable or outside your assigned sites.");
}

const referenceModels: Record<string, string> = {
  assetId: "asset", projectId: "project", driverId: "driver", workOrderId: "workOrder", scheduleId: "maintenanceSchedule",
  warehouseId: "inventoryWarehouse", fromWarehouseId: "inventoryWarehouse", toWarehouseId: "inventoryWarehouse",
  componentId: "majorComponent", fromProjectId: "project", toProjectId: "project",
  contractId: "hireContract", tankId: "fuelTank", siteId: "site", caseId: "fraudCase", tyreId: "tyre",
};

/** Posted IDs never confer authority, including references on otherwise new records. */
export async function assertFormAccess(access: Access, fd: FormData, options: { allowProjectMove?: boolean } = {}): Promise<void> {
  for (const [field, model] of Object.entries(referenceModels)) {
    const value = fd.get(field);
    if (typeof value === "string" && value.trim()) await assertRecordAccess(access, model, value.trim());
  }
  const assetId = String(fd.get("assetId") ?? "").trim();
  const projectId = String(fd.get("projectId") ?? "").trim();
  if (assetId && projectId && !options.allowProjectMove) {
    const asset = await db.asset.findUnique({ where: { id: assetId }, select: { projectId: true } });
    if (asset?.projectId !== projectId) throw new ActionError("The machine does not belong to the selected site.");
  }
}
