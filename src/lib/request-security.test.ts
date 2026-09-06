import assert from "node:assert/strict";
import test from "node:test";

import { isPrivateFileReference, isSafeAppPath, requireSameOrigin } from "./request-security";
import { toCsv } from "./reporting";

test("cookie-authenticated mutations require the exact application origin", () => {
  assert.doesNotThrow(() => requireSameOrigin(new Request("https://fleet.example/api/fuel", { headers: { origin: "https://fleet.example" } })));
  assert.throws(() => requireSameOrigin(new Request("https://fleet.example/api/fuel", { headers: { origin: "https://evil.example" } })));
  assert.throws(() => requireSameOrigin(new Request("https://fleet.example/api/fuel")));
});

test("evidence links and notification destinations cannot become executable or external URLs", () => {
  assert.ok(isPrivateFileReference("/api/files?blob=https%3A%2F%2Fstore.blob.vercel-storage.com%2Fprivate%2Fa.jpg"));
  assert.ok(!isPrivateFileReference("javascript:alert(1)"));
  assert.ok(!isPrivateFileReference("https://evil.example/file"));
  assert.ok(isSafeAppPath("/fleet/asset-1"));
  assert.ok(!isSafeAppPath("//evil.example"));
  assert.ok(!isSafeAppPath("https://evil.example"));
});

test("CSV exports neutralize spreadsheet formulas without changing ordinary values", () => {
  const csv = toCsv([{ name: "Loader", note: "=HYPERLINK(\"https://evil.example\")", amount: 0 }]);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /Loader/);
});
