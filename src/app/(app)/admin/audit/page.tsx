import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard } from "@/components/ui";
import { num, fmtDate, timeAgo } from "@/lib/utils";
import { KeyRound, Activity, Users, ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { requireAdminPage } from "@/lib/access";

export const dynamic = "force-dynamic";

const ACTION_BADGE: Record<string, string> = {
  CREATE: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  UPDATE: "bg-brand-100 text-brand-700 ring-brand-600/20",
  DELETE: "bg-rose-100 text-rose-700 ring-rose-600/20",
  APPROVE: "bg-violet-100 text-violet-700 ring-violet-600/20",
  CONFIG: "bg-amber-100 text-amber-700 ring-amber-600/20",
  LOGIN: "bg-slate-100 text-slate-600 ring-slate-500/20",
  LOGIN_FAILED: "bg-rose-50 text-rose-700 ring-rose-600/20",
  EXPORT: "bg-amber-100 text-amber-700 ring-amber-600/20",
};

export default async function AuditPage() {
  await requireAdminPage("admin.audit");
  const since = new Date(); since.setDate(since.getDate() - 90);
  const [events, total, actors] = await Promise.all([
    db.auditEvent.findMany({ orderBy: { at: "desc" }, take: 300 }),
    db.auditEvent.count(),
    db.auditEvent.groupBy({ by: ["actorName"], _count: true, where: { at: { gte: since } } }),
  ]);

  const sensitive = events.filter((e) => e.action === "DELETE" || e.action === "CONFIG" || e.action === "EXPORT").length;

  return (
    <div className="space-y-6">
      <Link href="/admin/roles" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Roles
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Audit Log</h1>
        <p className="text-sm text-slate-500">
          Append-only record of who did what. Nothing in the app edits or deletes these rows.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Events Recorded" value={num(total)} sub="all time" accent="brand" icon={<Activity className="h-5 w-5" />} />
        <StatCard label="Sensitive Actions" value={num(sensitive)} sub="deletes, config, exports" accent="amber" icon={<ShieldCheck className="h-5 w-5" />} />
        <StatCard label="Active Users" value={num(actors.length)} sub="last 90 days" accent="violet" icon={<Users className="h-5 w-5" />} />
        <StatCard label="Showing" value={num(events.length)} sub="most recent" accent="emerald" icon={<KeyRound className="h-5 w-5" />} />
      </div>

      <Card className="p-0">
        <div className="p-5 pb-3"><SectionTitle title="Events" subtitle="Newest first" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">When</th>
                <th className="px-5 py-3 font-medium">Who</th>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium">Module</th>
                <th className="px-5 py-3 font-medium">Summary</th>
                <th className="px-5 py-3 font-medium">Changes</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 align-top hover:bg-brand-50/30">
                  <td className="px-5 py-3 whitespace-nowrap text-slate-600">
                    {fmtDate(e.at)}
                    <span className="block text-xs text-slate-400">{timeAgo(e.at)}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="font-medium text-ink-900">{e.actorName ?? "System"}</span>
                    {e.actorRole && <span className="block text-xs text-slate-400">{e.actorRole}</span>}
                  </td>
                  <td className="px-5 py-3"><Badge color={ACTION_BADGE[e.action] ?? ACTION_BADGE.LOGIN}>{e.action}</Badge></td>
                  <td className="px-5 py-3 text-slate-600">{e.module}</td>
                  <td className="px-5 py-3 text-slate-700">
                    {e.summary}
                    {e.entity && <span className="block font-mono text-[10px] text-slate-400">{e.entity}{e.entityId ? ` · ${e.entityId.slice(0, 8)}` : ""}</span>}
                  </td>
                  <td className="px-5 py-3">
                    {e.changes ? <code className="block max-w-xs overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[10px] text-slate-600">{e.changes}</code> : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-400">
                  No events yet. The log fills as roles are installed and records are created or changed.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
