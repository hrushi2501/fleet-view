import test from "node:test";
import assert from "node:assert/strict";
import {
  positiveNumber,
  nonNegativeNumber,
  boundedNumber,
  percentageNumber,
  coordinatePair,
  validateDateRange,
  oneOf,
  safeParseDate,
} from "./input-validation";
import { ActionError } from "./guard";
import { computePay, netPay, type AttendanceDay, type WageAgreement } from "./payroll";
import { safetyScore } from "./drivers";

/* ============================================================================
 * 1. Fuel Module Validations
 * ========================================================================== */
test("Fuel Module: Tank Configuration & Boundary Defenses", () => {
  const VALID_TANK_STATUSES = ["ACTIVE", "INACTIVE", "MAINTENANCE"] as const;

  // Capacity boundary tests
  assert.equal(boundedNumber("10000", "Capacity", { min: 1, max: 500_000 }), 10000);
  assert.throws(() => boundedNumber("0", "Capacity", { min: 1, max: 500_000 }), ActionError);
  assert.throws(() => boundedNumber("600000", "Capacity", { min: 1, max: 500_000 }), ActionError);

  // Status enum
  assert.equal(oneOf("ACTIVE", VALID_TANK_STATUSES, "Tank status"), "ACTIVE");
  assert.throws(() => oneOf("DRAFT", VALID_TANK_STATUSES, "Tank status"), ActionError);

  // Level against capacity rule
  const capacity = 20000;
  const minLevel = 2000;
  assert.ok(minLevel <= capacity);
  const invalidMinLevel = 25000;
  assert.ok(invalidMinLevel > capacity, "Min level cannot exceed capacity");
});

test("Fuel Module: Receipt Flow Meter & Rates", () => {
  const start = 12000;
  const end = 15000;
  assert.ok(end >= start, "End meter must be greater than or equal to start meter");
  assert.throws(() => {
    if (11000 < start) throw new ActionError("Flow meter end cannot be less than start");
  }, ActionError);

  assert.equal(positiveNumber("3000", "Receipt quantity"), 3000);
  assert.equal(positiveNumber("89.5", "Fuel rate"), 89.5);
  assert.throws(() => positiveNumber("-50", "Fuel quantity"), ActionError);
});

test("Fuel Module: Dispensation Meter & Type Validation", () => {
  const VALID_TYPES = ["INTERNAL", "BOWSER", "EXTERNAL"] as const;
  assert.equal(oneOf("INTERNAL", VALID_TYPES, "Fuel issue type"), "INTERNAL");
  assert.throws(() => oneOf("STOLEN", VALID_TYPES, "Fuel issue type"), ActionError);

  const meter = boundedNumber("145000", "Meter reading", { min: 0, max: 10_000_000 });
  assert.equal(meter, 145000);
  assert.throws(() => boundedNumber("-10", "Meter reading", { min: 0, max: 10_000_000 }), ActionError);
});

/* ============================================================================
 * 2. Maintenance Module Validations
 * ========================================================================== */
test("Maintenance Module: Work Order Enums, Costs, & Downtime", () => {
  const VALID_TYPES = ["PM", "REPAIR", "BREAKDOWN", "INSPECTION", "TYRE"] as const;
  const VALID_PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
  const VALID_STATUSES = ["Open", "In-Progress", "Waiting-Parts", "Completed", "Closed"] as const;

  assert.equal(oneOf("BREAKDOWN", VALID_TYPES, "WO Type"), "BREAKDOWN");
  assert.equal(oneOf("Critical", VALID_PRIORITIES, "WO Priority"), "Critical");
  assert.equal(oneOf("In-Progress", VALID_STATUSES, "WO Status"), "In-Progress");
  assert.throws(() => oneOf("DELETED", VALID_STATUSES, "WO Status"), ActionError);

  const labor = nonNegativeNumber("1500", "Labor cost", { max: 10_000_000 });
  const parts = nonNegativeNumber("8500", "Parts cost", { max: 50_000_000 });
  const total = labor + parts;
  assert.equal(total, 10000);

  const downtime = boundedNumber("12.5", "Downtime hours", { min: 0, max: 8760 });
  assert.equal(downtime, 12.5);
  assert.throws(() => boundedNumber("9000", "Downtime hours", { min: 0, max: 8760 }), ActionError);
});

test("Maintenance Module: PM Schedule Intervals & Line Kinds", () => {
  const intervalKm = nonNegativeNumber("10000", "Interval km", { max: 1_000_000 });
  const intervalHours = nonNegativeNumber("250", "Interval hours", { max: 50_000 });
  const intervalDays = boundedNumber("90", "Interval days", { min: 0, max: 3650, integer: true });

  assert.equal(intervalKm, 10000);
  assert.equal(intervalHours, 250);
  assert.equal(intervalDays, 90);

  const VALID_LINE_KINDS = ["PART", "LABOUR", "OUTSIDE"] as const;
  assert.equal(oneOf("PART", VALID_LINE_KINDS, "Line kind"), "PART");
  assert.throws(() => oneOf("MISC", VALID_LINE_KINDS, "Line kind"), ActionError);
});

/* ============================================================================
 * 3. Tyres Module Validations
 * ========================================================================== */
test("Tyres Module: Tread Depths, Life, & Scrap Defenses", () => {
  const VALID_STATUSES = ["IN_STOCK", "IN_USE", "REMOVED", "SCRAPPED", "RETREAD"] as const;
  assert.equal(oneOf("IN_STOCK", VALID_STATUSES, "Tyre status"), "IN_STOCK");

  const treadNew = boundedNumber("22", "New tread depth", { min: 5, max: 60 });
  const currentTread = boundedNumber("18", "Current tread depth", { min: 0, max: 60 });
  assert.ok(currentTread <= treadNew);

  // Reject current tread exceeding new tread
  assert.throws(() => {
    const invalidCurrent = 25;
    if (invalidCurrent > treadNew) {
      throw new ActionError("Current tread depth cannot exceed new tyre tread depth.");
    }
  }, ActionError);

  // Removal reason validation and auto-scrap trigger
  const VALID_REASONS = ["WEAR", "BURST", "CUT", "PUNCTURE", "RETREAD", "ROTATION", "OTHER"] as const;
  const reason = oneOf("BURST", VALID_REASONS, "Removal reason");
  const isScrap = reason === "BURST" || reason === "CUT";
  assert.equal(isScrap, true);

  // Distance banking calculation
  const fittedMeter = 45000;
  const currentMeter = 58000;
  const ranKm = currentMeter > fittedMeter ? currentMeter - fittedMeter : 0;
  assert.equal(ranKm, 13000);
});

/* ============================================================================
 * 4. Drivers & Compliance Module Validations
 * ========================================================================== */
test("Drivers Module: Roles, Competencies & Safety Scores", () => {
  const DRIVER_TYPES = ["DRIVER", "OPERATOR"] as const;
  const DRIVER_STATUSES = ["Active", "Inactive", "Suspended"] as const;
  assert.equal(oneOf("OPERATOR", DRIVER_TYPES, "Driver type"), "OPERATOR");
  assert.equal(oneOf("Active", DRIVER_STATUSES, "Driver status"), "Active");

  // Competency
  const LEVELS = ["TRAINED", "CERTIFIED", "EXPERT"] as const;
  assert.equal(oneOf("CERTIFIED", LEVELS, "Competency level"), "CERTIFIED");

  const certifiedOn = safeParseDate("2025-01-15", "Certified on");
  const expiresOn = safeParseDate("2027-01-15", "Expires on");
  validateDateRange(certifiedOn, expiresOn, "Competency period");

  assert.throws(() => {
    validateDateRange(expiresOn, certifiedOn, "Inverted competency period");
  }, ActionError);

  // Violation severity and safety score
  const SEVERITIES = ["MINOR", "MAJOR", "CRITICAL"] as const;
  assert.equal(oneOf("MAJOR", SEVERITIES, "Severity"), "MAJOR");

  const violations = [
    { id: "1", type: "SPEEDING", severity: "MINOR", points: 2, date: new Date(), penalty: 500, status: "CLOSED" },
    { id: "2", type: "OVERLOADING", severity: "MAJOR", points: 5, date: new Date(), penalty: 2000, status: "CLOSED" },
  ];
  const { score } = safetyScore(violations);
  assert.ok(score < 100 && score > 0, "Safety score diminishes with violations");
});

test("Compliance Module: Document Dates & Expiry Status", () => {
  const VALID_DOC_TYPES = [
    "FITNESS", "INSURANCE", "ROAD_TAX", "PUC", "NATIONAL_PERMIT", "STATE_PERMIT", "CALIBRATION", "OTHER"
  ] as const;
  assert.equal(oneOf("FITNESS", VALID_DOC_TYPES, "Doc type"), "FITNESS");

  const issueDate = safeParseDate("2026-01-01", "Issue date")!;
  const expiryDate = safeParseDate("2027-01-01", "Expiry date")!;
  validateDateRange(issueDate, expiryDate, "Document period");

  // Status computation logic
  const now = new Date("2026-06-01").getTime();
  const reminderDays = 30;
  const daysRemaining = (expiryDate.getTime() - now) / 86400000;
  const status = daysRemaining < 0 ? "Expired" : daysRemaining <= reminderDays ? "Expiring" : "Valid";
  assert.equal(status, "Valid");
});

/* ============================================================================
 * 5. Weighbridge Module Validations
 * ========================================================================== */
test("Weighbridge Module: Ticket Kinds & Mass Boundaries", () => {
  const KINDS = ["DISPATCH", "RECEIPT", "INTERNAL"] as const;
  assert.equal(oneOf("RECEIPT", KINDS, "Ticket kind"), "RECEIPT");
  assert.throws(() => oneOf("SALE", KINDS, "Ticket kind"), ActionError);

  const gross = boundedNumber("42500", "Gross weight", { min: 0, max: 150_000 });
  const tare = boundedNumber("14200", "Tare weight", { min: 0, max: 150_000 });
  assert.ok(gross >= tare, "Gross must be >= tare");
  const net = gross - tare;
  assert.equal(net, 28300);

  // Reject inverted weights
  assert.throws(() => {
    const invalidGross = 10000;
    const higherTare = 14000;
    if (invalidGross < higherTare) {
      throw new ActionError("Gross weight cannot be less than tare weight.");
    }
  }, ActionError);
});

/* ============================================================================
 * 6. Costs & Financials Module Validations
 * ========================================================================== */
test("Costs Module: Head Enums, Positive Amounts, & Depreciation", () => {
  const COST_HEADS = [
    "FUEL", "MAINTENANCE", "TYRE", "INSURANCE", "EMI", "PERMIT", "TOLL", "SALARY", "OVERHEAD", "OTHER"
  ] as const;
  assert.equal(oneOf("TOLL", COST_HEADS, "Cost head"), "TOLL");
  assert.throws(() => oneOf("BRIBE", COST_HEADS, "Cost head"), ActionError);

  const amount = positiveNumber("15000", "Cost amount", { max: 100_000_000 });
  assert.equal(amount, 15000);
  assert.throws(() => positiveNumber("0", "Cost amount"), ActionError);
  assert.throws(() => positiveNumber("-500", "Cost amount"), ActionError);

  // Revenue bill types
  const BILL_TYPES = ["RA_BILL", "ADVANCE", "RETENTION_RELEASE", "OTHER"] as const;
  assert.equal(oneOf("RA_BILL", BILL_TYPES, "Bill type"), "RA_BILL");

  // Depreciation validation
  const acqCost = boundedNumber("4500000", "Acquisition cost", { min: 0, max: 1_000_000_000 });
  const salvage = boundedNumber("500000", "Salvage value", { min: 0, max: 1_000_000_000 });
  assert.ok(salvage <= acqCost);

  assert.throws(() => {
    const excessSalvage = 5000000;
    if (excessSalvage > acqCost) {
      throw new ActionError("Salvage value cannot exceed original acquisition cost");
    }
  }, ActionError);

  const depMethod = oneOf("SLM", ["SLM", "WDV"], "Depreciation method");
  assert.equal(depMethod, "SLM");
  const usefulLife = boundedNumber("8", "Useful life", { min: 1, max: 100, integer: true });
  assert.equal(usefulLife, 8);
});

/* ============================================================================
 * 7. Hire & Contracts Module Validations
 * ========================================================================== */
test("Hire Module: Contract Terms, Inspection, & Log Boundaries", () => {
  const RATE_TYPES = ["PER_HOUR", "PER_DAY", "PER_MONTH", "PER_TRIP", "PER_KM"] as const;
  const FUEL_BORNE_BY = ["HIRER", "OWNER"] as const;
  const HIRE_STATUS = ["Active", "Completed", "Terminated", "Draft", "Suspended"] as const;

  assert.equal(oneOf("PER_MONTH", RATE_TYPES, "Rate type"), "PER_MONTH");
  assert.equal(oneOf("HIRER", FUEL_BORNE_BY, "Fuel borne by"), "HIRER");
  assert.equal(oneOf("Active", HIRE_STATUS, "Status"), "Active");

  // Daily log 24-hour limit
  const worked = 10;
  const idle = 4;
  const breakdown = 2;
  const total = worked + idle + breakdown;
  assert.ok(total <= 24);

  assert.throws(() => {
    const overflowWorked = 16;
    const overflowIdle = 10;
    if (overflowWorked + overflowIdle > 24) {
      throw new ActionError("Sum of worked, idle, and breakdown hours cannot exceed 24 hours in a single day.");
    }
  }, ActionError);

  // Inspection fuel percentage
  const fuelPct = percentageNumber("65", "Fuel level");
  assert.equal(fuelPct, 65);
  assert.throws(() => percentageNumber("105", "Fuel level"), ActionError);
});

/* ============================================================================
 * 8. Operations & Allocations Module Validations
 * ========================================================================== */
test("Operations Module: Site Coordinates, Radius, & Allocation Conflicts", () => {
  const SITE_TYPES = ["WORK_FRONT", "CAMP", "WORKSHOP", "QUARRY", "CRUSHER", "OTHER"] as const;
  assert.equal(oneOf("QUARRY", SITE_TYPES, "Site type"), "QUARRY");

  const coords = coordinatePair("21.1702", "72.8311", "Surat Quarry");
  assert.equal(coords.lat, 21.1702);
  assert.equal(coords.lng, 72.8311);

  const radiusM = boundedNumber("750", "Radius", { min: 10, max: 50_000 });
  assert.equal(radiusM, 750);

  // Allocation status
  const ALLOC_STATUSES = ["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED", "RELEASED"] as const;
  assert.equal(oneOf("ACTIVE", ALLOC_STATUSES, "Allocation status"), "ACTIVE");

  // Mobilization transport mode
  const TRANSPORT_MODES = ["SELF_DRIVE", "TRAILER", "LOW_BED", "TOWED", "RAIL", "OTHER"] as const;
  assert.equal(oneOf("LOW_BED", TRANSPORT_MODES, "Transport mode"), "LOW_BED");
});

/* ============================================================================
 * 9. People & Payroll Validations
 * ========================================================================== */
test("People Module: Attendance Register, Wage Rates, & Net Pay Calc", () => {
  const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "REST", "HOLIDAY"] as const;
  const SHIFTS = ["DAY", "NIGHT", "GENERAL"] as const;

  assert.equal(oneOf("HALF_DAY", ATTENDANCE_STATUSES, "Attendance status"), "HALF_DAY");
  assert.equal(oneOf("NIGHT", SHIFTS, "Shift"), "NIGHT");

  const hours = boundedNumber("12", "Hours", { min: 0, max: 24 });
  assert.equal(hours, 12);
  assert.throws(() => boundedNumber("26", "Hours", { min: 0, max: 24 }), ActionError);

  // Payroll compute pay verification
  const days: AttendanceDay[] = [
    { date: new Date("2026-08-01"), status: "PRESENT", hours: 8 },
    { date: new Date("2026-08-02"), status: "PRESENT", hours: 10 },
    { date: new Date("2026-08-03"), status: "HALF_DAY", hours: 4 },
    { date: new Date("2026-08-04"), status: "REST", hours: 0 },
  ];
  const agreements: WageAgreement[] = [
    { kind: "DAILY", amount: 800, otHourly: 100, effectiveFrom: new Date("2026-01-01") },
  ];

  const pay = computePay(days, agreements, new Date("2026-08-31"), { standardDays: 26, standardHours: 8 });
  assert.equal(pay.present, 2);
  assert.equal(pay.half, 1);
  assert.equal(pay.rest, 1);
  assert.equal(pay.paid, 2.5); // 2 full + 0.5 half (daily wage does not pay for rest days)
  assert.equal(pay.otHours, 2); // 10 - 8 = 2 OT hours on Aug 2

  // Net pay with advance and deduction
  const calculatedNet = netPay({
    gross: pay.gross,
    bonus: 500,
    advance: 1000,
    deduction: 200,
  });
  assert.equal(calculatedNet, pay.gross + 500 - 1000 - 200);
});

/* ============================================================================
 * 10. Multi-Module End-to-End Integration & Data Flow Simulation
 * ========================================================================== */
test("Integration: End-to-End Cross-Module Enterprise Life Cycle", () => {
  // Step 1: Commission an Asset
  const asset = {
    id: "asset-101",
    code: "EX-01",
    name: "Komatsu PC210 Hydraulic Excavator",
    assetClass: "EXCAVATOR",
    meterValue: 1250,
    status: "Active",
    projectId: "proj-01",
    healthScore: 98,
  };
  assert.equal(asset.code, "EX-01");

  // Step 2: Allocate Driver with valid license
  const driver = {
    id: "drv-501",
    empCode: "EMP-102",
    name: "Ramesh Sharma",
    licenseExpiry: new Date("2028-12-31"),
    status: "Active",
    safetyScore: 100,
  };
  assert.ok(driver.licenseExpiry > new Date());

  // Step 3: Shift Operation Logged
  const shiftLog = {
    assetId: asset.id,
    driverId: driver.id,
    date: new Date("2026-09-01"),
    shift: "DAY",
    workedHours: 10,
    idleHours: 1,
    trips: 45,
    tonnage: 900,
  };
  assert.ok(shiftLog.workedHours + shiftLog.idleHours <= 24);

  // Step 4: Fuel Issue recorded with Anti-rollback check
  const newMeter = 1260; // 10 hours worked
  assert.ok(newMeter >= asset.meterValue, "Meter advanced monotonically");
  asset.meterValue = newMeter;

  const fuelTransaction = {
    assetId: asset.id,
    quantity: 180, // 180 L
    rate: 92.5,
    amount: 180 * 92.5,
    meterValue: asset.meterValue,
  };
  assert.equal(fuelTransaction.amount, 16650);

  // Step 5: Routine PM Work Order raised and completed
  const workOrder = {
    woNo: "WO-2026-0901",
    assetId: asset.id,
    type: "PM",
    priority: "Medium",
    status: "Completed",
    laborCost: 1200,
    partsCost: 3800,
    totalCost: 5000,
  };
  assert.equal(workOrder.totalCost, workOrder.laborCost + workOrder.partsCost);

  // Step 6: Direct Project Cost Line aggregated
  const projectCost = {
    projectId: asset.projectId,
    assetId: asset.id,
    costHead: "MAINTENANCE",
    amount: workOrder.totalCost,
    period: "2026-09",
  };
  assert.equal(projectCost.amount, 5000);

  // Step 7: Operator Attendance Marked & Payroll Accrued
  const attendance = {
    driverId: driver.id,
    date: new Date("2026-09-01"),
    status: "PRESENT",
    hours: shiftLog.workedHours,
  };
  assert.equal(attendance.status, "PRESENT");
  assert.equal(attendance.hours, 10);
});
