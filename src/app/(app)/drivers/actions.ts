"use server";

import { db } from "@/lib/db";
import { formNumber } from "@/lib/input-validation";
import { assertRecordAccess, assertFormAccess, assertGlobalAccess } from "@/lib/record-access";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { SEVERITY_POINTS, safetyScore } from "@/lib/drivers";
import { requireAction, ActionError, safe } from "@/lib/guard";
import { uploadPrivateFile } from "@/lib/private-upload";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = formNumber;

function refresh() {
  revalidatePath("/drivers");
  revalidatePath("/compliance");
  revalidatePath("/loss-prevention");
}

/** Recompute and persist the driver's safety score from their violation history. */
async function syncScore(driverId: string) {
  const vs = await db.violation.findMany({ where: { driverId } });
  const { score } = safetyScore(vs.map((v) => ({ id: v.id, type: v.type, severity: v.severity, points: v.points, date: v.date, penalty: v.penalty, status: v.status })));
  await db.driver.update({ where: { id: driverId }, data: { safetyScore: score } });
}

/* ------------------------------- competencies ------------------------------- */

async function saveCompetency__impl(fd: FormData) {
  const scopeAccess = await requireAction("people.edit");
  await assertFormAccess(scopeAccess, fd);
  const driverId = s(fd, "driverId");
  const assetClass = s(fd, "assetClass");
  if (!driverId || !assetClass) throw new ActionError("Driver and machine class are required");

  const data = {
    level: s(fd, "level") || "TRAINED",
    certNo: s(fd, "certNo") || null,
    certifiedOn: s(fd, "certifiedOn") ? new Date(s(fd, "certifiedOn")) : null,
    expiresOn: s(fd, "expiresOn") ? new Date(s(fd, "expiresOn")) : null,
    issuedBy: s(fd, "issuedBy") || null,
  };
  await db.competency.upsert({
    where: { driverId_assetClass: { driverId, assetClass } },
    create: { driverId, assetClass, ...data },
    update: data,
  });
  refresh();
}

async function deleteCompetency__impl(id: string) {
  const scopeAccess = await requireAction("people.edit");
  await assertRecordAccess(scopeAccess, "competency", id);
  await db.competency.delete({ where: { id } });
  refresh();
}

/* -------------------------------- violations -------------------------------- */

async function saveViolation__impl(fd: FormData) {
  const scopeAccess = await requireAction("people.discipline");
  await assertFormAccess(scopeAccess, fd);
  const driverId = s(fd, "driverId");
  if (!driverId) throw new ActionError("Driver is required");
  const severity = s(fd, "severity") || "MINOR";
  const session = await getSession();

  await db.violation.create({
    data: {
      driverId,
      assetId: s(fd, "assetId") || null,
      type: s(fd, "type") || "OTHER",
      severity,
      points: Math.round(n(fd, "points")) || SEVERITY_POINTS[severity] || 1,
      date: s(fd, "date") ? new Date(s(fd, "date")) : new Date(),
      description: s(fd, "description") || null,
      penalty: n(fd, "penalty"),
      actionTaken: s(fd, "actionTaken") || null,
      recordedBy: session?.name ?? null,
    },
  });
  await syncScore(driverId);
  refresh();
}

async function updateViolation__impl(id: string, fd: FormData) {
  const scopeAccess = await requireAction("people.discipline");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "violation", id);
  const v = await db.violation.update({
    where: { id },
    data: {
      status: s(fd, "status") || "OPEN",
      actionTaken: s(fd, "actionTaken") || null,
      penalty: n(fd, "penalty"),
    },
  });
  await syncScore(v.driverId);
  refresh();
}

async function deleteViolation__impl(id: string) {
  const scopeAccess = await requireAction("people.discipline");
  await assertRecordAccess(scopeAccess, "violation", id);
  const v = await db.violation.findUnique({ where: { id } });
  if (!v) return;
  await db.violation.delete({ where: { id } });
  await syncScore(v.driverId);
  refresh();
}

/* -------------------------------- compliance -------------------------------- */

/** Save or renew a document. Renewals chain to the old record rather than overwrite it. */
async function saveDocument__impl(fd: FormData) {
  const scopeAccess = await requireAction("compliance.edit");
  await assertFormAccess(scopeAccess, fd);
  const assetId = s(fd, "assetId");
  if (!assetId) throw new ActionError("Asset is required");

  const expiryDate = new Date(s(fd, "expiryDate"));
  const reminderDays = Math.round(n(fd, "reminderDays")) || 30;
  const days = (expiryDate.getTime() - Date.now()) / 86400000;
  const status = days < 0 ? "Expired" : days <= reminderDays ? "Expiring" : "Valid";

  const file = fd.get("document");
  let documentUrl: string | null = null;
  if (file && typeof file !== "string") {
    const f = file as File;
    if (f.size) {
      documentUrl = await uploadPrivateFile(f, { folder: "compliance", kind: "document" });
    }
  }

  const supersedesId = s(fd, "supersedesId") || null;

  await db.complianceDoc.create({
    data: {
      assetId,
      docType: s(fd, "docType"),
      number: s(fd, "number"),
      issueDate: s(fd, "issueDate") ? new Date(s(fd, "issueDate")) : new Date(),
      expiryDate,
      status,
      reminderDays,
      cost: n(fd, "cost"),
      vendor: s(fd, "vendor") || null,
      notes: s(fd, "notes") || null,
      documentUrl,
      supersedesId,
      renewedAt: supersedesId ? new Date() : null,
    },
  });
  refresh();
}

async function deleteDocument__impl(id: string) {
  const scopeAccess = await requireAction("compliance.edit");
  await assertRecordAccess(scopeAccess, "complianceDoc", id);
  await db.complianceDoc.delete({ where: { id } });
  refresh();
}

/** Refresh every document's cached status against today's date. */
async function refreshDocStatuses__impl() {
  const scopeAccess = await requireAction("compliance.edit");
  assertGlobalAccess(scopeAccess);
  const docs = await db.complianceDoc.findMany();
  let changed = 0;
  for (const d of docs) {
    const days = (d.expiryDate.getTime() - Date.now()) / 86400000;
    const status = days < 0 ? "Expired" : days <= d.reminderDays ? "Expiring" : "Valid";
    if (status !== d.status) {
      await db.complianceDoc.update({ where: { id: d.id }, data: { status } });
      changed++;
    }
  }
  refresh();
  return { ok: true as const, changed };
}

/* ---------------------------------------------------------------------------
 * Exported actions.
 *
 * Wrapped in `safe()` so an `ActionError` comes back as `{ error }` instead of
 * being thrown — Next redacts thrown messages in production builds, which made
 * every validation message in this file invisible to the person who triggered
 * it. Return values are passed through untouched.
 * ------------------------------------------------------------------------- */
export const saveCompetency = safe(saveCompetency__impl);
export const deleteCompetency = safe(deleteCompetency__impl);
export const saveViolation = safe(saveViolation__impl);
export const updateViolation = safe(updateViolation__impl);
export const deleteViolation = safe(deleteViolation__impl);
export const saveDocument = safe(saveDocument__impl);
export const deleteDocument = safe(deleteDocument__impl);
export const refreshDocStatuses = safe(refreshDocStatuses__impl);
