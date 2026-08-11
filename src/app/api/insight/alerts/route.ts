import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const severity = url.searchParams.get("severity");
    const category = url.searchParams.get("category");
    const status = url.searchParams.get("status");

    const where: Prisma.AlertWhereInput = {};
    if (severity && severity !== 'ALL') where.severity = severity;
    if (category && category !== 'ALL') where.category = category;
    if (status && status !== 'ALL') where.status = status;

    const alerts = await db.alert.findMany({
      where,
      include: { asset: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }]
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action, supervisor } = body as { id: string; action: string; supervisor?: string };

    if (!id || !action) {
      return NextResponse.json({ error: "Missing id or action" }, { status: 400 });
    }

    if (action === "acknowledge") {
       await db.alert.update({ where: { id }, data: { status: "Acknowledged", acknowledgedAt: new Date() } });
    } else if (action === "escalate") {
       await db.alert.update({ where: { id }, data: { escalatedAt: new Date() } });
    } else if (action === "assign") {
       if (!supervisor) return NextResponse.json({ error: "supervisor required for assign action" }, { status: 400 });
       await db.alert.update({ where: { id }, data: { assignedTo: supervisor, status: "Acknowledged", acknowledgedAt: new Date() } });
    } else if (action === "resolve") {
       await db.alert.update({ where: { id }, data: { status: "Resolved", resolvedAt: new Date() } });
    } else {
       return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[API] /insight/alerts PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
