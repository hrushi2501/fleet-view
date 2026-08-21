"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { getSession } from "@/lib/auth";
import { getDieselRate } from "@/lib/settings";
import { reconcileTank, scoreTankRecon, type TankLite } from "@/lib/fuel-recon";
import { requireAction } from "@/lib/guard";
import { transition } from "@/lib/transition";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k) ?? 0) || 0;
const d = (fd: FormData, k: string) => (s(fd, k) ? new Date(s(fd, k)) : new Date());

async function uploadPhoto(file: FormDataEntryValue | null, prefix: string): Promise<string | null> {
  if (!file || typeof file === "string") return null;
  const f = file as File;
  if (!f.size) return null;
  const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
  const blob = await put(`fuel/${prefix}-${Date.now()}.${ext}`, f, { access: "public", addRandomSuffix: true });
  return blob.url;
}

function refresh() {
  revalidatePath("/fuel");
  revalidatePath("/fuel/tanks");
  revalidatePath("/fuel/reconciliation");
  revalidatePath("/fuel/anomalies");
}

/* --------------------------------- tanks --------------------------------- */

export async function saveTank(id: string | null, fd: FormData) {
  await requireAction("fuel.receipt");
  const data = {
    name: s(fd, "name"),
    location: s(fd, "location"),
    capacity: n(fd, "capacity"),
    minLevel: n(fd, "minLevel"),
    openingLevel: n(fd, "openingLevel"),
    projectId: s(fd, "projectId") || null,
    status: s(fd, "status") || "Active",
    code: s(fd, "code") || null,
  };
  if (id) await db.fuelTank.update({ where: { id }, data });
  else await db.fuelTank.create({ data: { ...data, currentLevel: data.openingLevel } });
  refresh();
}

export async function deleteTank(id: string) {
  await requireAction("fuel.reconcile");
  await db.fuelTank.delete({ where: { id } });
  refresh();
}

/* -------------------------------- receipts -------------------------------- */

/** Bulk diesel delivery in. Shortfall (invoiced − actually dipped in) is the control point. */
export async function saveReceipt(fd: FormData) {
  await requireAction("fuel.receipt");
  const qtyInvoiced = n(fd, "qtyInvoiced");
  const qtyReceived = n(fd, "qtyReceived") || qtyInvoiced;
  const rate = n(fd, "rate") || (await getDieselRate());
  const tankId = s(fd, "tankId");
  if (!tankId) throw new Error("Tank is required");

  const photo = await uploadPhoto(fd.get("invoicePhoto"), "receipt");
  const session = await getSession();
  const shortfall = Math.max(0, qtyInvoiced - qtyReceived);

  // Wrap in ACID transaction for database consistency
  await db.$transaction(async (tx) => {
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
    await tx.fuelTank.update({ where: { id: tankId }, data: { currentLevel: { increment: qtyReceived } } });

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

export async function deleteReceipt(id: string) {
  await requireAction("fuel.receipt");
  await db.$transaction(async (tx) => {
    const r = await tx.fuelReceipt.findUnique({ where: { id } });
    if (r) {
      await tx.fuelTank.update({ where: { id: r.tankId }, data: { currentLevel: { decrement: r.qtyReceived } } });
      await tx.fuelReceipt.delete({ where: { id } });
    }
  });
  refresh();
}

/* ---------------------------------- dips ---------------------------------- */

/** Physical dipstick reading — the ground truth. Re-anchors the tank's book balance. */
export async function saveDip(fd: FormData) {
  await requireAction("fuel.receipt");
  const tankId = s(fd, "tankId");
  if (!tankId) throw new Error("Tank is required");
  const level = n(fd, "level");
  const photo = await uploadPhoto(fd.get("photo"), "dip");
  const session = await getSession();

  await db.$transaction(async (tx) => {
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

export async function deleteDip(id: string) {
  await requireAction("fuel.receipt");
  await db.tankDip.delete({ where: { id } });
  refresh();
}


/* ------------------------------ reconciliation ------------------------------ */

/**
 * Run reconciliation for one tank over a window and persist the result.
 * Raises/updates an anomaly when the gap is beyond tolerance.
 */
export async function runReconciliation(tankId: string, fromStr?: string, toStr?: string) {
  await requireAction("fuel.reconcile");
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
  if (!tank) throw new Error("Tank not found");

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

  await db.$transaction(async (tx) => {


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
export async function setReconStatus(id: string, status: string, notes?: string) {
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

export async function updateAnomaly(id: string, fd: FormData) {
  await requireAction("fuel.approve");
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

export async function saveNorm(fd: FormData) {
  await requireAction("fuel.reconcile");
  const assetClass = s(fd, "assetClass") || null;
  const unit = s(fd, "unit") || "KMPL";
  const data = {
    normLow: n(fd, "normLow"),
    normHigh: n(fd, "normHigh"),
    tolerancePct: n(fd, "tolerancePct") || 15,
  };
  if (!assetClass) throw new Error("Asset class is required");
  await db.consumptionNorm.upsert({
    where: { assetClass_unit: { assetClass, unit } },
    create: { assetClass, unit, ...data },
    update: data,
  });
  refresh();
}
