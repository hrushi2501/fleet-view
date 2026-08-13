import { db } from "@/lib/db";
import { StatCard, Card, SectionTitle, Badge, Progress } from "@/components/ui";
import { Donut } from "@/components/charts";
import { WorkOrderEntry, WorkOrderStatus } from "@/components/EntryForms";
import { ScheduleForm, SeedPmButton, RaiseWoButton, CompleteWoForm, DeleteRow, PreOpChecklistForm } from "@/components/MaintTyreForms";
import { pmDue, reliability, SERVICE_TIERS, FAILURE_CODES, type ScheduleLite, type WoLite } from "@/lib/maintenance";
import { scoreBreakdownRisk } from "@/lib/analytics";
import { inr, num, fmtDate, timeAgo, STATUS_COLOR, ASSET_CLASS_LABEL } from "@/lib/utils";
import { Wrench, TriangleAlert, Clock, BadgeCheck, Brain, CalendarClock, Activity, IndianRupee, Users, LayoutGrid, ListFilter, AlertCircle } from "lucide-react";
import Link from "next/link";
import { requirePage } from "@/lib/access";

export const dynamic = "force-dynamic";

const PRIORITY_COLOR: Record<string, string> = {
  Critical: "bg-rose-100 text-rose-700 ring-rose-600/20",
  High: "bg-amber-100 text-amber-700 ring-amber-600/20",
  Medium: "bg-sky-100 text-sky-700 ring-sky-600/20",
  Low: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const DUE_BADGE: Record<string, string> = {
  overdue: "bg-rose-100 text-rose-700 ring-rose-600/20",
  due: "bg-amber-100 text-amber-700 ring-amber-600/20",
  upcoming: "bg-sky-100 text-sky-700 ring-sky-600/20",
  ok: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
};
const DUE_LABEL: Record<string, string> = { overdue: "Overdue", due: "Due now", upcoming: "Coming up", ok: "OK" };

const WINDOW_DAYS = 365;

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string }> }) {
  await requirePage("maintenance.view");
  const resolvedParams = await searchParams;
  const tab = resolvedParams?.tab || "workorders";
  const view = resolvedParams?.view || "table";

  const since = new Date();
  since.setDate(since.getDate() - WINDOW_DAYS);


  const [wos, assets, schedules, openWos, allWos] = await Promise.all([
    db.workOrder.findMany({ include: { asset: true }, orderBy: { reportedAt: "desc" } }),
    db.asset.findMany({ orderBy: { code: "asc" } }),
    db.maintenanceSchedule.findMany({ where: { active: true }, include: { asset: true }, orderBy: { taskName: "asc" } }),
    db.workOrder.findMany({ where: { status: { in: ["Open", "In-Progress"] } }, include: { asset: true, lines: true, checklist: true }, orderBy: { reportedAt: "desc" } }),
    db.workOrder.findMany({ where: { reportedAt: { gte: since } } }),
  ]);

  const assetOpts = assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }));
  const classOpts = Object.entries(ASSET_CLASS_LABEL).map(([value, label]) => ({ value, label }));

  // Work order calculations
  const openJobs = wos.filter((w) => w.status === "Open" || w.status === "In-Progress");
  const breakdowns = wos.filter((w) => w.type === "BREAKDOWN" && (w.status === "Open" || w.status === "In-Progress"));
  const completed = wos.filter((w) => w.completedAt);
  const avgMttr = completed.length ? completed.reduce((s, w) => s + w.downtimeHrs, 0) / completed.length : 0;
  const totalCost = wos.reduce((s, w) => s + w.totalCost, 0);
  const warrantyClaimable = wos.filter((w) => w.warranty).length;

  const byType = ["PM", "BREAKDOWN", "REPAIR"].map((t) => ({ name: t, value: wos.filter((w) => w.type === t).length }));

  const bdCount: Record<string, number> = {};
  for (const w of wos) if (w.type === "BREAKDOWN") bdCount[w.assetId] = (bdCount[w.assetId] || 0) + 1;
  const risk = scoreBreakdownRisk(assets.map((a) => ({ id: a.id, code: a.code, name: a.name, assetClass: a.assetClass, yearMfg: a.yearMfg, healthScore: a.healthScore, serviceDueDate: a.serviceDueDate, lastServiceDate: a.lastServiceDate, breakdownCount: bdCount[a.id] || 0 }))).filter((r) => r.score > 0).slice(0, 10);

  // PM Calculations
  const rel = reliability(
    allWos.map((w): WoLite => ({ id: w.id, type: w.type, status: w.status, totalCost: w.totalCost, downtimeHrs: w.downtimeHrs, reportedAt: w.reportedAt, completedAt: w.completedAt })),
    WINDOW_DAYS
  );

  const dues = schedules
    .filter((s) => s.asset)
    .map((s) => {
      const meterIsHours = s.asset!.primaryMeter === "SMU";
      const lite: ScheduleLite = {
        id: s.id, taskName: s.taskName, intervalKm: s.intervalKm, intervalHours: s.intervalHours,
        intervalDays: s.intervalDays, lastDoneMeter: s.lastDoneMeter, lastDoneDate: s.lastDoneDate, estimatedCost: s.estimatedCost,
      };
      return { schedule: s, due: pmDue(lite, s.asset!.meterValue, meterIsHours) };
    })
    .sort((a, b) => b.due.progressPct - a.due.progressPct);

  const overdue = dues.filter((d) => d.due.status === "overdue");
  const dueNow = dues.filter((d) => d.due.status === "due");
  const upcoming = dues.filter((d) => d.due.status === "upcoming");
  const forecastCost = [...overdue, ...dueNow].reduce((s, d) => s + d.schedule.estimatedCost, 0);

  // PM 30-Day Forecast Planner Calculation
  const pmForecasts = schedules
    .filter((s) => s.asset)
    .map((s) => {
      const ageDays = Math.max(1, (new Date().getTime() - new Date(s.asset!.createdAt).getTime()) / 86400000);
      const dailyRate = Math.max(0.1, s.asset!.meterValue / ageDays);

      const currentMeter = s.asset!.meterValue;
      const lastDone = s.lastDoneMeter;
      const interval = s.asset!.primaryMeter === "SMU" ? s.intervalHours : s.intervalKm;
      const nextDueMeter = lastDone + interval;
      const remainingMeter = nextDueMeter - currentMeter;

      const daysByMeter = remainingMeter > 0 ? remainingMeter / dailyRate : 0;

      let daysByDate = 999;
      if (s.intervalDays && s.lastDoneDate) {
        const elapsed = (new Date().getTime() - new Date(s.lastDoneDate).getTime()) / 86400000;
        daysByDate = Math.max(0, s.intervalDays - elapsed);
      }

      const estDaysRemaining = Math.min(daysByMeter, daysByDate);
      const estDate = new Date();
      estDate.setDate(estDate.getDate() + estDaysRemaining);

      return {
        schedule: s,
        estDaysRemaining,
        estDate,
      };
    })
    // Filter down to schedules due in next 30 days and not already overdue/due (those are in the due list)
    .filter((f) => f.estDaysRemaining > 0 && f.estDaysRemaining <= 30)
    .sort((a, b) => a.estDaysRemaining - b.estDaysRemaining);

  // Technician Load Assignment Calculation
  const techJobs: Record<string, typeof openJobs> = {};
  for (const w of openJobs) {
    const name = w.technician || "Unassigned";
    if (!techJobs[name]) techJobs[name] = [];
    techJobs[name].push(w);
  }
  const techList = Object.entries(techJobs).map(([name, jobs]) => {
    return {
      name,
      jobsCount: jobs.length,
      totalDowntime: jobs.reduce((s, j) => s + j.downtimeHrs, 0),
      totalCost: jobs.reduce((s, j) => s + j.totalCost, 0),
      jobs,
    };
  }).sort((a, b) => b.jobsCount - a.jobsCount);

  const tabClass = (t: string) => `px-4 py-2 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
    tab === t
      ? "border-brand-600 text-brand-600"
      : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
  }`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Maintenance Management</h1>
          <p className="text-sm text-slate-500">Preventive &amp; breakdown maintenance, work orders, downtime &amp; warranty</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PreOpChecklistForm assets={assetOpts} />
          {tab === "workorders" ? (
            <WorkOrderEntry assets={assetOpts} />
          ) : (
            <>
              {schedules.length === 0 && <SeedPmButton />}
              <ScheduleForm assets={assetOpts} classes={classOpts} />
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 justify-between items-center overflow-x-auto">
        <div className="flex gap-1">
          <Link href={`/maintenance?tab=workorders&view=${view}`} className={tabClass("workorders")}>📋 Work Orders</Link>
          <Link href="/maintenance?tab=preventive" className={tabClass("preventive")}>📅 Preventive Service</Link>
        </div>

        {tab === "workorders" && (
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            <Link href="/maintenance?tab=workorders&view=table" className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${view === "table" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
              <ListFilter className="h-3.5 w-3.5" /> Table View
            </Link>
            <Link href="/maintenance?tab=workorders&view=kanban" className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${view === "kanban" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
              <LayoutGrid className="h-3.5 w-3.5" /> Kanban Board
            </Link>
          </div>
        )}
      </div>

      {tab === "workorders" && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Open Work Orders" value={num(openJobs.length)} sub={`${wos.length} total`} accent="brand" icon={<Wrench className="h-5 w-5" />} />
            <StatCard label="Active Breakdowns" value={num(breakdowns.length)} sub="Needs urgent attention" accent="rose" icon={<TriangleAlert className="h-5 w-5" />} />
            <StatCard label="Avg MTTR" value={`${avgMttr.toFixed(1)} h`} sub="Mean time to repair" accent="amber" icon={<Clock className="h-5 w-5" />} />
            <StatCard label="Maintenance Spend" value={inr(totalCost, { compact: true })} sub={`${warrantyClaimable} warranty-claimable`} accent="violet" icon={<BadgeCheck className="h-5 w-5" />} />
          </div>

          {/* Failure Code Analytics Widget */}
          {(() => {
            const failureCounts: Record<string, number> = {};
            for (const fc of FAILURE_CODES) failureCounts[fc.code] = 0;
            for (const w of wos) {
              for (const fc of FAILURE_CODES) {
                if (w.description.includes(fc.code) || w.description.toLowerCase().includes(fc.category.toLowerCase())) {
                  failureCounts[fc.code] = (failureCounts[fc.code] || 0) + 1;
                }
              }
            }
            const topFailures = FAILURE_CODES.map((fc) => ({ ...fc, count: failureCounts[fc.code] || 0 }))
              .sort((a, b) => b.count - a.count);

            return (
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-600" />
                    <SectionTitle title="Failure Reason & RCA Intelligence" subtitle="Categorized component failure frequency to drive corrective action" />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {topFailures.slice(0, 4).map((tf) => (
                    <div key={tf.code} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tf.category}</span>
                        <span className="text-xs font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full">{tf.count} incidents</span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-ink-900 truncate" title={tf.label}>{tf.label}</p>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}

          {/* Kanban View vs Table View */}
          {view === "kanban" ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {(["Open", "In-Progress", "Completed", "Closed"] as const).map((statusCol) => {
                const colWos = wos.filter((w) => w.status === statusCol);
                const colAccent = statusCol === "Open" ? "border-t-sky-500 bg-sky-50/30" : statusCol === "In-Progress" ? "border-t-amber-500 bg-amber-50/30" : statusCol === "Completed" ? "border-t-emerald-500 bg-emerald-50/30" : "border-t-slate-400 bg-slate-50/30";

                return (
                  <div key={statusCol} className={`rounded-xl border border-slate-200 border-t-4 ${colAccent} p-3 space-y-3 min-h-[500px]`}>
                    <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                      <span className="font-bold text-sm text-slate-800">{statusCol}</span>
                      <span className="text-xs font-bold bg-white px-2 py-0.5 rounded-full shadow-sm text-slate-600 border border-slate-200">{colWos.length}</span>
                    </div>

                    <div className="space-y-3 max-h-[700px] overflow-y-auto pr-1">
                      {colWos.map((w) => (
                        <div key={w.id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm space-y-2.5 hover:shadow-md transition-shadow">
                          <div className="flex items-start justify-between">
                            <span className="font-mono text-xs font-bold text-slate-500">{w.woNo}</span>
                            <Badge color={PRIORITY_COLOR[w.priority]}>{w.priority}</Badge>
                          </div>

                          <div>
                            <Link href={`/fleet/${w.assetId}`} className="font-bold text-sm text-brand-700 hover:underline">{w.asset?.code || "Asset"}</Link>
                            <p className="text-xs text-slate-600 line-clamp-2 mt-0.5">{w.description}</p>
                          </div>

                          <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
                            <span>Cost: <strong className="text-slate-800">{inr(w.totalCost, { compact: true })}</strong></span>
                            <span>{w.downtimeHrs}h downtime</span>
                          </div>

                          {w.technician && (
                            <div className="text-[11px] text-slate-500 flex items-center gap-1">
                              <Users className="h-3 w-3 text-slate-400" />
                              <span>{w.technician}</span>
                            </div>
                          )}

                          <div className="pt-2 flex justify-end">
                            <WorkOrderStatus id={w.id} status={w.status} />
                          </div>
                        </div>
                      ))}
                      {colWos.length === 0 && (
                        <p className="text-center py-8 text-xs text-slate-400">No {statusCol.toLowerCase()} jobs</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <SectionTitle title="Work Orders by Type" />
                <Donut data={byType} />
              </Card>
              <Card className="lg:col-span-2">
                <SectionTitle title="Open &amp; In-Progress Work Orders" subtitle="Prioritized queue" />
                <div className="max-h-[300px] space-y-2 overflow-y-auto mt-4">
                  {openJobs.slice(0, 12).map((w) => (
                    <div key={w.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-2.5 hover:bg-slate-50/50">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge color={PRIORITY_COLOR[w.priority]}>{w.priority}</Badge>
                          <span className="text-sm font-semibold text-ink-900">{w.woNo}</span>
                          <span className="text-xs text-slate-400">{w.asset?.code}</span>
                        </div>
                        <p className="truncate text-xs text-slate-500 mt-0.5">{w.description}</p>
                      </div>
                      <Badge color={STATUS_COLOR[w.status]}>{w.status}</Badge>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* Technician Allocation Grid */}
          <Card className="p-0">
            <div className="flex items-center gap-2 p-5 pb-3 border-b border-slate-100">
              <Users className="h-5 w-5 text-brand-600" />
              <SectionTitle title="Workshop Load &amp; Technician Assignment" subtitle="Allocations of open maintenance jobs by technician" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="px-5 py-3 font-medium">Technician</th>
                    <th className="px-5 py-3 text-center font-medium">Active Jobs</th>
                    <th className="px-5 py-3 text-right font-medium">Est. Downtime</th>
                    <th className="px-5 py-3 text-right font-medium">Active Cost</th>
                    <th className="px-5 py-3 font-medium">Current Assignments</th>
                  </tr>
                </thead>
                <tbody>
                  {techList.map((t) => (
                    <tr key={t.name} className="border-t border-slate-100 hover:bg-slate-50/30">
                      <td className="px-5 py-3 font-semibold text-ink-900">{t.name}</td>
                      <td className="px-5 py-3 text-center">
                        <Badge color={t.jobsCount > 3 ? "bg-rose-100 text-rose-700 ring-rose-600/20" : "bg-brand-100 text-brand-700 ring-brand-600/20"}>{t.jobsCount} jobs</Badge>
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600 font-mono">{t.totalDowntime} hrs</td>
                      <td className="px-5 py-3 text-right font-medium text-ink-900">{inr(t.totalCost)}</td>
                      <td className="px-5 py-3 font-medium">
                        <div className="flex flex-wrap gap-1 max-w-lg">
                          {t.jobs.map((j) => (
                            <span key={j.id} className="inline-flex items-center gap-1 bg-slate-50 text-slate-600 text-xs px-2 py-0.5 rounded border border-slate-100">
                              <span className="font-semibold text-slate-700">{j.asset?.code}</span>
                              <span className="text-[10px] text-slate-400">({j.woNo})</span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {techList.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-slate-400">No active technician allocations.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {risk.length > 0 && (
            <Card className="p-0">
              <div className="flex items-center gap-2 p-5 pb-3">
                <Brain className="h-5 w-5 text-violet-600" />
                <SectionTitle title="Predictive — Breakdown Risk" subtitle="Vehicles most likely to break down next, by age, overdue service, history &amp; health" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Vehicle</th>
                      <th className="px-5 py-3 font-medium">Class</th>
                      <th className="px-5 py-3 font-medium">Risk</th>
                      <th className="px-5 py-3 font-medium">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {risk.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100 hover:bg-violet-50/30">
                        <td className="px-5 py-3"><Link href={`/fleet/${r.id}`} className="font-semibold text-brand-700 hover:underline">{r.code}</Link><p className="text-xs text-slate-400">{r.name}</p></td>
                        <td className="px-5 py-3 text-slate-600">{ASSET_CLASS_LABEL[r.assetClass] ?? r.assetClass}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${r.level === "High" ? "bg-rose-100 text-rose-700 ring-rose-600/20" : r.level === "Medium" ? "bg-amber-100 text-amber-700 ring-amber-600/20" : "bg-emerald-100 text-emerald-700 ring-emerald-600/20"}`}>{r.score} · {r.level}</span>
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500">{r.factors.join(" · ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card className="p-0">
            <div className="p-5 pb-3"><SectionTitle title="All Work Orders" /></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="px-5 py-3 font-medium">WO No.</th>
                    <th className="px-5 py-3 font-medium">Asset</th>
                    <th className="px-5 py-3 font-medium">Type</th>
                    <th className="px-5 py-3 font-medium">Description</th>
                    <th className="px-5 py-3 font-medium">Priority</th>
                    <th className="px-5 py-3 font-medium">Downtime</th>
                    <th className="px-5 py-3 font-medium">Cost</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Repair Photos</th>
                    <th className="px-5 py-3 font-medium">Reported</th>
                  </tr>
                </thead>
                <tbody>
                  {wos.slice(0, 40).map((w) => (
                    <tr key={w.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                      <td className="px-5 py-3 font-semibold text-ink-900">{w.woNo}</td>
                      <td className="px-5 py-3">{w.asset ? <Link href={`/fleet/${w.assetId}`} className="text-brand-700 hover:underline">{w.asset.code}</Link> : "—"}</td>
                      <td className="px-5 py-3 text-slate-600">{w.type}</td>
                      <td className="px-5 py-3 text-slate-600">{w.description}</td>
                      <td className="px-5 py-3"><Badge color={PRIORITY_COLOR[w.priority]}>{w.priority}</Badge></td>
                      <td className="px-5 py-3 text-slate-600">{w.downtimeHrs.toFixed(0)} h</td>
                      <td className="px-5 py-3 font-medium text-ink-900">{inr(w.totalCost, { compact: true })}</td>
                      <td className="px-5 py-3"><WorkOrderStatus id={w.id} status={w.status} /></td>
                      <td className="px-5 py-3">
                        {(() => {
                          let oldU: string[] = [], newU: string[] = [];
                          try {
                            const p = w.partPhotos ? JSON.parse(w.partPhotos) : null;
                            if (Array.isArray(p)) newU = p;
                            else if (p) { oldU = p.old || []; newU = p.new || []; }
                          } catch { /* ignore */ }
                          if (!oldU.length && !newU.length) return <span className="text-slate-300">—</span>;
                          const grp = (label: string, urls: string[], ring: string) => urls.length ? (
                            <div className="flex items-center gap-1">
                              <span className={`text-[9px] font-bold uppercase ${label === "Old" ? "text-rose-500" : "text-emerald-600"}`}>{label}</span>
                              {urls.slice(0, 2).map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt={label} className={`h-9 w-9 rounded-md object-cover ring-2 ${ring} transition-transform hover:scale-110`} /></a>)}
                              {urls.length > 2 && <span className="text-[10px] text-slate-400">+{urls.length - 2}</span>}
                            </div>
                          ) : null;
                          return <div className="flex flex-col gap-1">{grp("Old", oldU, "ring-rose-300")}{grp("New", newU, "ring-emerald-300")}</div>;
                        })()}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-400">{timeAgo(w.reportedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "preventive" && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="Overdue" value={num(overdue.length)} sub="past interval" accent="rose" icon={<TriangleAlert className="h-5 w-5" />} />
            <StatCard label="Due Now" value={num(dueNow.length)} sub={`${num(upcoming.length)} coming up`} accent="amber" icon={<CalendarClock className="h-5 w-5" />} />
            <StatCard label="Forecast Spend" value={inr(forecastCost, { compact: true })} sub="overdue + due tasks" accent="brand" icon={<IndianRupee className="h-5 w-5" />} />
            <StatCard label="Planned Ratio" value={rel.plannedRatio != null ? `${rel.plannedRatio.toFixed(0)}%` : "—"} sub={rel.plannedRatio != null ? `${rel.breakdowns} breakdowns / 12mo` : "no work orders in the period"} accent={rel.plannedRatio != null && rel.plannedRatio >= 60 ? "emerald" : "amber"} icon={<Activity className="h-5 w-5" />} />
            <StatCard label="MTBF / MTTR" value={rel.mtbfDays ? `${rel.mtbfDays.toFixed(0)}d` : "—"} sub={rel.mttrHours ? `${rel.mttrHours.toFixed(1)}h to repair` : "no breakdowns"} accent="violet" icon={<Wrench className="h-5 w-5" />} />
          </div>

          {schedules.length === 0 && (
            <Card>
              <div className="py-12 text-center">
                <CalendarClock className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-ink-900">No PM schedules yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  Press <strong>Install PM Templates</strong> to apply standard service tasks to every matching machine, anchored to its current meter.
                </p>
              </div>
            </Card>
          )}

          {dues.length > 0 && (
            <Card className="p-0">
              <div className="p-5 pb-3">
                <SectionTitle title="Service Due Board" subtitle="Most urgent first — raise a work order straight from a due task" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-100">
                    <tr>
                      <th className="px-5 py-3 font-medium">Machine</th>
                      <th className="px-5 py-3 font-medium">Task</th>
                      <th className="px-5 py-3 font-medium">Interval</th>
                      <th className="px-5 py-3 font-medium">Progress</th>
                      <th className="px-5 py-3 font-medium">Remaining</th>
                      <th className="px-5 py-3 text-right font-medium">Est. Cost</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dues.slice(0, 80).map(({ schedule: s, due }) => {
                      const tier = s.intervalHours >= 2000 || s.intervalKm >= 80000 ? SERVICE_TIERS.SERVICE_D : s.intervalHours >= 1000 || s.intervalKm >= 40000 ? SERVICE_TIERS.SERVICE_C : s.intervalHours >= 500 || s.intervalKm >= 20000 ? SERVICE_TIERS.SERVICE_B : SERVICE_TIERS.SERVICE_A;

                      return (
                        <tr key={s.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                          <td className="px-5 py-3">
                            <Link href={`/fleet/${s.assetId}`} className="font-semibold text-brand-700 hover:underline">{s.asset!.code}</Link>
                            <p className="text-xs text-slate-400">
                              {s.asset!.primaryMeter === "SMU" ? `${num(s.asset!.meterValue)} hrs` : `${num(s.asset!.meterValue)} km`}
                            </p>
                          </td>
                          <td className="px-5 py-3 font-medium text-ink-900">
                            <div>{s.taskName}</div>
                            <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${tier.badgeColor}`}>{tier.name}</span>
                          </td>
                          <td className="px-5 py-3 text-xs text-slate-500">
                          {[s.intervalKm ? `${num(s.intervalKm)} km` : null, s.intervalHours ? `${num(s.intervalHours)} hrs` : null, s.intervalDays ? `${s.intervalDays} days` : null].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="px-5 py-3">
                          <div className="w-28">
                            <Progress value={Math.min(100, due.progressPct)} />
                            <p className="mt-0.5 text-xs text-slate-400">{due.progressPct.toFixed(0)}%</p>
                          </div>
                        </td>
                        <td className={`px-5 py-3 text-sm ${due.status === "overdue" ? "font-semibold text-rose-600" : "text-slate-600"}`}>{due.label}</td>
                        <td className="px-5 py-3 text-right text-slate-600">{s.estimatedCost ? inr(s.estimatedCost, { compact: true }) : "—"}</td>
                        <td className="px-5 py-3"><Badge color={DUE_BADGE[due.status]}>{DUE_LABEL[due.status]}</Badge></td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {(due.status === "overdue" || due.status === "due") && <RaiseWoButton scheduleId={s.id} />}
                            <DeleteRow id={s.id} kind="schedule" />
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* 30-Day PM Forecast Planner */}
          <Card className="p-0">
            <div className="flex items-center gap-2 p-5 pb-3 border-b border-slate-100">
              <CalendarClock className="h-5 w-5 text-brand-600" />
              <SectionTitle title="30-Day PM Forecast Planner" subtitle="Service intervals predicted to trip in the next 30 days based on run-rates" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="px-5 py-3 font-medium">Machine</th>
                    <th className="px-5 py-3 font-medium">Task</th>
                    <th className="px-5 py-3 text-center font-medium">Est. Days Remaining</th>
                    <th className="px-5 py-3 font-medium">Predicted Due Date</th>
                    <th className="px-5 py-3 text-right font-medium">Est. Cost</th>
                    <th className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pmForecasts.map((f) => (
                    <tr key={f.schedule.id} className="border-t border-slate-100 hover:bg-slate-50/30">
                      <td className="px-5 py-3">
                        <Link href={`/fleet/${f.schedule.assetId}`} className="font-semibold text-brand-700 hover:underline">{f.schedule.asset!.code}</Link>
                        <p className="text-xs text-slate-400">Current: {num(f.schedule.asset!.meterValue)} {f.schedule.asset!.primaryMeter}</p>
                      </td>
                      <td className="px-5 py-3 font-medium text-ink-900">{f.schedule.taskName}</td>
                      <td className="px-5 py-3 text-center">
                        <Badge color="bg-sky-50 text-sky-700 border-sky-100">in {Math.round(f.estDaysRemaining)} days</Badge>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{fmtDate(f.estDate)}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{f.schedule.estimatedCost ? inr(f.schedule.estimatedCost, { compact: true }) : "—"}</td>
                      <td className="px-5 py-3 text-right">
                        <RaiseWoButton scheduleId={f.schedule.id} />
                      </td>
                    </tr>
                  ))}
                  {pmForecasts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-6 text-center text-slate-400">No upcoming service forecasts in the next 30 days.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-0">
            <div className="p-5 pb-3">
              <SectionTitle title={`Open PM Work Orders (${openWos.length})`} subtitle="Job cards with their labour and parts lines" />
            </div>
            <div className="divide-y divide-slate-100">
              {openWos.map((w) => {
                const criticalOpen = w.checklist.filter((c) => c.critical && !c.done).length;
                return (
                  <div key={w.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-slate-400">{w.woNo}</span>
                          <Link href={`/fleet/${w.assetId}`} className="font-bold text-brand-700 hover:underline">{w.asset.code}</Link>
                          <Badge color={w.type === "BREAKDOWN" ? "bg-rose-100 text-rose-700 ring-rose-600/20" : w.type === "PM" ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : "bg-sky-100 text-sky-700 ring-sky-600/20"}>{w.type}</Badge>
                          <Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{w.status}</Badge>
                          {criticalOpen > 0 && <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">{criticalOpen} critical unticked</Badge>}
                        </div>
                        <p className="mt-1 font-medium text-ink-900">{w.description}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Reported {fmtDate(w.reportedAt)} · {inr(w.totalCost)} · {w.downtimeHrs}h downtime
                          {w.technician ? ` · ${w.technician}` : ""}
                        </p>
                      </div>
                      <CompleteWoForm wo={{ id: w.id, woNo: w.woNo, laborCost: w.laborCost, partsCost: w.partsCost, downtimeHrs: w.downtimeHrs, meterAtService: w.meterAtService }} />
                    </div>

                    {w.lines.length > 0 && (
                      <div className="mt-3 overflow-x-auto rounded-lg ring-1 ring-slate-100">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                            <tr>
                              <th className="px-4 py-2 font-medium">Kind</th>
                              <th className="px-4 py-2 font-medium">Description</th>
                              <th className="px-4 py-2 font-medium">Part No.</th>
                              <th className="px-4 py-2 text-right font-medium">Qty</th>
                              <th className="px-4 py-2 text-right font-medium">Rate</th>
                              <th className="px-4 py-2 text-right font-medium">Amount</th>
                              <th className="px-4 py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {w.lines.map((l) => (
                              <tr key={l.id} className="border-t border-slate-100">
                                <td className="px-4 py-2 text-slate-600">{l.kind}</td>
                                <td className="px-4 py-2 font-medium text-ink-900">{l.description}</td>
                                <td className="px-4 py-2 text-slate-500">{l.partNo ?? "—"}</td>
                                <td className="px-4 py-2 text-right text-slate-600">{l.qty}</td>
                                <td className="px-4 py-2 text-right text-slate-600">{inr(l.rate)}</td>
                                <td className="px-4 py-2 text-right font-medium text-ink-900">{inr(l.amount)}</td>
                                <td className="px-4 py-2 text-right"><DeleteRow id={l.id} kind="woline" /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {w.checklist.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {w.checklist.map((c) => (
                          <li key={c.id} className="flex items-center gap-2 text-sm">
                            <span className={`inline-block h-2 w-2 rounded-full ${c.done ? "bg-emerald-500" : c.critical ? "bg-rose-500" : "bg-slate-300"}`} />
                            <span className={c.done ? "text-slate-400 line-through" : "text-slate-700"}>{c.task}</span>
                            {c.critical && !c.done && <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">critical</Badge>}
                            {c.doneBy && <span className="text-xs text-slate-400">— {c.doneBy}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {openWos.length === 0 && <p className="py-10 text-center text-sm text-slate-400">No open work orders.</p>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
