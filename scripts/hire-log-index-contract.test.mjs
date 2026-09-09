import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const sql = readFileSync(new URL("../prisma/sql/drop-redundant-hire-log-index.sql", import.meta.url), "utf8");

test("HireLog keeps one composite index through its unique constraint", () => {
  const hireLog = schema.match(/model HireLog \{[\s\S]*?\n\}/)?.[0];
  assert.ok(hireLog, "HireLog model must exist");
  assert.match(hireLog, /@@unique\(\[contractId, date\]\)/);
  assert.doesNotMatch(hireLog, /@@index\(\[contractId, date\]\)/);
});

test("redundant HireLog index cleanup cannot weaken its uniqueness constraint", () => {
  assert.match(sql, /DROP INDEX IF EXISTS public\."HireLog_contractId_date_idx";/);
  assert.doesNotMatch(sql, /DROP\s+CONSTRAINT/i);
  assert.doesNotMatch(sql, /HireLog_contractId_date_key[^\n]*DROP/i);
});
