import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { can, type RoleLite } from "./rbac";

const COOKIE = "fv_session";

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

/** Verifies a password; supports legacy plaintext records so old accounts keep working. */
export async function verifyPassword(plain: string, stored: string) {
  if (stored.startsWith("$2")) return bcrypt.compare(plain, stored);
  return plain === stored;
}

export function isHashed(stored: string) {
  return stored.startsWith("$2");
}

export async function getSession() {
  const store = await cookies();
  const uid = store.get(COOKIE)?.value;
  if (!uid) return null;
  const user = await db.user.findUnique({
    where: { id: uid },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user) return null;
  // A deactivated account kept working for as long as its cookie lived, which
  // makes "remove their access" a promise the app could not keep.
  if (user.active === false) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function setSession(userId: string) {
  const store = await cookies();
  store.set(COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    // The session cookie is the whole of the caller's identity, so it must never
    // travel over plain HTTP in production. Left off in development so the cookie
    // still works on http://localhost.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export type Denied = { ok: false; status: 401 | 403 | 503; error: string };
export type Allowed = { ok: true; session: Session };

/**
 * The permission codes actually held by a signed-in user, read from the role
 * record rather than the legacy role string.
 *
 * Returns `null` when the user has no role record at all — roles are installed
 * by an admin action, and until that has been run the only safe fallback is the
 * legacy `Admin` string. Callers must treat `null` as "no permissions".
 */
export async function permissionsFor(userId: string): Promise<{ codes: string[]; legacyRole: string } | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, active: true, roleRef: { select: { name: true, label: true, permissions: true, approvalLimit: true } } },
  });
  if (!user || user.active === false) return null;
  const codes = user.roleRef?.permissions.split("\n").map((c) => c.trim()).filter(Boolean) ?? [];
  return { codes, legacyRole: user.role };
}

/**
 * Gate for API routes: signed in *and* holding `code`.
 *
 * Permissions are evaluated with `rbac.can`, so the catalogue in `rbac.ts` is
 * the single definition of who may do what rather than a second, drifting copy
 * of the rules living in route handlers.
 *
 * Falls back to the legacy `Admin` role string only when no role record has been
 * installed yet, which is the same allowance the CSV export has always made so
 * an admin is not locked out mid-setup.
 */
export async function requirePermission(code: string): Promise<Allowed | Denied> {
  const session = await getSession();
  if (!session) return { ok: false, status: 401, error: "Not signed in." };

  const held = await permissionsFor(session.id);
  if (!held) return { ok: false, status: 401, error: "Not signed in." };

  const role: RoleLite = { name: session.role, label: session.role, permissions: held.codes, approvalLimit: 0 };
  const allowed = held.codes.length === 0 ? held.legacyRole === "Admin" : can(role, code);
  if (!allowed) {
    return { ok: false, status: 403, error: `Your role does not permit this (${code}).` };
  }
  return { ok: true, session };
}

/** Signed in, no particular permission. */
export async function requireSession(): Promise<Allowed | Denied> {
  const session = await getSession();
  if (!session) return { ok: false, status: 401, error: "Not signed in." };
  return { ok: true, session };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/**
 * Machine-to-machine auth for cron jobs and device ingest.
 *
 * Fails **closed**: when the environment variable is unset the endpoint rejects
 * every request. The previous `process.env.X || "some-default"` shape meant an
 * unset variable silently published a key that is committed to this repository,
 * i.e. known to anyone who can read it.
 *
 * Accepts `Authorization: Bearer <secret>`, `x-fleet-key: <secret>`, a
 * `?key=<secret>` query parameter, or a `key` field already parsed out of a JSON
 * body. Comparison is constant-time.
 */
export function checkSharedSecret(
  req: Request,
  envName: string,
  opts: { bodyKey?: unknown } = {}
): { ok: true } | Denied {
  const expected = process.env[envName]?.trim();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: `${envName} is not configured on this deployment, so this endpoint is disabled. Set ${envName} and redeploy.`,
    };
  }

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const header = req.headers.get("x-fleet-key")?.trim() ?? "";
  // Secrets in a query string end up in access logs and browser history; kept
  // only because the runbook documents a manual `?key=` check.
  const query = new URL(req.url).searchParams.get("key")?.trim() ?? "";
  const body = typeof opts.bodyKey === "string" ? opts.bodyKey : "";

  const supplied = [bearer, header, query, body].filter(Boolean);
  if (!supplied.some((s) => safeEqual(s, expected))) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

export const ROLE_LABEL: Record<string, string> = {
  Admin: "Administrator",
  Driver: "Truck Driver",
  FleetManager: "Fleet Manager",
  Finance: "Finance Controller",
  SiteManager: "Site Manager",
  Workshop: "Workshop Manager",
};
