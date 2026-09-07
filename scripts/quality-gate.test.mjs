import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const workflow = await readFile(new URL("../.github/workflows/dependency-audit.yml", import.meta.url), "utf8");

test("quality commands keep the required checks in one predictable order", () => {
  assert.equal(pkg.scripts.test, "node --import ./scripts/test-setup.mjs --test 'src/**/*.test.ts'");
  assert.equal(pkg.scripts["test:all"], "npm test && npm run test:deploy");
  assert.equal(pkg.scripts.check, "npm run lint && tsc --noEmit && npm run test:all");
  assert.equal(pkg.scripts.verify, "npm run check && npm run build");
  assert.equal(pkg.scripts["verify:integration"], "npm run verify && npm run test:integration");
  assert.equal(pkg.scripts["verify:release"], "npm run verify:integration && npm run db:check");
});

test("pull requests and protected branches run the full code-quality gate", () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches: \[main, master\]/);
  assert.match(workflow, /- run: npm run verify/);
});
