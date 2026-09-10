"use server";

import { db } from "@/lib/db";
import { formNumber, positiveNumber, boundedNumber, oneOf, safeParseDate, sanitizeString, sanitizeOptionalString } from "@/lib/input-validation";
import { assertFormAccess, assertRecordAccess } from "@/lib/record-access";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { parseBusinessDay, businessMonth } from "@/lib/business-time";
import { requireAction, ActionError, safe } from "@/lib/guard";

const s = (fd: FormData, k: string) => sanitizeString(fd.get(k), k);
const sOrNull = (fd: FormData, k: string) => sanitizeOptionalString(fd.get(k), k);
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
  const amount = positiveNumber(fd.get("amount"), "Cost amount", { max: 100_000_000 });

  const costHead = oneOf(
    s(fd, "costHead") || "OTHER",
    ["FUEL", "MAINTENANCE", "TYRE", "INSURANCE", "EMI", "PERMIT", "TOLL", "SALARY", "OVERHEAD", "OTHER"],
    "Cost head"
  );

  const assetId = sOrNull(fd, "assetId");
  if (assetId) {
    const asset = await db.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new ActionError("Selected asset does not exist");
  }

  const projectId = sOrNull(fd, "projectId");
  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) throw new ActionError("Selected project does not exist");
  }

  const rawDate = s(fd, "date");
  if (rawDate) {
    safeParseDate(rawDate, "Cost date");
  }
  const date = parseBusinessDay(rawDate);
  await db.costTransaction.create({
    data: {
      assetId,
      projectId,
      costHead,
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
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ActionError("Selected project does not exist");

  const amount = positiveNumber(fd.get("amount"), "Revenue amount", { max: 1_000_000_000 });
  const billType = oneOf(
    s(fd, "billType") || "RA_BILL",
    ["RA_BILL", "ADVANCE", "RETENTION_RELEASE", "OTHER"],
    "Bill type"
  );

  const rawDate = s(fd, "date");
  if (rawDate) {
    safeParseDate(rawDate, "Revenue date");
  }
  const date = parseBusinessDay(rawDate);
  await db.projectRevenue.create({
    data: {
      projectId,
      description: s(fd, "description") || "Project Revenue",
      amount,
      billType,
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

  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ActionError("Asset not found");

  const acquisitionCost = boundedNumber(fd.get("acquisitionCost"), "Acquisition cost", { min: 0, max: 1_000_000_000, fallback: 0 });
  const salvageValue = boundedNumber(fd.get("salvageValue"), "Salvage value", { min: 0, max: 1_000_000_000, fallback: 0 });

  if (salvageValue > acquisitionCost) {
    throw new ActionError("Salvage value cannot exceed original acquisition cost");
  }

  const usefulLifeYears = boundedNumber(fd.get("usefulLifeYears"), "Useful life (years)", { min: 1, max: 100, integer: true, fallback: 10 });
  const depMethod = oneOf(s(fd, "depMethod") || "SLM", ["SLM", "WDV"], "Depreciation method");

  const inServiceDateStr = s(fd, "inServiceDate");
  const inServiceDate = inServiceDateStr
    ? safeParseDate(inServiceDateStr, "In-service date", { minYear: 1980, maxYear: 2050 })
    : null;

  await db.asset.update({
    where: { id: assetId },
    data: {
      acquisitionCost,
      salvageValue,
      usefulLifeYears,
      depMethod,
      inServiceDate,
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
