/**
 * When the nightly fuel-theft scan last ran, and whether that is recent enough.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * "No theft found" and "nothing is looking for theft" produce the same empty
 * screen. One of those is good news and the other is the feature being broken,
 * and an operator cannot tell them apart — so a scan that quietly started
 * failing would leave the fleet reading as all-clear indefinitely.
 *
 * The scan writes one audit row per run whatever it finds. This reads the most
 * recent one, so the screen can state plainly when the fleet was last checked
 * rather than implying it by silence.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { db } from "@/lib/db";

/**
 * The scan is nightly, so a gap beyond this means a run was missed.
 *
 * Generous by one full cycle: a single late run should not cry wolf, two
 * missed nights should.
 */
const STALE_AFTER_HOURS = 50;

export type ScanStatus = {
  lastRunAt: Date | null;
  hoursAgo: number | null;
  /** True when the scan has not run recently enough to be trusted. */
  stale: boolean;
  /** True when it has never run at all. */
  neverRun: boolean;
  scanned: number | null;
  raised: number | null;
};

export async function lastTheftScan(): Promise<ScanStatus> {
  const row = await db.auditEvent.findFirst({
    where: { action: "SCAN", module: "FUEL" },
    orderBy: { at: "desc" },
    select: { at: true, changes: true },
  });

  if (!row) {
    return { lastRunAt: null, hoursAgo: null, stale: true, neverRun: true, scanned: null, raised: null };
  }

  const hoursAgo = (Date.now() - row.at.getTime()) / 3_600_000;

  // The payload is written by the scan itself, but a malformed row must not
  // take down the page that reports on it.
  let scanned: number | null = null;
  let raised: number | null = null;
  try {
    const parsed = JSON.parse(row.changes ?? "{}") as { scanned?: number; raised?: number };
    scanned = typeof parsed.scanned === "number" ? parsed.scanned : null;
    raised = typeof parsed.raised === "number" ? parsed.raised : null;
  } catch {
    // leave both null — the run time is the part that matters here
  }

  return {
    lastRunAt: row.at,
    hoursAgo: Math.round(hoursAgo),
    stale: hoursAgo > STALE_AFTER_HOURS,
    neverRun: false,
    scanned,
    raised,
  };
}
