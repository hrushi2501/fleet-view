import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendPushToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getSession();
  if (session?.role !== "Admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const result = await sendPushToAll({
    title: body.title || "FleetView Alert",
    body: body.body || "This is a test notification from FleetView.",
    url: body.url || "/notifications",
  });
  return NextResponse.json({ ok: true, ...result });
}
