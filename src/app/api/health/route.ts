import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const t0 = Date.now();
    const [users, assets] = await Promise.all([db.user.count(), db.asset.count()]);
    return NextResponse.json({ ok: true, db: "connected", users, assets, latencyMs: Date.now() - t0 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, db: "error", message: e instanceof Error ? e.message.split("\n")[0] : "unknown" },
      { status: 500 }
    );
  }
}
