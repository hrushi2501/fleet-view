"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { DEFAULT_PROD_NORMS } from "@/lib/production";
import { parseBusinessDay } from "@/lib/business-time";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k) ?? 0) || 0;

function refresh() {
  revalidatePath("/production");
  revalidatePath("/costs");
  revalidatePath("/projects");
  revalidatePath("/sites");
}

/** One shift of output for one machine. Upserted, so a correction overwrites. */
export async function saveProduction(fd: FormData) {
  const assetId = s(fd, "assetId");
  if (!assetId) throw new Error("Asset is required");
  const date = parseBusinessDay(s(fd, "date"));
  date.setHours(0, 0, 0, 0);
  const shift = s(fd, "shift") || "DAY";
  const session = await getSession();

  const data = {
    projectId: s(fd, "projectId") || null,
    driverId: s(fd, "driverId") || null,
    material: s(fd, "material") || null,
    trips: Math.round(n(fd, "trips")),
    tonnage: n(fd, "tonnage"),
    volumeM3: n(fd, "volumeM3"),
    cycles: Math.round(n(fd, "cycles")),
    workedHours: n(fd, "workedHours"),
    idleHours: n(fd, "idleHours"),
    distanceKm: n(fd, "distanceKm"),
    leadKm: n(fd, "leadKm"),
    source: s(fd, "source") || "MANUAL",
    verifiedBy: s(fd, "verifiedBy") || session?.name || null,
    note: s(fd, "note") || null,
  };

  await db.productionLog.upsert({
    where: { assetId_date_shift: { assetId, date, shift } },
    create: { assetId, date, shift, ...data },
    update: data,
  });
  refresh();
}

export async function deleteProduction(id: string) {
  await db.productionLog.delete({ where: { id } });
  refresh();
}

export async function saveProdNorm(fd: FormData) {
  const assetClass = s(fd, "assetClass");
  const unit = s(fd, "unit");
  if (!assetClass || !unit) throw new Error("Asset class and unit are required");
  const data = { targetLow: n(fd, "targetLow"), targetHigh: n(fd, "targetHigh") };
  await db.productionNorm.upsert({
    where: { assetClass_unit: { assetClass, unit } },
    create: { assetClass, unit, ...data },
    update: data,
  });
  refresh();
}

/** Installs the shipped production targets. Safe to run repeatedly. */
export async function seedProdNorms() {
  for (const nm of DEFAULT_PROD_NORMS) {
    await db.productionNorm.upsert({
      where: { assetClass_unit: { assetClass: nm.assetClass, unit: nm.unit } },
      create: nm,
      update: {},
    });
  }
  refresh();
}
