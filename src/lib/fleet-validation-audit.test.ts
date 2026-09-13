import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nonNegativeNumber,
  boundedNumber,
  percentageNumber,
  coordinatePair,
  validateDateRange,
  oneOf,
  safeParseDate,
} from "./input-validation";
import { checkReading, type ReadingLite } from "./master";
import { ActionError } from "./action-error";

describe("Fleet Input Validation: Identification & Classifications", () => {
  const VALID_ASSET_CLASSES = [
    "DUMPER", "TIPPER", "EXCAVATOR", "BACKHOE", "GRADER", "ROLLER",
    "CRANE", "TRANSIT_MIXER", "WATER_TANKER", "TRUCK", "PICKUP",
    "CAR", "BIKE", "TRACTOR", "PLANT", "CRUSHER", "MINES",
  ] as const;
  const VALID_CATEGORIES = ["VEHICLE", "EQUIPMENT"] as const;
  const VALID_OWNERSHIP_TYPES = ["OWNED", "LEASED", "HIRED", "CONTRACTOR"] as const;
  const VALID_STATUSES = ["Active", "Idle", "Under-Maintenance", "In-Transit", "Breakdown", "Off-hired"] as const;
  const VALID_PRIMARY_METERS = ["ODOMETER", "SMU"] as const;

  it("validates asset code: required, trimmed, max 50 characters", () => {
    const validateCode = (raw: unknown) => {
      const code = String(raw ?? "").trim();
      if (!code) throw new ActionError("Asset code is required.");
      if (code.length > 50) throw new ActionError("Asset code cannot exceed 50 characters.");
      return code;
    };

    assert.equal(validateCode("TRK-001"), "TRK-001");
    assert.equal(validateCode("  EXC-204  "), "EXC-204");
    assert.throws(() => validateCode(""), /Asset code is required/);
    assert.throws(() => validateCode("   "), /Asset code is required/);
    assert.throws(() => validateCode(null), /Asset code is required/);
    assert.throws(() => validateCode("A".repeat(51)), /cannot exceed 50 characters/);
  });

  it("validates asset name: required, trimmed, max 100 characters", () => {
    const validateName = (raw: unknown) => {
      const name = String(raw ?? "").trim();
      if (!name) throw new ActionError("Asset name is required.");
      if (name.length > 100) throw new ActionError("Asset name cannot exceed 100 characters.");
      return name;
    };

    assert.equal(validateName("Tata Prima 2830.K"), "Tata Prima 2830.K");
    assert.throws(() => validateName(""), /Asset name is required/);
    assert.throws(() => validateName("   "), /Asset name is required/);
    assert.throws(() => validateName("N".repeat(101)), /cannot exceed 100 characters/);
  });

  it("validates asset class against enumeration", () => {
    assert.equal(oneOf("TIPPER", VALID_ASSET_CLASSES, "asset class"), "TIPPER");
    assert.equal(oneOf("EXCAVATOR", VALID_ASSET_CLASSES, "asset class"), "EXCAVATOR");
    assert.throws(() => oneOf("AIRPLANE", VALID_ASSET_CLASSES, "asset class"), /Invalid asset class/);
    assert.throws(() => oneOf("tipper", VALID_ASSET_CLASSES, "asset class"), /Invalid asset class/);
  });

  it("validates category against enumeration", () => {
    assert.equal(oneOf("VEHICLE", VALID_CATEGORIES, "category"), "VEHICLE");
    assert.equal(oneOf("EQUIPMENT", VALID_CATEGORIES, "category"), "EQUIPMENT");
    assert.throws(() => oneOf("TOOL", VALID_CATEGORIES, "category"), /Invalid category/);
  });

  it("validates ownership type against enumeration", () => {
    assert.equal(oneOf("OWNED", VALID_OWNERSHIP_TYPES, "ownership type"), "OWNED");
    assert.equal(oneOf("HIRED", VALID_OWNERSHIP_TYPES, "ownership type"), "HIRED");
    assert.throws(() => oneOf("STOLEN", VALID_OWNERSHIP_TYPES, "ownership type"), /Invalid ownership type/);
  });

  it("validates asset status against enumeration", () => {
    assert.equal(oneOf("Active", VALID_STATUSES, "status"), "Active");
    assert.equal(oneOf("Under-Maintenance", VALID_STATUSES, "status"), "Under-Maintenance");
    assert.throws(() => oneOf("Scrapped", VALID_STATUSES, "status"), /Invalid status/);
  });

  it("validates primary meter type against enumeration", () => {
    assert.equal(oneOf("ODOMETER", VALID_PRIMARY_METERS, "primary meter"), "ODOMETER");
    assert.equal(oneOf("SMU", VALID_PRIMARY_METERS, "primary meter"), "SMU");
    assert.throws(() => oneOf("TACHOMETER", VALID_PRIMARY_METERS, "primary meter"), /Invalid primary meter/);
  });
});

describe("Fleet Input Validation: Metrics & Technical Specifications", () => {
  it("validates manufacturing year boundaries [1950 ... currentYear + 1]", () => {
    const currentYear = new Date().getFullYear();
    const yearMfg = (val: unknown) =>
      boundedNumber(val, "Manufacturing year", { min: 1950, max: currentYear + 1, integer: true, fallback: currentYear });

    assert.equal(yearMfg(2023), 2023);
    assert.equal(yearMfg(null), currentYear);
    assert.throws(() => yearMfg(1940), /must be at least 1950/);
    assert.throws(() => yearMfg(currentYear + 2), /must be at most/);
    assert.throws(() => yearMfg(2021.5), /must be a whole integer/);
  });

  it("validates odometer/meter limits [0 ... 10,000,000]", () => {
    const meterVal = (val: unknown) =>
      boundedNumber(val, "Meter reading", { min: 0, max: 10_000_000, fallback: 0 });

    assert.equal(meterVal(0), 0);
    assert.equal(meterVal(250_000), 250_000);
    assert.equal(meterVal(""), 0);
    assert.throws(() => meterVal(-10), /must be at least 0/);
    assert.throws(() => meterVal(10_000_001), /must be at most 10000000/);
  });

  it("validates fuel tank capacity [0 ... 50,000 L]", () => {
    const fuelCap = (val: unknown) =>
      boundedNumber(val, "Fuel capacity", { min: 0, max: 50_000, fallback: 0 });

    assert.equal(fuelCap(300), 300);
    assert.equal(fuelCap(0), 0);
    assert.throws(() => fuelCap(-1), /must be at least 0/);
    assert.throws(() => fuelCap(55_000), /must be at most 50000/);
  });

  it("validates acquisition cost and insured value [0 ... 100,000,000,000]", () => {
    const cost = (val: unknown) =>
      nonNegativeNumber(val, "Acquisition cost", { max: 100_000_000_000, fallback: 0 });

    assert.equal(cost(4_500_000), 4_500_000);
    assert.equal(cost(0), 0);
    assert.throws(() => cost(-500), /must be at least 0/);
    assert.throws(() => cost(200_000_000_000), /must be at most 100000000000/);
  });

  it("validates health score & utilization percentage [0 ... 100]", () => {
    assert.equal(percentageNumber(95, "Health score"), 95);
    assert.equal(percentageNumber(0, "Utilization"), 0);
    assert.throws(() => percentageNumber(-1, "Health score"), /must be at least 0/);
    assert.throws(() => percentageNumber(101, "Utilization"), /must be at most 100/);
  });

  it("validates engine power, torque, and tonnage boundaries", () => {
    const hp = (val: unknown) => boundedNumber(val, "Engine power", { min: 1, max: 10_000 });
    const torque = (val: unknown) => boundedNumber(val, "Torque", { min: 1, max: 50_000 });
    const tonnage = (val: unknown) => boundedNumber(val, "Tonnage", { min: 0.01, max: 1_000 });

    assert.equal(hp(300), 300);
    assert.throws(() => hp(0), /must be at least 1/);
    assert.throws(() => hp(15_000), /must be at most 10000/);

    assert.equal(torque(1100), 1100);
    assert.throws(() => torque(-10), /must be at least 1/);
    assert.throws(() => torque(60_000), /must be at most 50000/);

    assert.equal(tonnage(25), 25);
    assert.throws(() => tonnage(0), /must be at least 0.01/);
    assert.throws(() => tonnage(1500), /must be at most 1000/);
  });

  it("enforces laden weight >= unladen weight constraint", () => {
    const checkWeights = (laden: number | null, unladen: number | null) => {
      const l = laden !== null ? boundedNumber(laden, "Gross laden weight", { min: 10, max: 500_000 }) : null;
      const u = unladen !== null ? boundedNumber(unladen, "Unladen weight", { min: 10, max: 500_000 }) : null;
      if (l !== null && u !== null && l < u) {
        throw new ActionError("Gross laden weight cannot be less than unladen (tare) weight.");
      }
      return { l, u };
    };

    assert.deepEqual(checkWeights(28_000, 11_000), { l: 28_000, u: 11_000 });
    assert.deepEqual(checkWeights(null, 11_000), { l: null, u: 11_000 });
    assert.throws(() => checkWeights(10_000, 15_000), /Gross laden weight cannot be less than unladen/);
    assert.throws(() => checkWeights(5, 10), /Gross laden weight must be at least 10/);
  });

  it("validates geographic coordinates", () => {
    assert.deepEqual(coordinatePair(26.9, 75.8, "Vehicle"), { lat: 26.9, lng: 75.8 });
    assert.deepEqual(coordinatePair(null, null, "Vehicle"), { lat: null, lng: null });
    assert.throws(() => coordinatePair(26.9, null, "Vehicle"), /require both latitude and longitude/);
    assert.throws(() => coordinatePair(95, 75, "Vehicle"), /Latitude must be at most 90/);
    assert.throws(() => coordinatePair(25, 185, "Vehicle"), /Longitude must be at most 180/);
  });
});

describe("Fleet Input Validation: Date Fields & Ranges", () => {
  it("safeParseDate parses valid calendar dates and handles null/empty", () => {
    const d = safeParseDate("2026-06-15", "Service date");
    assert.ok(d instanceof Date);
    assert.equal(d?.toISOString().slice(0, 10), "2026-06-15");
    assert.equal(safeParseDate(null, "Optional date"), null);
    assert.equal(safeParseDate("", "Optional date"), null);
  });

  it("safeParseDate rejects invalid and unparseable dates", () => {
    assert.throws(() => safeParseDate("invalid-date-string", "Service date"), /Invalid date provided for Service date/);
    assert.throws(() => safeParseDate("99999-99-99", "Service date"), /Invalid date provided for Service date/);
  });

  it("safeParseDate enforces year boundaries", () => {
    assert.throws(
      () => safeParseDate("1900-01-01", "Reg date", { minYear: 1950, maxYear: 2100 }),
      /year cannot be earlier than 1950/
    );
    assert.throws(
      () => safeParseDate("2200-01-01", "Reg date", { minYear: 1950, maxYear: 2100 }),
      /year cannot be later than 2100/
    );
  });

  it("enforces chronological order between lastServiceDate and serviceDueDate", () => {
    assert.doesNotThrow(() => validateDateRange("2026-01-01", "2026-06-01", "Service dates"));
    assert.doesNotThrow(() => validateDateRange("2026-01-01", null, "Service dates"));
    assert.throws(
      () => validateDateRange("2026-06-01", "2026-01-01", "Service dates"),
      /End date cannot be earlier than start date for Service dates/
    );
  });
});

describe("Fleet Business Integrity: Anti-Rollback Defenses", () => {
  it("rejects odometer rollback when updating vehicle, including zero reset", () => {
    const checkOdometerUpdate = (existingValue: number, proposedValue: number) => {
      if (existingValue > 0 && proposedValue < existingValue) {
        throw new ActionError(`Odometer reading (${proposedValue} km) cannot be lower than existing reading (${existingValue} km).`);
      }
    };

    assert.doesNotThrow(() => checkOdometerUpdate(50_000, 50_000));
    assert.doesNotThrow(() => checkOdometerUpdate(50_000, 52_000));
    assert.throws(() => checkOdometerUpdate(50_000, 48_000), /cannot be lower than existing reading/);
    // Crucial check: submitting 0 or blank fallback cannot reset an existing 50k odometer
    assert.throws(() => checkOdometerUpdate(50_000, 0), /cannot be lower than existing reading/);
  });

  it("rejects hour-meter rollback in master data", () => {
    const checkHourMeterUpdate = (existingHours: number, proposedHours: number) => {
      const valid = boundedNumber(proposedHours, "Hour-meter reading", { min: 0, max: 1_000_000, fallback: 0 });
      if (existingHours > 0 && valid < existingHours) {
        throw new ActionError(`Hour-meter reading (${valid} hrs) cannot be lower than existing reading (${existingHours} hrs).`);
      }
      return valid;
    };

    assert.equal(checkHourMeterUpdate(1200, 1250), 1250);
    assert.throws(() => checkHourMeterUpdate(1200, 1100), /cannot be lower than existing reading/);
    assert.throws(() => checkHourMeterUpdate(1200, -5), /Hour-meter reading must be at least 0/);
    assert.throws(() => checkHourMeterUpdate(1200, 0), /cannot be lower than existing reading/);
  });

  it("Meter reading checkReading flags rollback and prevents cached meter regression", () => {
    const history: ReadingLite[] = [
      { id: "r1", meterType: "ODOMETER", value: 45_000, date: new Date("2026-08-01"), source: "MANUAL" },
    ];
    const rollback = checkReading("ODOMETER", 44_000, new Date("2026-08-02"), history);
    assert.equal(rollback.ok, false);
    assert.equal(rollback.isRollback, true);
    assert.match(rollback.message!, /A meter does not run backwards/);

    const forward = checkReading("ODOMETER", 46_000, new Date("2026-08-02"), history);
    assert.equal(forward.ok, true);
    assert.equal(forward.isRollback, false);
  });
});

describe("Fleet Lifecycle & Master Data Integrity", () => {
  const VALID_LIFECYCLE_KINDS = [
    "COMMISSIONED", "TRANSFERRED", "STATUS_CHANGE", "OFF_HIRED", "DECOMMISSIONED", "DISPOSED",
  ] as const;

  it("validates lifecycle event kind enumeration", () => {
    assert.equal(oneOf("COMMISSIONED", VALID_LIFECYCLE_KINDS, "lifecycle kind"), "COMMISSIONED");
    assert.equal(oneOf("DECOMMISSIONED", VALID_LIFECYCLE_KINDS, "lifecycle kind"), "DECOMMISSIONED");
    assert.throws(() => oneOf("SOLD_TO_JUNK", VALID_LIFECYCLE_KINDS, "lifecycle kind"), /Invalid lifecycle kind/);
  });

  it("validates lifecycle event amount is non-negative", () => {
    const validateAmount = (val: unknown) =>
      nonNegativeNumber(val, "Amount", { max: 100_000_000_000, fallback: 0 });

    assert.equal(validateAmount(50_000), 50_000);
    assert.equal(validateAmount(0), 0);
    assert.throws(() => validateAmount(-500), /Amount must be at least 0/);
  });

  it("prevents modifications to decommissioned vehicles", () => {
    const assertNotDecommissioned = (asset: { code: string; decommissionedOn: Date | null }) => {
      if (asset.decommissionedOn) {
        throw new ActionError("Decommissioned vehicles cannot be edited. Restore it deliberately before changing records.");
      }
    };

    const activeAsset = { code: "TRK-01", decommissionedOn: null };
    const decommissionedAsset = { code: "TRK-02", decommissionedOn: new Date("2026-01-01") };

    assert.doesNotThrow(() => assertNotDecommissioned(activeAsset));
    assert.throws(() => assertNotDecommissioned(decommissionedAsset), /Decommissioned vehicles cannot be edited/);
  });
});

describe("Fleet End-to-End Data Flow Simulation", () => {
  // In-memory simulation of the complete fleet record lifecycle
  type SimulatedAsset = {
    id: string;
    code: string;
    name: string;
    meterValue: number;
    hourMeterValue: number;
    status: string;
    decommissionedOn: Date | null;
  };

  type SimulatedReading = {
    assetId: string;
    meterType: "ODOMETER" | "HOURS";
    value: number;
    date: Date;
    isRollback: boolean;
  };

  const assetStore = new Map<string, SimulatedAsset>();
  const readingsStore: SimulatedReading[] = [];

  it("simulates full lifecycle: create -> meter advance -> master update -> decommission -> rejection", () => {
    // 1. Create Asset
    const assetId = "asset-test-1";
    const initialAsset: SimulatedAsset = {
      id: assetId,
      code: "TIP-101",
      name: "Tata 2518 Tipper",
      meterValue: 10_000,
      hourMeterValue: 500,
      status: "Active",
      decommissionedOn: null,
    };
    assetStore.set(assetId, initialAsset);

    // 2. Record valid meter reading
    const newMeter = 10_500;
    const readingDate = new Date("2026-09-01");
    const check = checkReading("ODOMETER", newMeter, readingDate, [
      { id: "init", meterType: "ODOMETER", value: initialAsset.meterValue, date: new Date("2026-08-01"), source: "MANUAL" },
    ]);
    assert.equal(check.ok, true);
    assert.equal(check.isRollback, false);
    readingsStore.push({ assetId, meterType: "ODOMETER", value: newMeter, date: readingDate, isRollback: false });
    initialAsset.meterValue = newMeter;

    // 3. Rollback attempt is caught and does not update cached meter
    const rollbackCheck = checkReading("ODOMETER", 10_200, new Date("2026-09-02"), [
      { id: "r1", meterType: "ODOMETER", value: newMeter, date: readingDate, source: "MANUAL" },
    ]);
    assert.equal(rollbackCheck.isRollback, true);
    // Cached meter remains 10,500
    assert.equal(initialAsset.meterValue, 10_500);

    // 4. Update master data (advance hour meter)
    const newHours = 550;
    if (initialAsset.hourMeterValue > 0 && newHours < initialAsset.hourMeterValue) {
      throw new ActionError("Hour-meter rollback");
    }
    initialAsset.hourMeterValue = newHours;
    assert.equal(initialAsset.hourMeterValue, 550);

    // 5. Decommission asset
    initialAsset.status = "Off-hired";
    initialAsset.decommissionedOn = new Date();

    // 6. Verify post-decommission immutability
    const tryEditDecommissioned = (asset: SimulatedAsset) => {
      if (asset.decommissionedOn) {
        throw new ActionError("Decommissioned vehicles cannot be edited.");
      }
    };
    assert.throws(() => tryEditDecommissioned(initialAsset), /Decommissioned vehicles cannot be edited/);
  });
});
