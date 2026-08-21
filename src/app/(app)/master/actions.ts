"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { checkReading, type MeterType, type ReadingLite } from "@/lib/master";
import { parseBusinessDay } from "@/lib/business-time";
import { requireAction } from "@/lib/guard";

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
export async function saveReading(fd: FormData) {
  await requireAction("fleet.edit");
  const assetId = s(fd, "assetId");
  if (!assetId) throw new Error("Asset is required");
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

export async function deleteReading(id: string) {
  await requireAction("fleet.edit");
  await db.meterReading.delete({ where: { id } });
  refresh();
}

/** Extra master-data fields the demo's asset form never captured. */
export async function saveAssetMaster(assetId: string, fd: FormData) {
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

export async function saveLifecycleEvent(fd: FormData) {
  await requireAction("fleet.edit");
  const assetId = s(fd, "assetId");
  if (!assetId) throw new Error("Asset is required");
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

export async function saveAttendance(fd: FormData) {
  await requireAction("people.edit");
  const driverId = s(fd, "driverId");
  if (!driverId) throw new Error("Person is required");
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

export async function deleteAttendance(id: string) {
  await requireAction("people.edit");
  await db.attendance.delete({ where: { id } });
  refresh();
}

export async function batchSaveAttendance(
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

export async function savePersonDoc(fd: FormData) {
  await requireAction("people.edit");
  const driverId = s(fd, "driverId");
  if (!driverId) throw new Error("Person is required");

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

export async function deletePersonDoc(id: string) {
  await requireAction("people.edit");
  await db.personDocument.delete({ where: { id } });
  refresh();
}

export async function savePersonMaster(driverId: string, fd: FormData) {
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
