import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendPushToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

// Called by Vercel Cron (sends Authorization: Bearer ${CRON_SECRET}) or manually with ?key=
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const { searchParams } = new URL(req.url);
  const secret = process.env.CRON_SECRET || "mcc-cron-2026";
  if (auth !== `Bearer ${secret}` && searchParams.get("key") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const soon = new Date(Date.now() + 15 * 86400000);
  const [serviceDue, breakdowns, expiring] = await Promise.all([
    db.asset.count({ where: { serviceDueDate: { not: null, lte: soon } } }),
    db.workOrder.count({ where: { type: "BREAKDOWN", status: { in: ["Open", "In-Progress"] } } }),
    db.complianceDoc.count({ where: { status: { in: ["Expiring", "Expired"] } } }),
  ]);

  const parts: string[] = [];
  if (serviceDue) parts.push(`${serviceDue} service due`);
  if (breakdowns) parts.push(`${breakdowns} breakdowns`);
  if (expiring) parts.push(`${expiring} docs expiring`);
  if (parts.length === 0) return NextResponse.json({ ok: true, skipped: "nothing due" });

  const result = await sendPushToAll({
    title: "FleetView — Fleet needs attention",
    body: parts.join(" · "),
    url: "/notifications",
  });
  return NextResponse.json({ ok: true, ...result });
}
