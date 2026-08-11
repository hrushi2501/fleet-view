import { NextResponse } from "next/server";
import { syncTataFleetEdge, isTataEnabled, missingConfigKeys } from "@/lib/tata-fleet-edge";

export const dynamic = "force-dynamic";
// Fleet Edge is polled for the whole fleet; allow room for a slow upstream.
export const maxDuration = 120;

/**
 * Pull telemetry from Tata Fleet Edge.
 *
 * Called by Vercel Cron (sends `Authorization: Bearer ${CRON_SECRET}`) or
 * manually with `?key=` for a one-off check after changing credentials.
 *
 * Returns 200 with `skipped` when the integration is switched off or
 * unconfigured — a disabled integration is not a failed cron, and paging the
 * team every 15 minutes over a deliberate off switch trains them to ignore it.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const { searchParams } = new URL(req.url);
  const secret = process.env.CRON_SECRET || "mcc-cron-2026";
  if (auth !== `Bearer ${secret}` && searchParams.get("key") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isTataEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: "Tata Fleet Edge disabled or unconfigured",
      enabled: process.env.TATA_FLEET_EDGE_ENABLED === "true",
      missing: missingConfigKeys(),
    });
  }

  // No backfill window: Fleet Edge's Basic Pull API is a snapshot of each
  // vehicle's latest state and takes no time filter, so a missed run is a gap
  // in history rather than something a later run can recover.
  const result = await syncTataFleetEdge();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
