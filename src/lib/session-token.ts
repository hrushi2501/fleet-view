/**
 * Signed session tokens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The session cookie used to be the user's primary key, in plaintext:
 *
 *     store.set("fv_session", userId)          // setSession
 *     db.user.findUnique({ where: { id: uid } }) // getSession trusts it
 *
 * That is not a session, it is an assertion by the browser. Anyone who typed
 *
 *     document.cookie = "fv_session=<some user id>"
 *
 * was signed in as that user. User ids are cuids, not secrets — they travel in
 * audit rows, admin screens and API payloads — and the Admin account is as
 * forgeable as any other. There was no expiry check on the server, and logout
 * only deleted the caller's own copy of the cookie, so a value captured once
 * kept working until the account was deactivated.
 *
 * A cookie is now `v1.<payload>.<hmac>`: the server can still read who it is
 * without a database round trip, but the browser can no longer author one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT A SESSION TABLE
 *
 * The usual answer is a `Session` row per login. This deployment's database
 * role holds no DDL privilege (`ALTER TABLE "User"` fails with "must be owner
 * of table" — see the note in `access.ts`), so a new table cannot be created
 * from the application. Signing needs no schema change, and revocation is
 * handled through the `Setting` key/value store the app already owns.
 *
 * The one property a stateless token gives up is per-device logout. What
 * matters here — "this person is gone, cut their access now" — is covered by
 * the revocation epoch in `auth.ts`, which invalidates every token a user
 * holds at once.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** How long a freshly issued token stays valid. Matches the cookie's max-age. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const VERSION = "v1";

export type TokenPayload = {
  /** User id this token asserts. */
  sub: string;
  /** Issued-at, epoch milliseconds. Compared against the revocation epoch. */
  iat: number;
  /** Expires-at, epoch milliseconds. */
  exp: number;
};

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

/**
 * The signing key.
 *
 * `AUTH_SECRET` is the supported way to set this and should be a long random
 * string. When it is absent we derive a key from the database credentials
 * rather than falling back to a constant: a hardcoded default in a public
 * repository is a published key, which is the exact bug `checkSharedSecret`
 * was already fixed for.
 *
 * The connection string is server-only, high entropy (it contains the database
 * password) and must be present for the app to run at all, so deriving from it
 * keeps existing deployments working without a new environment variable. The
 * query string is stripped first because `db.ts` rewrites `DATABASE_URL` at
 * import time to append pooling parameters — hashing the mutated value would
 * make the key depend on module import order and silently log everyone out.
 *
 * Rotating `AUTH_SECRET` (or the database password) invalidates every existing
 * session, which is the correct behaviour.
 */
function signingKey(): string {
  const explicit = process.env.AUTH_SECRET?.trim();
  if (explicit) return explicit;

  const raw = (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "").trim();
  const base = raw.split("?")[0];
  if (base.length >= 16) return `derived:${base}`;

  throw new Error(
    "Cannot sign sessions: set AUTH_SECRET (a long random string) in the environment. " +
      "No default is used because a constant fallback in source control is a published key.",
  );
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadPart: string): string {
  return createHmac("sha256", signingKey()).update(`${VERSION}.${payloadPart}`).digest("base64url");
}

/** Constant-time string compare that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** Mints a token for a user. `now` is injectable so tests can control expiry. */
export function issueToken(userId: string, now: number = Date.now()): string {
  const payload: TokenPayload = { sub: userId, iat: now, exp: now + SESSION_TTL_MS };
  const part = b64url(JSON.stringify(payload));
  return `${VERSION}.${part}.${sign(part)}`;
}

/**
 * Verifies a token and returns its payload.
 *
 * The signature is checked *before* the payload is trusted for anything, and
 * expiry is checked on the server rather than relying on the browser to drop
 * an expired cookie.
 */
export function verifyToken(token: string | undefined | null, now: number = Date.now()): VerifyResult {
  if (!token) return { ok: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [version, part, mac] = parts;
  if (version !== VERSION) return { ok: false, reason: "malformed" };
  if (!safeEqual(mac, sign(part))) return { ok: false, reason: "bad-signature" };

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as TokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (typeof payload?.sub !== "string" || !payload.sub) return { ok: false, reason: "malformed" };
  if (typeof payload.iat !== "number" || typeof payload.exp !== "number") return { ok: false, reason: "malformed" };
  if (now >= payload.exp) return { ok: false, reason: "expired" };

  return { ok: true, payload };
}

/**
 * True when a token predates the user's revocation epoch.
 *
 * Bumping the epoch — on password change, deactivation, or an explicit "sign
 * out everywhere" — invalidates every token already issued to that user
 * without needing to track them individually.
 */
export function isRevoked(payload: TokenPayload, epochMs: number | null): boolean {
  if (epochMs === null) return false;
  return payload.iat < epochMs;
}
