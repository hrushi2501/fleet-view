import { NextResponse } from "next/server";
import { requireApi } from "@/lib/access";
import { sendPushToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireApi("admin.settings");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const result = await sendPushToAll({
    title: body.title || "FleetView Alert",
    body: body.body || "This is a test notification from FleetView.",
    url: body.url || "/notifications",
  });
  return NextResponse.json({ ok: true, ...result });
}
