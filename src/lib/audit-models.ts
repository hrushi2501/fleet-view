/**
 * Which models are worth an audit row, and which would drown it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS AN ALLOWLIST AND NOT "EVERYTHING"
 *
 * The obvious implementation audits every write. It cannot work here. This
 * application ingests telemetry on a two-minute cron across the fleet, so
 * `TelemetryReading` and `FuelLevelReading` alone would add hundreds of
 * thousands of rows a month — the log becomes unusable at exactly the moment
 * somebody needs to find a hire-rate change in it, and the storage cost is
 * carried by data nobody will ever read.
 *
 * So the rule is: audit what a person decided, not what a sensor observed.
 *
 * The excluded list is written out explicitly rather than left implicit,
 * because a new model that nobody classifies should be a deliberate decision
 * rather than a silent omission. `auditableModel()` treats anything unlisted as
 * auditable — the safe default for a record of decisions is to keep it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * High-volume machine-written models. Never audited.
 *
 * These are appended by the telematics worker, the alert sweep and the push
 * scheduler, not by a person clicking something.
 */
export const NEVER_AUDITED = new Set<string>([
  // The log itself — auditing it recurses forever.
  "AuditEvent",

  // Telemetry: written by the 2-minute sync worker for every tracked vehicle.
  "TelemetryReading",
  "FuelLevelReading",
  "TripSession",
  "FeatureStoreRecord",
  "MeterReading",

  // Derived//generated records — a sweep rewrites these wholesale.
  "Alert",
  "UnifiedAnomaly",
  "FuelAnomaly",
  "AnomalyCorrelation",

  // Infrastructure, not business decisions.
  "PushSubscription",

  // The key/value store now carries session revocation epochs and failed-login
  // counters, which change on every sign-in attempt. The security events that
  // matter are audited explicitly by the auth code with real summaries.
  "Setting",
]);

/** Whether a write to this model should leave an audit row. */
export function auditableModel(model: string | undefined): boolean {
  if (!model) return false;
  return !NEVER_AUDITED.has(model);
}

/**
 * The audit module a model's events belong under, for the Admin → Audit filter.
 *
 * Falls back to the model name so a new model is still findable rather than
 * being filed under a misleading heading.
 */
export function moduleForModel(model: string): string {
  const map: Record<string, string> = {
    User: "ADMIN", Role: "ADMIN",
    Asset: "FLEET", AssetLifecycleEvent: "FLEET", TelematicsProvider: "FLEET",
    Driver: "PEOPLE", Attendance: "PEOPLE", Competency: "PEOPLE",
    Violation: "PEOPLE", PersonDocument: "PEOPLE",
    FuelTransaction: "FUEL", FuelReceipt: "FUEL", TankDip: "FUEL", FuelTank: "FUEL",
    FuelReconciliation: "FUEL", FuelReconConfig: "FUEL", ConsumptionNorm: "FUEL",
    HireContract: "HIRE", HireLog: "HIRE", HireInvoice: "HIRE",
    WorkOrder: "MAINTENANCE", WorkOrderLine: "MAINTENANCE", JobCardItem: "MAINTENANCE",
    MaintenanceSchedule: "MAINTENANCE", Tyre: "MAINTENANCE", TyreEvent: "MAINTENANCE",
    MajorComponent: "MAINTENANCE",
    ComplianceDoc: "COMPLIANCE",
    CostTransaction: "COST", ProjectRevenue: "COST",
    FraudCase: "LOSS", CaseEvidence: "LOSS", CaseAction: "LOSS", CaseRecovery: "LOSS",
    ControlRule: "LOSS",
    WeighbridgeTicket: "WEIGHBRIDGE",
    ProductionLog: "PRODUCTION", ProductionNorm: "PRODUCTION",
    Site: "OPERATIONS", EquipmentPlan: "OPERATIONS", Allocation: "OPERATIONS",
    MobilizationOrder: "OPERATIONS", Project: "OPERATIONS",
    InventoryWarehouse: "INVENTORY", InventoryItem: "INVENTORY",
    InventoryStock: "INVENTORY", InventoryTransaction: "INVENTORY",
  };
  return map[model] ?? model.toUpperCase();
}
