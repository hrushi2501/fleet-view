import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { can, type RoleLite } from "./rbac";
import { issueToken, verifyToken, isRevoked, SESSION_TTL_MS } from "./session-token";

const COOKIE = "fv_session";

/**
 * Where a user's session revocation epoch lives.
 *
 * Any token issued before this timestamp is refused. Bumping it is how "sign
 * out everywhere" and "this person has left" are enforced against tokens
 * already in the wild. It uses the `Setting` key/value store for the same
 * reason `access.ts` does — this deployment's database role cannot add a
 * column to `User`.
 */
const epochKey = (userId: string) => `auth:epoch:${userId}`;

async function revocationEpoch(userId: string): Promise<number | null> {
  const row = await db.setting.findUnique({ where: { key: epochKey(userId) } });
  if (!row?.value) return null;
  const parsed = Number(row.value);
  // An unreadable epoch fails closed — treated as "revoked now" rather than
  // silently accepting every token for that user.
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * Invalidates every session token already issued to a user.
 *
 * Call on password change, on deactivation, and whenever an admin needs to cut
 * access immediately. Deleting a cookie only affects the one browser holding it.
 */
export async function revokeSessions(userId: string): Promise<void> {
  const key = epochKey(userId);
  const value = String(Date.now());
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

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

/**
 * The signed-in user, or null.
 *
 * The cookie is a signed token, never a bare user id. It is verified before
 * its contents are used for anything: a forged or edited cookie fails the
 * signature check and is treated as no session at all.
 *
 * Every route in the app resolves identity through this function, so the
 * signature, expiry, revocation and deactivation checks all apply everywhere
 * at once.
 */
export async function getSession() {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;

  const verified = verifyToken(raw);
  if (!verified.ok) return null;

  const { sub: userId, iat } = verified.payload;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user) return null;
  // A deactivated account kept working for as long as its cookie lived, which
  // makes "remove their access" a promise the app could not keep.
  if (user.active === false) return null;

  // Tokens issued before the user's revocation epoch are dead even though
  // their signature is valid and they have not expired.
  if (isRevoked({ sub: userId, iat, exp: verified.payload.exp }, await revocationEpoch(userId))) {
    return null;
  }

  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function setSession(userId: string) {
  const store = await cookies();
  store.set(COOKIE, issueToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    // The session cookie is the whole of the caller's identity, so it must never
    // travel over plain HTTP in production. Left off in development so the cookie
    // still works on http://localhost.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Kept in step with the token's own expiry so the browser and the server
    // agree on when the session ends.
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
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

export { ROLE_LABEL } from "./utils";
