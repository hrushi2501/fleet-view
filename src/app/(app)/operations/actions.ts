"use server";

import { db } from "@/lib/db";
import { businessTransaction } from "@/lib/business-transaction";
import {
  formNumber,
  boundedNumber,
  nonNegativeNumber,
  coordinatePair,
  oneOf,
  safeParseDate,
  validateDateRange,
} from "@/lib/input-validation";
import { assertFormAccess, assertRecordAccess } from "@/lib/record-access";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { requireAction, ActionError, safe } from "@/lib/guard";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = formNumber;

/**
 * Revalidate every page that reads project / site / allocation / mob data.
 *
 * This list is deliberately broad — a stale cache on any of these modules is
 * worse than a few extra SSR renders.
 */
function refresh() {
  revalidatePath("/sites");
  revalidatePath("/operations");
  revalidatePath("/projects");
  revalidatePath("/fleet");
  revalidatePath("/costs");
  revalidatePath("/production");
  revalidatePath("/tracking");
  revalidatePath("/");
}

/* ================================ SITES ================================ */

async function saveSite__impl(id: string | null, fd: FormData) {
  const scopeAccess = await requireAction("fleet.edit");
  await assertFormAccess(scopeAccess, fd, { allowProjectMove: true });
  if (id) await assertRecordAccess(scopeAccess, "site", id);
  const projectId = s(fd, "projectId");
  if (!projectId) throw new ActionError("Project is required");

  const type = oneOf(
    s(fd, "type") || "WORK_FRONT",
    ["WORK_FRONT", "CAMP", "WORKSHOP", "QUARRY", "CRUSHER", "OTHER"],
    "Site type"
  );
  const radiusM = boundedNumber(fd.get("radiusM"), "Radius (m)", { min: 10, max: 50_000, fallback: 500 });
  const { lat, lng } = coordinatePair(fd.get("lat"), fd.get("lng"), "Site");

  const data = {
    projectId,
    code: s(fd, "code"),
    name: s(fd, "name"),
    type,
    lat: lat ?? 0,
    lng: lng ?? 0,
    radiusM,
    address: s(fd, "address") || null,
    active: fd.get("active") == null ? true : fd.get("active") === "on",
  };
  if (!data.code || !data.name) throw new ActionError("Site code and name are required");

  // Validate project exists
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ActionError("Selected project does not exist");

  if (id) {
    await db.site.update({ where: { id }, data });
  } else {
    await db.site.create({ data });
  }
  await audit({
    action: id ? "UPDATE" : "CREATE",
    module: "PROJECT",
    entity: "Site",
    summary: `Site ${data.code} — ${data.name} (Project: ${project.code})`,
  });
  refresh();
}

async function deleteSite__impl(id: string) {
  const scopeAccess = await requireAction("fleet.edit");
  await assertRecordAccess(scopeAccess, "site", id);
  const site = await db.site.findUnique({ where: { id }, include: { allocations: { select: { id: true } } } });
  if (!site) throw new ActionError("Site not found");

  // Release any allocations tied to this site before deleting
  await db.$transaction([
    db.allocation.updateMany({ where: { siteId: id }, data: { siteId: null } }),
    db.site.delete({ where: { id } }),
  ]);

  await audit({
    action: "DELETE",
    module: "PROJECT",
    entity: "Site",
    entityId: id,
    summary: `Deleted site ${site.code} — ${site.name}`,
  });
  refresh();
}

/* ================================ EQUIPMENT PLAN ================================ */

async function saveEquipmentPlan__impl(fd: FormData) {
  const scopeAccess = await requireAction("production.edit");
  await assertFormAccess(scopeAccess, fd, { allowProjectMove: true });
  const projectId = s(fd, "projectId");
  const assetClass = s(fd, "assetClass");
  if (!projectId || !assetClass) throw new ActionError("Project and machine class are required");

  // Validate project exists
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ActionError("Selected project does not exist");

  const plannedCount = boundedNumber(fd.get("plannedCount"), "Planned count", { min: 1, max: 500, integer: true, fallback: 1 });
  const fromDateRaw = s(fd, "fromDate");
  const fromDate = fromDateRaw ? safeParseDate(fromDateRaw, "Start date") ?? new Date() : new Date();
  const toDateRaw = s(fd, "toDate");
  const toDate = toDateRaw ? safeParseDate(toDateRaw, "End date") : null;
  if (toDate) {
    validateDateRange(fromDate, toDate, "Equipment plan duration");
  }

  const budgetPerDay = nonNegativeNumber(fd.get("budgetPerDay"), "Budget per day", { max: 10_000_000, fallback: 0 });

  const data = {
    plannedCount,
    fromDate,
    toDate,
    budgetPerDay,
    notes: s(fd, "notes") || null,
  };

  await db.equipmentPlan.upsert({
    where: { projectId_assetClass: { projectId, assetClass } },
    create: { projectId, assetClass, ...data },
    update: data,
  });

  await audit({
    action: "UPSERT",
    module: "OPERATIONS",
    entity: "EquipmentPlan",
    summary: `Equipment plan: ${plannedCount}× ${assetClass} for project ${project.code}`,
  });
  refresh();
}

async function deleteEquipmentPlan__impl(id: string) {
  const scopeAccess = await requireAction("production.edit");
  await assertRecordAccess(scopeAccess, "equipmentPlan", id);
  const plan = await db.equipmentPlan.findUnique({ where: { id }, include: { project: { select: { code: true } } } });
  if (!plan) throw new ActionError("Equipment plan not found");

  await db.equipmentPlan.delete({ where: { id } });

  await audit({
    action: "DELETE",
    module: "OPERATIONS",
    entity: "EquipmentPlan",
    entityId: id,
    summary: `Deleted equipment plan: ${plan.assetClass} for project ${plan.project.code}`,
  });
  refresh();
}

/* ================================ ALLOCATIONS ================================ */

async function saveAllocation__impl(fd: FormData) {
  const scopeAccess = await requireAction("production.edit");
  await assertFormAccess(scopeAccess, fd, { allowProjectMove: true });
  const assetId = s(fd, "assetId");
  const projectId = s(fd, "projectId");
  if (!assetId || !projectId) throw new ActionError("Asset and project are required");

  // Validate foreign keys exist
  const [asset, project] = await Promise.all([
    db.asset.findUnique({ where: { id: assetId } }),
    db.project.findUnique({ where: { id: projectId } }),
  ]);
  if (!asset) throw new ActionError("Selected asset does not exist");
  if (!project) throw new ActionError("Selected project does not exist");

  // Validate site belongs to this project (if provided)
  const siteId = s(fd, "siteId") || null;
  if (siteId) {
    const site = await db.site.findUnique({ where: { id: siteId } });
    if (!site) throw new ActionError("Selected site does not exist");
    if (site.projectId !== projectId) throw new ActionError("Site does not belong to the selected project");
  }

  const fromDateRaw = s(fd, "fromDate");
  const fromDate = fromDateRaw ? safeParseDate(fromDateRaw, "Start date") ?? new Date() : new Date();
  const toDateRaw = s(fd, "toDate");
  const toDate = toDateRaw ? safeParseDate(toDateRaw, "End date") : null;
  if (toDate) validateDateRange(fromDate, toDate, "Allocation duration");

  const status = oneOf(
    s(fd, "status") || "PLANNED",
    ["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED", "RELEASED"],
    "Allocation status"
  );
  const ratePerDay = nonNegativeNumber(fd.get("ratePerDay"), "Rate per day", { max: 10_000_000, fallback: 0 });
  const session = await getSession();

  // ACID: single transaction for allocation creation + asset project sync + race condition check
  const alloc = await businessTransaction(scopeAccess.session, async (tx) => {
    if (status === "ACTIVE") {
      const otherActive = await tx.allocation.findFirst({
        where: { assetId, status: "ACTIVE" },
      });
      if (otherActive) {
        throw new ActionError(`Machine ${asset.code} already has an active allocation on another project.`);
      }
    }

    const created = await tx.allocation.create({
      data: {
        assetId, projectId, siteId,
        fromDate, toDate, status,
        purpose: s(fd, "purpose") || null,
        ratePerDay,
        allocatedBy: session?.name ?? null,
        notes: s(fd, "notes") || null,
      },
    });

    // An ACTIVE allocation is the operational truth, so mirror it onto the asset.
    if (status === "ACTIVE") {
      await tx.asset.update({ where: { id: assetId }, data: { projectId } });
    }

    return created;
  });

  await audit({
    action: "CREATE",
    module: "OPERATIONS",
    entity: "Allocation",
    entityId: alloc.id,
    summary: `${asset.code} allocated to ${project.code}${siteId ? " (site)" : ""} — ${status}`,
  });
  refresh();
}

async function updateAllocationStatus__impl(id: string, fd: FormData) {
  const scopeAccess = await requireAction("production.edit");
  await assertFormAccess(scopeAccess, fd, { allowProjectMove: true });
  await assertRecordAccess(scopeAccess, "allocation", id);
  const rawStatus = s(fd, "status");
  if (!rawStatus) throw new ActionError("Status is required");
  const status = oneOf(
    rawStatus,
    ["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED", "RELEASED"],
    "Allocation status"
  );

  const existing = await db.allocation.findUnique({ where: { id } });
  if (!existing) throw new ActionError("Allocation not found");

  const toDateRaw = s(fd, "toDate");
  const toDate = toDateRaw ? safeParseDate(toDateRaw, "End date") : undefined;

  // ACID: single transaction for allocation status change + asset project sync + race condition guard
  await businessTransaction(scopeAccess.session, async (tx) => {
    if (status === "ACTIVE" && existing.status !== "ACTIVE") {
      const otherActive = await tx.allocation.findFirst({
        where: { assetId: existing.assetId, status: "ACTIVE", NOT: { id } },
      });
      if (otherActive) {
        throw new ActionError(`Machine already has another active allocation.`);
      }
    }

    await tx.allocation.update({
      where: { id },
      data: {
        status,
        toDate: toDate ?? undefined,
        releasedOn: status === "RELEASED" ? new Date() : null,
        notes: s(fd, "notes") || undefined,
      },
    });

    // Sync asset's project assignment
    if (status === "ACTIVE") {
      await tx.asset.update({ where: { id: existing.assetId }, data: { projectId: existing.projectId } });
    }
    if (status === "RELEASED") {
      await tx.asset.update({ where: { id: existing.assetId }, data: { projectId: null } });
    }
  });

  await audit({
    action: "UPDATE",
    module: "OPERATIONS",
    entity: "Allocation",
    entityId: id,
    summary: `Allocation ${existing.id.slice(-6)} set to ${status}`,
    changes: { from: existing.status, to: status },
  });
  refresh();
}

async function deleteAllocation__impl(id: string) {
  const scopeAccess = await requireAction("production.edit");
  await assertRecordAccess(scopeAccess, "allocation", id);
  const alloc = await db.allocation.findUnique({
    where: { id },
    include: { asset: { select: { code: true } }, project: { select: { code: true } } },
  });
  if (!alloc) throw new ActionError("Allocation not found");

  // If this was the ACTIVE allocation, clear the asset's project link
  await businessTransaction(scopeAccess.session, async (tx) => {
    if (alloc.status === "ACTIVE") {
      await tx.asset.update({ where: { id: alloc.assetId }, data: { projectId: null } });
    }
    await tx.allocation.delete({ where: { id } });
  });

  await audit({
    action: "DELETE",
    module: "OPERATIONS",
    entity: "Allocation",
    entityId: id,
    summary: `Deleted allocation: ${alloc.asset.code} ↔ ${alloc.project.code}`,
  });
  refresh();
}

/* ================================ MOBILISATION ================================ */

async function saveMobilization__impl(fd: FormData) {
  const scopeAccess = await requireAction("production.edit");
  await assertFormAccess(scopeAccess, fd, { allowProjectMove: true });
  const assetId = s(fd, "assetId");
  if (!assetId) throw new ActionError("Asset is required");

  // Validate asset exists
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ActionError("Selected asset does not exist");

  // Validate projects if provided
  const toProjectId = s(fd, "toProjectId") || null;
  const fromProjectId = s(fd, "fromProjectId") || null;
  if (toProjectId) {
    const proj = await db.project.findUnique({ where: { id: toProjectId } });
    if (!proj) throw new ActionError("Destination project does not exist");
  }
  if (fromProjectId) {
    const proj = await db.project.findUnique({ where: { id: fromProjectId } });
    if (!proj) throw new ActionError("Source project does not exist");
  }

  const transportMode = oneOf(
    s(fd, "transportMode") || "SELF_DRIVE",
    ["SELF_DRIVE", "TRAILER", "LOW_BED", "TOWED", "RAIL", "OTHER"],
    "Transport mode"
  );
  const status = oneOf(
    s(fd, "status") || "REQUESTED",
    ["REQUESTED", "APPROVED", "DISPATCHED", "IN_TRANSIT", "ARRIVED", "CANCELLED"],
    "Mobilization status"
  );
  const distanceKm = nonNegativeNumber(fd.get("distanceKm"), "Distance", { max: 50_000, fallback: 0 });
  const cost = nonNegativeNumber(fd.get("cost"), "Cost", { max: 10_000_000, fallback: 0 });
  const reqDateRaw = s(fd, "requestedDate");
  const requestedDate = reqDateRaw ? safeParseDate(reqDateRaw, "Requested date") ?? new Date() : new Date();

  const session = await getSession();

  // Atomic creation + audit in transaction
  const order = await businessTransaction(scopeAccess.session, async (tx) => {
    return await tx.mobilizationOrder.create({
      data: {
        assetId,
        fromProjectId,
        toProjectId,
        requestedDate,
        transportMode,
        transporter: s(fd, "transporter") || null,
        distanceKm,
        cost,
        status,
        requestedBy: session?.name ?? null,
        notes: s(fd, "notes") || null,
      },
    });
  });

  await audit({
    action: "CREATE",
    module: "OPERATIONS",
    entity: "MobilizationOrder",
    entityId: order.id,
    summary: `Mobilisation requested for ${asset.code}${toProjectId ? ` → project` : ""}`,
  });
  refresh();
}

async function updateMobilization__impl(id: string, fd: FormData) {
  const scopeAccess = await requireAction("production.edit");
  await assertFormAccess(scopeAccess, fd, { allowProjectMove: true });
  await assertRecordAccess(scopeAccess, "mobilizationOrder", id);
  const rawStatus = s(fd, "status");
  if (!rawStatus) throw new ActionError("Status is required");
  const status = oneOf(
    rawStatus,
    ["REQUESTED", "APPROVED", "DISPATCHED", "IN_TRANSIT", "ARRIVED", "CANCELLED"],
    "Mobilization status"
  );

  const existing = await db.mobilizationOrder.findUnique({ where: { id }, include: { asset: true } });
  if (!existing) throw new ActionError("Mobilisation order not found");

  const dispatchRaw = s(fd, "dispatchDate");
  const dispatchDate = dispatchRaw ? safeParseDate(dispatchRaw, "Dispatch date") : undefined;
  const arrivalRaw = s(fd, "arrivalDate");
  const arrivalDate = arrivalRaw ? safeParseDate(arrivalRaw, "Arrival date") : undefined;
  if (dispatchDate && arrivalDate) {
    validateDateRange(dispatchDate, arrivalDate, "Mobilization journey");
  }
  const cost = nonNegativeNumber(fd.get("cost"), "Cost", { max: 10_000_000, fallback: 0 });

  // ACID: single transaction for mob order update + asset status/project sync + lifecycle event
  await businessTransaction(scopeAccess.session, async (tx) => {
    const order = await tx.mobilizationOrder.update({
      where: { id },
      data: {
        status,
        dispatchDate: dispatchDate ?? undefined,
        arrivalDate: arrivalDate ?? undefined,
        cost,
        notes: s(fd, "notes") || undefined,
      },
    });

    if (status === "IN_TRANSIT") {
      await tx.asset.update({ where: { id: order.assetId }, data: { status: "In-Transit" } });
    } else if (status === "ARRIVED") {
      await tx.asset.update({
        where: { id: order.assetId },
        data: { status: "Active", ...(order.toProjectId ? { projectId: order.toProjectId } : {}) },
      });
      await tx.assetLifecycleEvent.create({
        data: {
          assetId: order.assetId,
          kind: "TRANSFERRED",
          toValue: order.toProjectId ?? null,
          amount: order.cost,
          note: `Mobilisation by ${order.transportMode}`,
        },
      });
    } else if (status === "CANCELLED" && existing.status === "IN_TRANSIT") {
      // Revert asset status back to Active (if assigned to project) or Idle
      await tx.asset.update({
        where: { id: order.assetId },
        data: { status: existing.asset.projectId ? "Active" : "Idle" },
      });
    }
  });

  await audit({
    action: "UPDATE",
    module: "OPERATIONS",
    entity: "MobilizationOrder",
    entityId: id,
    summary: `Mobilisation ${id.slice(-6)} set to ${status}`,
    changes: { from: existing.status, to: status },
  });
  refresh();
}

async function deleteMobilization__impl(id: string) {
  const scopeAccess = await requireAction("production.edit");
  await assertRecordAccess(scopeAccess, "mobilizationOrder", id);
  const order = await db.mobilizationOrder.findUnique({
    where: { id },
    include: { asset: true },
  });
  if (!order) throw new ActionError("Mobilisation order not found");

  // Revert asset status & project assignment if in transit or arrived
  await businessTransaction(scopeAccess.session, async (tx) => {
    if (order.status === "ARRIVED") {
      await tx.asset.update({
        where: { id: order.assetId },
        data: {
          projectId: order.fromProjectId ?? null,
          status: order.fromProjectId ? "Active" : "Idle",
        },
      });
    } else if (order.status === "IN_TRANSIT") {
      await tx.asset.update({
        where: { id: order.assetId },
        data: {
          status: order.fromProjectId ? "Active" : "Idle",
        },
      });
    }
    await tx.mobilizationOrder.delete({ where: { id } });
  });

  await audit({
    action: "DELETE",
    module: "OPERATIONS",
    entity: "MobilizationOrder",
    entityId: id,
    summary: `Deleted mobilisation order for ${order.asset.code}`,
  });
  refresh();
}

/* ---------------------------------------------------------------------------
 * Exported actions.
 *
 * Wrapped in `safe()` so an `ActionError` comes back as `{ error }` instead of
 * being thrown — Next redacts thrown messages in production builds, which made
 * every validation message in this file invisible to the person who triggered
 * it. Return values are passed through untouched.
 * ------------------------------------------------------------------------- */
export const saveSite = safe(saveSite__impl);
export const deleteSite = safe(deleteSite__impl);
export const saveEquipmentPlan = safe(saveEquipmentPlan__impl);
export const deleteEquipmentPlan = safe(deleteEquipmentPlan__impl);
export const saveAllocation = safe(saveAllocation__impl);
export const updateAllocationStatus = safe(updateAllocationStatus__impl);
export const deleteAllocation = safe(deleteAllocation__impl);
export const saveMobilization = safe(saveMobilization__impl);
export const updateMobilization = safe(updateMobilization__impl);
export const deleteMobilization = safe(deleteMobilization__impl);
