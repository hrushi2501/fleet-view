import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  await db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth, userId: session.id },
    create: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userId: session.id },
  });
  return NextResponse.json({ ok: true });
}
