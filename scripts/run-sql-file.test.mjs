import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("privileged SQL runner explicitly supports an owner connection", () => {
  const source = readFileSync(new URL("./run-sql-file.mjs", import.meta.url), "utf8");
  assert.match(source, /DATABASE_URL_OWNER/);
  assert.match(source, /DATABASE_URL_OWNER\?\.trim\(\)\s*\|\|\s*process\.env\.DATABASE_URL_UNPOOLED/);
});
