#!/usr/bin/env node
/**
 * Tata Fleet Edge — 1-Minute Automated Telematics Worker Daemon
 *
 * Continuously polls the Tata Fleet Edge Basic Pull API on a 60-second schedule,
 * persists snapshots as historical `TelemetryReading`s, updates `Asset` caches,
 * identifies fuel siphons/anomalies, records sensor refuels, and updates `TelematicsProvider` status.
 *
 * Usage:
 *   node --import ./scripts/test-setup.mjs scripts/telematics-worker.mjs           # Run continuous daemon
 *   node --import ./scripts/test-setup.mjs scripts/telematics-worker.mjs --once    # Run a single sync cycle and exit
 *   node --import ./scripts/test-setup.mjs scripts/telematics-worker.mjs -i 30     # Custom interval (seconds)
 */

import { syncTataFleetEdge, isTataEnabled, missingConfigKeys, getTataSyncStatus } from "../src/lib/tata-fleet-edge.ts";
import { db } from "../src/lib/db.ts";

const args = process.argv.slice(2);
const runOnce = args.includes("--once");
const intervalArgIndex = args.indexOf("-i") !== -1 ? args.indexOf("-i") : args.indexOf("--interval");
const customInterval = intervalArgIndex !== -1 && args[intervalArgIndex + 1] ? Number(args[intervalArgIndex + 1]) : null;

const POLL_INTERVAL_MS = (customInterval && customInterval > 0 ? customInterval : 60) * 1000;
const RATE_LIMIT_BACKOFF_MS = 30_000;

let isRunning = true;
let cycleCount = 0;

function timestamp() {
  return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function log(message, meta) {
  const metaStr = meta ? ` | ${JSON.stringify(meta)}` : "";
  console.log(`[${timestamp()}][TELEMATICS-WORKER] ${message}${metaStr}`);
}

function logError(message, err) {
  console.error(`[${timestamp()}][TELEMATICS-WORKER][ERROR] ${message}`, err);
}

async function runSyncCycle() {
  cycleCount++;
  log(`Starting sync cycle #${cycleCount}...`);

  if (!isTataEnabled()) {
    const missing = missingConfigKeys();
    log("Tata Fleet Edge is disabled or missing credentials.", {
      enabled: process.env.TATA_FLEET_EDGE_ENABLED === "true",
      missing,
    });
    return { skipped: true, rateLimited: false };
  }

  try {
    const startTime = Date.now();
    const result = await syncTataFleetEdge();
    const durationMs = Date.now() - startTime;

    if (result.ok) {
      log(`Cycle #${cycleCount} completed in ${durationMs}ms`, {
        fetched: result.fetched,
        stored: result.stored,
        duplicates: result.duplicates ?? 0,
        analysed: result.analysed ?? 0,
        anomalies: result.anomaliesRaised ?? 0,
        skipped: result.skipped,
      });

      if (result.unmatched && result.unmatched.length > 0) {
        log(`Unmatched vehicles returned by provider:`, result.unmatched);
      }
      if (result.schemaDrift && result.schemaDrift.length > 0) {
        log(`Schema drift detected in upstream payload:`, result.schemaDrift);
      }

      const rateLimited = Boolean(result.skipped?.includes("Rate limited"));
      return { skipped: Boolean(result.skipped), rateLimited };
    } else {
      logError(`Cycle #${cycleCount} sync returned failure: ${result.error}`, result);
      return { error: result.error, rateLimited: false };
    }
  } catch (err) {
    logError(`Uncaught error in cycle #${cycleCount}:`, err);
    return { error: err.message, rateLimited: false };
  }
}

async function startDaemon() {
  log(`Daemon started. Target poll interval: ${POLL_INTERVAL_MS / 1000}s`);

  // Initial status check
  try {
    const status = await getTataSyncStatus();
    log("Initial status loaded", {
      configured: status.configured,
      activeVehicles: status.activeVehiclesCount,
      totalReadings: status.totalReadingsCount,
      lastSyncStatus: status.provider?.lastSyncStatus ?? "NONE",
    });
  } catch (e) {
    logError("Failed to fetch initial sync status:", e);
  }

  if (runOnce) {
    const res = await runSyncCycle();
    log("Run-once mode complete. Disconnecting database...");
    await db.$disconnect();
    process.exit(res.error ? 1 : 0);
  }

  while (isRunning) {
    const res = await runSyncCycle();
    
    // If rate limited by upstream, wait backoff delay before normal interval
    const delay = res.rateLimited ? RATE_LIMIT_BACKOFF_MS : POLL_INTERVAL_MS;
    if (res.rateLimited) {
      log(`Upstream rate limit detected. Backing off for ${RATE_LIMIT_BACKOFF_MS / 1000}s...`);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  log("Daemon stopped. Disconnecting from database...");
  await db.$disconnect();
  log("Database disconnected. Exiting cleanly.");
  process.exit(0);
}

// Graceful signal handling
function handleShutdown(signal) {
  log(`Received ${signal}. Shutting down gracefully...`);
  isRunning = false;
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

startDaemon().catch(async (err) => {
  logError("Fatal daemon crash:", err);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
