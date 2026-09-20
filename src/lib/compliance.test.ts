import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  requiredDocsFor,
  docState,
  assetCompliance,
  renewalForecast,
  REQUIRED_DOCS,
  REQUIRED_DOCS_BY_CLASS,
  BLOCKING_DOCS,
  type DocLite,
} from "./compliance.ts";

const now = new Date("2026-09-01T12:00:00Z");

describe("required documents resolution by category and class", () => {
  test("commercial vehicle requires complete 6-document suite", () => {
    const docs = requiredDocsFor("VEHICLE", "TIPPER");
    assert.deepEqual(docs, REQUIRED_DOCS.VEHICLE);
    assert.ok(docs.includes("RC"));
    assert.ok(docs.includes("Fitness"));
    assert.ok(docs.includes("Permit"));
    assert.ok(docs.includes("Insurance"));
    assert.ok(docs.includes("PUC"));
    assert.ok(docs.includes("RoadTax"));
  });

  test("stationary plant or crusher requires only insurance", () => {
    const plantDocs = requiredDocsFor("EQUIPMENT", "PLANT");
    assert.deepEqual(plantDocs, ["Insurance"]);

    const crusherDocs = requiredDocsFor("EQUIPMENT", "CRUSHER");
    assert.deepEqual(crusherDocs, ["Insurance"]);
  });

  test("private and staff vehicles do not require commercial permit or fitness", () => {
    const bikeDocs = requiredDocsFor("VEHICLE", "BIKE");
    assert.deepEqual(bikeDocs, ["RC", "Insurance", "PUC"]);
    assert.ok(!bikeDocs.includes("Permit"));
    assert.ok(!bikeDocs.includes("Fitness"));

    const carDocs = requiredDocsFor("VEHICLE", "CAR");
    assert.deepEqual(carDocs, ["RC", "Insurance", "PUC"]);
  });

  test("falls back to category when class override is not defined", () => {
    const equipDocs = requiredDocsFor("EQUIPMENT", "CUSTOM_EQUIP");
    assert.deepEqual(equipDocs, ["Insurance"]);
  });
});

describe("document expiry state determination", () => {
  test("document expiring in 60 days is valid with standard 30-day reminder", () => {
    const expiry = new Date("2026-10-31T12:00:00Z"); // ~60 days
    const res = docState(expiry, 30, now);
    assert.equal(res.state, "valid");
    assert.ok(res.days > 30);
  });

  test("document expiring in 15 days is expiring with 30-day reminder", () => {
    const expiry = new Date("2026-09-16T12:00:00Z"); // 15 days
    const res = docState(expiry, 30, now);
    assert.equal(res.state, "expiring");
    assert.equal(res.days, 15);
  });

  test("document expired yesterday is marked expired", () => {
    const expiry = new Date("2026-08-31T12:00:00Z"); // -1 day
    const res = docState(expiry, 30, now);
    assert.equal(res.state, "expired");
    assert.equal(res.days, -1);
  });
});

describe("asset compliance assessment", () => {
  const mkDoc = (docType: string, expiry: string, reminderDays = 30): DocLite => ({
    id: `doc-${docType}`,
    docType,
    number: `NUM-${docType}`,
    issueDate: new Date("2025-01-01"),
    expiryDate: new Date(expiry),
    reminderDays,
    documentUrl: null,
  });

  test("machine with all required valid documents is 100% operable", () => {
    const plantDocs: DocLite[] = [mkDoc("Insurance", "2027-01-01")];
    const res = assetCompliance("asset-p1", "EQUIPMENT", plantDocs, now, "PLANT");

    assert.equal(res.operable, true);
    assert.equal(res.score, 100);
    assert.equal(res.expired, 0);
    assert.equal(res.missing, 0);
  });

  test("missing mandatory document marks asset not operable", () => {
    // Tipper requires RC, Insurance, Fitness, Permit, PUC, RoadTax.
    // Providing only RC.
    const res = assetCompliance("asset-t1", "VEHICLE", [mkDoc("RC", "2027-01-01")], now, "TIPPER");

    assert.equal(res.operable, false, "missing Insurance/Fitness/Permit/PUC must block operation");
    assert.ok(res.missing >= 4);
    assert.ok(res.score < 50);
  });

  test("expired blocking document marks asset not operable", () => {
    const bikeDocs: DocLite[] = [
      mkDoc("RC", "2027-01-01"),
      mkDoc("Insurance", "2026-08-01"), // Expired a month ago!
      mkDoc("PUC", "2026-12-01"),
    ];
    const res = assetCompliance("asset-b1", "VEHICLE", bikeDocs, now, "BIKE");

    assert.equal(res.operable, false);
    assert.equal(res.expired, 1);
    const insuranceFinding = res.findings.find((f) => f.docType === "Insurance");
    assert.equal(insuranceFinding?.state, "expired");
    assert.equal(insuranceFinding?.blocking, true);
    assert.ok(insuranceFinding?.message.includes("expired"));
  });

  test("document in renewal window (expiring) remains operable and counts toward good score", () => {
    const bikeDocs: DocLite[] = [
      mkDoc("RC", "2027-01-01"),
      mkDoc("Insurance", "2026-09-10"), // Expires in 9 days (within 30-day reminder)
      mkDoc("PUC", "2026-12-01"),
    ];
    const res = assetCompliance("asset-b2", "VEHICLE", bikeDocs, now, "BIKE");

    assert.equal(res.operable, true, "expiring document is still valid today");
    assert.equal(res.score, 100, "all 3 docs are in date today");
    assert.equal(res.expiring, 1);
    const ins = res.findings.find((f) => f.docType === "Insurance");
    assert.equal(ins?.state, "expiring");
    assert.ok(ins?.message.includes("expires in"));
    const rc = res.findings.find((f) => f.docType === "RC");
    assert.equal(rc?.state, "valid");
    assert.ok(rc?.message.includes("valid for"));
  });

  test("renewed document supersedes older expired record", () => {
    const docs: DocLite[] = [
      mkDoc("Insurance", "2026-08-01"), // Old expired policy
      mkDoc("Insurance", "2027-08-01"), // New renewed policy
    ];
    const res = assetCompliance("asset-p2", "EQUIPMENT", docs, now, "PLANT");

    assert.equal(res.operable, true);
    assert.equal(res.expired, 0);
    assert.equal(res.score, 100);
  });

  test("documents held beyond required list are reported and advisory", () => {
    const docs: DocLite[] = [
      mkDoc("Insurance", "2027-01-01"),
      mkDoc("EXTRA_CERT", "2026-08-01"), // Expired extra doc
      mkDoc("EXTRA_VALID", "2027-08-01"), // Valid extra doc
    ];
    const res = assetCompliance("asset-p3", "EQUIPMENT", docs, now, "PLANT");
    assert.equal(res.operable, true, "extra document expiry must not block operation");
    const extraExp = res.findings.find((f) => f.docType === "EXTRA_CERT");
    assert.equal(extraExp?.blocking, false);
    assert.ok(extraExp?.message.includes("expired"));
    const extraVal = res.findings.find((f) => f.docType === "EXTRA_VALID");
    assert.ok(extraVal?.message.includes("valid for"));
  });
});

describe("compliance renewal forecasting", () => {
  test("aggregates costs for documents due within the horizon", () => {
    const docs = [
      { docType: "Insurance", expiryDate: new Date("2026-09-15"), cost: 25000 },
      { docType: "Fitness", expiryDate: new Date("2026-09-20"), cost: 8000 },
      { docType: "Insurance", expiryDate: new Date("2026-09-25"), cost: 22000 },
      { docType: "RoadTax", expiryDate: new Date("2026-12-01"), cost: 15000 }, // beyond 30-day cutoff
    ];

    const forecast = renewalForecast(docs, 30, now);
    assert.equal(forecast.count, 3);
    assert.equal(forecast.total, 55000);
    assert.equal(forecast.byType.length, 2);
    assert.equal(forecast.byType[0].docType, "Insurance");
    assert.equal(forecast.byType[0].cost, 47000);
    assert.equal(forecast.byType[1].docType, "Fitness");
    assert.equal(forecast.byType[1].cost, 8000);
  });
});

describe("statutory constants contracts", () => {
  test("REQUIRED_DOCS_BY_CLASS and BLOCKING_DOCS expose mandatory safety document sets", () => {
    assert.ok(REQUIRED_DOCS_BY_CLASS.BIKE.includes("PUC"));
    assert.ok(REQUIRED_DOCS_BY_CLASS.PLANT.includes("Insurance"));
    assert.ok(BLOCKING_DOCS.has("Fitness"));
    assert.ok(BLOCKING_DOCS.has("Insurance"));
  });
});

