import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Public liveness probe — the one route with no credential of any kind, so it
 * says only whether the app can reach its database.
 *
 * It used to return the user and asset counts (headcount and fleet size are the
 * client's commercial data) and, on failure, the raw driver message, which for
 * Prisma routinely contains the database host, port and user.
 */
export async function GET() {
  try {
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "connected", latencyMs: Date.now() - t0 });
  } catch (e) {
    console.error("[API] /health db check failed:", e);
    return NextResponse.json({ ok: false, db: "error" }, { status: 500 });
  }
}
