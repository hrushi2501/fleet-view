/**
 * Production setup — installs SYSTEM CONFIGURATION only.
 *
 * This deliberately creates no transactions, no fake fuel entries, no invented
 * history. It installs the settings the modules need in order to work at all:
 * roles and permissions, alert rules, loss-prevention control rules, and
 * preventive-maintenance schedules attached to the real assets already in the
 * database.
 *
 * Safe to run repeatedly — everything upserts.
 *
 *   node prisma/setup-production.mjs
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/* ------------------------------ M0 roles ------------------------------ */
const ROLES = [
  { name: "Admin", label: "Administrator", description: "Full access to every module and setting.", permissions: ["*"], approvalLimit: 10000000, isSystem: true },
  { name: "FleetManager", label: "Fleet Manager",
    description: "Runs the fleet day to day: contracts, work orders, production. Deliberately cannot approve the hire and maintenance spend it creates — that sits with Finance.",
    permissions: ["fleet.view","fleet.edit","fuel.view","fuel.approve","fuel.reconcile","hire.view","hire.edit","maintenance.view","maintenance.edit","production.view","production.edit","compliance.view","compliance.edit","people.view","people.edit","cost.view","loss.view","loss.investigate","weighbridge.view","weighbridge.edit","reports.view","reports.export"],
    approvalLimit: 500000, isSystem: true },
  { name: "Finance", label: "Finance Controller",
    description: "Owns cost, revenue and payment. Approves hire and maintenance spend precisely because it does not create it.",
    permissions: ["fleet.view","fuel.view","hire.view","hire.approve","maintenance.view","maintenance.approve","production.view","compliance.view","people.view","cost.view","cost.edit","loss.view","loss.close","weighbridge.view","reports.view","reports.export"],
    approvalLimit: 2000000, isSystem: true },
  { name: "SiteManager", label: "Site Manager",
    description: "Runs one or more sites. Logs production and hire days; cannot approve invoices.",
    permissions: ["fleet.view","fuel.view","fuel.receipt","hire.view","hire.edit","maintenance.view","maintenance.edit","production.view","production.edit","compliance.view","people.view","weighbridge.view","weighbridge.edit","reports.view"],
    approvalLimit: 50000, isSystem: true },
  { name: "FuelClerk", label: "Fuel Clerk",
    description: "Issues diesel and records deliveries and dips. Deliberately cannot approve or reconcile.",
    permissions: ["fleet.view","fuel.view","fuel.issue","fuel.receipt","weighbridge.view","weighbridge.edit"],
    approvalLimit: 0, isSystem: true },
  { name: "Workshop", label: "Workshop Manager",
    description: "Runs the workshop. Raises and completes work orders; approval sits elsewhere.",
    permissions: ["fleet.view","maintenance.view","maintenance.edit","compliance.view","people.view","reports.view"],
    approvalLimit: 25000, isSystem: true },
  { name: "Auditor", label: "Auditor",
    description: "Read-only across everything, including the audit log. Changes nothing.",
    permissions: ["fleet.view","fuel.view","hire.view","maintenance.view","production.view","compliance.view","people.view","cost.view","loss.view","weighbridge.view","reports.view","reports.export","admin.audit"],
    approvalLimit: 0, isSystem: true },
  { name: "Driver", label: "Driver / Operator",
    description: "Mobile app only — logs fuel fills and repair photos for their own machine.",
    permissions: ["fuel.issue"], approvalLimit: 0, isSystem: true },
];

/* --------------------------- M6 control rules --------------------------- */
const CONTROL_RULES = [
  { code: "FUEL_TANK_GAP", name: "Unaccounted tank fuel", domain: "FUEL", severity: "HIGH", threshold: 25, thresholdUnit: "litres", description: "Physical dip disagrees with the book balance beyond tolerance — fuel has left the tank without a record." },
  { code: "FUEL_SHORT_DELIVERY", name: "Short delivery from supplier", domain: "FUEL", severity: "HIGH", threshold: 50, thresholdUnit: "litres", description: "Supplier invoiced more litres than were actually dipped into the tank." },
  { code: "FUEL_EFFICIENCY_DROP", name: "Abnormal fuel burn", domain: "FUEL", severity: "MEDIUM", threshold: 30, thresholdUnit: "% off norm", description: "An asset is consuming well outside its consumption norm for the work it did." },
  { code: "HIRE_OVERBILL", name: "Vendor overbilling", domain: "HIRE", severity: "HIGH", threshold: 5000, thresholdUnit: "₹", description: "A hire invoice claims more days, hours or kilometres than the site logs support." },
  { code: "HIRE_NO_CONTRACT", name: "Hired asset without contract", domain: "HIRE", severity: "MEDIUM", threshold: 0, thresholdUnit: "", description: "A hired or contractor asset is in use with no active contract, so its invoices cannot be validated." },
  { code: "HIRE_UNVERIFIABLE", name: "Invoice with no site logs", domain: "HIRE", severity: "MEDIUM", threshold: 0, thresholdUnit: "", description: "A vendor invoice covers a period with no day logs at all — nothing to verify it against." },
  { code: "METER_ROLLBACK", name: "Odometer / hour-meter rollback", domain: "METER", severity: "HIGH", threshold: 0, thresholdUnit: "", description: "A meter reading went backwards between fuel entries — tampering or a falsified reading." },
  { code: "FUEL_NO_EVIDENCE", name: "Fuel issued without evidence", domain: "FUEL", severity: "LOW", threshold: 0, thresholdUnit: "", description: "Diesel was booked against an asset with no odometer or pump photo to support it." },
  { code: "COMPLIANCE_EXPIRED_RUNNING", name: "Expired document, asset still active", domain: "COMPLIANCE", severity: "HIGH", threshold: 0, thresholdUnit: "", description: "An asset with an expired statutory document is still shown as operating — a legal and financial exposure." },
];

/* ---------------------------- M18 alert rules ---------------------------- */
const ALERT_RULES = [
  { code: "DOC_EXPIRING", name: "Document expiring", category: "Compliance", severity: "Warning", threshold: 30, thresholdUnit: "days notice", description: "A statutory document is approaching expiry.", escalateAfterHours: 48, escalateToRole: "FleetManager" },
  { code: "DOC_EXPIRED", name: "Document expired", category: "Compliance", severity: "Critical", threshold: 0, thresholdUnit: "", description: "A machine is operating with an expired statutory document.", escalateAfterHours: 12, escalateToRole: "Admin" },
  { code: "LICENCE_EXPIRING", name: "Driving licence expiring", category: "Driver", severity: "Warning", threshold: 30, thresholdUnit: "days notice", description: "A driver's licence is approaching expiry.", escalateAfterHours: 48, escalateToRole: "FleetManager" },
  { code: "PM_OVERDUE", name: "Service overdue", category: "Maintenance", severity: "Critical", threshold: 0, thresholdUnit: "", description: "A preventive service has passed its interval.", escalateAfterHours: 24, escalateToRole: "Workshop" },
  { code: "TANK_LOW", name: "Diesel tank below reorder", category: "Fuel", severity: "Warning", threshold: 0, thresholdUnit: "", description: "A site tank has dropped below its reorder level.", escalateAfterHours: 24, escalateToRole: "SiteManager" },
  { code: "FUEL_ANOMALY_OPEN", name: "Unresolved fuel anomaly", category: "Fuel", severity: "Critical", threshold: 100, thresholdUnit: "litres", description: "A significant fuel gap is still open.", escalateAfterHours: 24, escalateToRole: "Admin" },
  { code: "TYRE_UNSAFE", name: "Tyre below legal tread", category: "Maintenance", severity: "Critical", threshold: 1.6, thresholdUnit: "mm", description: "A fitted tyre is at or below the legal minimum tread.", escalateAfterHours: 12, escalateToRole: "Workshop" },
  { code: "ALLOC_CONFLICT", name: "Machine double-booked", category: "Operations", severity: "Warning", threshold: 0, thresholdUnit: "", description: "A machine is committed to two projects over the same dates.", escalateAfterHours: 48, escalateToRole: "FleetManager" },
  { code: "MOB_STALE", name: "Mobilisation not dispatched", category: "Operations", severity: "Warning", threshold: 7, thresholdUnit: "days", description: "A requested machine move has not left.", escalateAfterHours: 72, escalateToRole: "FleetManager" },
  { code: "CASE_AGEING", name: "Loss-prevention case ageing", category: "Loss", severity: "Warning", threshold: 14, thresholdUnit: "days", description: "An open case has had no disposition for too long.", escalateAfterHours: 72, escalateToRole: "Admin" },
];

/* ------------------------------ M14 PM tasks ------------------------------ */
const PM_TASKS = [
  { assetClass: "TIPPER", taskName: "Engine oil & filter change", intervalKm: 10000, intervalHours: 0, intervalDays: 90, estimatedCost: 8000 },
  { assetClass: "TIPPER", taskName: "Brake inspection & adjustment", intervalKm: 20000, intervalHours: 0, intervalDays: 180, estimatedCost: 5000 },
  { assetClass: "DUMPER", taskName: "Engine oil & filter change", intervalKm: 10000, intervalHours: 0, intervalDays: 90, estimatedCost: 9000 },
  { assetClass: "DUMPER", taskName: "Hydraulic system service", intervalKm: 30000, intervalHours: 0, intervalDays: 365, estimatedCost: 15000 },
  { assetClass: "TRUCK", taskName: "Engine oil & filter change", intervalKm: 12000, intervalHours: 0, intervalDays: 90, estimatedCost: 7000 },
  { assetClass: "WATER_TANKER", taskName: "Engine oil & filter change", intervalKm: 12000, intervalHours: 0, intervalDays: 90, estimatedCost: 7000 },
  { assetClass: "PICKUP", taskName: "Engine oil & filter change", intervalKm: 10000, intervalHours: 0, intervalDays: 180, estimatedCost: 4000 },
  { assetClass: "EXCAVATOR", taskName: "Engine oil & filter change", intervalKm: 0, intervalHours: 250, intervalDays: 90, estimatedCost: 12000 },
  { assetClass: "EXCAVATOR", taskName: "Hydraulic oil & filter", intervalKm: 0, intervalHours: 1000, intervalDays: 365, estimatedCost: 35000 },
  { assetClass: "EXCAVATOR", taskName: "Undercarriage inspection", intervalKm: 0, intervalHours: 500, intervalDays: 180, estimatedCost: 6000 },
  { assetClass: "BACKHOE", taskName: "Engine oil & filter change", intervalKm: 0, intervalHours: 250, intervalDays: 90, estimatedCost: 9000 },
  { assetClass: "GRADER", taskName: "Engine oil & filter change", intervalKm: 0, intervalHours: 250, intervalDays: 90, estimatedCost: 11000 },
  { assetClass: "ROLLER", taskName: "Engine oil & filter change", intervalKm: 0, intervalHours: 250, intervalDays: 90, estimatedCost: 8000 },
  { assetClass: "CRANE", taskName: "Wire rope & hook inspection", intervalKm: 0, intervalHours: 500, intervalDays: 180, estimatedCost: 10000 },
  { assetClass: "TRANSIT_MIXER", taskName: "Drum & chute service", intervalKm: 15000, intervalHours: 0, intervalDays: 120, estimatedCost: 9000 },
];

const CONSUMPTION = {
  KMPL: { DUMPER: [2.2, 4.0], TIPPER: [2.2, 3.8], TRUCK: [3.0, 5.5], WATER_TANKER: [3.0, 5.5], TRANSIT_MIXER: [2.2, 4.0], PICKUP: [8, 15], CAR: [9, 18], BIKE: [35, 65], TRACTOR: [3, 6] },
  LPH: { EXCAVATOR: [10, 20], GRADER: [12, 25], ROLLER: [5, 12], BACKHOE: [4, 9], CRANE: [6, 16], PLANT: [15, 40], CRUSHER: [20, 50] },
};

const PRODUCTION = [
  { assetClass: "DUMPER", unit: "TRIPS_PER_DAY", targetLow: 6, targetHigh: 12 },
  { assetClass: "TIPPER", unit: "TRIPS_PER_DAY", targetLow: 6, targetHigh: 14 },
  { assetClass: "TRUCK", unit: "TRIPS_PER_DAY", targetLow: 4, targetHigh: 10 },
  { assetClass: "TRANSIT_MIXER", unit: "TRIPS_PER_DAY", targetLow: 5, targetHigh: 12 },
  { assetClass: "EXCAVATOR", unit: "M3_PER_HOUR", targetLow: 40, targetHigh: 90 },
  { assetClass: "BACKHOE", unit: "M3_PER_HOUR", targetLow: 15, targetHigh: 40 },
  { assetClass: "GRADER", unit: "M3_PER_HOUR", targetLow: 30, targetHigh: 70 },
  { assetClass: "CRUSHER", unit: "TONNES_PER_DAY", targetLow: 150, targetHigh: 400 },
  { assetClass: "PLANT", unit: "TONNES_PER_DAY", targetLow: 100, targetHigh: 350 },
  { assetClass: "ROLLER", unit: "CYCLES_PER_HOUR", targetLow: 4, targetHigh: 12 },
  { assetClass: "CRANE", unit: "CYCLES_PER_HOUR", targetLow: 2, targetHigh: 8 },
];

async function main() {
  const log = [];

  for (const r of ROLES) {
    await db.role.upsert({
      where: { name: r.name },
      create: { name: r.name, label: r.label, description: r.description, permissions: r.permissions.join("\n"), approvalLimit: r.approvalLimit, isSystem: r.isSystem },
      update: { label: r.label, description: r.description, permissions: r.permissions.join("\n"), approvalLimit: r.approvalLimit },
    });
  }
  log.push(`roles: ${ROLES.length}`);

  // Link existing users to their role by the legacy role string.
  const roles = await db.role.findMany();
  const byName = new Map(roles.map((r) => [r.name, r.id]));
  let linked = 0;
  for (const u of await db.user.findMany()) {
    const id = byName.get(u.role);
    if (id && u.roleId !== id) {
      await db.user.update({ where: { id: u.id }, data: { roleId: id } });
      linked++;
    }
  }
  log.push(`users linked to roles: ${linked}`);

  for (const r of CONTROL_RULES) {
    await db.controlRule.upsert({
      where: { code: r.code },
      create: { code: r.code, name: r.name, domain: r.domain, description: r.description, severity: r.severity, threshold: r.threshold, thresholdUnit: r.thresholdUnit || null },
      update: { name: r.name, description: r.description },
    });
  }
  log.push(`control rules: ${CONTROL_RULES.length}`);

  for (const r of ALERT_RULES) {
    await db.alertRule.upsert({
      where: { code: r.code },
      create: { code: r.code, name: r.name, category: r.category, description: r.description, severity: r.severity, threshold: r.threshold, thresholdUnit: r.thresholdUnit || null, escalateAfterHours: r.escalateAfterHours, escalateToRole: r.escalateToRole },
      update: { name: r.name, description: r.description },
    });
  }
  log.push(`alert rules: ${ALERT_RULES.length}`);

  for (const [unit, table] of Object.entries(CONSUMPTION)) {
    for (const [assetClass, [normLow, normHigh]] of Object.entries(table)) {
      await db.consumptionNorm.upsert({
        where: { assetClass_unit: { assetClass, unit } },
        create: { assetClass, unit, normLow, normHigh, tolerancePct: 15 },
        update: {},
      });
    }
  }
  for (const n of PRODUCTION) {
    await db.productionNorm.upsert({ where: { assetClass_unit: { assetClass: n.assetClass, unit: n.unit } }, create: n, update: {} });
  }
  log.push(`norms & targets: verified`);

  // PM schedules attach to the REAL assets already in the database. Each is
  // anchored to that machine's current meter and today's date, so nothing shows
  // as instantly overdue on day one.
  const assets = await db.asset.findMany({ select: { id: true, assetClass: true, meterValue: true } });
  let pm = 0;
  for (const t of PM_TASKS) {
    for (const a of assets.filter((x) => x.assetClass === t.assetClass)) {
      const exists = await db.maintenanceSchedule.findFirst({ where: { assetId: a.id, taskName: t.taskName } });
      if (exists) continue;
      await db.maintenanceSchedule.create({
        data: {
          assetId: a.id, assetClass: t.assetClass, taskName: t.taskName,
          intervalKm: t.intervalKm, intervalHours: t.intervalHours, intervalDays: t.intervalDays,
          estimatedCost: t.estimatedCost, lastDoneMeter: a.meterValue, lastDoneDate: new Date(),
        },
      });
      pm++;
    }
  }
  log.push(`PM schedules created: ${pm} (across ${assets.length} real assets)`);

  await db.auditEvent.create({
    data: { actorName: "Setup script", action: "CONFIG", module: "ADMIN", summary: `Production configuration installed — ${log.join("; ")}` },
  });

  console.log("Production configuration installed:");
  for (const l of log) console.log("  •", l);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
