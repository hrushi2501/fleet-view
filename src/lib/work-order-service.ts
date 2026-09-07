import type { Prisma } from "@prisma/client";
import type { Access } from "./access";
import { ActionError } from "./action-error";
import { businessTransaction, type Transaction } from "./business-transaction";
import { assertRecordAccess } from "./record-access";
import { checkTransition, WORK_ORDER } from "./workflow";
import { finiteNumber } from "./input-validation";
import { canApprove } from "./rbac";

export async function editableWorkOrder(tx: Transaction, id: string) {
  const wo = await tx.workOrder.findUnique({ where: { id } });
  if (!wo || !["Open", "In-Progress"].includes(wo.status)) throw new ActionError("Parts and checklist items can only be changed on an open work order.");
  return wo;
}

export async function recalculateWorkOrder(tx: Transaction, workOrderId: string): Promise<void> {
  const lines = await tx.workOrderLine.findMany({ where: { workOrderId } });
  const laborCost = lines.filter(l => l.kind === "LABOUR").reduce((sum, l) => sum + l.amount, 0);
  const partsCost = lines.filter(l => l.kind !== "LABOUR").reduce((sum, l) => sum + l.amount, 0);
  await tx.workOrder.update({ where: { id: workOrderId }, data: { laborCost, partsCost, totalCost: laborCost + partsCost } });
}

type Completion = Pick<Prisma.WorkOrderUncheckedUpdateInput, "description" | "technician"> & {
  laborCost?: number; partsCost?: number; meterAtService?: number; downtimeHrs?: number;
  failureCode?: string; rcaNote?: string;
};

export async function changeWorkOrderStatus(access: Access, id: string, to: string, completion: Completion = {}): Promise<void> {
  const { failureCode, rcaNote, ...completionData } = completion;
  await businessTransaction(access.session, async tx => {
    await assertRecordAccess(access, "workOrder", id, tx);
    const wo = await tx.workOrder.findUniqueOrThrow({ where: { id }, include: { asset: true, lines: true, checklist: true } });
    const verdict = checkTransition(WORK_ORDER, wo.status, to);
    if (!verdict.ok) throw new ActionError(verdict.reason);
    if (!access.can(verdict.transition.permission)) throw new ActionError("Your role cannot make this work-order change.");
    if (to === "Cancelled" && wo.lines.some(l => l.inventoryItemId)) {
      throw new ActionError("Return unused cataloged parts by removing their lines before cancelling. Consumed parts must remain on a completed work order.");
    }
    if (["Completed", "Closed"].includes(to) && wo.checklist.some(item => item.critical && !item.done)) {
      throw new ActionError("Complete the critical safety checklist before finishing this work order.");
    }
    const laborCost = wo.lines.length ? wo.lines.filter(l => l.kind === "LABOUR").reduce((sum,l) => sum+l.amount,0) : completion.laborCost ?? wo.laborCost;
    const partsCost = wo.lines.length ? wo.lines.filter(l => l.kind !== "LABOUR").reduce((sum,l) => sum+l.amount,0) : completion.partsCost ?? wo.partsCost;
    finiteNumber(laborCost, "Labour cost", { min: 0 });
    finiteNumber(partsCost, "Parts cost", { min: 0 });
    const totalCost = laborCost + partsCost;
    if (to === "Closed") {
      const user = await tx.user.findUnique({ where: { id: access.session.id }, include: { roleRef: true } });
      const role = user?.roleRef;
      if (!role && access.session.role !== "Admin") throw new ActionError("An approval role is required to sign off work.");
      if (role) {
        const approved = canApprove({ ...role, permissions: role.permissions.split("\n").filter(Boolean) }, "maintenance.approve", totalCost);
        if (!approved.ok) throw new ActionError(approved.reason ?? "The work-order amount exceeds your approval limit.");
      }
    }
    const meter = completion.meterAtService ?? (to === "Completed" ? wo.asset.meterValue : wo.meterAtService ?? wo.asset.meterValue);
    finiteNumber(meter, "Service meter", { min: 0 });
    if (to === "Completed" && meter < wo.asset.meterValue) throw new ActionError("The service meter cannot be below the machine's recorded meter.");
    const now = new Date();
    const updated = await tx.workOrder.updateMany({ where: { id, status: wo.status }, data: {
      ...completionData, laborCost, partsCost, totalCost, status: to,
      ...((failureCode || rcaNote) && !wo.description.includes("[Failure:") ? {
        description: `${wo.description} [Failure: ${failureCode || "General"}]${rcaNote ? ` RCA: ${rcaNote}` : ""}`,
      } : {}),
      ...(completion.downtimeHrs !== undefined ? { downtimeHrs: finiteNumber(completion.downtimeHrs, "Downtime", { min: 0 }) } : {}),
      ...(["Completed", "Closed"].includes(to) ? { completedAt: wo.completedAt ?? now, meterAtService: meter } : { completedAt: null }),
    } });
    if (updated.count !== 1) throw new ActionError("This work order changed. Reload and try again.");
    if (to === "Completed") {
      if (wo.scheduleId) await tx.maintenanceSchedule.update({ where: { id: wo.scheduleId }, data: { lastDoneMeter: meter, lastDoneDate: now } });
      await tx.asset.update({ where: { id: wo.assetId }, data: { lastServiceDate: now } });
    }
    const remaining = await tx.workOrder.count({ where: {
      assetId: wo.assetId, status: { in: ["Open", "In-Progress"] },
      OR: [{ type: { in: ["BREAKDOWN", "REPAIR"] } }, { priority: "Critical" }],
    } });
    if (remaining > 0) {
      await tx.asset.updateMany({ where: { id: wo.assetId, status: { in: ["Active", "Idle", "Breakdown", "Under-Maintenance"] } }, data: { status: "Breakdown" } });
    } else {
      await tx.asset.updateMany({ where: { id: wo.assetId, status: { in: ["Breakdown", "Under-Maintenance"] } }, data: { status: "Active" } });
    }
  });
}
