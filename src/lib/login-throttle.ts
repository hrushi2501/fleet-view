/**
 * Brute-force protection for the sign-in form.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The login action accepted unlimited attempts. Passwords here are set by an
 * administrator and default to `driver123` for new driver logins, so an
 * unthrottled form is a realistic way in rather than a theoretical one.
 *
 * State lives in the `Setting` key/value store, not in a module-level Map,
 * because this deploys to serverless functions: an in-memory counter is per
 * instance, and an attacker gets a fresh allowance every time the platform
 * scales out or recycles. The database is the only thing all instances share.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { db } from "@/lib/db";

/** Failures allowed inside the window before the account is locked. */
export const MAX_ATTEMPTS = 5;
/** How long failures accumulate for. */
export const WINDOW_MS = 15 * 60 * 1000;
/** How long a lock lasts once tripped. */
export const LOCKOUT_MS = 15 * 60 * 1000;

type Record_ = { count: number; firstAt: number; lockedUntil: number | null };

const key = (email: string) => `auth:fail:${email.toLowerCase()}`;

async function read(email: string): Promise<Record_ | null> {
  const row = await db.setting.findUnique({ where: { key: key(email) } });
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as Record_;
    if (typeof parsed?.count !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function write(email: string, value: Record_): Promise<void> {
  const k = key(email);
  const v = JSON.stringify(value);
  await db.setting.upsert({ where: { key: k }, update: { value: v }, create: { key: k, value: v } });
}

/**
 * Whether this address may attempt a sign-in right now.
 *
 * Returns the remaining lock time so the form can say when to try again — "try
 * later" with no number is the kind of error that generates a support call.
 */
export async function checkLock(
  email: string,
  now: number = Date.now(),
): Promise<{ locked: false } | { locked: true; retryInSeconds: number }> {
  const rec = await read(email);
  if (!rec?.lockedUntil) return { locked: false };
  if (now >= rec.lockedUntil) return { locked: false };
  return { locked: true, retryInSeconds: Math.ceil((rec.lockedUntil - now) / 1000) };
}

/**
 * Records a failed attempt, locking the account once the threshold is crossed.
 *
 * Returns whether this failure was the one that tripped the lock, so the caller
 * can record it in the audit log — a lockout is a security event, an ordinary
 * typo is not.
 */
export async function recordFailure(email: string, now: number = Date.now()): Promise<{ nowLocked: boolean }> {
  const rec = await read(email);

  // Start a fresh window when there is no record, or the last one has aged out.
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    await write(email, { count: 1, firstAt: now, lockedUntil: null });
    return { nowLocked: false };
  }

  const count = rec.count + 1;
  const nowLocked = count >= MAX_ATTEMPTS;
  await write(email, {
    count,
    firstAt: rec.firstAt,
    lockedUntil: nowLocked ? now + LOCKOUT_MS : rec.lockedUntil,
  });
  return { nowLocked };
}

/** Clears the counter after a genuine sign-in. */
export async function clearFailures(email: string): Promise<void> {
  await db.setting.deleteMany({ where: { key: key(email) } });
}
