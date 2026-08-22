/**
 * A lock shared across server instances, for work that must not run twice at once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE EXISTING GUARD IS NOT ENOUGH
 *
 * `tata-fleet-edge.ts` already guards itself with a module-level flag:
 *
 *     if (isSyncInProgress) return { skipped: "Sync already in progress" };
 *
 * That works in a single long-lived process. This deploys to Vercel, where each
 * serverless instance has its own copy of the module and therefore its own copy
 * of that flag. Two instances can be mid-sync simultaneously and each will
 * correctly report that nothing else is running.
 *
 * It matters here because Fleet Edge allows 60 calls an hour across the whole
 * subscription. Two overlapping syncs spend two calls on the same minute, and a
 * refused call is a permanently lost sample — the Basic Pull API is a snapshot
 * with no history endpoint, so a missed moment cannot be fetched later.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE `Setting` TABLE
 *
 * The database is the only thing every instance shares. `Setting` is the
 * existing key/value store the app already owns, and this deployment's role
 * cannot create new tables (see the note in `access.ts`). It is excluded from
 * the audit extension, so lock churn does not flood the audit log.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW IT STAYS CORRECT
 *
 * Acquisition is a compare-and-swap, not a read-then-write. Reading the row,
 * deciding it is expired, and then writing would let two instances both read the
 * same expired lock and both decide they own it. Instead the takeover is a
 * conditional update against the exact value that was read: whoever's write
 * matches first wins, and the loser sees `count === 0`.
 *
 * Leases expire so a crashed run cannot hold the lock forever, and release is
 * also conditional so a slow run that has already lost its lease cannot delete
 * the lock its successor is holding.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

const key = (name: string) => `lock:${name}`;

type Lease = { owner: string; expiresAt: number };

function parse(raw: string): Lease | null {
  try {
    const v = JSON.parse(raw) as Lease;
    return typeof v?.owner === "string" && typeof v.expiresAt === "number" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Runs `fn` if the lock is free, and skips if another instance holds it.
 *
 * `ttlMs` must comfortably exceed how long the work takes. Too short and a
 * second run starts while the first is still going, which is the thing this
 * exists to prevent; too long and a crashed run blocks its successors for that
 * many milliseconds.
 */
export async function withPollLock<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false; heldBy: string | null }> {
  const k = key(name);
  const owner = randomUUID();
  const now = Date.now();
  const mine = JSON.stringify({ owner, expiresAt: now + ttlMs } satisfies Lease);

  let acquired = false;

  try {
    await db.setting.create({ data: { key: k, value: mine } });
    acquired = true;
  } catch {
    // The row exists. It is either a live lease or the remains of a run that
    // died without releasing.
    const existing = await db.setting.findUnique({ where: { key: k } });
    if (!existing) return { ran: false, heldBy: null };

    const lease = parse(existing.value);
    if (lease && lease.expiresAt > now) {
      return { ran: false, heldBy: lease.owner };
    }

    // Expired or unparseable. Take it over only if nobody else has already —
    // the `value` in the where clause makes this a compare-and-swap.
    const won = await db.setting.updateMany({
      where: { key: k, value: existing.value },
      data: { value: mine },
    });
    if (won.count !== 1) return { ran: false, heldBy: lease?.owner ?? null };
    acquired = true;
  }

  if (!acquired) return { ran: false, heldBy: null };

  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    // Conditional on still being ours. If this run overran its lease and another
    // instance took over, deleting unconditionally would free a lock that is
    // legitimately held and allow a third run to start alongside it.
    await db.setting.deleteMany({ where: { key: k, value: mine } }).catch(() => {});
  }
}
