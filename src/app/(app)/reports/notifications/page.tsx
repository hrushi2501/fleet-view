import Link from "next/link";
import { BellRing, CircleAlert, ExternalLink, Fuel, ShieldAlert } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage, assetScope } from "@/lib/access";
import { Badge, Card, SectionTitle, StatCard } from "@/components/ui";
import { fmtDate, num } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The durable notification history.
 *
 * Reminders shows only work waiting for maintenance attention. This page reads
 * every Alert, including acknowledged and resolved rows, so a driver fuel fill
 * or accident report remains visible after the operational queue is cleared.
 */
export default async function NotificationLogPage() {
  const access = await requirePage("reports.view");
  const visibleAssets = assetScope(access);
  const where = access.group === "ADMIN" ? {} : { asset: visibleAssets };
  const alerts = await db.alert.findMany({
    where,
    include: { asset: { select: { code: true, name: true } }, driver: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const critical = alerts.filter((alert) => alert.severity === "Critical").length;
  const open = alerts.filter((alert) => alert.status === "Open").length;
  const fuel = alerts.filter((alert) => alert.category === "Fuel").length;
  const severity = (value: string) => value === "Critical"
    ? "bg-rose-100 text-rose-700 ring-rose-600/20"
    : value === "Warning"
      ? "bg-amber-100 text-amber-700 ring-amber-600/20"
      : "bg-sky-100 text-sky-700 ring-sky-600/20";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Notification Log</h1>
        <p className="text-sm text-slate-500">Master record of driver and system notifications, newest first</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-4">
        <StatCard label="Recorded" value={num(alerts.length)} sub="latest 500 events" accent="brand" icon={<BellRing className="h-5 w-5" />} />
        <StatCard label="Open" value={num(open)} sub="needs attention" accent="amber" icon={<CircleAlert className="h-5 w-5" />} />
        <StatCard label="Critical" value={num(critical)} sub="priority events" accent="rose" icon={<ShieldAlert className="h-5 w-5" />} />
        <StatCard label="Fuel fills" value={num(fuel)} sub="driver and system" accent="emerald" icon={<Fuel className="h-5 w-5" />} />
      </div>

      <Card className="p-0">
        <div className="border-b border-slate-100 p-5 pb-3">
          <SectionTitle title="All notifications" subtitle="Acknowledged and resolved records remain here for reporting" />
        </div>
        <div className="divide-y divide-slate-100">
          {alerts.map((alert) => (
            <div key={alert.id} className="flex flex-wrap items-start justify-between gap-4 p-5 hover:bg-brand-50/30">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink-900">{alert.title}</p>
                  <Badge color={severity(alert.severity)}>{alert.severity}</Badge>
                  <Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{alert.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-600">{alert.message}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {fmtDate(alert.createdAt)} · {alert.category}
                  {alert.asset ? ` · ${alert.asset.code} — ${alert.asset.name}` : ""}
                  {alert.driver ? ` · ${alert.driver.name}` : ""}
                </p>
              </div>
              {alert.actionUrl && (
                <Link href={alert.actionUrl} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                  Open <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          ))}
          {alerts.length === 0 && <p className="p-10 text-center text-sm text-slate-400">No notifications have been recorded yet.</p>}
        </div>
      </Card>
    </div>
  );
}
