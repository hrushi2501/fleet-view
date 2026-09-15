import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { cache } from "react";
import { db } from "./db";
import { can, type RoleLite } from "./rbac";
import { issueToken, verifyToken, isRevoked, SESSION_TTL_MS } from "./session-token";

/**
 * A host-only production cookie cannot be set or overwritten by a subdomain.
 *
 * `__Host-` is only valid with `Secure`, `Path=/`, and no `Domain` attribute;
 * `setSession` intentionally satisfies all three. Development keeps the short
 * name because localhost commonly runs over HTTP.
 *
 * Changing the production name deliberately invalidates the old cookie. A
 * compatibility read would keep the weaker, subdomain-settable cookie alive.
 */
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-fv_session" : "fv_session";

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

function parseRevocationEpoch(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
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

/** bcrypt's maximum input is 72 bytes; reject truncation rather than hiding it. */
const MAX_PASSWORD_BYTES = 72;
export const PASSWORD_MIN_LENGTH = 12;
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

// This is deliberately not a credential. It is only a fixed bcrypt workload
// for unknown and legacy-password accounts, so those cases take the same class
// of time as an ordinary failed password comparison.
const DUMMY_PASSWORD_HASH = "$2b$10$p1f5XPDNBz92g9Hztpm8iOEVBQSVbc1Kqlo/XWaT/VBXfLJfkCOym";

/** Returns a safe user-facing message when a new password does not meet policy. */
export function passwordPolicyError(plain: string): string | null {
  if (plain.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }
  if (Buffer.byteLength(plain, "utf8") > MAX_PASSWORD_BYTES) {
    return "Password must be at most 72 bytes long.";
  }
  if (!/[A-Za-z]/.test(plain) || !/\d/.test(plain) || !/[^A-Za-z0-9]/.test(plain)) {
    return "Password must include at least one letter, number, and symbol.";
  }
  return null;
}

export async function hashPassword(plain: string) {
  const error = passwordPolicyError(plain);
  if (error) throw new Error(error);
  return bcrypt.hash(plain, 10);
}

/**
 * Verifies a bcrypt password without retaining a plaintext compatibility path.
 *
 * A valid bcrypt comparison is still performed for unknown or legacy records.
 * This prevents an email probe from being visibly faster than a failed login
 * against a real bcrypt-backed account. Legacy rows must be migrated with
 * `npm run db:migrate-passwords` before this release is deployed.
 */
export async function verifyPassword(plain: string, stored: string) {
  return bcrypt.compare(plain, isHashed(stored) ? stored : DUMMY_PASSWORD_HASH);
}

export function isHashed(stored: string) {
  return BCRYPT_HASH.test(stored);
}

/**
 * The database-backed signed-in account, or null.
 *
 * The cookie is a signed token, never a bare user id. It is verified before
 * its contents are used for anything: a forged or edited cookie fails the
 * signature check and is treated as no session at all.
 *
 * Every route in the app resolves identity through this cached function, so the
 * signature, expiry, revocation and deactivation checks apply everywhere while
 * the database-backed account is resolved only once per render pass. Returning the
 * account internally lets `access.ts` reuse this same user read instead of
 * immediately querying the same row again on every navigation.
 */
export const getSessionAccount = cache(async () => {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;

  const verified = verifyToken(raw);
  if (!verified.ok) return null;

  const { sub: userId, iat } = verified.payload;

  // These reads are independent. Overlap them on the bounded pool because this
  // path gates every page and API request; serial round trips here tax every
  // navigation before its page-specific data can even start.
  const [user, epoch] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        driverId: true,
        language: true,
        roleRef: { select: { permissions: true } },
      },
    }),
    db.setting.findUnique({ where: { key: epochKey(userId) }, select: { value: true } }),
  ]);
  if (!user) return null;
  // A deactivated account kept working for as long as its cookie lived, which
  // makes "remove their access" a promise the app could not keep.
  if (user.active === false) return null;

  // Tokens issued before the user's revocation epoch are dead even though
  // their signature is valid and they have not expired.
  if (isRevoked({ sub: userId, iat, exp: verified.payload.exp }, parseRevocationEpoch(epoch?.value))) {
    return null;
  }

  return user;
});

export const getSession = cache(async () => {
  const user = await getSessionAccount();
  return user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null;
});

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
 * Accepts `Authorization: Bearer <secret>`, `x-fleet-key: <secret>`, or a key
 * field already parsed out of a JSON body. Query-string credentials are never
 * accepted because URL logs and referrers are not a secret store. Comparison is
 * constant-time.
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
  const body = typeof opts.bodyKey === "string" ? opts.bodyKey : "";

  const supplied = [bearer, header, body].filter(Boolean);
  if (!supplied.some((s) => safeEqual(s, expected))) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

export { ROLE_LABEL } from "./utils";
