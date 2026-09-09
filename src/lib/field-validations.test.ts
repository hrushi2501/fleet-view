import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  finiteNumber,
  formNumber,
  positiveNumber,
  nonNegativeNumber,
  boundedNumber,
  percentageNumber,
  coordinatePair,
  validateDateRange,
  oneOf,
} from "./input-validation";
import { validateWeighbridgeWeights } from "./weighbridge";
import { ActionError } from "./action-error";

describe("Validation: finiteNumber & formNumber", () => {
  it("parses valid numbers and string representations", () => {
    assert.equal(finiteNumber(42, "Field"), 42);
    assert.equal(finiteNumber("123.45", "Field"), 123.45);
    assert.equal(finiteNumber("-15", "Field"), -15);
    assert.equal(finiteNumber("0", "Field"), 0);
  });

  it("rejects non-finite numbers: NaN, Infinity, -Infinity", () => {
    assert.throws(() => finiteNumber(NaN, "Field"), /must be a finite number/);
    assert.throws(() => finiteNumber(Infinity, "Field"), /must be a finite number/);
    assert.throws(() => finiteNumber(-Infinity, "Field"), /must be a finite number/);
    assert.throws(() => finiteNumber("abc", "Field"), /must be a finite number/);
  });

  it("rejects non-numeric objects and types", () => {
    assert.throws(() => finiteNumber({}, "Field"), /must be a number/);
    assert.throws(() => finiteNumber([], "Field"), /must be a number/);
    assert.throws(() => finiteNumber(true, "Field"), /must be a number/);
    assert.throws(() => finiteNumber(() => {}, "Field"), /must be a number/);
  });

  it("handles empty values with fallback or error", () => {
    assert.throws(() => finiteNumber(null, "RequiredField"), /RequiredField is required/);
    assert.throws(() => finiteNumber(undefined, "RequiredField"), /RequiredField is required/);
    assert.throws(() => finiteNumber("   ", "RequiredField"), /RequiredField is required/);
    assert.equal(finiteNumber(null, "OptionalField", { fallback: 10 }), 10);
    assert.equal(finiteNumber("", "OptionalField", { fallback: 0 }), 0);
  });

  it("formNumber defaults to zero fallback", () => {
    const fd = new FormData();
    assert.equal(formNumber(fd, "testValue"), 0);
    fd.set("testValue", "85.5");
    assert.equal(formNumber(fd, "testValue"), 85.5);
    fd.set("testValue", "not_a_number");
    assert.throws(() => formNumber(fd, "testValue"), /must be a finite number/);
  });
});

describe("Validation: positiveNumber", () => {
  it("accepts strictly positive values", () => {
    assert.equal(positiveNumber(1, "Quantity"), 1);
    assert.equal(positiveNumber("0.001", "Quantity"), 0.001);
    assert.equal(positiveNumber(5000, "Quantity"), 5000);
  });

  it("rejects zero and negative zero", () => {
    assert.throws(() => positiveNumber(0, "Quantity"), /must be greater than zero/);
    assert.throws(() => positiveNumber(-0, "Quantity"), /must be greater than zero/);
    assert.throws(() => positiveNumber("0", "Quantity"), /must be greater than zero/);
  });

  it("rejects negative numbers", () => {
    assert.throws(() => positiveNumber(-1, "Quantity"), /must be at least 0/);
    assert.throws(() => positiveNumber("-999", "Quantity"), /must be at least 0/);
    assert.throws(() => positiveNumber(-0.0001, "Quantity"), /must be at least 0/);
  });

  it("enforces optional max boundary", () => {
    assert.equal(positiveNumber(100, "Quantity", { max: 100 }), 100);
    assert.throws(() => positiveNumber(100.01, "Quantity", { max: 100 }), /must be at most 100/);
  });
});

describe("Validation: nonNegativeNumber", () => {
  it("accepts zero and positive values", () => {
    assert.equal(nonNegativeNumber(0, "Rate"), 0);
    assert.equal(nonNegativeNumber("0", "Rate"), 0);
    assert.equal(nonNegativeNumber(250.75, "Rate"), 250.75);
  });

  it("rejects negative numbers", () => {
    assert.throws(() => nonNegativeNumber(-0.01, "Rate"), /must be at least 0/);
    assert.throws(() => nonNegativeNumber(-500, "Rate"), /must be at least 0/);
  });

  it("enforces maximum bound", () => {
    assert.equal(nonNegativeNumber(5000, "Amount", { max: 5000 }), 5000);
    assert.throws(() => nonNegativeNumber(5000.1, "Amount", { max: 5000 }), /must be at most 5000/);
  });
});

describe("Validation: boundedNumber", () => {
  it("accepts values inside [min, max]", () => {
    assert.equal(boundedNumber(50, "Speed", { min: 0, max: 120 }), 50);
    assert.equal(boundedNumber(0, "Speed", { min: 0, max: 120 }), 0);
    assert.equal(boundedNumber(120, "Speed", { min: 0, max: 120 }), 120);
  });

  it("rejects values below min or above max", () => {
    assert.throws(() => boundedNumber(-1, "Speed", { min: 0, max: 120 }), /must be at least 0/);
    assert.throws(() => boundedNumber(120.001, "Speed", { min: 0, max: 120 }), /must be at most 120/);
    assert.throws(() => boundedNumber(1e12, "Speed", { min: 0, max: 120 }), /must be at most 120/);
  });

  it("enforces integer constraint when specified", () => {
    assert.equal(boundedNumber(5, "Trips", { min: 0, max: 100, integer: true }), 5);
    assert.throws(() => boundedNumber(5.5, "Trips", { min: 0, max: 100, integer: true }), /must be a whole integer/);
    assert.throws(() => boundedNumber(0.1, "Trips", { min: 0, max: 100, integer: true }), /must be a whole integer/);
  });
});

describe("Validation: percentageNumber", () => {
  it("accepts valid percentages between 0 and 100", () => {
    assert.equal(percentageNumber(0, "Score"), 0);
    assert.equal(percentageNumber(50.5, "Score"), 50.5);
    assert.equal(percentageNumber(100, "Score"), 100);
  });

  it("rejects negative percentages and values > 100", () => {
    assert.throws(() => percentageNumber(-1, "Score"), /must be at least 0/);
    assert.throws(() => percentageNumber(-50, "Score"), /must be at least 0/);
    assert.throws(() => percentageNumber(100.01, "Score"), /must be at most 100/);
    assert.throws(() => percentageNumber(150, "Score"), /must be at most 100/);
    assert.throws(() => percentageNumber(99999, "Score"), /must be at most 100/);
  });
});

describe("Validation: coordinatePair", () => {
  it("returns nulls when both latitude and longitude are omitted", () => {
    assert.deepEqual(coordinatePair(null, null), { lat: null, lng: null });
    assert.deepEqual(coordinatePair("", ""), { lat: null, lng: null });
    assert.deepEqual(coordinatePair(undefined, undefined), { lat: null, lng: null });
  });

  it("rejects when only one coordinate is provided", () => {
    assert.throws(() => coordinatePair("26.9", null), /require both latitude and longitude/);
    assert.throws(() => coordinatePair(null, "75.8"), /require both latitude and longitude/);
    assert.throws(() => coordinatePair("26.9", ""), /require both latitude and longitude/);
  });

  it("accepts valid geographic coordinates", () => {
    const coords = coordinatePair(26.9124, 75.7873);
    assert.equal(coords.lat, 26.9124);
    assert.equal(coords.lng, 75.7873);

    const boundary = coordinatePair(-90, 180);
    assert.equal(boundary.lat, -90);
    assert.equal(boundary.lng, 180);
  });

  it("rejects latitude outside [-90, 90]", () => {
    assert.throws(() => coordinatePair(90.1, 75), /Latitude must be at most 90/);
    assert.throws(() => coordinatePair(-90.1, 75), /Latitude must be at least -90/);
    assert.throws(() => coordinatePair(500, 75), /Latitude must be at most 90/);
  });

  it("rejects longitude outside [-180, 180]", () => {
    assert.throws(() => coordinatePair(25, 180.1), /Longitude must be at most 180/);
    assert.throws(() => coordinatePair(25, -180.1), /Longitude must be at least -180/);
    assert.throws(() => coordinatePair(25, 1000), /Longitude must be at most 180/);
  });
});

describe("Validation: validateDateRange", () => {
  it("accepts valid chronological dates", () => {
    assert.doesNotThrow(() => validateDateRange("2026-01-01", "2026-01-02"));
    assert.doesNotThrow(() => validateDateRange(new Date("2026-01-01"), new Date("2026-01-01")));
  });

  it("ignores when either date is missing", () => {
    assert.doesNotThrow(() => validateDateRange("2026-01-01", null));
    assert.doesNotThrow(() => validateDateRange(null, "2026-01-02"));
  });

  it("rejects when end date is earlier than start date", () => {
    assert.throws(
      () => validateDateRange("2026-05-10", "2026-05-01", "Contract"),
      /End date cannot be earlier than start date for Contract/
    );
  });

  it("rejects invalid date strings", () => {
    assert.throws(
      () => validateDateRange("invalid-date", "2026-05-01"),
      /Invalid date provided/
    );
  });
});

describe("Validation: oneOf enumeration", () => {
  const ROLES = ["ADMIN", "SUPERVISOR", "DRIVER"] as const;

  it("accepts matching values", () => {
    assert.equal(oneOf("ADMIN", ROLES, "role"), "ADMIN");
    assert.equal(oneOf("DRIVER", ROLES, "role"), "DRIVER");
  });

  it("rejects non-matching and case-mismatched values", () => {
    assert.throws(() => oneOf("admin", ROLES, "role"), /Invalid role/);
    assert.throws(() => oneOf("HACKER", ROLES, "role"), /Invalid role/);
    assert.throws(() => oneOf("", ROLES, "role"), /Invalid role/);
  });
});

describe("Domain Validation: Weighbridge Physical Boundaries", () => {
  it("accepts valid gross, tare, and derived net weights", () => {
    const res = validateWeighbridgeWeights({ grossKg: 40_000, tareKg: 15_000 });
    assert.equal(res.valid, true);
    assert.equal(res.computedNetKg, 25_000);
  });

  it("rejects non-matching explicit net weight", () => {
    const res = validateWeighbridgeWeights({ grossKg: 40_000, tareKg: 15_000, netKg: 30_000 });
    assert.equal(res.valid, false);
    assert.match(res.error!, /Net weight must equal gross minus tare weight/i);
  });

  it("rejects gross weight less than tare weight", () => {
    const res = validateWeighbridgeWeights({ grossKg: 10_000, tareKg: 15_000 });
    assert.equal(res.valid, false);
    assert.match(res.error!, /cannot be less than empty tare weight/i);
  });

  it("rejects negative gross and tare weights", () => {
    assert.equal(validateWeighbridgeWeights({ grossKg: -100, tareKg: 1000 }).valid, false);
    assert.equal(validateWeighbridgeWeights({ grossKg: 1000, tareKg: -50 }).valid, false);
  });

  it("rejects unrealistic weights exceeding maximum 150 tonnes", () => {
    assert.equal(validateWeighbridgeWeights({ grossKg: 200_000, tareKg: 10_000 }).valid, false);
    assert.equal(validateWeighbridgeWeights({ grossKg: 50_000, tareKg: 160_000 }).valid, false);
  });
});

describe("Domain Validation: Asset Physical Constraints", () => {
  it("validates laden weight >= unladen weight", () => {
    const checkLadenUnladen = (laden: number | null, unladen: number | null) => {
      if (laden !== null && unladen !== null && laden < unladen) {
        throw new ActionError("Gross laden weight cannot be less than unladen (tare) weight.");
      }
    };

    assert.doesNotThrow(() => checkLadenUnladen(28_000, 10_500));
    assert.doesNotThrow(() => checkLadenUnladen(null, 10_500));
    assert.throws(() => checkLadenUnladen(10_000, 15_000), /Gross laden weight cannot be less than unladen/);
  });

  it("validates manufacturing year boundaries [1950 ... currentYear + 1]", () => {
    const currentYear = new Date().getFullYear();
    const validateYear = (val: unknown) =>
      boundedNumber(val, "Manufacturing year", { min: 1950, max: currentYear + 1, integer: true });

    assert.equal(validateYear(2022), 2022);
    assert.throws(() => validateYear(1899), /must be at least 1950/);
    assert.throws(() => validateYear(3000), /must be at most/);
    assert.throws(() => validateYear(2020.5), /must be a whole integer/);
  });

  it("validates odometer/meter limits [0 ... 10,000,000 km]", () => {
    const validateMeter = (val: unknown) =>
      boundedNumber(val, "Meter reading", { min: 0, max: 10_000_000 });

    assert.equal(validateMeter(0), 0);
    assert.equal(validateMeter(150_000), 150_000);
    assert.throws(() => validateMeter(-50), /must be at least 0/);
    assert.throws(() => validateMeter(10_000_001), /must be at most 10000000/);
    assert.throws(() => validateMeter(1e12), /must be at most 10000000/);
  });
});

describe("Domain Validation: Tyre Tread Depths & Life", () => {
  it("rejects current tread depth exceeding new tyre tread depth", () => {
    const checkTread = (treadNew: number, currentTread: number) => {
      const validNew = boundedNumber(treadNew, "New tyre tread depth", { min: 5, max: 60 });
      const validCurrent = boundedNumber(currentTread, "Current tyre tread depth", { min: 0, max: 60 });
      if (validCurrent > validNew) {
        throw new ActionError("Current tread depth cannot exceed new tyre tread depth.");
      }
      return { validNew, validCurrent };
    };

    assert.deepEqual(checkTread(20, 15), { validNew: 20, validCurrent: 15 });
    assert.deepEqual(checkTread(20, 20), { validNew: 20, validCurrent: 20 });
    assert.throws(() => checkTread(18, 25), /Current tread depth cannot exceed new tyre tread depth/);
    assert.throws(() => checkTread(-5, 10), /New tyre tread depth must be at least 5/);
    assert.throws(() => checkTread(100, 20), /New tyre tread depth must be at most 60/);
    assert.throws(() => checkTread(20, -1), /Current tyre tread depth must be at least 0/);
  });
});

describe("Domain Validation: Production & Daily Shift Limits", () => {
  it("enforces workedHours + idleHours <= 24 in a single shift", () => {
    const checkShiftHours = (worked: number, idle: number) => {
      const w = boundedNumber(worked, "Worked hours", { min: 0, max: 24 });
      const i = boundedNumber(idle, "Idle hours", { min: 0, max: 24 });
      if (w + i > 24) {
        throw new ActionError("Total hours (worked + idle) cannot exceed 24 hours for a single shift.");
      }
      return w + i;
    };

    assert.equal(checkShiftHours(10, 2), 12);
    assert.equal(checkShiftHours(24, 0), 24);
    assert.throws(() => checkShiftHours(16, 10), /Total hours \(worked \+ idle\) cannot exceed 24/);
    assert.throws(() => checkShiftHours(-2, 5), /Worked hours must be at least 0/);
    assert.throws(() => checkShiftHours(25, 0), /Worked hours must be at most 24/);
  });

  it("enforces production targetLow <= targetHigh", () => {
    const checkNorm = (low: number, high: number) => {
      const l = nonNegativeNumber(low, "Target low");
      const h = nonNegativeNumber(high, "Target high");
      if (l > h) throw new ActionError("Target low cannot exceed target high.");
      return { l, h };
    };

    assert.deepEqual(checkNorm(20, 40), { l: 20, h: 40 });
    assert.deepEqual(checkNorm(30, 30), { l: 30, h: 30 });
    assert.throws(() => checkNorm(50, 40), /Target low cannot exceed target high/);
    assert.throws(() => checkNorm(-10, 40), /Target low must be at least 0/);
  });
});

describe("Domain Validation: Hire Daily Logsheet Limits", () => {
  it("enforces worked + idle + breakdown <= 24 in a single day", () => {
    const checkDayLog = (w: number, i: number, b: number) => {
      const worked = boundedNumber(w, "Worked hours", { min: 0, max: 24 });
      const idle = boundedNumber(i, "Idle hours", { min: 0, max: 24 });
      const breakdown = boundedNumber(b, "Breakdown hours", { min: 0, max: 24 });
      if (worked + idle + breakdown > 24) {
        throw new ActionError("Sum of worked, idle, and breakdown hours cannot exceed 24 hours in a single day.");
      }
      return worked + idle + breakdown;
    };

    assert.equal(checkDayLog(8, 2, 4), 14);
    assert.equal(checkDayLog(24, 0, 0), 24);
    assert.throws(() => checkDayLog(12, 8, 6), /Sum of worked, idle, and breakdown hours cannot exceed 24/);
    assert.throws(() => checkDayLog(-1, 0, 0), /Worked hours must be at least 0/);
  });
});
