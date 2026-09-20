import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Database Safety & Hermetic Test Invariants", () => {
  test("unit test environment never exposes ambient DATABASE_URL to prevent accidental DB writes", () => {
    // Under scripts/test-setup.mjs, ambient database connection variables are scrubbed
    assert.equal(
      process.env.DATABASE_URL,
      undefined,
      "DATABASE_URL must be undefined during unit tests to guarantee zero live DB mutations"
    );
    assert.equal(
      process.env.DATABASE_URL_UNPOOLED,
      undefined,
      "DATABASE_URL_UNPOOLED must be undefined during unit tests"
    );
  });

  test("integration test gate strictly rejects non-local or non-test databases", () => {
    // Validate the exact gate logic from tests/integration/hardening.test.ts
    const isSafeTestDb = (connStr: string) => {
      try {
        const url = new URL(connStr);
        return (
          ["localhost", "127.0.0.1"].includes(url.hostname) &&
          url.pathname.endsWith("_test")
        );
      } catch {
        return false;
      }
    };

    // Live or dangerous database targets that MUST be rejected:
    assert.equal(isSafeTestDb("postgresql://postgres:secret@db.supabase.co:6543/postgres"), false, "Must reject remote Supabase DB");
    assert.equal(isSafeTestDb("postgresql://app:secret@aws-0.neon.tech/fleetview_prod"), false, "Must reject remote Neon DB");
    assert.equal(isSafeTestDb("postgresql://postgres:secret@localhost:5432/fleetview"), false, "Must reject local non-test DB");
    assert.equal(isSafeTestDb("postgresql://postgres:secret@localhost:5432/fleetview_dev"), false, "Must reject local dev DB");
    assert.equal(isSafeTestDb("postgresql://postgres:secret@127.0.0.1:5432/postgres"), false, "Must reject default postgres DB");

    // Only strictly isolated local test DBs are permitted:
    assert.equal(isSafeTestDb("postgresql://postgres:secret@localhost:5432/fleetview_test"), true, "Must accept localhost *_test DB");
    assert.equal(isSafeTestDb("postgresql://postgres:secret@127.0.0.1:5432/my_app_test"), true, "Must accept 127.0.0.1 *_test DB");
  });

  test("no unit test in src/**/*.test.ts contains direct database write queries", () => {
    const srcDir = path.resolve(process.cwd(), "src");
    const testFiles: string[] = [];

    function findTests(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findTests(full);
        } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
          testFiles.push(full);
        }
      }
    }

    findTests(srcDir);
    assert.ok(testFiles.length >= 30, `Expected at least 30 test files in src, found ${testFiles.length}`);

    // Mutating patterns that should NEVER appear in unit tests
    const forbiddenWritePatterns = [
      /rawDb\.\w+\.create\(/,
      /rawDb\.\w+\.update\(/,
      /rawDb\.\w+\.delete\(/,
      /rawDb\.\w+\.upsert\(/,
      /db\.\w+\.create\(/,
      /db\.\w+\.update\(/,
      /db\.\w+\.delete\(/,
      /db\.\w+\.upsert\(/,
    ];

    for (const file of testFiles) {
      const content = fs.readFileSync(file, "utf8");
      for (const pattern of forbiddenWritePatterns) {
        assert.ok(
          !pattern.test(content),
          `Hermetic violation: Unit test ${path.basename(file)} contains potential DB write: ${pattern}`
        );
      }
    }
  });

  test("mutation runner scripts/mutation-test.mjs explicitly scrubs database credentials", () => {
    const runnerSource = fs.readFileSync(
      path.resolve(process.cwd(), "scripts/mutation-test.mjs"),
      "utf8"
    );
    assert.match(runnerSource, /delete sanitizedEnv\.DATABASE_URL/);
    assert.match(runnerSource, /delete sanitizedEnv\.TEST_DATABASE_URL/);
  });
});
