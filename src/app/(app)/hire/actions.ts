"use server";

import { db } from "@/lib/db";
import { businessTransaction } from "@/lib/business-transaction";
import { formNumber, boundedNumber, nonNegativeNumber, positiveNumber, validateDateRange, oneOf, safeParseDate } from "@/lib/input-validation";
import { assertFormAccess, assertRecordAccess } from "@/lib/record-access";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { requireAction, ActionError, safe } from "@/lib/guard";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
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
  if (id) await assertRecordAccess(scopeAccess, "hireContract", id);

  const assetId = s(fd, "assetId");
  if (!assetId) throw new ActionError("Asset is required");
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ActionError("Selected asset does not exist");

  const vendor = s(fd, "vendor");
  if (!vendor) throw new ActionError("Vendor is required");

  const rate = nonNegativeNumber(fd.get("rate"), "Contract rate", { max: 10_000_000, fallback: 0 });
  const overtimeRate = nonNegativeNumber(fd.get("overtimeRate"), "Overtime rate", { max: 1_000_000, fallback: 0 });
  const minGuarantee = nonNegativeNumber(fd.get("minGuarantee"), "Minimum guarantee", { max: 1_000, fallback: 0 });
  
  const startDate = dt(fd, "startDate");
  const endDateStr = s(fd, "endDate");
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
    contractNo: s(fd, "contractNo") || null,
    rateType,
    rate,
    overtimeRate,
    minGuarantee,
    guaranteeUnit: s(fd, "guaranteeUnit") || null,
    fuelBorneBy,
    breakdownBillable: b(fd, "breakdownBillable"),
    idleBillable: b(fd, "idleBillable"),
    startDate,
    endDate,
    status,
    notes: s(fd, "notes") || null,
  };
  if (id) await db.hireContract.update({ where: { id }, data });
  else await db.hireContract.create({ data });
  refresh();
}

async function deleteContract__impl(id: string) {
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
  const contractId = s(fd, "contractId");
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
    verifiedBy: s(fd, "verifiedBy") || session?.name || null,
    note: s(fd, "note") || null,
  };

  await db.hireLog.upsert({
    where: { contractId_date: { contractId, date } },
    create: { contractId, date, ...data },
    update: data,
  });
  refresh();
}

async function deleteLog__impl(id: string) {
  const scopeAccess = await requireAction("hire.edit");
  await assertRecordAccess(scopeAccess, "hireLog", id);
  await db.hireLog.delete({ where: { id } });
  refresh();
}

/* -------------------------------- new features -------------------------------- */

async function saveHireInspection__impl(contractId: string, fd: FormData) {
  const scopeAccess = await requireAction("hire.edit");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "hireContract", contractId);
  if (!contractId) throw new ActionError("Contract is required");
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
    inspector: s(fd, "inspector") || session?.name || "Admin",
    meterValue,
    fuelLevelPct,
    condition,
    damages: s(fd, "damages") || null,
    status,
  };
  await db.hireInspection.create({ data });
  refresh();
}

async function saveContractAmendment__impl(contractId: string, fd: FormData) {
  const scopeAccess = await requireAction("hire.edit");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "hireContract", contractId);
  if (!contractId) throw new ActionError("Contract is required");
  const session = await getSession();
  const newRate = n(fd, "newRate");
  const reason = s(fd, "reason");
  if (newRate <= 0) throw new ActionError("New rate must be greater than zero.");
  if (!reason) throw new ActionError("Reason is required.");

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
  const contractId = s(fd, "contractId") || null;
  if (contractId) {
    const contract = await db.hireContract.findUnique({ where: { id: contractId } });
    if (!contract) throw new ActionError("Contract not found.");
  }
  const vendor = s(fd, "vendor");
  if (!vendor) throw new ActionError("Vendor is required.");
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
    referenceNo: s(fd, "referenceNo") || null,
    notes: s(fd, "notes") || null,
  };
  await db.hirePayment.create({ data });
  refresh();
}

async function approveHireLog__impl(id: string, status: string) {
  const scopeAccess = await requireAction("hire.approve");
  await assertRecordAccess(scopeAccess, "hireLog", id);
  const session = await getSession();
  if (!new Set(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]).has(status)) {
    throw new ActionError("Invalid approval status.");
  }
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
  const scopeAccess = await requireAction("hire.edit");
  await assertRecordAccess(scopeAccess, "hireInspection", id);
  await db.hireInspection.delete({ where: { id } });
  refresh();
}

async function deleteAmendment__impl(id: string) {
  const scopeAccess = await requireAction("hire.edit");
  await assertRecordAccess(scopeAccess, "hireContractAmendment", id);
  await db.hireContractAmendment.delete({ where: { id } });
  refresh();
}

async function deletePayment__impl(id: string) {
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
