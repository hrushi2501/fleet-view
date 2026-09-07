import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { requireApi, assetScope } from "@/lib/access";
import { getLiveFleet } from "@/lib/fleet-edge-live";

export const dynamic = "force-dynamic";

/**
 * The Fleet Edge console's polling endpoint.
 *
 * The page renders its first frame on the server so it is useful before any
 * JavaScript runs; this is only what keeps it fresh afterwards. It returns the
 * whole fleet rather than a delta because the fleet is dozens of vehicles — a
 * diff protocol would be more code and more ways to show a stale card.
 *
 * Scoped exactly like the page. A supervisor limited to one site polls one
 * site's vehicles; the refresh must not become the hole that shows them the
 * company's fleet.
 */
async function handleGET() {
  const auth = await requireApi("fleet.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const fleet = await getLiveFleet(assetScope(auth.access));

  return NextResponse.json(fleet, {
    // A tracking console showing a cached position is worse than one showing a
    // spinner: the number looks live and is not.
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export const GET = withApiErrors(handleGET);
