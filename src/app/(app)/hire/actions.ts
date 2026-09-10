"use server";

import { db } from "@/lib/db";
import { businessTransaction } from "@/lib/business-transaction";
import {
  formNumber,
  boundedNumber,
  nonNegativeNumber,
  positiveNumber,
  validateDateRange,
  oneOf,
  safeParseDate,
  sanitizeString,
  sanitizeOptionalString,
  sanitizeId,
} from "@/lib/input-validation";
import { assertFormAccess, assertRecordAccess } from "@/lib/record-access";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { requireAction, ActionError, safe } from "@/lib/guard";

const s = (fd: FormData, k: string) => sanitizeString(fd.get(k), k);
const sOrNull = (fd: FormData, k: string) => sanitizeOptionalString(fd.get(k), k);
const n = formNumber;
const b = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const dt = (fd: FormData, k: string) => {
  const val = s(fd, k);
  if (!val) return new Date();
  const parsed = safeParseDate(val, k);
  return parsed ?? new Date();
};

function refresh() {
  revalidatePath("/hire");
  revalidatePath("/fleet");
}

/* -------------------------------- contracts -------------------------------- */

async function saveContract__impl(id: string | null, fd: FormData) {
  const scopeAccess = await requireAction("hire.edit");
  await assertFormAccess(scopeAccess, fd);
  if (id) {
    id = sanitizeId(id, "Contract ID");
    await assertRecordAccess(scopeAccess, "hireContract", id);
  }

  const assetId = sanitizeId(s(fd, "assetId"), "Asset ID");
  if (!assetId) throw new ActionError("Asset is required");
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ActionError("Selected asset does not exist");

  const vendor = sanitizeString(fd.get("vendor"), "Vendor", { required: true, maxLength: 200 });

  const rate = nonNegativeNumber(fd.get("rate"), "Contract rate", { max: 10_000_000, fallback: 0 });
  const overtimeRate = nonNegativeNumber(fd.get("overtimeRate"), "Overtime rate", { max: 1_000_000, fallback: 0 });
  const minGuarantee = nonNegativeNumber(fd.get("minGuarantee"), "Minimum guarantee", { max: 1_000, fallback: 0 });
  
  const startDate = dt(fd, "startDate");
  const endDateStr = sOrNull(fd, "endDate");
  const endDate = endDateStr ? safeParseDate(endDateStr, "End date") : null;
  if (endDate) {
    validateDateRange(startDate, endDate, "Contract duration");
  }

  const rateType = oneOf(
    s(fd, "rateType") || "PER_DAY",
    ["PER_HOUR", "PER_DAY", "PER_MONTH", "PER_TRIP", "PER_KM"],
    "Rate type"
  );
  const fuelBorneBy = oneOf(
    s(fd, "fuelBorneBy") || "HIRER",
    ["HIRER", "OWNER"],
    "Fuel borne by"
  );
  const status = oneOf(
    s(fd, "status") || "Active",
    ["Active", "Completed", "Terminated", "Draft", "Suspended"],
    "Contract status"
  );

  const data = {
    assetId,
    vendor,
    contractNo: sOrNull(fd, "contractNo"),
    rateType,
    rate,
    overtimeRate,
    minGuarantee,
    guaranteeUnit: sOrNull(fd, "guaranteeUnit"),
    fuelBorneBy,
    breakdownBillable: b(fd, "breakdownBillable"),
    idleBillable: b(fd, "idleBillable"),
    startDate,
    endDate,
    status,
    notes: sOrNull(fd, "notes"),
  };
  if (id) await db.hireContract.update({ where: { id }, data });
  else await db.hireContract.create({ data });
  refresh();
}

async function deleteContract__impl(id: string) {
  id = sanitizeId(id, "Contract ID");
  const scopeAccess = await requireAction("hire.edit");
  await assertRecordAccess(scopeAccess, "hireContract", id);
  await db.hireContract.delete({ where: { id } });
  refresh();
}

/* ----------------------------------- logs ----------------------------------- */

/** One day of actual work. Upserted so re-entering a date corrects rather than duplicates. */
async function saveLog__impl(fd: FormData) {
  const scopeAccess = await requireAction("hire.edit");
  await assertFormAccess(scopeAccess, fd);
  const contractId = sanitizeId(s(fd, "contractId"), "Contract ID");
  if (!contractId) throw new ActionError("Contract is required");
  const date = dt(fd, "date");
  date.setHours(0, 0, 0, 0);

  const workedHours = boundedNumber(fd.get("workedHours"), "Worked hours", { min: 0, max: 24, fallback: 0 });
  const idleHours = boundedNumber(fd.get("idleHours"), "Idle hours", { min: 0, max: 24, fallback: 0 });
  const breakdownHours = boundedNumber(fd.get("breakdownHours"), "Breakdown hours", { min: 0, max: 24, fallback: 0 });

  if (workedHours + idleHours + breakdownHours > 24) {
    throw new ActionError("Sum of worked, idle, and breakdown hours cannot exceed 24 hours in a single day.");
  }

  const km = boundedNumber(fd.get("km"), "Distance", { min: 0, max: 2_000, fallback: 0 });
  const trips = boundedNumber(fd.get("trips"), "Trips", { min: 0, max: 1_000, integer: true, fallback: 0 });

  const session = await getSession();
  const data = {
    present: s(fd, "present") !== "false",
    workedHours,
    idleHours,
    breakdownHours,
    km,
    trips,
    source: s(fd, "source") || "MANUAL",
    verifiedBy: sOrNull(fd, "verifiedBy") || session?.name || null,
    note: sOrNull(fd, "note"),
  };

  await db.hireLog.upsert({
    where: { contractId_date: { contractId, date } },
    create: { contractId, date, ...data },
    update: data,
  });
  refresh();
}

async function deleteLog__impl(id: string) {
  id = sanitizeId(id, "Hire Log ID");
  const scopeAccess = await requireAction("hire.edit");
  await assertRecordAccess(scopeAccess, "hireLog", id);
  await db.hireLog.delete({ where: { id } });
  refresh();
}

/* -------------------------------- new features -------------------------------- */

async function saveHireInspection__impl(rawContractId: string, fd: FormData) {
  const contractId = sanitizeId(rawContractId, "Contract ID");
  const scopeAccess = await requireAction("hire.edit");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "hireContract", contractId);
  const session = await getSession();

  const type = oneOf(s(fd, "type") || "ON_HIRE", ["ON_HIRE", "OFF_HIRE", "PERIODIC"], "Inspection type");
  const condition = oneOf(s(fd, "condition") || "GOOD", ["EXCELLENT", "GOOD", "FAIR", "POOR", "DAMAGED"], "Inspection condition");
  const status = oneOf(s(fd, "status") || "SUBMITTED", ["SUBMITTED", "APPROVED", "REJECTED"], "Inspection status");
  const meterValue = nonNegativeNumber(fd.get("meterValue"), "Meter value", { max: 10_000_000, fallback: 0 });
  
  const rawFuel = fd.get("fuelLevelPct");
  const fuelLevelPct = rawFuel !== null && rawFuel !== undefined && String(rawFuel).trim() !== ""
    ? boundedNumber(rawFuel, "Fuel level", { min: 0, max: 100 })
    : null;

  const data = {
    contractId,
    type,
    date: dt(fd, "date"),
    inspector: sOrNull(fd, "inspector") || session?.name || "Admin",
    meterValue,
    fuelLevelPct,
    condition,
    damages: sOrNull(fd, "damages"),
    status,
  };
  await db.hireInspection.create({ data });
  refresh();
}

async function saveContractAmendment__impl(rawContractId: string, fd: FormData) {
  const contractId = sanitizeId(rawContractId, "Contract ID");
  const scopeAccess = await requireAction("hire.edit");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "hireContract", contractId);
  const session = await getSession();
  const newRate = nonNegativeNumber(fd.get("newRate"), "New rate", { max: 10_000_000 });
  const reason = sanitizeString(fd.get("reason"), "Reason", { required: true, maxLength: 500 });
  if (newRate <= 0) throw new ActionError("New rate must be greater than zero.");

  await businessTransaction(scopeAccess.session, async (tx) => {
    const contract = await tx.hireContract.findUnique({ where: { id: contractId }, select: { rate: true } });
    if (!contract) throw new ActionError("Contract was not found.");
    await tx.hireContractAmendment.create({
      data: {
        contractId,
        effectiveDate: dt(fd, "effectiveDate"),
        previousRate: contract.rate,
        newRate,
        reason,
        approvedBy: session?.name || "Admin",
      },
    });
    await tx.hireContract.update({ where: { id: contractId }, data: { rate: newRate } });
  });
  refresh();
}

async function saveHirePayment__impl(fd: FormData) {
  const scopeAccess = await requireAction("hire.approve");
  await assertFormAccess(scopeAccess, fd);
  const rawContractId = sOrNull(fd, "contractId");
  const contractId = rawContractId ? sanitizeId(rawContractId, "Contract ID") : null;
  if (contractId) {
    const contract = await db.hireContract.findUnique({ where: { id: contractId } });
    if (!contract) throw new ActionError("Contract not found.");
  }
  const vendor = sanitizeString(fd.get("vendor"), "Vendor", { required: true, maxLength: 200 });
  const amount = positiveNumber(fd.get("amount"), "Payment amount", { max: 100_000_000 });
  const type = oneOf(
    s(fd, "type") || "ADVANCE",
    ["ADVANCE", "MONTHLY_BILL", "FINAL_SETTLEMENT", "DAMAGE_RECOVERY", "OTHER"],
    "Payment type"
  );

  const data = {
    contractId,
    vendor,
    amount,
    type,
    date: dt(fd, "date"),
    referenceNo: sOrNull(fd, "referenceNo"),
    notes: sOrNull(fd, "notes"),
  };
  await db.hirePayment.create({ data });
  refresh();
}

async function approveHireLog__impl(rawId: string, rawStatus: string) {
  const id = sanitizeId(rawId, "Hire Log ID");
  const scopeAccess = await requireAction("hire.approve");
  await assertRecordAccess(scopeAccess, "hireLog", id);
  const session = await getSession();
  const status = oneOf(rawStatus, ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"], "Approval status");

  await db.hireLog.update({
    where: { id },
    data: {
      approvalStatus: status,
      approvedBy: status === "APPROVED" || status === "REJECTED" ? session?.name || "Admin" : null,
      approvedAt: status === "APPROVED" || status === "REJECTED" ? new Date() : null,
    },
  });
  refresh();
}

async function deleteInspection__impl(id: string) {
  id = sanitizeId(id, "Inspection ID");
  const scopeAccess = await requireAction("hire.edit");
  await assertRecordAccess(scopeAccess, "hireInspection", id);
  await db.hireInspection.delete({ where: { id } });
  refresh();
}

async function deleteAmendment__impl(id: string) {
  id = sanitizeId(id, "Amendment ID");
  const scopeAccess = await requireAction("hire.edit");
  await assertRecordAccess(scopeAccess, "hireContractAmendment", id);
  await db.hireContractAmendment.delete({ where: { id } });
  refresh();
}

async function deletePayment__impl(id: string) {
  id = sanitizeId(id, "Payment ID");
  const scopeAccess = await requireAction("hire.approve");
  await assertRecordAccess(scopeAccess, "hirePayment", id);
  await db.hirePayment.delete({ where: { id } });
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
export const saveContract = safe(saveContract__impl);
export const deleteContract = safe(deleteContract__impl);
export const saveLog = safe(saveLog__impl);
export const deleteLog = safe(deleteLog__impl);
export const saveHireInspection = safe(saveHireInspection__impl);
export const saveContractAmendment = safe(saveContractAmendment__impl);
export const saveHirePayment = safe(saveHirePayment__impl);
export const approveHireLog = safe(approveHireLog__impl);
export const deleteInspection = safe(deleteInspection__impl);
export const deleteAmendment = safe(deleteAmendment__impl);
export const deletePayment = safe(deletePayment__impl);
