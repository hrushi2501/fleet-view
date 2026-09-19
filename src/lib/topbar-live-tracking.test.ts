import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

test("the top bar links directly to live asset tracking for permitted users", () => {
  const layout = read("src/app/(app)/layout.tsx");
  const topbar = read("src/components/Topbar.tsx");

  assert.match(
    layout,
    /liveTrackingHref=\{access\.can\("fleet\.view"\) \? "\/fleet\/tracking" : null\}/,
    "the layout must not offer tracking without fleet.view",
  );
  assert.match(topbar, /href=\{liveTrackingHref\}/);
  assert.match(topbar, /Open live asset tracking/);
  assert.match(topbar, /<QuickActionMenu[^>]*>[\s\S]*liveTrackingHref/,
    "live tracking should sit beside the quick actions control",
  );
});
