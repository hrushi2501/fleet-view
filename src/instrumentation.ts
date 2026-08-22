/**
 * Next.js server lifecycle instrumentation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE BACKGROUND SYNC TIMER IS OFF BY DEFAULT
 *
 * This used to start a 60-second `setInterval` calling the Fleet Edge sync
 * whenever the server booted in production. That is safe in a single
 * long-running process and wrong on Vercel, for two reasons:
 *
 *   1. `register()` runs per serverless instance. Vercel scales out and
 *      recycles, so every live instance started its own timer. Two instances
 *      meant 120 calls an hour, four meant 240 — against a subscription limit
 *      of 60 for the whole account.
 *
 *   2. It ran *alongside* the Vercel cron, which was already polling. Neither
 *      knew about the other, so the account sat structurally above its ceiling
 *      and the excess came back as 429s. Fleet Edge's Basic Pull API is a
 *      snapshot with no history endpoint, so every refused call is a moment
 *      that can never be fetched again — silent, permanent data loss.
 *
 * The Vercel cron in `vercel.json` is now the single scheduled poller, at one
 * call a minute, which is the rate Tata recommends. It is the right survivor
 * because it cannot duplicate itself and its runs are visible in the dashboard.
 *
 * `TATA_FLEET_EDGE_AUTO_SYNC=true` still starts the in-process timer, for
 * self-hosting or local development where there is no platform cron. Do not set
 * it on Vercel: it would put a second poller back alongside the cron. The
 * distributed lock in `poll-lock.ts` would stop the two overlapping, but they
 * would still spend the account's call budget twice over.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** One call a minute — Fleet Edge allows 60 an hour across the subscription. */
const INTERVAL_MS = 60_000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Opt-in only. The previous condition also fired on
  // `NODE_ENV === "production" && TATA_FLEET_EDGE_ENABLED === "true"`, which is
  // true of every Vercel instance — so the timer started everywhere by default.
  if (process.env.TATA_FLEET_EDGE_AUTO_SYNC !== "true") return;

  if (process.env.VERCEL) {
    console.warn(
      "[INSTRUMENTATION] TATA_FLEET_EDGE_AUTO_SYNC is set on Vercel. " +
        "The cron in vercel.json already polls Fleet Edge every minute; this timer " +
        "will spend the same 60-calls-per-hour budget a second time. Unset it.",
    );
  }

  const { syncTataFleetEdge, isTataEnabled } = await import("@/lib/tata-fleet-edge");

  console.log("[INSTRUMENTATION] Starting in-process Fleet Edge sync timer (60s).");

  const timer = setInterval(async () => {
    try {
      if (!isTataEnabled()) return;
      // Overlapping runs are refused by the shared lock inside the sync, so a
      // slow upstream cannot stack calls behind it.
      const res = await syncTataFleetEdge();
      if (!res.ok && res.error) {
        console.warn("[INSTRUMENTATION] Tata sync warning:", res.error);
      }
    } catch (err) {
      console.error("[INSTRUMENTATION] Tata sync background timer error:", err);
    }
  }, INTERVAL_MS);

  if (timer && typeof timer.unref === "function") timer.unref();
}
