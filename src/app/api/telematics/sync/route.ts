import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { checkSharedSecret } from "@/lib/auth";
import { requireApi } from "@/lib/access";
import { recordSystemAudit } from "@/lib/audit-writer";
import { syncTataFleetEdge, isTataEnabled, missingConfigKeys } from "@/lib/tata-fleet-edge";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";
// Fleet Edge is polled for the whole fleet; allow room for a slow upstream.
export const maxDuration = 120;

/**
 * Pull telemetry from Tata Fleet Edge.
 *
 * Called by Vercel Cron (sends `Authorization: Bearer ${CRON_SECRET}`) or
 * by internal worker / manual admin check.
 */
async function handleGET(req: Request) {
  const authSecret = checkSharedSecret(req, "CRON_SECRET");
  let isAuthorized = authSecret.ok;

  if (!isAuthorized) {
    const sessionAuth = await requireApi("fleet.view");
    if (sessionAuth.ok) {
      const limit = await reserveRateLimit({
        scope: "telematics-sync",
        subject: sessionAuth.access.session.id,
        limit: 5,
        windowMs: 60_000,
      });
      if (!limit.ok) {
        return rateLimitResponse(limit.retryInSeconds, "Too many sync requests. Please wait before syncing again.");
      }
      isAuthorized = true;
    }
  }


  if (!isAuthorized) {
    return NextResponse.json(
      { error: "Unauthorized — valid CRON_SECRET or session required" },
      { status: 401 }
    );
  }

  if (!isTataEnabled()) {
    const body = {
      ok: true,
      skipped: "Tata Fleet Edge disabled or unconfigured",
      enabled: process.env.TATA_FLEET_EDGE_ENABLED === "true",
      missing: missingConfigKeys(),
    };
    return NextResponse.json(body);
  }

  // No backfill window: Fleet Edge's Basic Pull API is a snapshot of each
  // vehicle's latest state and takes no time filter, so a missed run is a gap
  // in history rather than something a later run can recover.
  const result = await syncTataFleetEdge();
  if (!result.ok) {
    // Successful background work is already durable in TelemetryReading and
    // its latest health is on TelematicsProvider. Persist only failures here:
    // logging every minute would bury the Admin audit log in machine noise.
    await recordSystemAudit({
      action: "CONFIG",
      module: "FLEET",
      entity: "TelematicsProvider",
      summary: "Tata Fleet Edge background sync failed",
      changes: { trigger: authSecret.ok ? "CRON" : "MANUAL", error: result.error ?? "Unknown sync failure" },
    });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

export const GET = withApiErrors(handleGET);
