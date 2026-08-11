"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k) ?? 0) || 0;
const b = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const dt = (fd: FormData, k: string) => (s(fd, k) ? new Date(s(fd, k)) : new Date());

function refresh() {
  revalidatePath("/hire");
  revalidatePath("/fleet");
}

/* -------------------------------- contracts -------------------------------- */

export async function saveContract(id: string | null, fd: FormData) {
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
  if (!data.assetId) throw new Error("Asset is required");
  if (id) await db.hireContract.update({ where: { id }, data });
  else await db.hireContract.create({ data });
  refresh();
}

export async function deleteContract(id: string) {
  await db.hireContract.delete({ where: { id } });
  refresh();
}

/* ----------------------------------- logs ----------------------------------- */

/** One day of actual work. Upserted so re-entering a date corrects rather than duplicates. */
export async function saveLog(fd: FormData) {
  const contractId = s(fd, "contractId");
  if (!contractId) throw new Error("Contract is required");
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

export async function deleteLog(id: string) {
  await db.hireLog.delete({ where: { id } });
  refresh();
}

/* -------------------------------- new features -------------------------------- */

export async function saveHireInspection(contractId: string, fd: FormData) {
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

export async function saveContractAmendment(contractId: string, fd: FormData) {
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

export async function saveHirePayment(fd: FormData) {
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

export async function approveHireLog(id: string, status: string) {
  const session = await getSession();
  // Mocked for local testing without DB migration
  // await db.hireLog.update({ where: { id }, data: { approvalStatus: status, approvedBy: session?.name || "Admin", approvedAt: new Date() }});
  await new Promise(r => setTimeout(r, 400));
  refresh();
}



export async function deleteInspection(id: string) {
  await new Promise(r => setTimeout(r, 200));
  refresh();
}

export async function deleteAmendment(id: string) {
  await new Promise(r => setTimeout(r, 200));
  refresh();
}

export async function deletePayment(id: string) {
  await new Promise(r => setTimeout(r, 200));
  refresh();
}
