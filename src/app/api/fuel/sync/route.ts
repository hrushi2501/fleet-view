import { NextResponse } from "next/server";
import { checkSharedSecret } from "@/lib/auth";
import { requireApi } from "@/lib/access";
import { syncTataFleetEdge, isTataEnabled, missingConfigKeys } from "@/lib/tata-fleet-edge";

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
    if (sessionAuth.ok) isAuthorized = true;
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

export async function GET(req: Request) {
  return handleSync(req);
}

export async function POST(req: Request) {
  return handleSync(req);
}
