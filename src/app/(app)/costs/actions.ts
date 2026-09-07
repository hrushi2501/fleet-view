"use server";

import { db } from "@/lib/db";
import { formNumber } from "@/lib/input-validation";
import { assertFormAccess, assertRecordAccess } from "@/lib/record-access";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { parseBusinessDay, businessMonth } from "@/lib/business-time";
import { requireAction, ActionError, safe } from "@/lib/guard";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = formNumber;

function refresh() {
  revalidatePath("/costs");
  revalidatePath("/projects");
  revalidatePath("/sites");
}

/** Manual cost line — tyres, insurance, EMI, tolls. Fuel/maintenance/hire come from their modules. */
async function saveCost__impl(fd: FormData) {
  const scopeAccess = await requireAction("cost.edit");
  await assertFormAccess(scopeAccess, fd);
  const amount = n(fd, "amount");
  if (amount <= 0) throw new ActionError("Cost amount must be greater than zero");

  const date = parseBusinessDay(s(fd, "date"));
  await db.costTransaction.create({
    data: {
      assetId: s(fd, "assetId") || null,
      projectId: s(fd, "projectId") || null,
      costHead: s(fd, "costHead") || "OTHER",
      amount,
      period: businessMonth(date),
      date,
    },
  });
  refresh();
}

async function deleteCost__impl(id: string) {
  const scopeAccess = await requireAction("cost.edit");
  await assertRecordAccess(scopeAccess, "costTransaction", id);
  const session = await getSession();
  if (!session) throw new ActionError("Not authenticated");

  const target = await db.costTransaction.findUnique({ where: { id }, include: { asset: true, project: true } });
  if (target) {
    await db.auditEvent.create({
      data: {
        actorId: session.id,
        actorName: session.name,
        actorRole: session.role,
        action: "DELETE",
        module: "COSTS",
        entity: "costTransaction",
        entityId: id,
        summary: `Deleted manual cost line of ${target.amount} under head ${target.costHead} for ${target.asset?.code ?? target.project?.code ?? "Fleet"}`,
      },
    });
    await db.costTransaction.delete({ where: { id } });
  }
  refresh();
}

/** Money in on a project — RA bills, advances, retention released. */
async function saveRevenue__impl(fd: FormData) {
  const scopeAccess = await requireAction("cost.edit");
  await assertFormAccess(scopeAccess, fd);
  const projectId = s(fd, "projectId");
  if (!projectId) throw new ActionError("Project is required");
  const amount = n(fd, "amount");
  if (amount <= 0) throw new ActionError("Revenue amount must be greater than zero");

  const date = parseBusinessDay(s(fd, "date"));
  await db.projectRevenue.create({
    data: {
      projectId,
      description: s(fd, "description"),
      amount,
      billType: s(fd, "billType") || "RA_BILL",
      period: businessMonth(date),
      date,
    },
  });
  refresh();
}

async function deleteRevenue__impl(id: string) {
  const scopeAccess = await requireAction("cost.edit");
  await assertRecordAccess(scopeAccess, "projectRevenue", id);
  const session = await getSession();
  if (!session) throw new ActionError("Not authenticated");

  const target = await db.projectRevenue.findUnique({ where: { id }, include: { project: true } });
  if (target) {
    await db.auditEvent.create({
      data: {
        actorId: session.id,
        actorName: session.name,
        actorRole: session.role,
        action: "DELETE",
        module: "REPORTS",
        entity: "projectRevenue",
        entityId: id,
        summary: `Deleted project revenue of ${target.amount} for project ${target.project.code} (${target.description})`,
      },
    });
    await db.projectRevenue.delete({ where: { id } });
  }
  refresh();
}

/** Depreciation basis for an asset — drives book value and replace-vs-repair. */
async function saveDepreciation__impl(assetId: string, fd: FormData) {
  const scopeAccess = await requireAction("cost.edit");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "asset", assetId);
  const acquisitionCost = n(fd, "acquisitionCost");
  const salvageValue = n(fd, "salvageValue");

  if (acquisitionCost < 0 || salvageValue < 0) {
    throw new ActionError("Acquisition cost and salvage value cannot be negative");
  }
  if (salvageValue > acquisitionCost) {
    throw new ActionError("Salvage value cannot exceed original acquisition cost");
  }

  await db.asset.update({
    where: { id: assetId },
    data: {
      acquisitionCost,
      salvageValue,
      usefulLifeYears: Math.max(1, Math.round(n(fd, "usefulLifeYears"))),
      depMethod: s(fd, "depMethod") || "SLM",
      inServiceDate: s(fd, "inServiceDate") ? new Date(s(fd, "inServiceDate")) : null,
    },
  });
  revalidatePath("/costs");
  revalidatePath(`/fleet/${assetId}`);
}

/* ---------------------------------------------------------------------------
 * Exported actions.
 *
 * Wrapped in `safe()` so an `ActionError` comes back as `{ error }` instead of
 * being thrown — Next redacts thrown messages in production builds, which made
 * every validation message in this file invisible to the person who triggered
 * it. Return values are passed through untouched.
 * ------------------------------------------------------------------------- */
export const saveCost = safe(saveCost__impl);
export const deleteCost = safe(deleteCost__impl);
export const saveRevenue = safe(saveRevenue__impl);
export const deleteRevenue = safe(deleteRevenue__impl);
export const saveDepreciation = safe(saveDepreciation__impl);
