"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { checkReading, type MeterType, type ReadingLite } from "@/lib/master";
import { parseBusinessDay } from "@/lib/business-time";
import { requireAction, ActionError, safe } from "@/lib/guard";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k) ?? 0) || 0;

function refresh() {
  revalidatePath("/master/assets");
  revalidatePath("/master/people");
  revalidatePath("/fleet");
  revalidatePath("/drivers");
}

/* ------------------------------ M1 meters ------------------------------ */

/**
 * Record a meter reading. A rollback or implausible jump is stored and flagged
 * rather than refused — refusing outright just teaches people to fudge numbers.
 * The asset's cached meter only moves forward.
 */
async function saveReading__impl(fd: FormData) {
  await requireAction("fleet.edit");
  const assetId = s(fd, "assetId");
  if (!assetId) throw new ActionError("Asset is required");
  const meterType = (s(fd, "meterType") || "ODOMETER") as MeterType;
  const value = n(fd, "value");
  const date = parseBusinessDay(s(fd, "date"));
  const session = await getSession();

  const history = await db.meterReading.findMany({ where: { assetId }, orderBy: { date: "desc" }, take: 200 });
  const check = checkReading(
    meterType,
    value,
    date,
    history.map((h): ReadingLite => ({ id: h.id, meterType: h.meterType, value: h.value, date: h.date, source: h.source }))
  );

  await db.meterReading.create({
    data: {
      assetId, meterType, value, date,
      source: s(fd, "source") || "MANUAL",
      recordedBy: s(fd, "recordedBy") || session?.name || null,
      note: check.message ? `${s(fd, "note")}${s(fd, "note") ? " — " : ""}${check.message}` : s(fd, "note") || null,
      isRollback: check.isRollback,
    },
  });

  // Only advance the cached meter; never let a bad entry drag it backwards.
  if (!check.isRollback) {
    const field = meterType === "HOURS" ? "hourMeterValue" : "meterValue";
    const asset = await db.asset.findUnique({ where: { id: assetId } });
    const current = meterType === "HOURS" ? asset?.hourMeterValue ?? 0 : asset?.meterValue ?? 0;
    if (value > current) await db.asset.update({ where: { id: assetId }, data: { [field]: value } });
  }

  if (check.isRollback || check.implausible) {
    await audit({
      action: "UPDATE", module: "FLEET", entity: "MeterReading", entityId: assetId,
      summary: `Suspicious meter reading on asset ${assetId}: ${check.message}`,
    });
  }
  refresh();
  return { ok: check.ok, message: check.message };
}

async function deleteReading__impl(id: string) {
  await requireAction("fleet.edit");
  await db.meterReading.delete({ where: { id } });
  refresh();
}

/** Extra master-data fields the demo's asset form never captured. */
async function saveAssetMaster__impl(assetId: string, fd: FormData) {
  await requireAction("fleet.edit");
  const before = await db.asset.findUnique({ where: { id: assetId } });
  await db.asset.update({
    where: { id: assetId },
    data: {
      chassisNo: s(fd, "chassisNo") || null,
      engineNo: s(fd, "engineNo") || null,
      insuredValue: n(fd, "insuredValue"),
      hourMeterValue: n(fd, "hourMeterValue"),
      commissionedOn: s(fd, "commissionedOn") ? new Date(s(fd, "commissionedOn")) : null,
    },
  });
  await audit({
    action: "UPDATE", module: "FLEET", entity: "Asset", entityId: assetId,
    summary: `Master data updated for ${before?.code ?? assetId}`,
  });
  refresh();
}

async function saveLifecycleEvent__impl(fd: FormData) {
  await requireAction("fleet.edit");
  const assetId = s(fd, "assetId");
  if (!assetId) throw new ActionError("Asset is required");
  const session = await getSession();
  const kind = s(fd, "kind") || "STATUS_CHANGE";

  await db.assetLifecycleEvent.create({
    data: {
      assetId, kind,
      date: parseBusinessDay(s(fd, "date")),
      fromValue: s(fd, "fromValue") || null,
      toValue: s(fd, "toValue") || null,
      amount: n(fd, "amount"),
      note: s(fd, "note") || null,
      by: session?.name ?? null,
    },
  });

  if (kind === "DECOMMISSIONED" || kind === "DISPOSED") {
    await db.asset.update({ where: { id: assetId }, data: { status: "Off-hired", decommissionedOn: new Date() } });
  }
  await audit({ action: "UPDATE", module: "FLEET", entity: "Asset", entityId: assetId, summary: `Lifecycle event: ${kind}` });
  refresh();
}

/* ------------------------------ M2 personnel ------------------------------ */

async function saveAttendance__impl(fd: FormData) {
  await requireAction("people.edit");
  const driverId = s(fd, "driverId");
  if (!driverId) throw new ActionError("Person is required");
  const date = parseBusinessDay(s(fd, "date"));
  date.setHours(0, 0, 0, 0);
  const shift = s(fd, "shift") || "DAY";
  const session = await getSession();

  const data = {
    status: s(fd, "status") || "PRESENT",
    projectId: s(fd, "projectId") || null,
    hours: n(fd, "hours"),
    markedBy: s(fd, "markedBy") || session?.name || null,
    note: s(fd, "note") || null,
  };
  await db.attendance.upsert({
    where: { driverId_date_shift: { driverId, date, shift } },
    create: { driverId, date, shift, ...data },
    update: data,
  });
  refresh();
}

async function deleteAttendance__impl(id: string) {
  await requireAction("people.edit");
  await db.attendance.delete({ where: { id } });
  refresh();
}

async function batchSaveAttendance__impl(
  items: Array<{
    driverId: string;
    status: string;
    shift?: string;
    date?: string;
    projectId?: string | null;
    note?: string | null;
  }>
) {
  await requireAction("people.edit");
  const session = await getSession();
  const markedBy = session?.name || "Supervisor";

  for (const item of items) {
    if (!item.driverId) continue;
    const date = parseBusinessDay(item.date);
    date.setHours(0, 0, 0, 0);
    const shift = item.shift || "DAY";
    const data = {
      status: item.status || "PRESENT",
      projectId: item.projectId || null,
      markedBy,
      note: item.note || null,
    };
    await db.attendance.upsert({
      where: { driverId_date_shift: { driverId: item.driverId, date, shift } },
      create: { driverId: item.driverId, date, shift, ...data },
      update: data,
    });
  }
  refresh();
}

async function savePersonDoc__impl(fd: FormData) {
  await requireAction("people.edit");
  const driverId = s(fd, "driverId");
  if (!driverId) throw new ActionError("Person is required");

  let documentUrl: string | null = null;
  const file = fd.get("document");
  if (file && typeof file !== "string") {
    const f = file as File;
    if (f.size) {
      const ext = (f.name.split(".").pop() || "pdf").toLowerCase();
      const blob = await put(`people/${s(fd, "docType")}-${Date.now()}.${ext}`, f, { access: "public", addRandomSuffix: true });
      documentUrl = blob.url;
    }
  }

  await db.personDocument.create({
    data: {
      driverId,
      docType: s(fd, "docType") || "LICENSE",
      number: s(fd, "number") || null,
      issueDate: s(fd, "issueDate") ? new Date(s(fd, "issueDate")) : null,
      expiryDate: s(fd, "expiryDate") ? new Date(s(fd, "expiryDate")) : null,
      notes: s(fd, "notes") || null,
      documentUrl,
    },
  });
  refresh();
}

async function deletePersonDoc__impl(id: string) {
  await requireAction("people.edit");
  await db.personDocument.delete({ where: { id } });
  refresh();
}

async function savePersonMaster__impl(driverId: string, fd: FormData) {
  await requireAction("people.edit");
  await db.driver.update({
    where: { id: driverId },
    data: {
      employmentType: s(fd, "employmentType") || "OWN",
      contractorName: s(fd, "contractorName") || null,
      joinDate: s(fd, "joinDate") ? new Date(s(fd, "joinDate")) : null,
      bloodGroup: s(fd, "bloodGroup") || null,
      emergencyContact: s(fd, "emergencyContact") || null,
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
export const saveReading = safe(saveReading__impl);
export const deleteReading = safe(deleteReading__impl);
export const saveAssetMaster = safe(saveAssetMaster__impl);
export const saveLifecycleEvent = safe(saveLifecycleEvent__impl);
export const saveAttendance = safe(saveAttendance__impl);
export const deleteAttendance = safe(deleteAttendance__impl);
export const batchSaveAttendance = safe(batchSaveAttendance__impl);
export const savePersonDoc = safe(savePersonDoc__impl);
export const deletePersonDoc = safe(deletePersonDoc__impl);
export const savePersonMaster = safe(savePersonMaster__impl);
