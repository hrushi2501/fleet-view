/**
 * Tests for role banding, menu derivation and query scoping.
 *
 * The restructure's central claim is that a driver cannot reach office data and
 * a supervisor cannot reach another site's — by URL, by API, or by any other
 * route. These cover the pure decision logic behind that claim; the HTTP-level
 * proof lives in the acceptance run against the three seeded roles.
 *
 * Written as statements about what each group must never be handed, because
 * the failure mode here is silent: an over-broad `where` fragment leaks rows
 * without erroring, and a menu built from the wrong band looks perfectly fine.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { groupFor, assetScope, projectIdScope, projectScope, type Access } from "./access.ts";
import { navFor, MODULES, DRIVER_MODULES, ROUTE_MOVES } from "./navigation.ts";

/** An Access object without touching the database. */
function access(over: Partial<Access>): Access {
  const codes = over.codes ?? [];
  return {
    session: { id: "u1", name: "Test", email: "t@example.invalid", role: "SiteManager" },
    group: "SUPERVISOR",
    codes,
    can: (c: string) => codes.includes("*") || codes.includes(c),
    driverId: null,
    projectIds: null,
    ...over,
  } as Access;
}

// ---------------------------------------------------------------------------

describe("role banding", () => {
  test("a wildcard permission is an administrator", () => {
    assert.equal(groupFor("Admin", ["*"]), "ADMIN");
  });

  test("holding any admin permission puts you in the admin band", () => {
    assert.equal(groupFor("Auditor", ["fleet.view", "admin.audit"]), "ADMIN");
  });

  test("a site supervisor's permission set is operational, not admin", () => {
    const supervisor = ["fleet.view", "fuel.view", "production.edit", "people.view", "reports.view"];
    assert.equal(groupFor("SiteManager", supervisor), "SUPERVISOR");
  });

  test("a driver login is a driver even before roles are configured", () => {
    assert.equal(groupFor("Driver", []), "DRIVER");
    assert.equal(groupFor("Driver", ["fuel.issue"]), "DRIVER");
  });

  test("banding follows the permissions actually granted, not the role's name", () => {
    // A client who re-cuts a role in the Roles screen must get the navigation
    // that matches what they granted, not what the role used to be called.
    assert.equal(groupFor("FuelClerk", ["admin.users"]), "ADMIN");
  });
});

describe("the menu offers only what the server would honour", () => {
  const asAdmin = { group: "ADMIN" as const, can: () => true };
  const asSupervisor = {
    group: "SUPERVISOR" as const,
    can: (c: string) =>
      ["fleet.view", "fuel.view", "people.view", "production.view", "maintenance.view",
       "compliance.view", "reports.view", "hire.view", "weighbridge.view"].includes(c),
  };

  test("an administrator gets all nine modules", () => {
    const nav = navFor(asAdmin);
    assert.equal(nav.length, 9);
    assert.ok(nav.some((m) => m.href === "/admin"));
  });

  test("a supervisor never sees that an Admin area exists", () => {
    const nav = navFor(asSupervisor);
    assert.equal(nav.some((m) => m.href === "/admin"), false);
    assert.equal(nav.some((m) => m.label === "Admin"), false);
  });

  test("a supervisor is not offered cost or profit pages", () => {
    const hrefs = navFor(asSupervisor).flatMap((m) => (m.children ?? []).map((c) => c.href));
    assert.equal(hrefs.includes("/reports/costs"), false, "cost.view is not held");
    assert.equal(hrefs.includes("/reports/summary"), false);
  });

  test("a driver gets their own app, not a trimmed office menu", () => {
    const nav = navFor({ group: "DRIVER", can: () => true });
    assert.deepEqual(nav, DRIVER_MODULES);
    assert.ok(nav.every((m) => m.href === "/my" || m.href.startsWith("/my/")));
  });

  test("every menu entry names a permission its page can enforce", () => {
    for (const m of MODULES) {
      for (const c of m.children ?? []) {
        assert.ok(
          c.permission === null || /^[a-z]+\.[a-z]+$/.test(c.permission),
          `${c.href} has an unusable permission: ${c.permission}`,
        );
      }
    }
  });
});

describe("query scoping is what makes the restriction real", () => {
  test("an administrator is never scoped", () => {
    const a = access({ group: "ADMIN", codes: ["*"] });
    assert.deepEqual(assetScope(a), {});
    assert.deepEqual(projectIdScope(a), {});
  });

  test("a driver with no linked person record sees nothing, not everything", () => {
    // The dangerous default. A null driverId must not collapse into an empty
    // filter, which would return the entire fleet.
    const a = access({ group: "DRIVER", driverId: null });
    const scope = assetScope(a) as { driverId?: string };
    assert.equal(scope.driverId, "__none__");
    assert.notDeepEqual(assetScope(a), {});
  });

  test("a driver is scoped to their own vehicle", () => {
    const a = access({ group: "DRIVER", driverId: "drv1" });
    assert.deepEqual(assetScope(a), { driverId: "drv1" });
  });

  test("a scoped supervisor only reaches their own projects", () => {
    const a = access({ group: "SUPERVISOR", projectIds: ["p1", "p2"] });
    assert.deepEqual(assetScope(a), { projectId: { in: ["p1", "p2"] } });
    assert.deepEqual(projectIdScope(a), { projectId: { in: ["p1", "p2"] } });
    assert.deepEqual(projectScope(a), { id: { in: ["p1", "p2"] } });
  });

  test("a supervisor scoped to nothing sees nothing — not everything", () => {
    // An empty list and an absent scope mean different things, and confusing
    // them is how a scoped account silently gains the whole company.
    const a = access({ group: "SUPERVISOR", projectIds: [] });
    assert.deepEqual(assetScope(a), { projectId: { in: [] } });
    assert.notDeepEqual(assetScope(a), {});
  });

  test("an unscoped supervisor keeps today's behaviour rather than being locked out", () => {
    const a = access({ group: "SUPERVISOR", projectIds: null });
    assert.deepEqual(assetScope(a), {});
  });

  test("a driver is never handed project-wide rows", () => {
    const a = access({ group: "DRIVER", driverId: "drv1" });
    assert.deepEqual(projectIdScope(a), { projectId: "__none__" });
  });
});

describe("route migration", () => {
  test("every moved route points somewhere inside the nine modules", () => {
    const valid = new Set(["/", "/my"]);
    for (const m of MODULES) {
      valid.add(m.href);
      for (const c of m.children ?? []) valid.add(c.href);
    }
    for (const [from, to] of Object.entries(ROUTE_MOVES)) {
      const root = "/" + to.split("/")[1];
      assert.ok(
        valid.has(to) || valid.has(root),
        `${from} → ${to} lands outside the module structure`,
      );
    }
  });

  test("no route is mapped to itself", () => {
    for (const [from, to] of Object.entries(ROUTE_MOVES)) {
      assert.notEqual(from, to, `${from} maps to itself`);
    }
  });
});
