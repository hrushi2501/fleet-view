import { db } from "@/lib/db";
import { StatCard } from "@/components/ui";
import { AlertsClient } from "@/components/AlertsClient";
import { SweepButton } from "@/components/AlertRuleForms";
import { num } from "@/lib/utils";
import { LiveAiPoller } from "@/components/LiveAiPoller";
import { Bell, TriangleAlert, ShieldAlert, CircleCheck, ArrowUpRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const alerts = await db.alert.findMany({ include: { asset: true }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Alerts Hub</h1>
          <p className="text-sm text-slate-500">Centralized live alert feed — acknowledge, escalate, or assign to a supervisor</p>
        </div>
        <div className="flex items-center gap-2">
          <LiveAiPoller />
          <SweepButton />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total Alerts" value={num(alerts.length)} accent="brand" icon={<Bell className="h-5 w-5" />} />
        <StatCard label="Open" value={num(open)} sub="Awaiting action" accent="amber" icon={<ShieldAlert className="h-5 w-5" />} />
        <StatCard label="Critical Open" value={num(critical)} sub="Immediate attention" accent="rose" icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="Escalated" value={num(escalated)} sub="Needs supervisor review" accent={escalated > 0 ? "rose" : "violet"} icon={<ArrowUpRight className="h-5 w-5" />} />
        <StatCard label="Resolved" value={num(resolved)} accent="emerald" icon={<CircleCheck className="h-5 w-5" />} />
      </div>

      <AlertsClient alerts={data} />
    </div>
  );
}
