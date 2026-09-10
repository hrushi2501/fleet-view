"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { checkReading, type MeterType, type ReadingLite } from "@/lib/master";
import { parseBusinessDay } from "@/lib/business-time";
import { requireAction, ActionError, safe } from "@/lib/guard";
import { uploadPrivateFile } from "@/lib/private-upload";
import { assertFormAccess, assertRecordAccess } from "@/lib/record-access";
import {
  formNumber,
  boundedNumber,
  nonNegativeNumber,
  oneOf,
  safeParseDate,
  validateDateRange,
} from "@/lib/input-validation";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => formNumber(fd, k);

const VALID_LIFECYCLE_KINDS = [
  "COMMISSIONED", "TRANSFERRED", "STATUS_CHANGE", "OFF_HIRED", "DECOMMISSIONED", "DISPOSED",
] as const;

function refresh() {
  revalidatePath("/master/assets");
  revalidatePath("/master/people");
  revalidatePath("/fleet");
  revalidatePath("/drivers");
  revalidatePath("/people");
  revalidatePath("/people/attendance");
}

/* ------------------------------ M1 meters ------------------------------ */

/**
 * Record a meter reading. A rollback or implausible jump is stored and flagged
 * rather than refused — refusing outright just teaches people to fudge numbers.
 * The asset's cached meter only moves forward.
 */
async function saveReading__impl(fd: FormData) {
  const scopeAccess = await requireAction("fleet.edit");
  await assertFormAccess(scopeAccess, fd);
  const assetId = s(fd, "assetId");
  if (!assetId) throw new ActionError("Asset is required");

  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ActionError("Asset not found.");
  if (asset.decommissionedOn) throw new ActionError("Cannot record meter readings for a decommissioned vehicle.");

  const meterType = oneOf(s(fd, "meterType") || "ODOMETER", ["ODOMETER", "HOURS"] as const, "meter type");
  const value = boundedNumber(fd.get("value"), "Meter reading", { min: 0, max: 10_000_000 });
  const rawDate = s(fd, "date");
  const date = parseBusinessDay(rawDate);
  const tomorrow = new Date(Date.now() + 86400000);
  if (date > tomorrow) {
    throw new ActionError("Meter reading date cannot be in the future.");
  }
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
    const current = meterType === "HOURS" ? asset.hourMeterValue ?? 0 : asset.meterValue ?? 0;
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
  const scopeAccess = await requireAction("fleet.edit");
  await assertRecordAccess(scopeAccess, "meterReading", id);
  await db.meterReading.delete({ where: { id } });
  refresh();
}

/** Extra master-data fields the demo's asset form never captured. */
async function saveAssetMaster__impl(assetId: string, fd: FormData) {
  const scopeAccess = await requireAction("fleet.edit");
  await assertRecordAccess(scopeAccess, "asset", assetId);
  const before = await db.asset.findUnique({ where: { id: assetId } });
  if (!before) throw new ActionError("Asset not found.");
  if (before.decommissionedOn) {
    throw new ActionError("Decommissioned vehicles cannot be edited. Restore it deliberately before changing master data.");
  }

  const insuredValue = nonNegativeNumber(fd.get("insuredValue"), "Insured value", {
    max: 100_000_000_000,
    fallback: 0,
  });
  const hourMeterValue = boundedNumber(fd.get("hourMeterValue"), "Hour-meter reading", {
    min: 0,
    max: 1_000_000,
    fallback: 0,
  });
  if (before.hourMeterValue > 0 && hourMeterValue < before.hourMeterValue) {
    throw new ActionError(`Hour-meter reading (${hourMeterValue} hrs) cannot be lower than existing reading (${before.hourMeterValue} hrs).`);
  }
  const commissionedOn = safeParseDate(fd.get("commissionedOn"), "Commissioned date", { minYear: 1950, maxYear: 2100 });

  await db.asset.update({
    where: { id: assetId },
    data: {
      chassisNo: s(fd, "chassisNo") || null,
      engineNo: s(fd, "engineNo") || null,
      insuredValue,
      hourMeterValue,
      commissionedOn,
    },
  });
  await audit({
    action: "UPDATE", module: "FLEET", entity: "Asset", entityId: assetId,
    summary: `Master data updated for ${before?.code ?? assetId}`,
  });
  refresh();
}

async function saveLifecycleEvent__impl(fd: FormData) {
  const scopeAccess = await requireAction("fleet.edit");
  await assertFormAccess(scopeAccess, fd);
  const assetId = s(fd, "assetId");
  if (!assetId) throw new ActionError("Asset is required");
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ActionError("Asset not found.");

  const session = await getSession();
  const kind = oneOf(s(fd, "kind") || "STATUS_CHANGE", VALID_LIFECYCLE_KINDS, "lifecycle event kind");
  const amount = nonNegativeNumber(fd.get("amount"), "Amount", {
    max: 100_000_000_000,
    fallback: 0,
  });

  const rawDate = s(fd, "date");
  if (rawDate) {
    safeParseDate(rawDate, "Lifecycle event date");
  }
  const date = parseBusinessDay(rawDate);

  await db.assetLifecycleEvent.create({
    data: {
      assetId,
      kind,
      fromValue: s(fd, "fromValue") || null,
      toValue: s(fd, "toValue") || null,
      amount,
      note: s(fd, "note") || null,
      date,
      by: session?.name ?? null,
    },
  });

  if (kind === "DECOMMISSIONED" || kind === "DISPOSED") {
    const now = new Date();
    await db.asset.update({
      where: { id: assetId },
      data: { status: "Decommissioned", driverId: null, decommissionedOn: now },
    });
  } else if (kind === "OFF_HIRED") {
    const now = new Date();
    await db.asset.update({
      where: { id: assetId },
      data: { status: "Off-hired", driverId: null, decommissionedOn: now },
    });
  }
  await audit({ action: "UPDATE", module: "FLEET", entity: "Asset", entityId: assetId, summary: `Lifecycle event: ${kind}` });
  refresh();
}

/* ------------------------------ M2 personnel ------------------------------ */

async function saveAttendance__impl(fd: FormData) {
  const scopeAccess = await requireAction("people.edit");
  await assertFormAccess(scopeAccess, fd);
  const driverId = s(fd, "driverId");
  if (!driverId) throw new ActionError("Person is required");
  const driver = await db.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new ActionError("Selected person does not exist");

  const projectId = s(fd, "projectId") || null;
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) throw new ActionError("Selected project does not exist");
  }

  const rawDate = s(fd, "date");
  if (rawDate) {
    safeParseDate(rawDate, "Attendance date");
  }
  const date = parseBusinessDay(rawDate);
  date.setHours(0, 0, 0, 0);

  const shift = oneOf(s(fd, "shift") || "DAY", ["DAY", "NIGHT", "GENERAL"], "Shift");
  const status = oneOf(
    s(fd, "status") || "PRESENT",
    ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "REST", "HOLIDAY"],
    "Attendance status"
  );
  const hours = boundedNumber(fd.get("hours"), "Attendance hours", { min: 0, max: 24, fallback: 8 });
  const session = await getSession();

  const data = {
    status,
    projectId,
    hours,
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
  const scopeAccess = await requireAction("people.edit");
  await assertRecordAccess(scopeAccess, "attendance", id);
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
  const scopeAccess = await requireAction("people.edit");
  const session = await getSession();
  const markedBy = session?.name || "Supervisor";

  for (const item of items) {
    if (!item.driverId) continue;
    await assertRecordAccess(scopeAccess, "driver", item.driverId);
    if (item.projectId) await assertRecordAccess(scopeAccess, "project", item.projectId);

    const status = oneOf(
      item.status || "PRESENT",
      ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "REST", "HOLIDAY"],
      "Attendance status"
    );
    const shift = oneOf(item.shift || "DAY", ["DAY", "NIGHT", "GENERAL"], "Shift");

    if (item.date) {
      safeParseDate(item.date, "Attendance date");
    }
    const date = parseBusinessDay(item.date);
    date.setHours(0, 0, 0, 0);

    const data = {
      status,
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
  const scopeAccess = await requireAction("people.edit");
  await assertFormAccess(scopeAccess, fd);
  const driverId = s(fd, "driverId");
  if (!driverId) throw new ActionError("Person is required");
  const driver = await db.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new ActionError("Selected person does not exist");

  const docType = oneOf(
    s(fd, "docType") || "LICENSE",
    ["LICENSE", "AADHAAR", "PAN", "MEDICAL", "POLICE_VERIFICATION", "TRAINING", "CONTRACT", "OTHER"],
    "Document type"
  );

  const issueDateStr = s(fd, "issueDate");
  const issueDate = issueDateStr ? safeParseDate(issueDateStr, "Issue date") : null;
  const expiryDateStr = s(fd, "expiryDate");
  const expiryDate = expiryDateStr ? safeParseDate(expiryDateStr, "Expiry date") : null;

  if (issueDate && expiryDate) {
    validateDateRange(issueDate, expiryDate, "Document validity period");
  }

  let documentUrl: string | null = null;
  const file = fd.get("document");
  if (file && typeof file !== "string") {
    const f = file as File;
    if (f.size) {
      documentUrl = await uploadPrivateFile(f, { folder: "people", kind: "document" });
    }
  }

  await db.personDocument.create({
    data: {
      driverId,
      docType,
      number: s(fd, "number") || null,
      issueDate,
      expiryDate,
      notes: s(fd, "notes") || null,
      documentUrl,
    },
  });
  refresh();
}

async function deletePersonDoc__impl(id: string) {
  const scopeAccess = await requireAction("people.edit");
  await assertRecordAccess(scopeAccess, "personDocument", id);
  await db.personDocument.delete({ where: { id } });
  refresh();
}

async function savePersonMaster__impl(driverId: string, fd: FormData) {
  const scopeAccess = await requireAction("people.edit");
  await assertRecordAccess(scopeAccess, "driver", driverId);
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
