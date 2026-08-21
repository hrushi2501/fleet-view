"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { requireAction, ActionError, safe } from "@/lib/guard";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k) ?? 0) || 0;
const b = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const dt = (fd: FormData, k: string) => (s(fd, k) ? new Date(s(fd, k)) : new Date());

function refresh() {
  revalidatePath("/hire");
  revalidatePath("/fleet");
}

/* -------------------------------- contracts -------------------------------- */

async function saveContract__impl(id: string | null, fd: FormData) {
  await requireAction("hire.edit");
  const data = {
    assetId: s(fd, "assetId"),
    vendor: s(fd, "vendor"),
    contractNo: s(fd, "contractNo") || null,
    rateType: s(fd, "rateType") || "PER_DAY",
    rate: n(fd, "rate"),
    overtimeRate: n(fd, "overtimeRate"),
    minGuarantee: n(fd, "minGuarantee"),
    guaranteeUnit: s(fd, "guaranteeUnit") || null,
    fuelBorneBy: s(fd, "fuelBorneBy") || "HIRER",
    breakdownBillable: b(fd, "breakdownBillable"),
    idleBillable: b(fd, "idleBillable"),
    startDate: dt(fd, "startDate"),
    endDate: s(fd, "endDate") ? new Date(s(fd, "endDate")) : null,
    status: s(fd, "status") || "Active",
    notes: s(fd, "notes") || null,
  };
  if (!data.assetId) throw new ActionError("Asset is required");
  if (id) await db.hireContract.update({ where: { id }, data });
  else await db.hireContract.create({ data });
  refresh();
}

async function deleteContract__impl(id: string) {
  await requireAction("hire.edit");
  await db.hireContract.delete({ where: { id } });
  refresh();
}

/* ----------------------------------- logs ----------------------------------- */

/** One day of actual work. Upserted so re-entering a date corrects rather than duplicates. */
async function saveLog__impl(fd: FormData) {
  await requireAction("hire.edit");
  const contractId = s(fd, "contractId");
  if (!contractId) throw new ActionError("Contract is required");
  const date = dt(fd, "date");
  date.setHours(0, 0, 0, 0);

  const session = await getSession();
  const data = {
    present: s(fd, "present") !== "false",
    workedHours: n(fd, "workedHours"),
    idleHours: n(fd, "idleHours"),
    breakdownHours: n(fd, "breakdownHours"),
    km: n(fd, "km"),
    trips: Math.round(n(fd, "trips")),
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
  await requireAction("hire.edit");
  await db.hireLog.delete({ where: { id } });
  refresh();
}

/* -------------------------------- new features -------------------------------- */

async function saveHireInspection__impl(contractId: string, fd: FormData) {
  await requireAction("hire.edit");
  const session = await getSession();
  const data = {
    contractId,
    type: s(fd, "type") || "ON_HIRE",
    date: dt(fd, "date"),
    inspector: s(fd, "inspector") || session?.name || "Admin",
    meterValue: n(fd, "meterValue"),
    fuelLevelPct: n(fd, "fuelLevelPct") || null,
    condition: s(fd, "condition") || "GOOD",
    damages: s(fd, "damages") || null,
    status: s(fd, "status") || "SUBMITTED",
  };
  // Mocked for local testing without DB migration
  // await db.hireInspection.create({ data });
  await new Promise(r => setTimeout(r, 400));
  refresh();
}

async function saveContractAmendment__impl(contractId: string, fd: FormData) {
  await requireAction("hire.edit");
  const session = await getSession();
  const data = {
    contractId,
    effectiveDate: dt(fd, "effectiveDate"),
    previousRate: n(fd, "previousRate"),
    newRate: n(fd, "newRate"),
    reason: s(fd, "reason"),
    approvedBy: session?.name || "Admin",
  };
  // Mocked for local testing without DB migration
  // await db.hireContractAmendment.create({ data });
  // await db.hireContract.update({ where: { id: contractId }, data: { rate: data.newRate } });
  await new Promise(r => setTimeout(r, 400));
  
  refresh();
}

async function saveHirePayment__impl(fd: FormData) {
  await requireAction("hire.approve");
  const contractId = s(fd, "contractId") || null;
  const data = {
    contractId,
    vendor: s(fd, "vendor"),
    amount: n(fd, "amount"),
    type: s(fd, "type") || "ADVANCE",
    date: dt(fd, "date"),
    referenceNo: s(fd, "referenceNo") || null,
    notes: s(fd, "notes") || null,
  };
  // Mocked for local testing without DB migration
  // await db.hirePayment.create({ data });
  await new Promise(r => setTimeout(r, 400));
  refresh();
}

async function approveHireLog__impl(id: string, status: string) {
  await requireAction("hire.approve");
  const session = await getSession();
  // Mocked for local testing without DB migration
  // await db.hireLog.update({ where: { id }, data: { approvalStatus: status, approvedBy: session?.name || "Admin", approvedAt: new Date() }});
  await new Promise(r => setTimeout(r, 400));
  refresh();
}



async function deleteInspection__impl(id: string) {
  await requireAction("hire.edit");
  await new Promise(r => setTimeout(r, 200));
  refresh();
}

async function deleteAmendment__impl(id: string) {
  await requireAction("hire.edit");
  await new Promise(r => setTimeout(r, 200));
  refresh();
}

async function deletePayment__impl(id: string) {
  await requireAction("hire.approve");
  await new Promise(r => setTimeout(r, 200));
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
