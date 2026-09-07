import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canPersistTelemetryFindings } from "./telemetry-ingestion";

test("simulated telemetry is never eligible to create operational findings", () => {
  assert.equal(canPersistTelemetryFindings({ simulated: true }), false);
  assert.equal(canPersistTelemetryFindings({ simulated: false }), true);
});

test("the fraud-scan route exits simulated runs before its persistence service", () => {
  const source = readFileSync(join(process.cwd(), "src/app/api/insight/ai-scan/route.ts"), "utf8");
  const guard = source.indexOf("if (!canPersistTelemetryFindings(adapter))");
  const persistence = source.indexOf("aiService.processTelemetry(stream)");

  assert.ok(guard >= 0, "simulated telemetry must have an explicit preview-only guard");
  assert.ok(persistence >= 0, "live telemetry must continue through the investigation service");
  assert.ok(guard < persistence, "the preview-only guard must run before any persistence can occur");
  assert.match(source.slice(guard, persistence), /persisted:\s*0/);
});
