"use server";

import { db } from "@/lib/db";
import {
  boundedNumber,
  nonNegativeNumber,
  safeParseDate,
  sanitizeString,
  sanitizeOptionalString,
  sanitizeId,
  oneOf,
} from "@/lib/input-validation";
import { assertFormAccess, assertRecordAccess, assertGlobalAccess } from "@/lib/record-access";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { DEFAULT_PROD_NORMS } from "@/lib/production";
import { parseBusinessDay } from "@/lib/business-time";
import { requireAction, ActionError, safe } from "@/lib/guard";

const s = (fd: FormData, k: string) => sanitizeString(fd.get(k), k);
const sOrNull = (fd: FormData, k: string) => sanitizeOptionalString(fd.get(k), k);

function refresh() {
  revalidatePath("/production");
  revalidatePath("/costs");
  revalidatePath("/projects");
  revalidatePath("/sites");
}

/** One shift of output for one machine. Upserted, so a correction overwrites. */
async function saveProduction__impl(fd: FormData) {
  const scopeAccess = await requireAction("production.edit");
  await assertFormAccess(scopeAccess, fd);
  const assetId = sanitizeId(s(fd, "assetId"), "Asset ID");
  if (!assetId) throw new ActionError("Asset is required");

  const rawDate = s(fd, "date");
  if (rawDate) {
    safeParseDate(rawDate, "Production date");
  }
  const date = parseBusinessDay(rawDate);
  date.setHours(0, 0, 0, 0);

  const shift = oneOf(s(fd, "shift") || "DAY", ["DAY", "NIGHT", "GENERAL"], "Shift");
  const session = await getSession();

  const trips = boundedNumber(fd.get("trips"), "Trips", { min: 0, max: 1_000, integer: true, fallback: 0 });
  const cycles = boundedNumber(fd.get("cycles"), "Cycles", { min: 0, max: 5_000, integer: true, fallback: 0 });
  const tonnage = nonNegativeNumber(fd.get("tonnage"), "Tonnage", { max: 100_000, fallback: 0 });
  const volumeM3 = nonNegativeNumber(fd.get("volumeM3"), "Volume (m³)", { max: 100_000, fallback: 0 });
  const workedHours = boundedNumber(fd.get("workedHours"), "Worked hours", { min: 0, max: 24, fallback: 0 });
  const idleHours = boundedNumber(fd.get("idleHours"), "Idle hours", { min: 0, max: 24, fallback: 0 });

  if (workedHours + idleHours > 24) {
    throw new ActionError("Total hours (worked + idle) cannot exceed 24 hours for a single shift.");
  }

  const distanceKm = boundedNumber(fd.get("distanceKm"), "Distance", { min: 0, max: 2_000, fallback: 0 });
  const leadKm = boundedNumber(fd.get("leadKm"), "Lead distance", { min: 0, max: 500, fallback: 0 });

  const data = {
    projectId: sOrNull(fd, "projectId"),
    driverId: sOrNull(fd, "driverId"),
    material: sOrNull(fd, "material"),
    trips,
    tonnage,
    volumeM3,
    cycles,
    workedHours,
    idleHours,
    distanceKm,
    leadKm,
    source: s(fd, "source") || "MANUAL",
    verifiedBy: sOrNull(fd, "verifiedBy") || session?.name || null,
    note: sOrNull(fd, "note"),
  };

  await db.productionLog.upsert({
    where: { assetId_date_shift: { assetId, date, shift } },
    create: { assetId, date, shift, ...data },
    update: data,
  });
  refresh();
}

async function deleteProduction__impl(id: string) {
  id = sanitizeId(id, "Production Log ID");
  const scopeAccess = await requireAction("production.edit");
  await assertRecordAccess(scopeAccess, "productionLog", id);
  await db.productionLog.delete({ where: { id } });
  refresh();
}

async function saveProdNorm__impl(fd: FormData) {
  const scopeAccess = await requireAction("production.edit");
  await assertFormAccess(scopeAccess, fd);
  assertGlobalAccess(scopeAccess);
  const assetClass = s(fd, "assetClass");
  const unit = s(fd, "unit");
  if (!assetClass || !unit) throw new ActionError("Asset class and unit are required");

  const targetLow = nonNegativeNumber(fd.get("targetLow"), "Target low", { max: 10_000, fallback: 0 });
  const targetHigh = nonNegativeNumber(fd.get("targetHigh"), "Target high", { max: 10_000, fallback: 0 });
  if (targetLow > targetHigh) {
    throw new ActionError("Target low cannot exceed target high.");
  }

  const data = { targetLow, targetHigh };
  await db.productionNorm.upsert({
    where: { assetClass_unit: { assetClass, unit } },
    create: { assetClass, unit, ...data },
    update: data,
  });
  refresh();
}

/** Installs the shipped production targets. Safe to run repeatedly. */
async function seedProdNorms__impl() {
  const scopeAccess = await requireAction("production.edit");
  assertGlobalAccess(scopeAccess);
  for (const nm of DEFAULT_PROD_NORMS) {
    await db.productionNorm.upsert({
      where: { assetClass_unit: { assetClass: nm.assetClass, unit: nm.unit } },
      create: nm,
      update: {},
    });
  }
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
export const saveProduction = safe(saveProduction__impl);
export const deleteProduction = safe(deleteProduction__impl);
export const saveProdNorm = safe(saveProdNorm__impl);
export const seedProdNorms = safe(seedProdNorms__impl);
