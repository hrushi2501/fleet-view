/**
 * Leaflet's stylesheet is global browser state, not component state.
 *
 * The map modules are dynamically mounted client-only islands. Importing the
 * stylesheet from either island makes Next create a route-scoped React `<link>`
 * resource; unmounting a map can then tear down a link Leaflet/the browser has
 * already detached, which surfaces as `finishedRoot.parentNode.removeChild`.
 * Keeping the import in the root layout gives it one stable lifetime.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const LEAFLET_CSS = "leaflet/dist/leaflet.css";

describe("Leaflet stylesheet ownership", () => {
  test("is owned by the root layout, not a dynamically unmounted map", () => {
    assert.match(read("src/app/layout.tsx"), new RegExp(`import ["']${LEAFLET_CSS}["']`));

    for (const map of ["src/components/RajasthanMap.tsx", "src/components/FleetEdgeMap.tsx"]) {
      assert.doesNotMatch(read(map), new RegExp(LEAFLET_CSS), `${map} must not own the global stylesheet`);
    }
  });
});
