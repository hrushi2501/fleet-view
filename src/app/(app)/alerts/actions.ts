"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { sweepAlerts, dueForEscalation, DEFAULT_ALERT_RULES, type AlertRuleLite, type SweepInput } from "@/lib/alerts";
import { pmDue, type ScheduleLite } from "@/lib/maintenance";
import { allocationConflicts, mobilizationStats, type AllocationLite, type MobLite } from "@/lib/operations";
import { requireAction, safe } from "@/lib/guard";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k) ?? 0) || 0;

function refresh() {
  revalidatePath("/alerts");
  revalidatePath("/reports");
}

/**
 * Kept from the original build so the existing AlertsClient keeps working;
 * now also stamps who acted and when, which M18's response-time stats need.
 */
async function updateAlert__impl(id: string, status: "Acknowledged" | "Resolved") {
  await requireAction("maintenance.edit");
  const session = await getSession();
  await db.alert.update({
    where: { id },
    data: {
      status,
      ...(status === "Acknowledged" ? { acknowledgedBy: session?.name ?? null, acknowledgedAt: new Date() } : {}),
      ...(status === "Resolved" ? { resolvedAt: new Date() } : {}),
    },
  });
  revalidatePath("/alerts");
  revalidatePath("/");
}

async function acknowledgeAlert__impl(id: string) {
  await requireAction("maintenance.edit");
  const session = await getSession();
  await db.alert.update({
    where: { id },
    data: { status: "Acknowledged", acknowledgedBy: session?.name ?? null, acknowledgedAt: new Date() },
  });
  refresh();
}

async function resolveAlert__impl(id: string) {
  await requireAction("maintenance.edit");
  await db.alert.update({ where: { id }, data: { status: "Resolved", resolvedAt: new Date() } });
  refresh();
}

async function escalateAlert__impl(id: string) {
  await requireAction("maintenance.edit");
  const session = await getSession();
  await db.alert.update({
    where: { id },
    data: { escalatedAt: new Date(), acknowledgedBy: session?.name ?? null },
  });
  refresh();
}

async function assignAlert__impl(id: string, supervisor: string) {
  await requireAction("maintenance.edit");
  const session = await getSession();
  await db.alert.update({
    where: { id },
    data: {
      assignedTo: supervisor,
      acknowledgedBy: session?.name ?? null,
      acknowledgedAt: new Date(),
      status: "Acknowledged",
    },
  });
  refresh();
}

async function seedAlertRules__impl() {
  await requireAction("admin.settings");
  for (const r of DEFAULT_ALERT_RULES) {
    await db.alertRule.upsert({
      where: { code: r.code },
      create: {
        code: r.code, name: r.name, category: r.category, description: r.description,
        severity: r.severity, threshold: r.threshold, thresholdUnit: r.thresholdUnit || null,
        escalateAfterHours: r.escalateAfterHours, escalateToRole: r.escalateToRole,
      },
      update: { name: r.name, description: r.description },
    });
  }
  refresh();
  return { ok: true as const, count: DEFAULT_ALERT_RULES.length };
}

async function updateAlertRule__impl(id: string, fd: FormData) {
  await requireAction("admin.settings");
  await db.alertRule.update({
    where: { id },
    data: {
      threshold: n(fd, "threshold"),
      severity: s(fd, "severity") || "Warning",
      enabled: fd.get("enabled") === "on" || fd.get("enabled") === "true",
      escalateAfterHours: Math.max(1, Math.round(n(fd, "escalateAfterHours"))) || 24,
      channels: fd.getAll("channels").map(String).join(",") || "IN_APP",
    },
  });
  await audit({ action: "CONFIG", module: "ADMIN", entity: "AlertRule", entityId: id, summary: "Alert rule tuned" });
  refresh();
}

/**
 * Sweep every module for alert conditions. Idempotent via dedupeKey, so running
 * it on a schedule refreshes existing alerts rather than posting duplicates.
 */
async function runAlertSweep__impl() {
  await requireAction("maintenance.edit");
  let rules = await db.alertRule.findMany();
  if (rules.length === 0) { await seedAlertRules__impl(); rules = await db.alertRule.findMany(); }
  const ruleLites: AlertRuleLite[] = rules.map((r) => ({
    code: r.code, enabled: r.enabled, threshold: r.threshold, severity: r.severity,
    escalateAfterHours: r.escalateAfterHours, channels: r.channels,
  }));

  const [docs, drivers, schedules, tanks, anomalies, tyres, allocations, mobs, cases] = await Promise.all([
    db.complianceDoc.findMany({ include: { asset: { select: { code: true } } } }),
    db.driver.findMany(),
    db.maintenanceSchedule.findMany({ where: { active: true }, include: { asset: true } }),
    db.fuelTank.findMany(),
    db.fuelAnomaly.findMany(),
    db.tyre.findMany({ where: { status: "IN_USE" }, include: { asset: { select: { code: true } } } }),
    db.allocation.findMany({ include: { asset: { select: { code: true } } } }),
    db.mobilizationOrder.findMany(),
    db.fraudCase.findMany({ where: { status: { in: ["OPEN", "INVESTIGATING"] } } }),
  ]);

  const now = new Date();

  const pmList = schedules.filter((x) => x.asset).map((x) => {
    const lite: ScheduleLite = {
      id: x.id, taskName: x.taskName, intervalKm: x.intervalKm, intervalHours: x.intervalHours,
      intervalDays: x.intervalDays, lastDoneMeter: x.lastDoneMeter, lastDoneDate: x.lastDoneDate, estimatedCost: x.estimatedCost,
    };
    const due = pmDue(lite, x.asset!.meterValue, x.asset!.primaryMeter === "SMU", now);
    return { scheduleId: x.id, assetId: x.assetId!, assetCode: x.asset!.code, taskName: x.taskName, overdue: due.status === "overdue" };
  });

  const allocLites: AllocationLite[] = allocations.map((a) => ({
    id: a.id, assetId: a.assetId, projectId: a.projectId, siteId: a.siteId,
    fromDate: a.fromDate, toDate: a.toDate, status: a.status, ratePerDay: a.ratePerDay,
  }));
  const codeOf = new Map(allocations.map((a) => [a.assetId, a.asset.code]));
  const conflicts = allocationConflicts(allocLites).map((c) => ({
    assetId: c.assetId, assetCode: codeOf.get(c.assetId) ?? "—", message: c.message,
  }));

  const mobStats = mobilizationStats(mobs.map((m): MobLite => ({
    id: m.id, status: m.status, requestedDate: m.requestedDate, dispatchDate: m.dispatchDate,
    arrivalDate: m.arrivalDate, cost: m.cost, distanceKm: m.distanceKm, transportMode: m.transportMode,
  })), now);
  const mobAsset = new Map(mobs.map((m) => [m.id, m.assetId]));

  const input: SweepInput = {
    rules: ruleLites,
    docs: docs.map((d) => ({ id: d.id, assetId: d.assetId, assetCode: d.asset.code, docType: d.docType, expiryDate: d.expiryDate })),
    drivers: drivers.map((d) => ({ id: d.id, name: d.name, licenseExpiry: d.licenseExpiry, status: d.status })),
    pmDue: pmList,
    tanks: tanks.map((t) => ({ id: t.id, name: t.name, currentLevel: t.currentLevel, minLevel: t.minLevel })),
    fuelAnomalies: anomalies.map((a) => ({ id: a.id, litres: a.litres, status: a.status, reasons: a.reasons })),
    tyres: tyres.map((t) => ({ id: t.id, serialNo: t.serialNo, assetId: t.assetId, assetCode: t.asset?.code ?? null, treadMm: t.currentTreadMm })),
    allocConflicts: conflicts,
    staleMobs: mobStats.stale.map((m) => ({
      id: m.id, assetId: mobAsset.get(m.id) ?? "", assetCode: "—",
      days: (now.getTime() - m.requestedDate.getTime()) / 86400000,
    })),
    ageingCases: cases.map((c) => ({ id: c.id, caseNo: c.caseNo, title: c.title, days: (now.getTime() - c.openedAt.getTime()) / 86400000 })),
  };

  const candidates = sweepAlerts(input, now);
  let created = 0, updated = 0;

  for (const c of candidates) {
    const existing = await db.alert.findUnique({ where: { dedupeKey: c.dedupeKey } });
    if (existing) {
      // Never resurrect something a human already dealt with.
      if (existing.status === "Resolved") continue;
      await db.alert.update({ where: { id: existing.id }, data: { title: c.title, message: c.message, severity: c.severity } });
      updated++;
      continue;
    }
    await db.alert.create({
      data: {
        dedupeKey: c.dedupeKey, ruleCode: c.ruleCode, category: c.category, severity: c.severity,
        title: c.title, message: c.message, assetId: c.assetId ?? null, driverId: c.driverId ?? null,
        dueDate: c.dueDate ?? null, actionUrl: c.actionUrl ?? null,
      },
    });
    created++;
  }

  // Escalate anything that has sat unacknowledged past its rule's patience.
  const open = await db.alert.findMany({ where: { status: "Open" } });
  const toEscalate = dueForEscalation(
    open.map((a) => ({ id: a.id, ruleCode: a.ruleCode, severity: a.severity, createdAt: a.createdAt, status: a.status, escalatedAt: a.escalatedAt, title: a.title })),
    ruleLites, now
  );
  for (const e of toEscalate) await db.alert.update({ where: { id: e.id }, data: { escalatedAt: now } });

  for (const r of rules) {
    const hits = candidates.filter((c) => c.ruleCode === r.code).length;
    if (hits !== r.hits) await db.alertRule.update({ where: { id: r.id }, data: { hits } });
  }

  refresh();
  return { ok: true as const, found: candidates.length, created, updated, escalated: toEscalate.length };
}

/* ---------------------------------------------------------------------------
 * Exported actions.
 *
 * Wrapped in `safe()` so an `ActionError` comes back as `{ error }` instead of
 * being thrown — Next redacts thrown messages in production builds, which made
 * every validation message in this file invisible to the person who triggered
 * it. Return values are passed through untouched.
 * ------------------------------------------------------------------------- */
export const updateAlert = safe(updateAlert__impl);
export const acknowledgeAlert = safe(acknowledgeAlert__impl);
export const resolveAlert = safe(resolveAlert__impl);
export const escalateAlert = safe(escalateAlert__impl);
export const assignAlert = safe(assignAlert__impl);
export const seedAlertRules = safe(seedAlertRules__impl);
export const updateAlertRule = safe(updateAlertRule__impl);
export const runAlertSweep = safe(runAlertSweep__impl);
