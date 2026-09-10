"use server";

import { db } from "@/lib/db";
import { businessTransaction } from "@/lib/business-transaction";
import {
  formNumber,
  boundedNumber,
  nonNegativeNumber,
  safeParseDate,
  sanitizeString,
  sanitizeOptionalString,
  sanitizeId,
  oneOf,
} from "@/lib/input-validation";
import { assertFormAccess, assertRecordAccess } from "@/lib/record-access";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { requireAction, ActionError, safe } from "@/lib/guard";

const s = (fd: FormData, k: string) => sanitizeString(fd.get(k), k);
const sOrNull = (fd: FormData, k: string) => sanitizeOptionalString(fd.get(k), k);
const n = formNumber;

function refresh() {
  revalidatePath("/tyres");
  revalidatePath("/maintenance");
  revalidatePath("/costs");
}

/* ---------------------------------- tyres ---------------------------------- */

async function saveTyre__impl(id: string | null, fd: FormData) {
  const scopeAccess = await requireAction("maintenance.edit");
  await assertFormAccess(scopeAccess, fd);
  if (id) {
    id = sanitizeId(id, "Tyre ID");
    await assertRecordAccess(scopeAccess, "tyre", id);
  }
  const status = oneOf(
    s(fd, "status") || "IN_STOCK",
    ["IN_STOCK", "IN_USE", "REMOVED", "SCRAPPED", "RETREADING"],
    "Tyre status"
  );

  const treadNewMm = boundedNumber(fd.get("treadNewMm"), "New tyre tread depth", { min: 5, max: 60, fallback: 20 });
  const rawCurrentTread = fd.get("currentTreadMm");
  const currentTreadMm = rawCurrentTread && String(rawCurrentTread).trim()
    ? boundedNumber(rawCurrentTread, "Current tyre tread depth", { min: 0, max: 60 })
    : treadNewMm;
  if (currentTreadMm > treadNewMm) {
    throw new ActionError("Current tread depth cannot exceed new tyre tread depth.");
  }
  const cost = nonNegativeNumber(fd.get("cost"), "Tyre cost", { max: 1_000_000, fallback: 0 });
  const expectedLifeKm = boundedNumber(fd.get("expectedLifeKm"), "Expected life", { min: 1_000, max: 500_000, fallback: 60_000 });

  const purchaseDateRaw = sOrNull(fd, "purchaseDate");
  const purchaseDate = purchaseDateRaw ? safeParseDate(purchaseDateRaw, "Purchase date") : null;

  const data = {
    serialNo: s(fd, "serialNo"),
    make: s(fd, "make"),
    pattern: sOrNull(fd, "pattern"),
    size: s(fd, "size"),
    cost,
    treadNewMm,
    currentTreadMm,
    expectedLifeKm,
    purchaseDate,
    status,
    warehouseId: status === "IN_USE" ? null : sOrNull(fd, "warehouseId"),
    ...(status !== "IN_USE" ? { assetId: null, position: null } : {}),
  };
  if (!data.serialNo) throw new ActionError("Serial number is required — serial-level tracking is what makes swaps visible");
  if (id) await db.tyre.update({ where: { id }, data });
  else await db.tyre.create({ data });
  refresh();
}

async function deleteTyre__impl(id: string) {
  id = sanitizeId(id, "Tyre ID");
  const scopeAccess = await requireAction("maintenance.edit");
  await assertRecordAccess(scopeAccess, "tyre", id);
  await db.tyre.delete({ where: { id } });
  refresh();
}

/** Fit a tyre to a machine. Records the fitment meter so km-run is measurable. */
async function fitTyre__impl(fd: FormData) {
  const scopeAccess = await requireAction("maintenance.edit");
  await assertFormAccess(scopeAccess, fd);
  const tyreId = sanitizeId(s(fd, "tyreId"), "Tyre ID");
  const assetId = sanitizeId(s(fd, "assetId"), "Asset ID");

  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ActionError("Asset not found");
  const meter = n(fd, "meterValue") || asset.meterValue || 0;
  const tread = n(fd, "treadMm");
  const session = await getSession();

  const pos = sOrNull(fd, "position");
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

  const rawDate = sOrNull(fd, "date");
  const eventDate = rawDate ? safeParseDate(rawDate, "Fitment date") ?? new Date() : new Date();

  await businessTransaction(scopeAccess.session, async (tx) => {
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
          date: eventDate,
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
        note: sOrNull(fd, "note"),
        by: session?.name ?? null,
        date: eventDate,
      },
    });
  });
  refresh();
}

/** Remove a tyre, banking the kilometres it ran on this fitment. */
async function removeTyre__impl(fd: FormData) {
  const scopeAccess = await requireAction("maintenance.edit");
  await assertFormAccess(scopeAccess, fd);
  const tyreId = sanitizeId(s(fd, "tyreId"), "Tyre ID");
  const t = await db.tyre.findUnique({ where: { id: tyreId }, include: { asset: true } });
  if (!t) throw new ActionError("Tyre not found");

  const meter = n(fd, "meterValue") || t.asset?.meterValue || 0;
  const ranKm = t.fittedMeter != null && meter > t.fittedMeter ? meter - t.fittedMeter : 0;
  const tread = n(fd, "treadMm");
  const reason = s(fd, "reason") || "WEAR";
  const session = await getSession();
  const warehouseId = sOrNull(fd, "warehouseId");

  const scrap = reason === "BURST" || reason === "CUT" || s(fd, "scrap") === "true";
  const rawDate = sOrNull(fd, "date");
  const eventDate = rawDate ? safeParseDate(rawDate, "Removal date") ?? new Date() : new Date();

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
      meterValue: meter, treadMm: tread, reason, note: sOrNull(fd, "note"), by: session?.name ?? null,
      date: eventDate,
    },
  });
  refresh();
}

async function inspectTyre__impl(fd: FormData) {
  const scopeAccess = await requireAction("maintenance.edit");
  await assertFormAccess(scopeAccess, fd);
  const tyreId = sanitizeId(s(fd, "tyreId"), "Tyre ID");
  const tread = n(fd, "treadMm");
  const session = await getSession();
  const t = await db.tyre.findUnique({ where: { id: tyreId }, include: { asset: true } });
  if (!t) throw new ActionError("Tyre not found");

  const rawDate = sOrNull(fd, "date");
  const eventDate = rawDate ? safeParseDate(rawDate, "Inspection date") ?? new Date() : new Date();

  await db.tyre.update({ where: { id: tyreId }, data: tread > 0 ? { currentTreadMm: tread } : {} });
  await db.tyreEvent.create({
    data: {
      tyreId, kind: "INSPECT", assetId: t.assetId ?? null, position: t.position ?? null,
      meterValue: n(fd, "meterValue") || t.asset?.meterValue || 0, treadMm: tread,
      note: sOrNull(fd, "note"), by: session?.name ?? null,
      date: eventDate,
    },
  });
  refresh();
}

async function retreadTyre__impl(fd: FormData) {
  const scopeAccess = await requireAction("maintenance.edit");
  await assertFormAccess(scopeAccess, fd);
  const tyreId = sanitizeId(s(fd, "tyreId"), "Tyre ID");
  const t = await db.tyre.findUnique({ where: { id: tyreId } });
  if (!t) throw new ActionError("Tyre not found");
  const tread = n(fd, "treadMm") || t.treadNewMm;
  const session = await getSession();
  const warehouseId = sOrNull(fd, "warehouseId");
  const rawDate = sOrNull(fd, "date");
  const eventDate = rawDate ? safeParseDate(rawDate, "Retread date") ?? new Date() : new Date();

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
      note: sOrNull(fd, "note"), by: session?.name ?? null,
      date: eventDate,
    },
  });
  refresh();
}

/* ------------------------------ major components ------------------------------ */

async function saveComponent__impl(id: string | null, fd: FormData) {
  const scopeAccess = await requireAction("maintenance.edit");
  await assertFormAccess(scopeAccess, fd);
  if (id) {
    id = sanitizeId(id, "Component ID");
    await assertRecordAccess(scopeAccess, "majorComponent", id);
  }
  const status = s(fd, "status") || "IN_STOCK";
  const fittedDateRaw = sOrNull(fd, "fittedDate");
  const fittedDate = status === "IN_USE" && fittedDateRaw ? safeParseDate(fittedDateRaw, "Fitted date") : null;

  const data = {
    serialNo: s(fd, "serialNo"),
    type: s(fd, "type") || "OTHER",
    make: sOrNull(fd, "make"),
    assetId: status === "IN_USE" ? sOrNull(fd, "assetId") : null,
    status,
    cost: n(fd, "cost"),
    expectedLifeHours: n(fd, "expectedLifeHours") || 8000,
    hoursUsed: n(fd, "hoursUsed"),
    fittedMeter: status === "IN_USE" ? n(fd, "fittedMeter") : 0,
    fittedDate,
    warehouseId: status === "IN_USE" ? null : sOrNull(fd, "warehouseId"),
    notes: sOrNull(fd, "notes"),
  };
  if (!data.serialNo) throw new ActionError("Serial number is required");
  if (id) await db.majorComponent.update({ where: { id }, data });
  else await db.majorComponent.create({ data });
  refresh();
}

async function deleteComponent__impl(id: string) {
  id = sanitizeId(id, "Component ID");
  const scopeAccess = await requireAction("maintenance.edit");
  await assertRecordAccess(scopeAccess, "majorComponent", id);
  await db.majorComponent.delete({ where: { id } });
  refresh();
}

/** Transfer a tyre from its current warehouse/status to another warehouse */
async function transferTyre__impl(fd: FormData) {
  const scopeAccess = await requireAction("maintenance.edit");
  await assertFormAccess(scopeAccess, fd);
  const tyreId = sanitizeId(s(fd, "tyreId"), "Tyre ID");
  const warehouseId = sanitizeId(s(fd, "warehouseId"), "Warehouse ID");

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
  const scopeAccess = await requireAction("maintenance.edit");
  await assertFormAccess(scopeAccess, fd);
  const componentId = sanitizeId(s(fd, "componentId"), "Component ID");
  const warehouseId = sanitizeId(s(fd, "warehouseId"), "Warehouse ID");

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
