import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

test("Leaflet's local z-index scale cannot overtake global overlays", () => {
  // Leaflet uses high z-index panes internally. Each map owner must establish a
  // z=0 stacking context so a 1000-level map control remains below the sticky
  // top bar, notification drawer, modals, command palette, and toast layer.
  for (const component of ["src/components/FleetEdgeConsole.tsx", "src/components/LiveMap.tsx"]) {
    assert.match(
      read(component),
      /relative z-0 isolate[^"`]*overflow-hidden/,
      `${component} must contain its map panes`,
    );
  }

  const topbar = read("src/components/Topbar.tsx");
  assert.match(topbar, /sticky top-0 z-20/, "the global header must remain above ordinary page content");
  assert.match(topbar, /top-\[calc\(100%\+0\.5rem\)\] z-50/, "notification drawer must sit above its header");
});
