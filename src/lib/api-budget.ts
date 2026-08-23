/**
 * A shared, rolling call budget for a rate-limited upstream API.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Fleet Edge allows 60 calls an hour for the whole subscription, and the cron
 * runs once a minute — which is exactly 60. That leaves no headroom at all, and
 * several things quietly spend from the same allowance:
 *
 *   - the OAuth token exchange, which is a second call whenever a cold
 *     serverless instance has no cached token. On a one-minute cron most
 *     invocations are cold, so a "one call per sync" assumption is wrong.
 *   - the Sync Now button on the tracking page
 *   - /api/fuel/sync, a second route that reaches the same provider
 *
 * Any of those pushes the hour over 60, and the excess comes back as 429. On a
 * snapshot API with no history endpoint a refused call is a moment that can
 * never be fetched again, so this is silent, permanent data loss rather than a
 * delay.
 *
 * Counting calls centrally is what lets the poller run as fast as the limit
 * genuinely allows instead of being detuned defensively. The cron can stay at
 * one a minute; when the hour's allowance is gone the sync skips cheaply rather
 * than spending a call to be told no.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A ROLLING WINDOW AND NOT A COUNTER PER CLOCK-HOUR
 *
 * A counter that resets on the hour permits 60 calls at 10:59 and 60 more at
 * 11:00 — 120 inside two minutes, which is exactly what a rate limiter is
 * measuring against. Timestamps in a rolling window cost a little more to store
 * and cannot be gamed that way.
 *
 * State lives in `Setting` because it must be shared across serverless
 * instances; a module-level array is per-instance and would let every instance
 * spend the full allowance. `Setting` is excluded from the audit extension, so
 * this churn does not flood the log.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { db } from "@/lib/db";

/** Fleet Edge's documented ceiling. */
export const TATA_CALLS_PER_HOUR = 60;

/**
 * Kept back from the ceiling.
 *
 * Two calls' worth, so a person clicking Sync Now — the one moment somebody is
 * actually watching — is not refused because the cron has eaten the hour. The
 * cron is opportunistic; a human request is not.
 */
const MANUAL_RESERVE = 2;

const WINDOW_MS = 60 * 60 * 1000;
const keyFor = (name: string) => `budget:${name}`;

type Window = { calls: number[] };

function parse(raw: string | undefined): number[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as Window;
    return Array.isArray(v?.calls) ? v.calls.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

export type BudgetVerdict =
  | { ok: true; remaining: number }
  | { ok: false; remaining: 0; retryInSeconds: number };

/**
 * Reserves one call, or refuses.
 *
 * `priority: "manual"` may spend into the reserve kept back for a person
 * waiting on a screen; the scheduled poller may not.
 *
 * Read-modify-write is not atomic here. It is called under the sync's
 * distributed lock, so scheduled callers are already serialised, and the
 * reserve absorbs a manual click racing the cron. The failure mode of a lost
 * update is one extra call in an hour, against a ceiling this deliberately
 * stays two calls below.
 */
export async function reserveCall(
  name: string,
  limitPerHour: number = TATA_CALLS_PER_HOUR,
  priority: "scheduled" | "manual" = "scheduled",
): Promise<BudgetVerdict> {
  const key = keyFor(name);
  const now = Date.now();

  const row = await db.setting.findUnique({ where: { key } });
  const recent = parse(row?.value).filter((t) => now - t < WINDOW_MS);

  const ceiling = priority === "manual" ? limitPerHour : limitPerHour - MANUAL_RESERVE;

  if (recent.length >= ceiling) {
    // When the oldest call ages out of the window, one slot frees up.
    const oldest = recent[0] ?? now;
    return {
      ok: false,
      remaining: 0,
      retryInSeconds: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)),
    };
  }

  recent.push(now);
  const value = JSON.stringify({ calls: recent } satisfies Window);
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });

  return { ok: true, remaining: Math.max(0, ceiling - recent.length) };
}

/** Calls used and left in the trailing hour. For status screens; reserves nothing. */
export async function budgetStatus(
  name: string,
  limitPerHour: number = TATA_CALLS_PER_HOUR,
): Promise<{ used: number; limit: number; remaining: number }> {
  const now = Date.now();
  const row = await db.setting.findUnique({ where: { key: keyFor(name) } });
  const used = parse(row?.value).filter((t) => now - t < WINDOW_MS).length;
  return { used, limit: limitPerHour, remaining: Math.max(0, limitPerHour - used) };
}
