import { withApiErrors } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireApi } from "@/lib/access";
import { notificationScope } from "@/lib/notification-feed";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";
import { requireSameOrigin } from "@/lib/request-security";

/**
 * Both handlers were open: GET returned every alert in the fleet and PATCH let
 * anyone acknowledge, assign or resolve one — i.e. silence a live alert without
 * an account. Reading remains `fleet.view`; a state transition requires the
 * existing `fleet.edit` capability and the same row predicate.
 */
async function handleGET(request: NextRequest) {
  const auth = await requireApi("fleet.view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const severity = url.searchParams.get("severity");
    const category = url.searchParams.get("category");
    const status = url.searchParams.get("status");

    const where: Prisma.AlertWhereInput = {
      AND: [
        notificationScope(auth.access),
        ...(severity && severity !== "ALL" ? [{ severity }] : []),
        ...(category && category !== "ALL" ? [{ category }] : []),
        ...(status && status !== "ALL" ? [{ status }] : []),
      ],
    };

    const alerts = await db.alert.findMany({
      where,
      // Only the asset code is used below; `include: { asset: true }` pulled
      // every asset column — acquisition cost, QR token, device id — per alert.
      include: { asset: { select: { code: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 2000,
    });

    const open = alerts.filter((a) => a.status === "Open").length;
    const critical = alerts.filter((a) => a.severity === "Critical" && a.status === "Open").length;
    const escalated = alerts.filter((a) => a.escalatedAt && a.status !== "Resolved").length;
    const resolved = alerts.filter((a) => a.status === "Resolved").length;

    const data = alerts.map((a) => ({
      id: a.id,
      category: a.category,
      severity: a.severity,
      title: a.title,
      message: a.message,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
      assetCode: a.asset?.code ?? null,
      escalatedAt: a.escalatedAt?.toISOString() ?? null,
      assignedTo: a.assignedTo ?? null,
      actionUrl: a.actionUrl ?? null,
    }));

    return NextResponse.json({
      alerts: data,
      stats: { total: alerts.length, open, critical, escalated, resolved }
    });
  } catch (error) {
    console.error("[API] /insight/alerts GET error:", error);
    throw error;
  }
}

async function handlePATCH(request: NextRequest) {
  const auth = await requireApi("fleet.edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  requireSameOrigin(request);

  try {
    const body = await request.json();
    const { id, action, supervisor } = body as { id: string; action: string; supervisor?: string };

    if (typeof id !== "string" || id.length > 128 || !["acknowledge", "escalate", "assign", "resolve"].includes(action)) {
      return NextResponse.json({ error: "Missing id or action" }, { status: 400 });
    }
    if (supervisor != null && (typeof supervisor !== "string" || supervisor.trim().length === 0 || supervisor.length > 160)) {
      return NextResponse.json({ error: "Supervisor name is invalid." }, { status: 400 });
    }
    const limit = await reserveRateLimit({ scope: "alert-mutation", subject: auth.access.session.id, limit: 30, windowMs: 60_000 });
    if (!limit.ok) return rateLimitResponse(limit.retryInSeconds, "Too many alert updates. Please wait.");

    // Look up through the same row-level predicate as the list. An alert id
    // alone is never authority to resolve another project's safety alert.
    const existing = await db.alert.findFirst({
      where: { AND: [{ id }, notificationScope(auth.access)] },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

    if (action === "acknowledge") {
       await db.alert.update({ where: { id }, data: { status: "Acknowledged", acknowledgedAt: new Date() } });
    } else if (action === "escalate") {
       await db.alert.update({ where: { id }, data: { escalatedAt: new Date() } });
    } else if (action === "assign") {
       if (!supervisor) return NextResponse.json({ error: "supervisor required for assign action" }, { status: 400 });
       await db.alert.update({ where: { id }, data: { assignedTo: supervisor.trim(), status: "Acknowledged", acknowledgedAt: new Date() } });
    } else if (action === "resolve") {
       await db.alert.update({ where: { id }, data: { status: "Resolved", resolvedAt: new Date() } });
    } else {
       return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[API] /insight/alerts PATCH error:", error);
    throw error;
  }
}

export const GET = withApiErrors(handleGET);
export const PATCH = withApiErrors(handlePATCH);
