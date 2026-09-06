"use server";

import { db } from "@/lib/db";
import { businessTransaction } from "@/lib/business-transaction";
import { formNumber, positiveNumber } from "@/lib/input-validation";
import { assertRecordAccess, assertFormAccess, assertGlobalAccess, fuelAnomalyScope } from "@/lib/record-access";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { getDieselRate } from "@/lib/settings";
import { reconcileTank, scoreTankRecon, type TankLite } from "@/lib/fuel-recon";
import { requireAction, ActionError, safe } from "@/lib/guard";
import { transition } from "@/lib/transition";
import { uploadPrivateFile } from "@/lib/private-upload";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = formNumber;
const d = (fd: FormData, k: string) => (s(fd, k) ? new Date(s(fd, k)) : new Date());

async function uploadPhoto(file: FormDataEntryValue | null, prefix: string): Promise<string | null> {
  if (!file || typeof file === "string") return null;
  const f = file as File;
  if (!f.size) return null;
  return uploadPrivateFile(f, { folder: `fuel-${prefix}`, kind: "image" });
}

function refresh() {
  revalidatePath("/fuel");
  revalidatePath("/fuel/tanks");
  revalidatePath("/fuel/reconciliation");
  revalidatePath("/fuel/anomalies");
}

/* --------------------------------- tanks --------------------------------- */

async function saveTank__impl(id: string | null, fd: FormData) {
  const scopeAccess = await requireAction("fuel.receipt");
  await assertFormAccess(scopeAccess, fd);
  if (id) await assertRecordAccess(scopeAccess, "fuelTank", id);
  const capacity = positiveNumber(fd.get("capacity"), "Tank capacity");
  const minLevel = n(fd, "minLevel");
  const openingLevel = n(fd, "openingLevel");
  if (minLevel < 0 || openingLevel < 0 || minLevel > capacity || openingLevel > capacity) throw new ActionError("Tank levels must be within tank capacity.");
  const data = {
    name: s(fd, "name"),
    location: s(fd, "location"),
    capacity,
    minLevel,
    openingLevel,
    projectId: s(fd, "projectId") || null,
    status: s(fd, "status") || "Active",
    code: s(fd, "code") || null,
  };
  if (id) await db.fuelTank.update({ where: { id }, data });
  else await db.fuelTank.create({ data: { ...data, currentLevel: data.openingLevel } });
  refresh();
}

async function deleteTank__impl(id: string) {
  const scopeAccess = await requireAction("fuel.reconcile");
  await assertRecordAccess(scopeAccess, "fuelTank", id);
  await db.fuelTank.delete({ where: { id } });
  refresh();
}

/* -------------------------------- receipts -------------------------------- */

/** Bulk diesel delivery in. Shortfall (invoiced − actually dipped in) is the control point. */
async function saveReceipt__impl(fd: FormData) {
  const scopeAccess = await requireAction("fuel.receipt");
  await assertFormAccess(scopeAccess, fd);
  const qtyInvoiced = n(fd, "qtyInvoiced");
  const enteredReceived = n(fd, "qtyReceived");
  const qtyReceived = enteredReceived === 0 ? qtyInvoiced : enteredReceived;
  const enteredRate = n(fd, "rate");
  const rate = enteredRate === 0 ? await getDieselRate() : enteredRate;
  const tankId = s(fd, "tankId");
  if (!tankId) throw new ActionError("Tank is required");
  if (qtyInvoiced <= 0 || qtyReceived <= 0 || rate <= 0 || qtyReceived > qtyInvoiced) throw new ActionError("Receipt quantities and rate must be positive, and received fuel cannot exceed the invoice.");
  const tank = await db.fuelTank.findFirst({ where: { id: tankId }, select: { capacity: true } });
  if (!tank) throw new ActionError("Tank not found");

  const photo = await uploadPhoto(fd.get("invoicePhoto"), "receipt");
  const session = await getSession();
  const shortfall = Math.max(0, qtyInvoiced - qtyReceived);

  // Wrap in ACID transaction for database consistency
  await businessTransaction(scopeAccess.session, async (tx) => {
    await tx.fuelReceipt.create({
      data: {
        tankId,
        supplier: s(fd, "supplier"),
        invoiceNo: s(fd, "invoiceNo") || null,
        qtyInvoiced,
        qtyReceived,
        rate,
        amount: n(fd, "amount") || qtyInvoiced * rate,
        flowMeterStart: n(fd, "flowMeterStart"),
        flowMeterEnd: n(fd, "flowMeterEnd"),
        weighbridgeNet: n(fd, "weighbridgeNet"),
        tankerNo: s(fd, "tankerNo") || null,
        invoicePhoto: photo,
        receivedBy: s(fd, "receivedBy") || session?.name || null,
        shortfall,
        date: d(fd, "date"),
      },
    });

    // Book balance moves on litres actually received
    const credited = await tx.fuelTank.updateMany({ where: { id: tankId, currentLevel: { lte: tank.capacity - qtyReceived } }, data: { currentLevel: { increment: qtyReceived } } });
    if (credited.count !== 1) throw new ActionError("The receipt would exceed the selected tank's capacity.");

    if (shortfall > 0) {
      await tx.fuelAnomaly.create({
        data: {
          source: "RECEIPT",
          refId: `${tankId}:${Date.now()}`,
          tankId,
          severity: shortfall > 100 ? "HIGH" : "MEDIUM",
          score: Math.min(100, Math.round((shortfall / Math.max(1, qtyInvoiced)) * 300)),
          litres: shortfall,
          valueAtRisk: shortfall * rate,
          reasons: `Supplier ${s(fd, "supplier")} invoiced ${qtyInvoiced} L but only ${qtyReceived} L was dipped into the tank.\nShortfall ${shortfall.toFixed(0)} L.`,
        },
      });
    }
  });

  refresh();
}

async function deleteReceipt__impl(id: string) {
  const scopeAccess = await requireAction("fuel.receipt");
  await assertRecordAccess(scopeAccess, "fuelReceipt", id);
  await businessTransaction(scopeAccess.session, async (tx) => {
    const r = await tx.fuelReceipt.findUnique({ where: { id } });
    if (r) {
      const reversed = await tx.fuelTank.updateMany({ where: { id: r.tankId, currentLevel: { gte: r.qtyReceived } }, data: { currentLevel: { decrement: r.qtyReceived } } });
      if (reversed.count !== 1) throw new ActionError("Receipt cannot be removed because its fuel has already been issued.");
      await tx.fuelReceipt.delete({ where: { id } });
    }
  });
  refresh();
}

/* ---------------------------------- dips ---------------------------------- */

/** Physical dipstick reading — the ground truth. Re-anchors the tank's book balance. */
async function saveDip__impl(fd: FormData) {
  const scopeAccess = await requireAction("fuel.receipt");
  await assertFormAccess(scopeAccess, fd);
  const tankId = s(fd, "tankId");
  if (!tankId) throw new ActionError("Tank is required");
  const level = n(fd, "level");
  if (level < 0) throw new ActionError("Dip level cannot be negative.");
  const tank = await db.fuelTank.findFirst({ where: { id: tankId }, select: { capacity: true } });
  if (!tank || level > tank.capacity) throw new ActionError("Dip level must be within tank capacity.");
  const photo = await uploadPhoto(fd.get("photo"), "dip");
  const session = await getSession();

  await businessTransaction(scopeAccess.session, async (tx) => {
    await tx.tankDip.create({
      data: {
        tankId,
        level,
        readBy: s(fd, "readBy") || session?.name || null,
        note: s(fd, "note") || null,
        photo,
        date: d(fd, "date"),
      },
    });
    await tx.fuelTank.update({ where: { id: tankId }, data: { currentLevel: level } });
  });
  refresh();
}

async function deleteDip__impl(id: string) {
  const scopeAccess = await requireAction("fuel.receipt");
  await assertRecordAccess(scopeAccess, "tankDip", id);
  await db.tankDip.delete({ where: { id } });
  refresh();
}


/* ------------------------------ reconciliation ------------------------------ */

/**
 * Run reconciliation for one tank over a window and persist the result.
 * Raises/updates an anomaly when the gap is beyond tolerance.
 */
async function runReconciliation__impl(tankId: string, fromStr?: string, toStr?: string) {
  const scopeAccess = await requireAction("fuel.reconcile");
  await assertRecordAccess(scopeAccess, "fuelTank", tankId);
  const from = fromStr ? new Date(fromStr) : undefined;
  const to = toStr ? new Date(toStr) : undefined;

  const tank = await db.fuelTank.findUnique({
    where: { id: tankId },
    include: {
      receipts: true,
      dips: true,
      issues: { where: { type: "ISSUE" } },
    },
  });
  if (!tank) throw new ActionError("Tank not found");

  const lite: TankLite = { id: tank.id, name: tank.name, location: tank.location, capacity: tank.capacity, minLevel: tank.minLevel };
  const recon = reconcileTank(
    lite,
    tank.receipts.map((r) => ({ id: r.id, date: r.date, qtyInvoiced: r.qtyInvoiced, qtyReceived: r.qtyReceived, amount: r.amount, supplier: r.supplier, shortfall: r.shortfall })),
    tank.issues.map((i) => ({ id: i.id, date: i.date, quantity: i.quantity, assetId: i.assetId, amount: i.amount })),
    tank.dips.map((p) => ({ id: p.id, date: p.date, level: p.level })),
    from,
    to
  );

  if (recon.status === "insufficient") return { ok: false as const, message: recon.reasons[0] };

  const session = await getSession();
  const rate = await getDieselRate();
  const anomaly = scoreTankRecon(recon, rate);

  await businessTransaction(scopeAccess.session, async (tx) => {


    await tx.fuelReconciliation.create({
      data: {
        tankId,
        periodStart: recon.periodStart,
        periodEnd: recon.periodEnd,
        openingDip: recon.openingDip,
        receiptsL: recon.receiptsL,
        issuesL: recon.issuesL,
        expectedClosing: recon.expectedClosing,
        actualClosing: recon.closingDip ?? 0,
        varianceL: recon.varianceL,
        variancePct: recon.variancePct,
        status: recon.status === "ok" ? "CLOSED" : "OPEN",
        notes: recon.reasons.join("\n") || null,
        closedBy: session?.name ?? null,
      },
    });

    if (anomaly) {
      await tx.fuelAnomaly.upsert({
        where: { source_refId: { source: anomaly.source, refId: anomaly.refId } },
        create: {
          source: anomaly.source,
          refId: anomaly.refId,
          tankId: anomaly.tankId ?? null,
          severity: anomaly.severity,
          score: anomaly.score,
          litres: anomaly.litres,
          valueAtRisk: anomaly.valueAtRisk,
          reasons: anomaly.reasons.join("\n"),
        },
        update: {
          severity: anomaly.severity,
          score: anomaly.score,
          litres: anomaly.litres,
          valueAtRisk: anomaly.valueAtRisk,
          reasons: anomaly.reasons.join("\n"),
        },
      });
    }
  });

  refresh();

  return { ok: true as const, varianceL: recon.varianceL, status: recon.status };
}

/**
 * Move a reconciliation through its stages.
 *
 * Routed through `transition()` rather than writing `status` directly, because
 * the two moves are not the same control: recording an explanation or escalating
 * a gap needs `fuel.reconcile`, but *closing* one needs `fuel.approve`. The
 * single `requireAction("fuel.reconcile")` that used to sit here let whoever ran
 * the reconciliation also sign it off — the exact pairing `SOD_CONFLICTS` names
 * as "can issue diesel and sign off the reconciliation that would expose a gap".
 */
async function setReconStatus__impl(id: string, status: string, notes?: string) {
  const session = await getSession();
  await transition({
    entity: "FuelReconciliation",
    id,
    to: status,
    note: notes,
    data: {
      ...(notes ? { notes } : {}),
      // Only stamp the closer on the move that actually closes it.
      ...(status === "CLOSED" ? { closedBy: session?.name ?? null } : {}),
    },
  });
  refresh();
}

/* -------------------------------- anomalies -------------------------------- */

async function updateAnomaly__impl(id: string, fd: FormData) {
  const scopeAccess = await requireAction("fuel.approve");
  const visible = await db.fuelAnomaly.findFirst({ where: { id, ...await fuelAnomalyScope(scopeAccess) }, select: { id: true } });
  if (!visible) throw new ActionError("This anomaly is unavailable or outside your assigned sites.");
  const status = s(fd, "status");
  const session = await getSession();
  await db.fuelAnomaly.update({
    where: { id },
    data: {
      status,
      resolution: s(fd, "resolution") || null,
      recovered: n(fd, "recovered"),
      assignedTo: s(fd, "assignedTo") || session?.name || null,
      resolvedAt: status === "OPEN" || status === "INVESTIGATING" ? null : new Date(),
    },
  });
  refresh();
}

/* ---------------------------------- norms ---------------------------------- */

async function saveNorm__impl(fd: FormData) {
  const scopeAccess = await requireAction("fuel.reconcile");
  await assertFormAccess(scopeAccess, fd);
  assertGlobalAccess(scopeAccess);
  const assetClass = s(fd, "assetClass") || null;
  const unit = s(fd, "unit") || "KMPL";
  const data = {
    normLow: n(fd, "normLow"),
    normHigh: n(fd, "normHigh"),
    tolerancePct: n(fd, "tolerancePct") || 15,
  };
  if (!assetClass) throw new ActionError("Asset class is required");
  await db.consumptionNorm.upsert({
    where: { assetClass_unit: { assetClass, unit } },
    create: { assetClass, unit, ...data },
    update: data,
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
export const saveTank = safe(saveTank__impl);
export const deleteTank = safe(deleteTank__impl);
export const saveReceipt = safe(saveReceipt__impl);
export const deleteReceipt = safe(deleteReceipt__impl);
export const saveDip = safe(saveDip__impl);
export const deleteDip = safe(deleteDip__impl);
export const runReconciliation = safe(runReconciliation__impl);
export const setReconStatus = safe(setReconStatus__impl);
export const updateAnomaly = safe(updateAnomaly__impl);
export const saveNorm = safe(saveNorm__impl);
