import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkSharedSecret } from "@/lib/auth";
import { sendPushToUsers } from "@/lib/push";
import { runAutomaticAlertSweep } from "@/lib/automatic-alert-sweep";
import { administratorNotificationUserIds } from "@/lib/notification-recipients";

export const dynamic = "force-dynamic";

// Called by Vercel Cron with Authorization: Bearer ${CRON_SECRET}. Fails closed
// when CRON_SECRET is unset — an unauthenticated
// trigger here pushes a notification to every subscribed device.
async function handleGET(req: Request) {
  const auth = checkSharedSecret(req, "CRON_SECRET");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    // Materialise PUC/compliance, PM, tyre, fuel, and allocation conditions as
    // Alert rows before counting or pushing. The in-app bell then exposes the
    // same durable record to each role under its own RBAC scope.
    const sweep = await runAutomaticAlertSweep();
    const soon = new Date(Date.now() + 15 * 86400000);
    const [serviceDue, breakdowns, expiring] = await db.$transaction([
      db.asset.count({ where: { serviceDueDate: { not: null, lte: soon } } }),
      db.workOrder.count({ where: { type: "BREAKDOWN", status: { in: ["Open", "In-Progress"] } } }),
      db.complianceDoc.count({ where: { status: { in: ["Expiring", "Expired"] } } }),
    ]);

    const parts: string[] = [];
    if (serviceDue) parts.push(`${serviceDue} service due`);
    if (breakdowns) parts.push(`${breakdowns} breakdowns`);
    if (expiring) parts.push(`${expiring} docs expiring`);
    if (parts.length === 0) return NextResponse.json({ ok: true, skipped: "nothing due", dbAudit: sweep.dbAudit });

    const result = await sendPushToUsers(await administratorNotificationUserIds(), {
      title: "FleetView — Fleet needs attention",
      body: parts.join(" · "),
      url: "/notifications",
    });
    return NextResponse.json({ ok: true, dbAudit: sweep.dbAudit, ...result });
  } catch (err) {
    console.error("[API] /push/cron error:", err);
    throw err;
  }
}

export const GET = withApiErrors(handleGET);
