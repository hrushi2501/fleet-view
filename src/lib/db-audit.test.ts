import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateSchemaAlignment } from "./db-audit";
import { Prisma } from "@prisma/client";

describe("Database Audits & Schema Uniformity", () => {
  describe("evaluateSchemaAlignment pure logic", () => {
    const mockModels = [
      {
        name: "Asset",
        dbName: null,
        fields: [
          { kind: "scalar", name: "id", dbName: null },
          { kind: "scalar", name: "code", dbName: null },
          { kind: "enum", name: "status", dbName: null },
          { kind: "object", name: "driver", dbName: null }, // Relational, should be ignored
        ],
      },
      {
        name: "User",
        dbName: "users",
        fields: [
          { kind: "scalar", name: "id", dbName: null },
          { kind: "scalar", name: "emailAddress", dbName: "email" },
        ],
      },
    ];

    test("returns synced: true when all tables and scalar columns are present", () => {
      const dbColumns = new Map<string, Set<string>>([
        ["Asset", new Set(["id", "code", "status", "untrackedExtraColumn"])],
        ["users", new Set(["id", "email"])],
      ]);

      const report = evaluateSchemaAlignment(mockModels, dbColumns);
      assert.equal(report.synced, true);
      assert.equal(report.totalModels, 2);
      assert.equal(report.matchedModels, 2);
      assert.deepEqual(report.missingTables, []);
      assert.deepEqual(report.missingColumns, []);
    });

    test("flags missing tables accurately", () => {
      const dbColumns = new Map<string, Set<string>>([
        ["Asset", new Set(["id", "code", "status"])],
        // "users" table is missing completely
      ]);

      const report = evaluateSchemaAlignment(mockModels, dbColumns);
      assert.equal(report.synced, false);
      assert.equal(report.matchedModels, 1);
      assert.deepEqual(report.missingTables, ["users"]);
      assert.deepEqual(report.missingColumns, []);
    });

    test("flags missing columns inside existing tables", () => {
      const dbColumns = new Map<string, Set<string>>([
        ["Asset", new Set(["id", "code"])], // "status" column is missing
        ["users", new Set(["id", "email"])],
      ]);

      const report = evaluateSchemaAlignment(mockModels, dbColumns);
      assert.equal(report.synced, false);
      assert.equal(report.matchedModels, 1);
      assert.deepEqual(report.missingTables, []);
      assert.deepEqual(report.missingColumns, ["Asset.status"]);
    });

    test("handles empty models or empty db gracefully", () => {
      const report = evaluateSchemaAlignment([], new Map());
      assert.equal(report.synced, true);
      assert.equal(report.totalModels, 0);
      assert.equal(report.matchedModels, 0);
    });
  });

  describe("Prisma DMMF model contract integrity", () => {
    test("every application model in Prisma DMMF has a non-empty name and scalar fields", () => {
      const models = Prisma.dmmf.datamodel.models;
      assert.ok(models.length >= 60, `Expected at least 60 models, found ${models.length}`);

      const names = new Set<string>();
      for (const m of models) {
        assert.ok(m.name.length > 0);
        assert.ok(!names.has(m.name), `Duplicate model name: ${m.name}`);
        names.add(m.name);

        const scalars = m.fields.filter((f) => f.kind === "scalar");
        assert.ok(scalars.length > 0, `Model ${m.name} must have at least one scalar field`);
      }
    });

    test("core compliance and operational models are present in schema", () => {
      const modelNames = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name));
      const required = [
        "Asset",
        "Driver",
        "TripSession",
        "TelemetryReading",
        "FuelTransaction",
        "WorkOrder",
        "AuditEvent",
        "Setting",
        "ComplianceDoc",
      ];
      for (const req of required) {
        assert.ok(modelNames.has(req), `Missing required model: ${req}`);
      }
    });
  });
});
