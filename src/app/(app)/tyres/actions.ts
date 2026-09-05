"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { requireAction, ActionError, safe } from "@/lib/guard";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k) ?? 0) || 0;

function refresh() {
  revalidatePath("/tyres");
  revalidatePath("/maintenance");
  revalidatePath("/costs");
}

/* ---------------------------------- tyres ---------------------------------- */

async function saveTyre__impl(id: string | null, fd: FormData) {
  await requireAction("maintenance.edit");
  const status = s(fd, "status") || "IN_STOCK";
  const data = {
    serialNo: s(fd, "serialNo"),
    make: s(fd, "make"),
    pattern: s(fd, "pattern") || null,
    size: s(fd, "size"),
    cost: n(fd, "cost"),
    treadNewMm: n(fd, "treadNewMm") || 20,
    currentTreadMm: n(fd, "currentTreadMm") || n(fd, "treadNewMm") || 20,
    expectedLifeKm: n(fd, "expectedLifeKm") || 60000,
    purchaseDate: s(fd, "purchaseDate") ? new Date(s(fd, "purchaseDate")) : null,
    status,
    warehouseId: status === "IN_USE" ? null : (s(fd, "warehouseId") || null),
    ...(status !== "IN_USE" ? { assetId: null, position: null } : {}),
  };
  if (!data.serialNo) throw new ActionError("Serial number is required — serial-level tracking is what makes swaps visible");
  if (id) await db.tyre.update({ where: { id }, data });
  else await db.tyre.create({ data });
  refresh();
}


async function deleteTyre__impl(id: string) {
  await requireAction("maintenance.edit");
  await db.tyre.delete({ where: { id } });
  refresh();
}

/** Fit a tyre to a machine. Records the fitment meter so km-run is measurable. */
async function fitTyre__impl(fd: FormData) {
  await requireAction("maintenance.edit");
  const tyreId = s(fd, "tyreId");
  const assetId = s(fd, "assetId");
  if (!tyreId || !assetId) throw new ActionError("Tyre and machine are required");

  const asset = await db.asset.findUnique({ where: { id: assetId } });
  const meter = n(fd, "meterValue") || asset?.meterValue || 0;
  const tread = n(fd, "treadMm");
  const session = await getSession();

  const pos = s(fd, "position") || null;
  const existingAtPos = pos
    ? await db.tyre.findFirst({
        where: {
          assetId,
          position: pos,
          status: "IN_USE",
          id: { not: tyreId },
        },
      })
    : null;

  await db.$transaction(async (tx) => {
    // If another tyre is currently mounted at this wheel position, dismount it cleanly
    if (existingAtPos) {
      const ranKm = existingAtPos.fittedMeter != null && meter > existingAtPos.fittedMeter ? meter - existingAtPos.fittedMeter : 0;
      await tx.tyre.update({
        where: { id: existingAtPos.id },
        data: {
          assetId: null,
          position: null,
          status: "REMOVED",
          fittedMeter: 0,
          totalKm: { increment: ranKm },
        },
      });
      await tx.tyreEvent.create({
        data: {
          tyreId: existingAtPos.id,
          kind: "REMOVE",
          assetId,
          position: pos,
          meterValue: meter,
          treadMm: existingAtPos.currentTreadMm,
          reason: "ROTATION",
          note: `Auto-unmounted: replaced at position ${pos} (${ranKm} km run banked)`,
          by: session?.name ?? null,
          date: s(fd, "date") ? new Date(s(fd, "date")) : new Date(),
        },
      });
    }

    await tx.tyre.update({
      where: { id: tyreId },
      data: {
        assetId,
        position: pos,
        status: "IN_USE",
        fittedMeter: meter,
        warehouseId: null,
        ...(tread > 0 ? { currentTreadMm: tread } : {}),
      },
    });

    await tx.tyreEvent.create({
      data: {
        tyreId,
        kind: "FIT",
        assetId,
        position: pos,
        meterValue: meter,
        treadMm: tread,
        note: s(fd, "note") || null,
        by: session?.name ?? null,
        date: s(fd, "date") ? new Date(s(fd, "date")) : new Date(),
      },
    });
  });
  refresh();
}

/** Remove a tyre, banking the kilometres it ran on this fitment. */
async function removeTyre__impl(fd: FormData) {
  await requireAction("maintenance.edit");
  const tyreId = s(fd, "tyreId");
  if (!tyreId) throw new ActionError("Tyre is required");
  const t = await db.tyre.findUnique({ where: { id: tyreId }, include: { asset: true } });
  if (!t) throw new ActionError("Tyre not found");

  const meter = n(fd, "meterValue") || t.asset?.meterValue || 0;
  const ranKm = t.fittedMeter != null && meter > t.fittedMeter ? meter - t.fittedMeter : 0;
  const tread = n(fd, "treadMm");
  const reason = s(fd, "reason") || "WEAR";
  const session = await getSession();
  const warehouseId = s(fd, "warehouseId") || null;

  const scrap = reason === "BURST" || reason === "CUT" || s(fd, "scrap") === "true";

  await db.tyre.update({
    where: { id: tyreId },
    data: {
      assetId: null,
      position: null,
      status: scrap ? "SCRAPPED" : "REMOVED",
      totalKm: t.totalKm + ranKm,
      fittedMeter: 0,
      warehouseId: scrap ? null : warehouseId, // Assign to warehouse if not scrapped
      ...(tread > 0 ? { currentTreadMm: tread } : {}),
    },
  });
  await db.tyreEvent.create({
    data: {
      tyreId, kind: scrap ? "SCRAP" : "REMOVE", assetId: t.assetId, position: t.position,
      meterValue: meter, treadMm: tread, reason, note: s(fd, "note") || null, by: session?.name ?? null,
      date: s(fd, "date") ? new Date(s(fd, "date")) : new Date(),
    },
  });
  refresh();
}

async function inspectTyre__impl(fd: FormData) {
  await requireAction("maintenance.edit");
  const tyreId = s(fd, "tyreId");
  if (!tyreId) throw new ActionError("Tyre is required");
  const tread = n(fd, "treadMm");
  const session = await getSession();
  const t = await db.tyre.findUnique({ where: { id: tyreId }, include: { asset: true } });

  await db.tyre.update({ where: { id: tyreId }, data: tread > 0 ? { currentTreadMm: tread } : {} });
  await db.tyreEvent.create({
    data: {
      tyreId, kind: "INSPECT", assetId: t?.assetId ?? null, position: t?.position ?? null,
      meterValue: n(fd, "meterValue") || t?.asset?.meterValue || 0, treadMm: tread,
      note: s(fd, "note") || null, by: session?.name ?? null,
      date: s(fd, "date") ? new Date(s(fd, "date")) : new Date(),
    },
  });
  refresh();
}

async function retreadTyre__impl(fd: FormData) {
  await requireAction("maintenance.edit");
  const tyreId = s(fd, "tyreId");
  if (!tyreId) throw new ActionError("Tyre is required");
  const t = await db.tyre.findUnique({ where: { id: tyreId } });
  if (!t) throw new ActionError("Tyre not found");
  const tread = n(fd, "treadMm") || t.treadNewMm;
  const session = await getSession();
  const warehouseId = s(fd, "warehouseId") || null;

  await db.tyre.update({
    where: { id: tyreId },
    data: {
      status: "IN_STOCK",
      currentTreadMm: tread,
      retreadCount: t.retreadCount + 1,
      assetId: null,
      position: null,
      warehouseId, // Assign to warehouse after retreading
    },
  });
  await db.tyreEvent.create({
    data: {
      tyreId, kind: "RETREAD", treadMm: tread, cost: n(fd, "cost"),
      note: s(fd, "note") || null, by: session?.name ?? null,
      date: s(fd, "date") ? new Date(s(fd, "date")) : new Date(),
    },
  });
  refresh();
}

/* ------------------------------ major components ------------------------------ */

async function saveComponent__impl(id: string | null, fd: FormData) {
  await requireAction("maintenance.edit");
  const status = s(fd, "status") || "IN_STOCK";
  const data = {
    serialNo: s(fd, "serialNo"),
    type: s(fd, "type") || "OTHER",
    make: s(fd, "make") || null,
    assetId: status === "IN_USE" ? (s(fd, "assetId") || null) : null,
    status,
    cost: n(fd, "cost"),
    expectedLifeHours: n(fd, "expectedLifeHours") || 8000,
    hoursUsed: n(fd, "hoursUsed"),
    fittedMeter: status === "IN_USE" ? n(fd, "fittedMeter") : 0,
    fittedDate: status === "IN_USE" ? (s(fd, "fittedDate") ? new Date(s(fd, "fittedDate")) : null) : null,
    warehouseId: status === "IN_USE" ? null : (s(fd, "warehouseId") || null),
    notes: s(fd, "notes") || null,
  };
  if (!data.serialNo) throw new ActionError("Serial number is required");
  if (id) await db.majorComponent.update({ where: { id }, data });
  else await db.majorComponent.create({ data });
  refresh();
}

async function deleteComponent__impl(id: string) {
  await requireAction("maintenance.edit");
  await db.majorComponent.delete({ where: { id } });
  refresh();
}

/** Transfer a tyre from its current warehouse/status to another warehouse */
async function transferTyre__impl(fd: FormData) {
  await requireAction("maintenance.edit");
  const tyreId = s(fd, "tyreId");
  const warehouseId = s(fd, "warehouseId");
  if (!tyreId || !warehouseId) throw new ActionError("Tyre and Destination Warehouse are required");

  const tyre = await db.tyre.findUnique({ where: { id: tyreId } });
  if (!tyre) throw new ActionError("Tyre not found");

  const targetWh = await db.inventoryWarehouse.findUnique({ where: { id: warehouseId } });
  if (!targetWh) throw new ActionError("Destination warehouse not found");

  const session = await getSession();

  await db.tyre.update({
    where: { id: tyreId },
    data: {
      status: "IN_STOCK",
      assetId: null,
      position: null,
      warehouseId,
    },
  });

  await db.tyreEvent.create({
    data: {
      tyreId,
      kind: "ROTATE",
      note: `Warehouse Transfer to ${targetWh.name} (${targetWh.code})`,
      by: session?.name ?? "System",
      date: new Date(),
    },
  });

  refresh();
}

/** Transfer a major component from its current warehouse/status to another warehouse */
async function transferComponent__impl(fd: FormData) {
  await requireAction("maintenance.edit");
  const componentId = s(fd, "componentId");
  const warehouseId = s(fd, "warehouseId");
  if (!componentId || !warehouseId) throw new ActionError("Component and Destination Warehouse are required");

  const component = await db.majorComponent.findUnique({ where: { id: componentId } });
  if (!component) throw new ActionError("Component not found");

  await db.majorComponent.update({
    where: { id: componentId },
    data: {
      status: "IN_STOCK",
      assetId: null,
      warehouseId,
    },
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
export const saveTyre = safe(saveTyre__impl);
export const deleteTyre = safe(deleteTyre__impl);
export const fitTyre = safe(fitTyre__impl);
export const removeTyre = safe(removeTyre__impl);
export const inspectTyre = safe(inspectTyre__impl);
export const retreadTyre = safe(retreadTyre__impl);
export const saveComponent = safe(saveComponent__impl);
export const deleteComponent = safe(deleteComponent__impl);
export const transferTyre = safe(transferTyre__impl);
export const transferComponent = safe(transferComponent__impl);
