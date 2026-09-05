import { NextResponse } from "next/server";
import { requireApi } from "@/lib/access";
import { sendPushToAll } from "@/lib/push";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireApi("admin.settings");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limit = await reserveRateLimit({
    scope: "push-broadcast",
    subject: auth.access.session.id,
    limit: 5,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return rateLimitResponse(limit.retryInSeconds, "Too many broadcast requests. Please wait.");
  }


  const body = await req.json().catch(() => ({}));
  const result = await sendPushToAll({
    title: body.title || "FleetView Alert",
    body: body.body || "This is a test notification from FleetView.",
    url: body.url || "/notifications",
  });
  return NextResponse.json({ ok: true, ...result });
}
