import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { requireApi } from "@/lib/access";
import { sendPushToAll } from "@/lib/push";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";
import { requireSameOrigin, isSafeAppPath } from "@/lib/request-security";

export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  const auth = await requireApi("admin.settings");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  requireSameOrigin(req);

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
  if ((body.title != null && (typeof body.title !== "string" || body.title.length > 120)) || (body.body != null && (typeof body.body !== "string" || body.body.length > 500)) || (body.url != null && !isSafeAppPath(body.url))) {
    return NextResponse.json({ error: "Notification content is invalid." }, { status: 400 });
  }
  const result = await sendPushToAll({
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : "FleetView Alert",
    body: typeof body.body === "string" && body.body.trim() ? body.body.trim() : "This is a test notification from FleetView.",
    url: isSafeAppPath(body.url) ? body.url : "/notifications",
  });
  return NextResponse.json({ ok: true, ...result });
}

export const POST = withApiErrors(handlePOST);
