"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { DEFAULT_PM_TASKS } from "@/lib/maintenance";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k) ?? 0) || 0;
const b = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";

function refresh() {
  revalidatePath("/maintenance");
  revalidatePath("/tyres");
  revalidatePath("/costs");
}

/* ------------------------------- PM schedules ------------------------------- */

export async function saveSchedule(id: string | null, fd: FormData) {
  const data = {
    assetId: s(fd, "assetId") || null,
    assetClass: s(fd, "assetClass") || null,
    taskName: s(fd, "taskName"),
    taskCode: s(fd, "taskCode") || null,
    intervalKm: n(fd, "intervalKm"),
    intervalHours: n(fd, "intervalHours"),
    intervalDays: Math.round(n(fd, "intervalDays")),
    lastDoneMeter: n(fd, "lastDoneMeter"),
    lastDoneDate: s(fd, "lastDoneDate") ? new Date(s(fd, "lastDoneDate")) : null,
    estimatedCost: n(fd, "estimatedCost"),
    estimatedHours: n(fd, "estimatedHours"),
    active: fd.get("active") == null ? true : b(fd, "active"),
    notes: s(fd, "notes") || null,
  };
  if (!data.taskName) throw new Error("Task name is required");
  if (id) await db.maintenanceSchedule.update({ where: { id }, data });
  else await db.maintenanceSchedule.create({ data });
  refresh();
}

export async function deleteSchedule(id: string) {
  await db.maintenanceSchedule.delete({ where: { id } });
  refresh();
}

/** Applies the shipped PM task templates to every matching asset. */
export async function seedPmSchedules() {
  const assets = await db.asset.findMany({ select: { id: true, assetClass: true, meterValue: true } });
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

import { PM_PARTS_KITS } from "@/lib/maintenance";

/** Raise a work order straight from a due schedule, auto-populating parts kit lines. */
export async function raiseWoFromSchedule(scheduleId: string) {
  const sch = await db.maintenanceSchedule.findUnique({ where: { id: scheduleId }, include: { asset: true } });
  if (!sch || !sch.assetId || !sch.asset) throw new Error("Schedule has no asset");

  const count = await db.workOrder.count();
  const woNo = `WO-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
  
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
export async function completeWorkOrder(id: string, fd: FormData) {
  const session = await getSession();
  const wo = await db.workOrder.findUnique({ where: { id }, include: { asset: true } });
  if (!wo) throw new Error("Work order not found");

  const laborCost = n(fd, "laborCost");
  const partsCost = n(fd, "partsCost");
  const meter = n(fd, "meterAtService") || wo.asset.meterValue;
  const failureCode = s(fd, "failureCode");
  const rcaNote = s(fd, "rcaNote");

  let updatedDescription = wo.description;
  if (failureCode || rcaNote) {
    const rcaString = ` [Failure: ${failureCode || "General"}]${rcaNote ? ` RCA: ${rcaNote}` : ""}`;
    if (!updatedDescription.includes("[Failure:")) {
      updatedDescription += rcaString;
    }
  }

  await db.workOrder.update({
    where: { id },
    data: {
      status: "Completed",
      description: updatedDescription,
      laborCost,
      partsCost,
      totalCost: laborCost + partsCost,
      downtimeHrs: n(fd, "downtimeHrs"),
      technician: s(fd, "technician") || session?.name || null,
      meterAtService: meter,
      completedAt: new Date(),
    },
  });

  if (wo.scheduleId) {
    await db.maintenanceSchedule.update({
      where: { id: wo.scheduleId },
      data: { lastDoneMeter: meter, lastDoneDate: new Date() },
    });
  }
  await db.asset.update({ where: { id: wo.assetId }, data: { lastServiceDate: new Date() } });
  refresh();
}

/** Submit a daily operator pre-operational inspection checklist. */
export async function submitPreOpChecklist(fd: FormData) {
  const assetId = s(fd, "assetId");
  if (!assetId) throw new Error("Asset selection is required for Pre-Op Inspection");

  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error("Asset not found");

  const checks = [
    { name: "Fluid Levels (Oil/Coolant)", pass: b(fd, "check_fluids") },
    { name: "Hydraulic System & Leaks", pass: b(fd, "check_hydraulics") },
    { name: "Belts & Tension", pass: b(fd, "check_belts") },
    { name: "Tyres / Tracks & Undercarriage", pass: b(fd, "check_undercarriage") },
    { name: "Brakes & Emergency Controls", pass: b(fd, "check_brakes") },
  ];

  const failedChecks = checks.filter((c) => !c.pass);

  if (failedChecks.length > 0) {
    // Automatically raise an urgent Breakdown Work Order for failed safety checks
    const count = await db.workOrder.count();
    const woNo = `WO-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
    const issueSummary = failedChecks.map((f) => f.name).join(", ");

    await db.workOrder.create({
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

    // Create a critical alert
    await db.alert.create({
      data: {
        category: "Maintenance",
        severity: "Critical",
        title: `Pre-Op Inspection Failed — ${asset.code}`,
        message: `Machine ${asset.code} (${asset.name}) failed daily pre-op check for: ${issueSummary}`,
        assetId: asset.id,
        status: "Open",
      },
    });
  }

  refresh();
  return { ok: true, failedCount: failedChecks.length };
}

/* ------------------------------ lines & checklist ------------------------------ */

export async function addWoLine(workOrderId: string, fd: FormData) {
  const qty = n(fd, "qty") || 1;
  const rate = n(fd, "rate");
  await db.workOrderLine.create({
    data: {
      workOrderId,
      kind: s(fd, "kind") || "PART",
      description: s(fd, "description"),
      partNo: s(fd, "partNo") || null,
      qty,
      rate,
      amount: qty * rate,
      vendor: s(fd, "vendor") || null,
    },
  });
  // Keep the work-order totals in step with its lines.
  const lines = await db.workOrderLine.findMany({ where: { workOrderId } });
  const labor = lines.filter((l) => l.kind === "LABOUR").reduce((x, l) => x + l.amount, 0);
  const parts = lines.filter((l) => l.kind !== "LABOUR").reduce((x, l) => x + l.amount, 0);
  await db.workOrder.update({ where: { id: workOrderId }, data: { laborCost: labor, partsCost: parts, totalCost: labor + parts } });
  refresh();
}

export async function deleteWoLine(id: string) {
  const line = await db.workOrderLine.findUnique({ where: { id } });
  if (!line) return;
  await db.workOrderLine.delete({ where: { id } });
  const lines = await db.workOrderLine.findMany({ where: { workOrderId: line.workOrderId } });
  const labor = lines.filter((l) => l.kind === "LABOUR").reduce((x, l) => x + l.amount, 0);
  const parts = lines.filter((l) => l.kind !== "LABOUR").reduce((x, l) => x + l.amount, 0);
  await db.workOrder.update({ where: { id: line.workOrderId }, data: { laborCost: labor, partsCost: parts, totalCost: labor + parts } });
  refresh();
}

export async function addChecklistItem(workOrderId: string, fd: FormData) {
  await db.jobCardItem.create({
    data: { workOrderId, task: s(fd, "task"), critical: b(fd, "critical") },
  });
  refresh();
}

export async function toggleChecklistItem(id: string, done: boolean) {
  const session = await getSession();
  await db.jobCardItem.update({
    where: { id },
    data: { done, doneBy: done ? session?.name ?? null : null, doneAt: done ? new Date() : null },
  });
  refresh();
}
