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
 * For self-hosting and local development, run the dedicated
 * `npm run worker:telematics` process instead. It has an explicit lifecycle and
 * does not make Next instrumentation import Prisma and Node-only crypto into
 * the Edge-compatible Webpack instrumentation graph.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export function register() {
  // Keep this validation dependency-free: instrumentation is also compiled for
  // the Edge-compatible Webpack graph, where importing the Node HMAC module
  // would reintroduce the `crypto` resolution failure this file avoids.
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.AUTH_SECRET?.trim();
    if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
      throw new Error("AUTH_SECRET must be set to a random value of at least 32 bytes in production.");
    }
  }

  if (process.env.TATA_FLEET_EDGE_AUTO_SYNC !== "true") return;

  console.warn(
    "[INSTRUMENTATION] TATA_FLEET_EDGE_AUTO_SYNC is no longer supported. " +
      "Run `npm run worker:telematics` for an explicit local/self-hosted poller; " +
      "Vercel uses the cron in vercel.json.",
  );
}
