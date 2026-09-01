import { NextResponse } from "next/server";
import { getAccess } from "@/lib/access";
import { getNotificationFeed } from "@/lib/notification-feed";

export const dynamic = "force-dynamic";

/** The bell drawer's RBAC-scoped feed. It intentionally has no client-supplied
 * role, project, or user parameter: all scope derives from the signed session. */
export async function GET(request: Request) {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const requested = Number(new URL(request.url).searchParams.get("take"));
  const feed = await getNotificationFeed(access, Number.isFinite(requested) ? requested : 8);
  return NextResponse.json(feed, { headers: { "Cache-Control": "no-store" } });
}
