import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard, Progress } from "@/components/ui";
import { SiteForm, PlanForm, AllocationForm, AllocationStatusForm, MobilizationForm, MobStatusForm, DeleteRow } from "@/components/OpsForms";
import {
  allocationConflicts, geofenceCheck, planVsActual, mobilizationStats,
  SITE_TYPE_LABEL, TRANSPORT_LABEL,
  type AllocationLite, type SiteLite, type MobLite, type PlanLite,
} from "@/lib/operations";
import { inr, num, fmtDate, ASSET_CLASS_LABEL } from "@/lib/utils";
import { MapPin, TriangleAlert, Truck, ClipboardList, Navigation, IndianRupee } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const ALLOC_BADGE: Record<string, string> = {
  PLANNED: "bg-brand-100 text-brand-700 ring-brand-600/20",
  ACTIVE: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  RELEASED: "bg-slate-100 text-slate-600 ring-slate-500/20",
  CANCELLED: "bg-slate-100 text-slate-500 ring-slate-400/20",
};
const MOB_BADGE: Record<string, string> = {
  REQUESTED: "bg-amber-100 text-amber-700 ring-amber-600/20",
  APPROVED: "bg-brand-100 text-brand-700 ring-brand-600/20",
  IN_TRANSIT: "bg-violet-100 text-violet-700 ring-violet-600/20",
  ARRIVED: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  CANCELLED: "bg-slate-100 text-slate-500 ring-slate-400/20",
};

export default async function OperationsPage() {
  const [projects, sites, plans, allocations, mobs, assets] = await Promise.all([
    db.project.findMany({ orderBy: { code: "asc" } }),
    db.site.findMany({ include: { project: true }, orderBy: { code: "asc" } }),
    db.equipmentPlan.findMany(),
    db.allocation.findMany({ include: { asset: true, project: true, site: true }, orderBy: { fromDate: "desc" }, take: 300 }),
    db.mobilizationOrder.findMany({ include: { asset: true, toProject: true }, orderBy: { requestedDate: "desc" }, take: 100 }),
    db.asset.findMany({ orderBy: { code: "asc" } }),
  ]);

  const projOpts = projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));
  const siteOpts = sites.map((s) => ({ id: s.id, label: `${s.code} — ${s.name} (${s.project.code})` }));
  const assetOpts = assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.registrationNo ?? a.name}` }));
  const classOpts = Object.entries(ASSET_CLASS_LABEL).map(([value, label]) => ({ value, label }));

  const allocLites: AllocationLite[] = allocations.map((a) => ({
    id: a.id, assetId: a.assetId, projectId: a.projectId, siteId: a.siteId,
    fromDate: a.fromDate, toDate: a.toDate, status: a.status, ratePerDay: a.ratePerDay,
  }));
  const conflicts = allocationConflicts(allocLites);

  // Geofence: for every ACTIVE allocation with a site, is the machine actually there?
  const outsideFence = allocations
    .filter((a) => a.status === "ACTIVE" && a.site)
    .map((a) => {
      const site: SiteLite = { id: a.site!.id, code: a.site!.code, name: a.site!.name, lat: a.site!.lat, lng: a.site!.lng, radiusM: a.site!.radiusM };
      const check = geofenceCheck(a.asset.lat, a.asset.lng, site);
      return { alloc: a, check };
    })
    .filter((x) => !x.check.unknown && !x.check.inside)
    .sort((a, b) => b.check.overshootM - a.check.overshootM);

  const mobStats = mobilizationStats(mobs.map((m): MobLite => ({
    id: m.id, status: m.status, requestedDate: m.requestedDate, dispatchDate: m.dispatchDate,
    arrivalDate: m.arrivalDate, cost: m.cost, distanceKm: m.distanceKm, transportMode: m.transportMode,
  })));

  const activeAllocs = allocations.filter((a) => a.status === "ACTIVE");
  const projectName = new Map(projects.map((p) => [p.id, p.code]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Sites &amp; Fleet Operations</h1>
          <p className="text-sm text-slate-500">
            Where machines are committed, whether they are actually there, and what it costs to move them
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PlanForm projects={projOpts} classes={classOpts} />
          <MobilizationForm assets={assetOpts} projects={projOpts} />
          <SiteForm projects={projOpts} />
          <AllocationForm assets={assetOpts} projects={projOpts} sites={siteOpts} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Sites" value={num(sites.length)} sub={`across ${num(projects.length)} projects`} accent="brand" icon={<MapPin className="h-5 w-5" />} />
        <StatCard label="Active Allocations" value={num(activeAllocs.length)} sub={`${num(allocations.length)} total`} accent="emerald" icon={<ClipboardList className="h-5 w-5" />} />
        <StatCard label="Double-Booked" value={num(conflicts.length)} sub="same machine, two projects" accent={conflicts.length > 0 ? "rose" : "emerald"} icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="Outside Geofence" value={num(outsideFence.length)} sub="not where allocated" accent={outsideFence.length > 0 ? "rose" : "emerald"} icon={<Navigation className="h-5 w-5" />} />
        <StatCard label="Mobilisation Cost" value={inr(mobStats.totalCost, { compact: true })} sub={`${num(mobStats.inTransit)} in transit`} accent="violet" icon={<IndianRupee className="h-5 w-5" />} />
      </div>

      {conflicts.length > 0 && (
        <Card className="border-rose-200 p-0">
          <div className="flex items-center gap-2 p-5 pb-3">
            <TriangleAlert className="h-5 w-5 text-rose-600" />
            <SectionTitle title="Double-Booked Machines" subtitle="Committed to two projects over the same dates — only one can legitimately be billed" />
          </div>
          <div className="divide-y divide-slate-100">
            {conflicts.map((c, i) => {
              const asset = assets.find((a) => a.id === c.assetId);
              return (
                <div key={i} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/fleet/${c.assetId}`} className="font-semibold text-brand-700 hover:underline">{asset?.code ?? "—"}</Link>
                    <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">{projectName.get(c.a.projectId)}</Badge>
                    <span className="text-xs text-slate-400">vs</span>
                    <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">{projectName.get(c.b.projectId)}</Badge>
                    <span className="text-xs text-slate-500">
                      {fmtDate(c.fromDate)}{c.toDate ? ` → ${fmtDate(c.toDate)}` : " onwards"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{c.message}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {outsideFence.length > 0 && (
        <Card className="border-amber-200 p-0">
          <div className="flex items-center gap-2 p-5 pb-3">
            <Navigation className="h-5 w-5 text-amber-600" />
            <SectionTitle title="Machines Outside Their Geofence" subtitle="Allocated to a site but reporting a position elsewhere" />
          </div>
          <div className="divide-y divide-slate-100">
            {outsideFence.slice(0, 20).map(({ alloc, check }) => (
              <div key={alloc.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/fleet/${alloc.assetId}`} className="font-semibold text-brand-700 hover:underline">{alloc.asset.code}</Link>
                    <span className="text-sm text-slate-500">allocated to {alloc.site!.name}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-700">{check.message}</p>
                </div>
                <a href={`https://www.google.com/maps?q=${alloc.asset.lat},${alloc.asset.lng}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline">
                  View position
                </a>
              </div>
            ))}
          </div>
        </Card>
      )}

      {projects.map((p) => {
        const pPlans: PlanLite[] = plans.filter((x) => x.projectId === p.id).map((x) => ({ assetClass: x.assetClass, plannedCount: x.plannedCount, budgetPerDay: x.budgetPerDay }));
        const actualByClass = new Map<string, number>();
        for (const a of activeAllocs.filter((x) => x.projectId === p.id)) {
          actualByClass.set(a.asset.assetClass, (actualByClass.get(a.asset.assetClass) ?? 0) + 1);
        }
        const rows = planVsActual(pPlans, actualByClass);
        const pSites = sites.filter((s) => s.projectId === p.id);
        if (rows.length === 0 && pSites.length === 0) return null;

        return (
          <Card key={p.id} className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-5">
              <div>
                <h2 className="text-lg font-bold text-ink-900">{p.code} — {p.name}</h2>
                <p className="text-sm text-slate-500">{p.location} · {pSites.length} site{pSites.length === 1 ? "" : "s"}</p>
              </div>
            </div>

            {pSites.length > 0 && (
              <div className="flex flex-wrap gap-2 border-b border-slate-100 p-5">
                {pSites.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                    <MapPin className="h-4 w-4 text-brand-600" />
                    <div>
                      <p className="text-sm font-medium text-ink-900">{s.name}</p>
                      <p className="text-xs text-slate-400">
                        {SITE_TYPE_LABEL[s.type] ?? s.type} · fence {s.radiusM} m
                        {s.lat || s.lng ? "" : " · no coordinates"}
                      </p>
                    </div>
                    <SiteForm projects={projOpts} site={{ id: s.id, projectId: s.projectId, code: s.code, name: s.name, type: s.type, lat: s.lat, lng: s.lng, radiusM: s.radiusM, address: s.address }} />
                    <DeleteRow id={s.id} kind="site" />
                  </div>
                ))}
              </div>
            )}

            {rows.length > 0 && (
              <div className="p-5">
                <SectionTitle title="Plan vs Actual" subtitle="Over-allocation is cost; under-allocation is delay" />
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Class</th>
                        <th className="px-4 py-2.5 text-right font-medium">Planned</th>
                        <th className="px-4 py-2.5 text-right font-medium">Allocated</th>
                        <th className="px-4 py-2.5 text-right font-medium">Variance</th>
                        <th className="px-4 py-2.5 text-right font-medium">Daily Budget</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.assetClass} className="border-t border-slate-100">
                          <td className="px-4 py-2.5 font-medium text-ink-900">{ASSET_CLASS_LABEL[r.assetClass] ?? r.assetClass}</td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{r.planned}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-ink-900">{r.actual}</td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={r.variance === 0 ? "text-emerald-600" : r.variance < 0 ? "text-amber-600" : "text-rose-600"}>
                              {r.variance > 0 ? "+" : ""}{r.variance}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{r.dailyBudget ? inr(r.dailyBudget, { compact: true }) : "—"}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">{r.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        );
      })}

      <Card className="p-0">
        <div className="p-5 pb-3"><SectionTitle title="Allocations" subtitle="Newest first" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Machine</th>
                <th className="px-5 py-3 font-medium">Project</th>
                <th className="px-5 py-3 font-medium">Site</th>
                <th className="px-5 py-3 font-medium">Period</th>
                <th className="px-5 py-3 text-right font-medium">Rate/day</th>
                <th className="px-5 py-3 font-medium">Purpose</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {allocations.slice(0, 50).map((a) => (
                <tr key={a.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                  <td className="px-5 py-3"><Link href={`/fleet/${a.assetId}`} className="font-semibold text-brand-700 hover:underline">{a.asset.code}</Link></td>
                  <td className="px-5 py-3 text-slate-600">{a.project.code}</td>
                  <td className="px-5 py-3 text-slate-600">{a.site?.name ?? "—"}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-xs text-slate-500">{fmtDate(a.fromDate)}{a.toDate ? ` → ${fmtDate(a.toDate)}` : " → open"}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{a.ratePerDay ? inr(a.ratePerDay) : "—"}</td>
                  <td className="px-5 py-3 text-slate-500">{a.purpose ?? "—"}</td>
                  <td className="px-5 py-3"><Badge color={ALLOC_BADGE[a.status] ?? ALLOC_BADGE.PLANNED}>{a.status}</Badge></td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <AllocationStatusForm alloc={{ id: a.id, status: a.status, toDate: a.toDate }} />
                      <DeleteRow id={a.id} kind="allocation" />
                    </div>
                  </td>
                </tr>
              ))}
              {allocations.length === 0 && <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-400">No allocations yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-3">
          <SectionTitle
            title="Mobilisation"
            subtitle={
              mobStats.avgTransitDays != null
                ? `Average ${mobStats.avgTransitDays.toFixed(1)} days in transit${mobStats.avgWaitDays != null ? `, ${mobStats.avgWaitDays.toFixed(1)} days waiting to be dispatched` : ""}`
                : "Days in transit are days nobody is producing with the machine"
            }
          />
          {mobStats.stale.length > 0 && (
            <Badge color="bg-amber-100 text-amber-700 ring-amber-600/20">{mobStats.stale.length} waiting over a week</Badge>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Machine</th>
                <th className="px-5 py-3 font-medium">To Project</th>
                <th className="px-5 py-3 font-medium">Transport</th>
                <th className="px-5 py-3 font-medium">Requested</th>
                <th className="px-5 py-3 font-medium">Dispatched</th>
                <th className="px-5 py-3 font-medium">Arrived</th>
                <th className="px-5 py-3 text-right font-medium">Cost</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {mobs.map((m) => (
                <tr key={m.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                  <td className="px-5 py-3"><Link href={`/fleet/${m.assetId}`} className="font-semibold text-brand-700 hover:underline">{m.asset.code}</Link></td>
                  <td className="px-5 py-3 text-slate-600">{m.toProject?.code ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {TRANSPORT_LABEL[m.transportMode] ?? m.transportMode}
                    {m.distanceKm > 0 && <span className="block text-xs text-slate-400">{num(m.distanceKm)} km</span>}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-slate-500">{fmtDate(m.requestedDate)}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-slate-500">{m.dispatchDate ? fmtDate(m.dispatchDate) : "—"}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-slate-500">{m.arrivalDate ? fmtDate(m.arrivalDate) : "—"}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{m.cost ? inr(m.cost, { compact: true }) : "—"}</td>
                  <td className="px-5 py-3"><Badge color={MOB_BADGE[m.status] ?? MOB_BADGE.REQUESTED}>{m.status.replace("_", " ")}</Badge></td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <MobStatusForm order={{ id: m.id, status: m.status, cost: m.cost, dispatchDate: m.dispatchDate, arrivalDate: m.arrivalDate }} />
                      <DeleteRow id={m.id} kind="mobilization" />
                    </div>
                  </td>
                </tr>
              ))}
              {mobs.length === 0 && <tr><td colSpan={9} className="px-5 py-10 text-center text-slate-400">No mobilisation orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
