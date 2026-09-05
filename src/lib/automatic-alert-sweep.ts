import "server-only";

import { db } from "@/lib/db";
import { DEFAULT_ALERT_RULES, dueForEscalation, sweepAlerts, type AlertRuleLite, type SweepInput } from "@/lib/alerts";
import { pmDue, type ScheduleLite } from "@/lib/maintenance";
import { allocationConflicts, mobilizationStats, type AllocationLite, type MobLite } from "@/lib/operations";
import { runPeriodicDatabaseAudit } from "@/lib/db-audit";

/**
 * The unattended counterpart to the Alerts screen's "Run sweep" action.
 * It is idempotent through Alert.dedupeKey, so a daily cron updates live
 * conditions instead of creating another PUC or service-expiry row each day.
 */
export async function runAutomaticAlertSweep() {
  // Concurrently run the periodic database audit, schema verification, and Setting pruning
  const dbAudit = await runPeriodicDatabaseAudit("CRON");

  let rules = await db.alertRule.findMany();
  if (rules.length === 0) {
    for (const rule of DEFAULT_ALERT_RULES) {
      await db.alertRule.upsert({
        where: { code: rule.code },
        create: {
          code: rule.code,
          name: rule.name,
          category: rule.category,
          description: rule.description,
          severity: rule.severity,
          threshold: rule.threshold,
          thresholdUnit: rule.thresholdUnit || null,
          escalateAfterHours: rule.escalateAfterHours,
          escalateToRole: rule.escalateToRole,
        },
        update: { name: rule.name, description: rule.description },
      });
    }
    rules = await db.alertRule.findMany();
  }

  const ruleLites: AlertRuleLite[] = rules.map((rule) => ({
    code: rule.code,
    enabled: rule.enabled,
    threshold: rule.threshold,
    severity: rule.severity,
    escalateAfterHours: rule.escalateAfterHours,
    channels: rule.channels,
  }));

  // One interactive transaction is important for Supabase's transaction pooler:
  // alert collection is read-heavy, and separate Promise.all connections can
  // starve the same authentication requests that render the office UI.
  const [docs, drivers, schedules, tanks, anomalies, tyres, allocations, mobs, cases] = await db.$transaction([
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
  const pmList = schedules.filter((schedule) => schedule.asset).map((schedule) => {
    const lite: ScheduleLite = {
      id: schedule.id,
      taskName: schedule.taskName,
      intervalKm: schedule.intervalKm,
      intervalHours: schedule.intervalHours,
      intervalDays: schedule.intervalDays,
      lastDoneMeter: schedule.lastDoneMeter,
      lastDoneDate: schedule.lastDoneDate,
      estimatedCost: schedule.estimatedCost,
    };
    const due = pmDue(lite, schedule.asset!.meterValue, schedule.asset!.primaryMeter === "SMU", now);
    return {
      scheduleId: schedule.id,
      assetId: schedule.assetId!,
      assetCode: schedule.asset!.code,
      taskName: schedule.taskName,
      overdue: due.status === "overdue",
    };
  });

  const allocLites: AllocationLite[] = allocations.map((allocation) => ({
    id: allocation.id,
    assetId: allocation.assetId,
    projectId: allocation.projectId,
    siteId: allocation.siteId,
    fromDate: allocation.fromDate,
    toDate: allocation.toDate,
    status: allocation.status,
    ratePerDay: allocation.ratePerDay,
  }));
  const codeOf = new Map(allocations.map((allocation) => [allocation.assetId, allocation.asset.code]));
  const conflicts = allocationConflicts(allocLites).map((conflict) => ({
    assetId: conflict.assetId,
    assetCode: codeOf.get(conflict.assetId) ?? "—",
    message: conflict.message,
  }));

  const mobStats = mobilizationStats(mobs.map((mob): MobLite => ({
    id: mob.id,
    status: mob.status,
    requestedDate: mob.requestedDate,
    dispatchDate: mob.dispatchDate,
    arrivalDate: mob.arrivalDate,
    cost: mob.cost,
    distanceKm: mob.distanceKm,
    transportMode: mob.transportMode,
  })), now);
  const mobAsset = new Map(mobs.map((mob) => [mob.id, mob.assetId]));

  const input: SweepInput = {
    rules: ruleLites,
    docs: docs.map((doc) => ({ id: doc.id, assetId: doc.assetId, assetCode: doc.asset.code, docType: doc.docType, expiryDate: doc.expiryDate })),
    drivers: drivers.map((driver) => ({ id: driver.id, name: driver.name, licenseExpiry: driver.licenseExpiry, status: driver.status })),
    pmDue: pmList,
    tanks: tanks.map((tank) => ({ id: tank.id, name: tank.name, currentLevel: tank.currentLevel, minLevel: tank.minLevel })),
    fuelAnomalies: anomalies.map((anomaly) => ({ id: anomaly.id, litres: anomaly.litres, status: anomaly.status, reasons: anomaly.reasons })),
    tyres: tyres.map((tyre) => ({ id: tyre.id, serialNo: tyre.serialNo, assetId: tyre.assetId, assetCode: tyre.asset?.code ?? null, treadMm: tyre.currentTreadMm })),
    allocConflicts: conflicts,
    staleMobs: mobStats.stale.map((mob) => ({
      id: mob.id,
      assetId: mobAsset.get(mob.id) ?? "",
      assetCode: "—",
      days: (now.getTime() - mob.requestedDate.getTime()) / 86400000,
    })),
    ageingCases: cases.map((item) => ({ id: item.id, caseNo: item.caseNo, title: item.title, days: (now.getTime() - item.openedAt.getTime()) / 86400000 })),
  };

  const candidates = sweepAlerts(input, now);
  let created = 0;
  let updated = 0;
  for (const candidate of candidates) {
    const existing = await db.alert.findUnique({ where: { dedupeKey: candidate.dedupeKey } });
    if (existing) {
      if (existing.status === "Resolved") continue;
      await db.alert.update({ where: { id: existing.id }, data: { title: candidate.title, message: candidate.message, severity: candidate.severity } });
      updated++;
      continue;
    }
    await db.alert.create({
      data: {
        dedupeKey: candidate.dedupeKey,
        ruleCode: candidate.ruleCode,
        category: candidate.category,
        severity: candidate.severity,
        title: candidate.title,
        message: candidate.message,
        assetId: candidate.assetId ?? null,
        driverId: candidate.driverId ?? null,
        dueDate: candidate.dueDate ?? null,
        actionUrl: candidate.actionUrl ?? null,
      },
    });
    created++;
  }

  const open = await db.alert.findMany({ where: { status: "Open" } });
  const escalations = dueForEscalation(
    open.map((alert) => ({
      id: alert.id,
      ruleCode: alert.ruleCode,
      severity: alert.severity,
      createdAt: alert.createdAt,
      status: alert.status,
      escalatedAt: alert.escalatedAt,
      title: alert.title,
    })),
    ruleLites,
    now,
  );
  for (const alert of escalations) await db.alert.update({ where: { id: alert.id }, data: { escalatedAt: now } });

  for (const rule of rules) {
    const hits = candidates.filter((candidate) => candidate.ruleCode === rule.code).length;
    if (hits !== rule.hits) await db.alertRule.update({ where: { id: rule.id }, data: { hits } });
  }

  return { found: candidates.length, created, updated, escalated: escalations.length, dbAudit };
}

