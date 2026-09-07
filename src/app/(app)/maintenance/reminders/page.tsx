import { db } from "@/lib/db";
import { StatCard, Card, SectionTitle, Badge } from "@/components/ui";
import { num, fmtDate, inr } from "@/lib/utils";
import { Wrench, TriangleAlert, CalendarClock, ShieldAlert, BellRing, AlertOctagon, FileText } from "lucide-react";
import { PushButton, SendTestPush } from "@/components/PushButton";
import { SnoozeModal, AlertActionButtons, RaiseWoFromReminderButton } from "@/components/ReminderForms";
import { pmDue, type ScheduleLite } from "@/lib/maintenance";
import Link from "next/link";
import { requirePage, assetScope } from "@/lib/access";
import { Txt } from "@/components/Txt";

export const dynamic = "force-dynamic";

const DAY = 86400000;

/**
 * What is due, what is overdue, and what is broken right now.
 *
 * Was `/notifications` — a name that described the delivery mechanism rather
 * than the content. Everything on it is a reminder about a machine, so it sits
 * under Maintenance and is called Service Due in the menu.
 */
export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const access = await requirePage("maintenance.view");
  // Rows, not just the page: a supervisor scoped to a site sees that site.
  const visible = assetScope(access);
  const resolvedParams = await searchParams;
  const tab = resolvedParams?.tab || "all";

  const [assets, breakdowns, expiringDocsList, alerts, schedules] = await Promise.all([
    db.asset.findMany({ where: { serviceDueDate: { not: null }, ...visible }, include: { project: true } }),
    db.workOrder.findMany({ where: { type: "BREAKDOWN", status: { in: ["Open", "In-Progress"] }, asset: visible }, include: { asset: true }, orderBy: { reportedAt: "desc" } }),
    db.complianceDoc.findMany({ where: { status: { in: ["Expiring", "Expired"] }, asset: visible }, include: { asset: true }, orderBy: { expiryDate: "asc" } }),
    db.alert.findMany({ where: { status: { in: ["Open", "Acknowledged"] } }, include: { asset: true }, orderBy: { createdAt: "desc" } }),
    db.maintenanceSchedule.findMany({ where: { active: true }, include: { asset: true } }),
  ]);

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  // Compute PM Dues with Dual Meter calculations
  const dues = schedules
    .filter((s) => s.asset)
    .map((s) => {
      const meterIsHours = s.asset!.primaryMeter === "SMU";
      const lite: ScheduleLite = {
        id: s.id,
        taskName: s.taskName,
        intervalKm: s.intervalKm,
        intervalHours: s.intervalHours,
        intervalDays: s.intervalDays,
        lastDoneMeter: s.lastDoneMeter,
        lastDoneDate: s.lastDoneDate,
        estimatedCost: s.estimatedCost,
      };
      return { schedule: s, due: pmDue(lite, s.asset!.meterValue, meterIsHours) };
    })
    .sort((a, b) => b.due.progressPct - a.due.progressPct);

  const pmOverdue = dues.filter((d) => d.due.status === "overdue");
  const pmDueSoon = dues.filter((d) => d.due.status === "due");

  const withDays = assets
    .map((a) => ({ a, days: Math.ceil((new Date(a.serviceDueDate!).getTime() - nowMs) / DAY) }))
    .sort((x, y) => x.days - y.days);

  const overdue = withDays.filter((x) => x.days < 0);
  const dueSoon = withDays.filter((x) => x.days >= 0 && x.days <= 15);
  const _upcoming = withDays.filter((x) => x.days > 15 && x.days <= 45);

  const tabClass = (t: string) => `px-4 py-2 text-sm font-semibold border-b-2 transition-all whitespace-nowrap flex items-center gap-1.5 ${
    tab === t
      ? "border-brand-600 text-brand-600"
      : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
  }`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900"><Txt text="Service Due &amp; Reminders" /></h1>
          <p className="text-sm text-slate-500"><Txt text="Multi-meter preventive service alerts, compliance expiries, and active breakdowns" /></p>
        </div>
        <div className="flex items-center gap-2">
          <PushButton />
          <SendTestPush />
        </div>
      </div>

      {/* Stat Cards Grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-4">
        <StatCard label="PM Service Overdue" value={num(pmOverdue.length + overdue.length)} sub="Action required" accent="rose" icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="Service Due Soon" value={num(pmDueSoon.length + dueSoon.length)} sub="Within 15 days / 50 hrs" accent="amber" icon={<CalendarClock className="h-5 w-5" />} />
        <StatCard label="Active Breakdowns" value={num(breakdowns.length)} sub="Open job cards" accent="brand" icon={<Wrench className="h-5 w-5" />} />
        <StatCard label="Compliance Expiries" value={num(expiringDocsList.length)} sub="RC / Fitness / Insurance" accent="violet" icon={<ShieldAlert className="h-5 w-5" />} />
      </div>

      {/* Category Tabs */}
      <div className="flex border-b border-slate-200 gap-1 overflow-x-auto">
        <Link href="/maintenance/reminders?tab=all" className={tabClass("all")}><BellRing className="h-4 w-4" /> All Reminders</Link>
        <Link href="/maintenance/reminders?tab=pm" className={tabClass("pm")}><Wrench className="h-4 w-4" /> PM Service ({pmOverdue.length + pmDueSoon.length})</Link>
        <Link href="/maintenance/reminders?tab=compliance" className={tabClass("compliance")}><FileText className="h-4 w-4" /> Compliance Docs ({expiringDocsList.length})</Link>
        <Link href="/maintenance/reminders?tab=breakdowns" className={tabClass("breakdowns")}><AlertOctagon className="h-4 w-4" /> Breakdowns ({breakdowns.length})</Link>
      </div>

      {/* ALL REMINDERS & PM SERVICE TAB */}
      {(tab === "all" || tab === "pm") && (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-brand-600" />
              <SectionTitle title="Preventive Maintenance Reminders" subtitle="Dual-meter tracking (Km, Engine Hours &amp; Calendar Days)" />
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {dues.slice(0, 20).map(({ schedule: s, due }) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between p-4 hover:bg-slate-50/50 gap-3">
                <div className="flex items-center gap-3">
                  <div className={`rounded-xl p-2.5 ${due.status === "overdue" ? "bg-rose-50 text-rose-600 border border-rose-200" : due.status === "due" ? "bg-amber-50 text-amber-600 border border-amber-200" : "bg-sky-50 text-sky-600 border border-sky-200"}`}>
                    <Wrench className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <Link href={`/fleet/${s.assetId}`} className="font-bold text-brand-700 hover:underline">{s.asset!.code}</Link>
                      <span className="text-xs text-slate-500">· {s.asset!.name}</span>
                      <Badge color={due.status === "overdue" ? "bg-rose-100 text-rose-700 ring-rose-600/20" : due.status === "due" ? "bg-amber-100 text-amber-700 ring-amber-600/20" : "bg-emerald-100 text-emerald-700 ring-emerald-600/20"}>
                        {due.status.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-sm font-semibold text-ink-900 mt-0.5">{s.taskName}</p>
                    <p className="text-xs text-slate-500">
                      Meter: <strong>{num(s.asset!.meterValue)} {s.asset!.primaryMeter}</strong> · Interval: {[s.intervalKm ? `${num(s.intervalKm)} km` : null, s.intervalHours ? `${num(s.intervalHours)} hrs` : null, s.intervalDays ? `${s.intervalDays} days` : null].filter(Boolean).join(" / ")}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className={`text-sm font-bold ${due.status === "overdue" ? "text-rose-600" : "text-amber-600"}`}>{due.label}</p>
                    <p className="text-xs text-slate-400">Est. Cost: {s.estimatedCost ? inr(s.estimatedCost) : "—"}</p>
                  </div>
                  <RaiseWoFromReminderButton scheduleId={s.id} />
                </div>
              </div>
            ))}
            {dues.length === 0 && <p className="p-8 text-center text-sm text-slate-400">No preventive service reminders recorded.</p>}
          </div>
        </Card>
      )}

      {/* COMPLIANCE TAB */}
      {(tab === "all" || tab === "compliance") && (
        <Card className="p-0">
          <div className="flex items-center gap-2 p-5 pb-3 border-b border-slate-100">
            <ShieldAlert className="h-5 w-5 text-violet-600" />
            <SectionTitle title="Statutory Document Expiry Reminders" subtitle="RC, Insurance, Fitness &amp; PUC Permits" />
          </div>
          <div className="divide-y divide-slate-100">
            {expiringDocsList.map((doc) => {
              const left = Math.ceil((new Date(doc.expiryDate).getTime() - nowMs) / DAY);
              return (
                <div key={doc.id} className="flex flex-wrap items-center justify-between p-4 hover:bg-slate-50/50 gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`rounded-xl p-2.5 ${left < 0 ? "bg-rose-50 text-rose-600 border border-rose-200" : "bg-amber-50 text-amber-600 border border-amber-200"}`}>
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Link href={`/fleet/${doc.assetId}`} className="font-bold text-brand-700 hover:underline">{doc.asset.code}</Link>
                        <Badge color={left < 0 ? "bg-rose-100 text-rose-700 ring-rose-600/20" : "bg-amber-100 text-amber-700 ring-amber-600/20"}>
                          {left < 0 ? "EXPIRED" : "EXPIRING"}
                        </Badge>
                      </div>
                      <p className="text-sm font-semibold text-ink-900 mt-0.5">{doc.docType} — No. {doc.number}</p>
                      <p className="text-xs text-slate-500">Expiry Date: <strong>{fmtDate(doc.expiryDate)}</strong></p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold ${left < 0 ? "text-rose-600" : "text-amber-600"}`}>
                      {left < 0 ? `${Math.abs(left)} days expired` : `Expires in ${left} days`}
                    </span>
                    <Link href="/compliance/checks" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg border border-brand-200">
                      Renew Doc
                    </Link>
                  </div>
                </div>
              );
            })}
            {expiringDocsList.length === 0 && <p className="p-8 text-center text-sm text-slate-400">All statutory compliance documents are valid and up to date.</p>}
          </div>
        </Card>
      )}

      {/* ACTIVE BREAKDOWNS TAB */}
      {(tab === "all" || tab === "breakdowns") && (
        <Card className="p-0">
          <div className="flex items-center gap-2 p-5 pb-3 border-b border-slate-100">
            <TriangleAlert className="h-5 w-5 text-rose-600" />
            <SectionTitle title="Active Breakdown Notifications" subtitle="Critical un-repaired machine job cards" />
          </div>
          <div className="divide-y divide-slate-100">
            {breakdowns.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center justify-between p-4 hover:bg-slate-50/50 gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">{w.woNo}</span>
                    <Link href={`/fleet/${w.assetId}`} className="font-bold text-brand-700 hover:underline">{w.asset?.code}</Link>
                    <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">{w.priority} Priority</Badge>
                  </div>
                  <p className="text-sm font-semibold text-ink-900 mt-0.5">{w.description}</p>
                  <p className="text-xs text-slate-500">Reported {fmtDate(w.reportedAt)} · {w.downtimeHrs}h downtime</p>
                </div>
                <Link href="/maintenance?tab=workorders" className="inline-flex items-center gap-1.5 bg-rose-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-rose-700">
                  <Wrench className="h-3.5 w-3.5" /> Manage Breakdown
                </Link>
              </div>
            ))}
            {breakdowns.length === 0 && <p className="p-8 text-center text-sm text-slate-400">No active breakdown job cards.</p>}
          </div>
        </Card>
      )}

      {/* ACTIVE SYSTEM ALERTS WITH SNOOZE WORKFLOW */}
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-brand-600" />
            <SectionTitle title="Active System Alerts &amp; Escalations" subtitle="Open alerts with snooze and acknowledgment controls" />
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {alerts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between p-4 hover:bg-slate-50/50 gap-3">
              <div className="flex items-start gap-3">
                <div className={`rounded-xl p-2.5 mt-0.5 ${a.severity === "Critical" ? "bg-rose-50 text-rose-600 border border-rose-200" : "bg-amber-50 text-amber-600 border border-amber-200"}`}>
                  <BellRing className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-ink-900 text-sm">{a.title}</span>
                    <Badge color={a.severity === "Critical" ? "bg-rose-100 text-rose-700 ring-rose-600/20" : "bg-amber-100 text-amber-700 ring-amber-600/20"}>{a.severity}</Badge>
                    <Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{a.status}</Badge>
                  </div>
                  <p className="text-xs text-slate-600 mt-1 max-w-xl">{a.message}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Category: {a.category} · Reported: {fmtDate(a.createdAt)}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <SnoozeModal alertId={a.id} alertTitle={a.title} />
                <AlertActionButtons alertId={a.id} />
              </div>
            </div>
          ))}
          {alerts.length === 0 && <p className="p-8 text-center text-sm text-slate-400">No active un-acknowledged system alerts.</p>}
        </div>
      </Card>
    </div>
  );
}