import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";
import { requireSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  requireSameOrigin(req);

  const limit = await reserveRateLimit({
    scope: "push-subscribe",
    subject: session.id,
    limit: 15,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return rateLimitResponse(limit.retryInSeconds, "Too many subscription updates. Please wait.");
  }

  const sub = await req.json().catch(() => null);

  if (typeof sub?.endpoint !== "string" || typeof sub?.keys?.p256dh !== "string" || typeof sub?.keys?.auth !== "string") {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  try {
    const endpoint = new URL(sub.endpoint);
    if (endpoint.protocol !== "https:" || sub.endpoint.length > 2_048 || !/^[A-Za-z0-9_-]{40,256}$/.test(sub.keys.p256dh) || !/^[A-Za-z0-9_-]{16,128}$/.test(sub.keys.auth)) {
      return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
    }
  } catch { return NextResponse.json({ error: "invalid subscription" }, { status: 400 }); }
  const existing = await db.pushSubscription.findUnique({ where: { endpoint: sub.endpoint }, select: { userId: true } });
  if (existing && existing.userId !== session.id) return NextResponse.json({ error: "This device is already linked to another account." }, { status: 409 });
  await db.pushSubscription.upsert({ where: { endpoint: sub.endpoint }, update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, create: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userId: session.id } });
  return NextResponse.json({ ok: true });
}

export const POST = withApiErrors(handlePOST);
