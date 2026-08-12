import { NextResponse } from "next/server";
import { checkSharedSecret } from "@/lib/auth";
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
 *
 * The secret check fails closed: with CRON_SECRET unset the route answers 503
 * rather than accepting a default that is public in this repository.
 */
export async function GET(req: Request) {
  const auth = checkSharedSecret(req, "CRON_SECRET");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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
