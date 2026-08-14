/**
 * Next.js Server Lifecycle Instrumentation
 *
 * Runs once when the Next.js server runtime starts up.
 * When `TATA_FLEET_EDGE_AUTO_SYNC="true"` or in server environments with Fleet Edge enabled,
 * starts the automatic 1-minute background sync timer loop.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const autoSyncEnabled =
      process.env.TATA_FLEET_EDGE_AUTO_SYNC === "true" ||
      (process.env.NODE_ENV === "production" && process.env.TATA_FLEET_EDGE_ENABLED === "true");

    if (autoSyncEnabled) {
      const { syncTataFleetEdge, isTataEnabled } = await import("@/lib/tata-fleet-edge");

      console.log("[INSTRUMENTATION] Initializing automatic 1-minute Tata Fleet Edge telematics background sync...");

      const INTERVAL_MS = 60_000;
      const timer = setInterval(async () => {
        try {
          if (isTataEnabled()) {
            const res = await syncTataFleetEdge();
            if (!res.ok && res.error) {
              console.warn("[INSTRUMENTATION] Tata sync warning:", res.error);
            }
          }
        } catch (err) {
          console.error("[INSTRUMENTATION] Tata sync background timer error:", err);
        }
      }, INTERVAL_MS);

      if (timer && typeof timer.unref === "function") {
        timer.unref();
      }
    }
  }
}
