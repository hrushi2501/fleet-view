import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { checkSharedSecret } from "@/lib/auth";
import { requireApi } from "@/lib/access";
import { syncTataFleetEdge, isTataEnabled, missingConfigKeys } from "@/lib/tata-fleet-edge";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET or POST /api/fuel/sync
 *
 * Trigger live telemetry & fuel sync from Tata Fleet Edge API.
 */
async function handleSync(req: Request) {
  const authSecret = checkSharedSecret(req, "CRON_SECRET");
  let isAuthorized = authSecret.ok;

  if (!isAuthorized) {
    const sessionAuth = await requireApi("fuel.view");
    if (sessionAuth.ok) {
      const limit = await reserveRateLimit({
        scope: "fuel-sync",
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
    return NextResponse.json({
      ok: true,
      skipped: "Tata Fleet Edge disabled or unconfigured",
      enabled: process.env.TATA_FLEET_EDGE_ENABLED === "true",
      missing: missingConfigKeys(),
    });
  }

  const result = await syncTataFleetEdge();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

async function handleGET(req: Request) {
  return handleSync(req);
}

async function handlePOST(req: Request) {
  return handleSync(req);
}

export const GET = withApiErrors(handleGET);
export const POST = withApiErrors(handlePOST);
