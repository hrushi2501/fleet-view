/**
 * Delivery cleanup — removes test and demo records, keeps the client's real data.
 *
 * KEPT: assets, compliance documents, projects, and all system configuration
 *       (roles, control rules, alert rules, norms, PM schedules).
 * REMOVED: test transactions, the demo driver and the demo login.
 *
 * Deletion order respects foreign keys: children before parents.
 * Safe to run repeatedly. Take a backup first — `npm run backup`.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const before = {
    assets: await db.asset.count(),
    compliance: await db.complianceDoc.count(),
    projects: await db.project.count(),
  };

  const removed = [];
  const drop = async (label, fn) => {
    const { count } = await fn();
    if (count) removed.push(`${label}: ${count}`);
  };

  // --- transactional records that reference assets/drivers ---
  await drop("fuel transactions", () => db.fuelTransaction.deleteMany({}));
  await drop("fuel anomalies", () => db.fuelAnomaly.deleteMany({}));
  await drop("fuel reconciliations", () => db.fuelReconciliation.deleteMany({}));
  await drop("tank dips", () => db.tankDip.deleteMany({}));
  await drop("fuel receipts", () => db.fuelReceipt.deleteMany({}));
  await drop("fuel tanks", () => db.fuelTank.deleteMany({}));

  // Work-order children first, then the orders themselves.
  await drop("work order lines", () => db.workOrderLine.deleteMany({}));
  await drop("job card items", () => db.jobCardItem.deleteMany({}));
  await drop("work orders", () => db.workOrder.deleteMany({}));

  await drop("hire invoices", () => db.hireInvoice.deleteMany({}));
  await drop("hire logs", () => db.hireLog.deleteMany({}));
  await drop("hire contracts", () => db.hireContract.deleteMany({}));

  await drop("production logs", () => db.productionLog.deleteMany({}));
  await drop("weighbridge tickets", () => db.weighbridgeTicket.deleteMany({}));
  await drop("trips", () => db.trip.deleteMany({}));
  await drop("cost transactions", () => db.costTransaction.deleteMany({}));
  await drop("project revenue", () => db.projectRevenue.deleteMany({}));

  // Loss-prevention cases and their evidence.
  await drop("case recoveries", () => db.caseRecovery.deleteMany({}));
  await drop("case actions", () => db.caseAction.deleteMany({}));
  await drop("case evidence", () => db.caseEvidence.deleteMany({}));
  await drop("fraud cases", () => db.fraudCase.deleteMany({}));

  // Tyres and components.
  await drop("tyre events", () => db.tyreEvent.deleteMany({}));
  await drop("tyres", () => db.tyre.deleteMany({}));
  await drop("major components", () => db.majorComponent.deleteMany({}));

  // Operations.
  await drop("allocations", () => db.allocation.deleteMany({}));
  await drop("mobilisation orders", () => db.mobilizationOrder.deleteMany({}));
  await drop("sites", () => db.site.deleteMany({}));
  await drop("equipment plans", () => db.equipmentPlan.deleteMany({}));

  // Meter and lifecycle history (test entries only — none are client records).
  await drop("meter readings", () => db.meterReading.deleteMany({}));
  await drop("lifecycle events", () => db.assetLifecycleEvent.deleteMany({}));

  // People: attendance, documents, competencies, violations, then the demo driver.
  await drop("attendance", () => db.attendance.deleteMany({}));
  await drop("person documents", () => db.personDocument.deleteMany({}));
  await drop("competencies", () => db.competency.deleteMany({}));
  await drop("violations", () => db.violation.deleteMany({}));

  // Release the demo login's link before removing the person it points at.
  await db.user.updateMany({ where: { driverId: { not: null } }, data: { driverId: null } });
  // Detach drivers from assets so the vehicles survive the driver delete.
  await db.asset.updateMany({ where: { driverId: { not: null } }, data: { driverId: null } });
  await drop("demo drivers", () => db.driver.deleteMany({}));

  await drop("alerts", () => db.alert.deleteMany({}));
  await drop("demo logins", () => db.user.deleteMany({ where: { role: "Driver" } }));

  // Reset counters that only made sense with the test data present.
  await db.asset.updateMany({ data: { utilization: 0, speed: 0 } });
  await db.alertRule.updateMany({ data: { hits: 0 } });
  await db.controlRule.updateMany({ data: { hits: 0 } });

  const after = {
    assets: await db.asset.count(),
    compliance: await db.complianceDoc.count(),
    projects: await db.project.count(),
    roles: await db.role.count(),
    pm: await db.maintenanceSchedule.count(),
  };

  await db.auditEvent.create({
    data: {
      actorName: "Delivery cleanup", action: "CONFIG", module: "ADMIN",
      summary: `Test data cleared for client handover. Kept ${after.assets} assets, ${after.compliance} compliance documents, ${after.projects} projects.`,
    },
  });

  console.log("Removed:");
  for (const r of removed) console.log("  -", r);
  console.log("\nKept (client's real data + configuration):");
  console.log(`  assets:      ${before.assets} -> ${after.assets}`);
  console.log(`  compliance:  ${before.compliance} -> ${after.compliance}`);
  console.log(`  projects:    ${before.projects} -> ${after.projects}`);
  console.log(`  roles:       ${after.roles}`);
  console.log(`  PM schedules:${after.pm}`);

  if (after.assets !== before.assets || after.compliance !== before.compliance) {
    console.error("\n!! Client data changed unexpectedly — restore from backup.");
    process.exit(1);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
