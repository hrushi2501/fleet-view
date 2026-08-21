"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { requireAction } from "@/lib/guard";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k) ?? 0) || 0;

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

export async function saveSite(id: string | null, fd: FormData) {
  await requireAction("fleet.edit");
  const projectId = s(fd, "projectId");
  if (!projectId) throw new Error("Project is required");
  const data = {
    projectId,
    code: s(fd, "code"),
    name: s(fd, "name"),
    type: s(fd, "type") || "WORK_FRONT",
    lat: n(fd, "lat"),
    lng: n(fd, "lng"),
    radiusM: n(fd, "radiusM") || 500,
    address: s(fd, "address") || null,
    active: fd.get("active") == null ? true : fd.get("active") === "on",
  };
  if (!data.code || !data.name) throw new Error("Site code and name are required");

  // Validate project exists
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Selected project does not exist");

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

export async function deleteSite(id: string) {
  await requireAction("fleet.edit");
  const site = await db.site.findUnique({ where: { id }, include: { allocations: { select: { id: true } } } });
  if (!site) throw new Error("Site not found");

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

export async function saveEquipmentPlan(fd: FormData) {
  await requireAction("production.edit");
  const projectId = s(fd, "projectId");
  const assetClass = s(fd, "assetClass");
  if (!projectId || !assetClass) throw new Error("Project and machine class are required");

  // Validate project exists
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Selected project does not exist");

  const plannedCount = Math.max(0, Math.round(n(fd, "plannedCount")));
  if (plannedCount < 1) throw new Error("Planned count must be at least 1");

  const data = {
    plannedCount,
    fromDate: s(fd, "fromDate") ? new Date(s(fd, "fromDate")) : new Date(),
    toDate: s(fd, "toDate") ? new Date(s(fd, "toDate")) : null,
    budgetPerDay: n(fd, "budgetPerDay"),
    notes: s(fd, "notes") || null,
  };

  // Date sanity
  if (data.toDate && data.toDate <= data.fromDate) {
    throw new Error("End date must be after start date");
  }

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

export async function deleteEquipmentPlan(id: string) {
  await requireAction("production.edit");
  const plan = await db.equipmentPlan.findUnique({ where: { id }, include: { project: { select: { code: true } } } });
  if (!plan) throw new Error("Equipment plan not found");

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

export async function saveAllocation(fd: FormData) {
  await requireAction("production.edit");
  const assetId = s(fd, "assetId");
  const projectId = s(fd, "projectId");
  if (!assetId || !projectId) throw new Error("Asset and project are required");

  // Validate foreign keys exist
  const [asset, project] = await Promise.all([
    db.asset.findUnique({ where: { id: assetId } }),
    db.project.findUnique({ where: { id: projectId } }),
  ]);
  if (!asset) throw new Error("Selected asset does not exist");
  if (!project) throw new Error("Selected project does not exist");

  // Validate site belongs to this project (if provided)
  const siteId = s(fd, "siteId") || null;
  if (siteId) {
    const site = await db.site.findUnique({ where: { id: siteId } });
    if (!site) throw new Error("Selected site does not exist");
    if (site.projectId !== projectId) throw new Error("Site does not belong to the selected project");
  }

  const fromDate = s(fd, "fromDate") ? new Date(s(fd, "fromDate")) : new Date();
  const toDate = s(fd, "toDate") ? new Date(s(fd, "toDate")) : null;
  if (toDate && toDate <= fromDate) throw new Error("End date must be after start date");

  const status = s(fd, "status") || "PLANNED";
  const session = await getSession();

  // ACID: single transaction for allocation creation + asset project sync + race condition check
  const alloc = await db.$transaction(async (tx) => {
    if (status === "ACTIVE") {
      const otherActive = await tx.allocation.findFirst({
        where: { assetId, status: "ACTIVE" },
      });
      if (otherActive) {
        throw new Error(`Machine ${asset.code} already has an active allocation on another project.`);
      }
    }

    const created = await tx.allocation.create({
      data: {
        assetId, projectId, siteId,
        fromDate, toDate, status,
        purpose: s(fd, "purpose") || null,
        ratePerDay: n(fd, "ratePerDay"),
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

export async function updateAllocationStatus(id: string, fd: FormData) {
  await requireAction("production.edit");
  const status = s(fd, "status");
  if (!status) throw new Error("Status is required");

  const existing = await db.allocation.findUnique({ where: { id } });
  if (!existing) throw new Error("Allocation not found");

  // ACID: single transaction for allocation status change + asset project sync + race condition guard
  await db.$transaction(async (tx) => {
    if (status === "ACTIVE" && existing.status !== "ACTIVE") {
      const otherActive = await tx.allocation.findFirst({
        where: { assetId: existing.assetId, status: "ACTIVE", NOT: { id } },
      });
      if (otherActive) {
        throw new Error(`Machine already has another active allocation.`);
      }
    }

    await tx.allocation.update({
      where: { id },
      data: {
        status,
        toDate: s(fd, "toDate") ? new Date(s(fd, "toDate")) : undefined,
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

export async function deleteAllocation(id: string) {
  await requireAction("production.edit");
  const alloc = await db.allocation.findUnique({
    where: { id },
    include: { asset: { select: { code: true } }, project: { select: { code: true } } },
  });
  if (!alloc) throw new Error("Allocation not found");

  // If this was the ACTIVE allocation, clear the asset's project link
  await db.$transaction(async (tx) => {
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

export async function saveMobilization(fd: FormData) {
  await requireAction("production.edit");
  const assetId = s(fd, "assetId");
  if (!assetId) throw new Error("Asset is required");

  // Validate asset exists
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error("Selected asset does not exist");

  // Validate projects if provided
  const toProjectId = s(fd, "toProjectId") || null;
  const fromProjectId = s(fd, "fromProjectId") || null;
  if (toProjectId) {
    const proj = await db.project.findUnique({ where: { id: toProjectId } });
    if (!proj) throw new Error("Destination project does not exist");
  }
  if (fromProjectId) {
    const proj = await db.project.findUnique({ where: { id: fromProjectId } });
    if (!proj) throw new Error("Source project does not exist");
  }

  const session = await getSession();

  // Atomic creation + audit in transaction
  const order = await db.$transaction(async (tx) => {
    return await tx.mobilizationOrder.create({
      data: {
        assetId,
        fromProjectId,
        toProjectId,
        requestedDate: s(fd, "requestedDate") ? new Date(s(fd, "requestedDate")) : new Date(),
        transportMode: s(fd, "transportMode") || "SELF_DRIVE",
        transporter: s(fd, "transporter") || null,
        distanceKm: n(fd, "distanceKm"),
        cost: n(fd, "cost"),
        status: s(fd, "status") || "REQUESTED",
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

export async function updateMobilization(id: string, fd: FormData) {
  await requireAction("production.edit");
  const status = s(fd, "status");
  if (!status) throw new Error("Status is required");

  const existing = await db.mobilizationOrder.findUnique({ where: { id }, include: { asset: true } });
  if (!existing) throw new Error("Mobilisation order not found");

  // ACID: single transaction for mob order update + asset status/project sync + lifecycle event
  await db.$transaction(async (tx) => {
    const order = await tx.mobilizationOrder.update({
      where: { id },
      data: {
        status,
        dispatchDate: s(fd, "dispatchDate") ? new Date(s(fd, "dispatchDate")) : undefined,
        arrivalDate: s(fd, "arrivalDate") ? new Date(s(fd, "arrivalDate")) : undefined,
        cost: n(fd, "cost"),
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

export async function deleteMobilization(id: string) {
  await requireAction("production.edit");
  const order = await db.mobilizationOrder.findUnique({
    where: { id },
    include: { asset: true },
  });
  if (!order) throw new Error("Mobilisation order not found");

  // Revert asset status & project assignment if in transit or arrived
  await db.$transaction(async (tx) => {
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
