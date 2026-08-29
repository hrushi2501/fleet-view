/**
 * One place that answers "who is this, what may they see, and which rows?"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Before this file, authorisation in the app was a redirect in `proxy.ts` and
 * nothing else. Every page under `(app)` rendered for anybody holding a session
 * cookie, so a driver who typed `/users`, `/costs` or `/admin/audit` got the
 * full company view — payroll, margins, the audit log. The permission
 * catalogue in `rbac.ts` was real and well designed, but only the API routes
 * consulted it; the pages never did.
 *
 * Hiding a menu item is not access control. The chain has to be:
 *
 *     ROLE → PERMISSIONS → DATA ACCESS → FRONTEND
 *
 * and each arrow has to be enforced on the server. This module owns the first
 * three. The navigation reads from it so the menu cannot drift from what the
 * server will actually allow.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { getSession, permissionsFor, type Session } from "@/lib/auth";
import { can, type RoleLite } from "@/lib/rbac";

/**
 * The three groups the business actually thinks in. The granular roles in
 * `rbac.ts` still exist and still decide individual permissions — this is the
 * coarse band that decides how much of the product someone is shown at all.
 */
export type UserGroup = "ADMIN" | "SUPERVISOR" | "DRIVER";

export type Access = {
  session: Session;
  group: UserGroup;
  /** Permission codes held, expanded from `*`. */
  codes: string[];
  can: (code: string) => boolean;
  /** The driver record this login belongs to, when it is a driver. */
  driverId: string | null;
  /**
   * Projects this user is limited to. `null` means unrestricted (admins, and
   * supervisors with no scope configured). An empty array means scoped to
   * nothing, which is not the same thing and must show nothing.
   */
  projectIds: string[] | null;
};

/**
 * Roles that get the full company view. Everything else is operational.
 *
 * Auditor sits here because its whole purpose is company-wide read access
 * including the audit log — it holds `admin.audit` and is deliberately
 * read-only, so the Admin area is exactly where it belongs.
 */
const ADMIN_ROLES = new Set(["Admin", "Auditor"]);
/** Roles whose work is a driver's own vehicle and nothing else. */
const DRIVER_ROLES = new Set(["Driver"]);

/**
 * Which band a login falls into.
 *
 * Decided from held permissions rather than the legacy role string wherever
 * possible, so a client who re-cuts a role in the Roles screen gets the
 * navigation that matches what they actually granted. The string is the
 * fallback for accounts created before roles were data.
 */
export function groupFor(legacyRole: string, codes: string[]): UserGroup {
  if (codes.includes("*")) return "ADMIN";
  // Any admin-module permission means this person manages the system itself.
  if (codes.some((c) => c.startsWith("admin."))) return "ADMIN";
  if (ADMIN_ROLES.has(legacyRole)) return "ADMIN";
  if (DRIVER_ROLES.has(legacyRole)) return "DRIVER";
  // A login holding only fuel.issue and nothing else is a driver in practice,
  // whatever the role is called.
  if (codes.length > 0 && codes.every((c) => c === "fuel.issue")) return "DRIVER";
  return "SUPERVISOR";
}

/**
 * Where a supervisor's site scope is stored.
 *
 * It belongs on the `User` row, but the database role this application connects
 * with holds no DDL privilege — `ALTER TABLE "User"` fails with
 * "must be owner of table" — so the column cannot be added from here. The
 * `Setting` table is an existing key/value store the app already owns, and it
 * carries the scope until someone with owner credentials can migrate.
 *
 * Format: `scope:user:<userId>` → JSON array of project ids.
 * Absent means unrestricted, which preserves today's behaviour for every
 * existing account rather than locking people out on deploy.
 */
const scopeKey = (userId: string) => `scope:user:${userId}`;

async function loadProjectScope(userId: string): Promise<string[] | null> {
  const row = await db.setting.findUnique({ where: { key: scopeKey(userId) } });
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : null;
  } catch {
    // A corrupt scope must not silently widen access.
    return [];
  }
}

/** Sets (or clears) which projects a supervisor may see. Admin-only callers. */
export async function setProjectScope(userId: string, projectIds: string[] | null): Promise<void> {
  const key = scopeKey(userId);
  if (projectIds === null) {
    await db.setting.deleteMany({ where: { key } });
    return;
  }
  await db.setting.upsert({
    where: { key },
    update: { value: JSON.stringify(projectIds) },
    create: { key, value: JSON.stringify(projectIds) },
  });
}

/**
 * The caller's full access context, or null when not signed in.
 *
 * Everything downstream — page guards, navigation, query scoping — reads this
 * one function, so there is a single definition of what a user may reach.
 */
async function resolveAccess(): Promise<Access | null> {
  const session = await getSession();
  if (!session) return null;

  const held = await permissionsFor(session.id);
  if (!held) return null;

  const codes = held.codes;
  const group = groupFor(held.legacyRole, codes);

  // An account created before roles became data still needs to work. The legacy
  // Admin string is the only fallback that grants anything, matching the
  // allowance `requirePermission` already makes.
  const role: RoleLite = { name: session.role, label: session.role, permissions: codes, approvalLimit: 0 };
  const allow = (code: string) =>
    codes.length === 0 ? held.legacyRole === "Admin" : can(role, code);

  const user = await db.user.findUnique({
    where: { id: session.id },
    select: { driverId: true },
  });

  // Admins are never scoped; drivers are scoped to themselves, not to projects.
  const projectIds = group === "ADMIN" ? null : await loadProjectScope(session.id);

  return {
    session,
    group,
    codes,
    can: allow,
    driverId: user?.driverId ?? null,
    projectIds,
  };
}

// Layouts cannot pass data into their page children. Next 16's documented
// pattern for ORM-backed identity is React.cache: it is request-scoped, so the
// layout and page share one authorization lookup without sharing one user's
// result with another request.
export const getAccess = cache(resolveAccess);

// ---------------------------------------------------------------------------
// Page guards
// ---------------------------------------------------------------------------

/**
 * Guard for a server-rendered page.
 *
 * Redirects rather than throwing, because a person who followed a stale link
 * should land somewhere useful instead of on an error. Drivers go to their own
 * home; everyone else goes to the dashboard, which every signed-in user can
 * see.
 *
 * Call this at the top of every page under `(app)`. A page that does not call
 * it is readable by anybody with a login.
 */
export async function requirePage(code: string | null): Promise<Access> {
  const access = await getAccess();
  if (!access) redirect("/login");

  // A driver has one destination in this app and it is not the office UI.
  //
  // This deliberately catches `code === null` too. A page open to "any signed-in
  // user" — the dashboard, for instance — is still a company-wide office screen,
  // and a driver landing on it would see the whole fleet's fuel and cost
  // position. Their equivalent lives under `/my`.
  if (access.group === "DRIVER" && !code?.startsWith("my.")) {
    redirect("/my");
  }

  if (code !== null && !code.startsWith("my.") && !access.can(code)) {
    redirect("/?denied=" + encodeURIComponent(code));
  }

  return access;
}

/**
 * Guard for an API route.
 *
 * Unlike `requirePermission` in `auth.ts`, this hands back the caller's full
 * access context, because for an API the permission check is only half the
 * job: a route that confirms `fleet.view` and then returns every vehicle has
 * enforced nothing for a supervisor scoped to one site. The scope helpers below
 * are meant to be applied to the query in the same breath.
 */
export async function requireApi(
  code: string,
): Promise<{ ok: true; access: Access } | { ok: false; status: 401 | 403; error: string }> {
  const access = await getAccess();
  if (!access) return { ok: false, status: 401, error: "Not signed in." };
  if (!access.can(code)) {
    return { ok: false, status: 403, error: `Your role does not permit this (${code}).` };
  }
  return { ok: true, access };
}

/** Guard for pages only the Admin band may open. */
export async function requireAdminPage(code: string): Promise<Access> {
  const access = await getAccess();
  if (!access) redirect("/login");
  if (access.group !== "ADMIN" || !access.can(code)) {
    redirect(access.group === "DRIVER" ? "/my" : "/?denied=" + encodeURIComponent(code));
  }
  return access;
}

// ---------------------------------------------------------------------------
// Data scoping
// ---------------------------------------------------------------------------

/**
 * Prisma `where` fragment limiting assets to what the caller may see.
 *
 * This is the part that makes the restriction real. Filtering a list in the
 * page after fetching everything still ships the whole fleet to the browser,
 * and still answers a hand-written API call with it.
 */
export function assetScope(access: Access): Record<string, unknown> {
  if (access.group === "ADMIN") return {};
  if (access.group === "DRIVER") {
    // A driver's own machine, by assignment. No driver record means no vehicle,
    // not every vehicle.
    return { driverId: access.driverId ?? "__none__" };
  }
  if (access.projectIds === null) return {};
  return { projectId: { in: access.projectIds } };
}

/**
 * Same, for anything hanging off a project.
 *
 * The driver case is tested *before* the unrestricted case on purpose. A driver
 * carries no project scope, so checking `projectIds === null` first would fall
 * through to an empty filter — which is not "no projects", it is "every
 * project". The band decides first; the scope only refines it.
 */
export function projectScope(access: Access): Record<string, unknown> {
  if (access.group === "ADMIN") return {};
  if (access.group === "DRIVER") return { id: "__none__" };
  if (access.projectIds === null) return {};
  return { id: { in: access.projectIds } };
}

/** Rows that carry a `projectId` of their own — production logs, costs, sites. */
export function projectIdScope(access: Access): Record<string, unknown> {
  if (access.group === "ADMIN") return {};
  if (access.group === "DRIVER") return { projectId: "__none__" };
  if (access.projectIds === null) return {};
  return { projectId: { in: access.projectIds } };
}

/**
 * Asserts the caller may see one specific asset, for detail pages and APIs.
 * Returns false rather than throwing so the caller decides between a 404 and a
 * redirect — leaking "this exists but is not yours" is itself information.
 */
export async function canSeeAsset(access: Access, assetId: string): Promise<boolean> {
  if (access.group === "ADMIN") return true;
  const asset = await db.asset.findFirst({
    where: { id: assetId, ...assetScope(access) },
    select: { id: true },
  });
  return !!asset;
}
