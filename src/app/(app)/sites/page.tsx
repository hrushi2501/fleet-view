import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard, Progress, EmptyState } from "@/components/ui";
import {
  SiteForm, PlanForm, AllocationForm, AllocationStatusForm,
  MobilizationForm, MobStatusForm, DeleteRow,
} from "@/components/OpsForms";
import { ProjectEntry, ProjectDeleteButton } from "@/components/EntryForms";
import { ProjectCard, CollapsibleSection, CardActions } from "@/components/SiteProjectCard";
import {
  allocationConflicts, geofenceCheck, planVsActual, mobilizationStats,
  SITE_TYPE_LABEL, TRANSPORT_LABEL,
  type AllocationLite, type SiteLite, type MobLite, type PlanLite,
} from "@/lib/operations";
import { inr, num, fmtDate, ASSET_CLASS_LABEL } from "@/lib/utils";
import {
  MapPin, TriangleAlert, Truck, ClipboardList, Navigation,
  IndianRupee, FolderKanban, Boxes,
} from "lucide-react";
import Link from "next/link";
import { requirePage, assetScope, projectScope } from "@/lib/access";

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

/**
 * Sites, the projects they belong to, and which machines are committed where.
 *
 * `/projects` and `/operations` both pointed here in the restructure and both
 * are already contained in this screen: it grew out of `/operations` and had
 * the project cards, budgets and the `ProjectEntry` form folded into it before
 * the consolidation started. Their routes redirect rather than being rendered
 * twice, because two copies of the same allocation table on one page would be
 * worse than either page was on its own.
 */
export default async function SitesPage() {
  const access = await requirePage("production.view");
  // Rows, not just the page: a scoped supervisor sees their own sites.
  const visible = assetScope(access);
  const visibleProjects = projectScope(access);
  /* ───────── data fetch ───────── */
  const [projects, sites, plans, allocations, mobs, assets] = await Promise.all([
    db.project.findMany({ where: visibleProjects, include: { _count: { select: { assets: true } } }, orderBy: { code: "asc" } }),
    db.site.findMany({ include: { project: true }, orderBy: { code: "asc" } }),
    db.equipmentPlan.findMany(),
    db.allocation.findMany({ include: { asset: true, project: true, site: true }, orderBy: { fromDate: "desc" }, take: 300 }),
    db.mobilizationOrder.findMany({ include: { asset: true, toProject: true }, orderBy: { requestedDate: "desc" }, take: 100 }),
    db.asset.findMany({ where: visible, orderBy: { code: "asc" } }),
  ]);

  /* ───────── option lists for forms ───────── */
  const projOpts = projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));
  const siteOpts = sites.map((s) => ({ id: s.id, label: `${s.code} — ${s.name} (${s.project.code})` }));
  const assetOpts = assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.registrationNo ?? a.name}` }));
  const classOpts = Object.entries(ASSET_CLASS_LABEL).map(([value, label]) => ({ value, label }));

  /* ───────── business logic ───────── */
  const allocLites: AllocationLite[] = allocations.map((a) => ({
    id: a.id, assetId: a.assetId, projectId: a.projectId, siteId: a.siteId,
    fromDate: a.fromDate, toDate: a.toDate, status: a.status, ratePerDay: a.ratePerDay,
  }));
  const conflicts = allocationConflicts(allocLites);

  const outsideFence = allocations
    .filter((a) => a.status === "ACTIVE" && a.site != null)
    .map((a) => {
      const site = a.site!;
      const siteLite: SiteLite = { id: site.id, code: site.code, name: site.name, lat: site.lat, lng: site.lng, radiusM: site.radiusM };
      const check = geofenceCheck(a.asset.lat, a.asset.lng, siteLite);
      return { alloc: a, site, check };
    })
    .filter((x) => !x.check.unknown && !x.check.inside)
    .sort((a, b) => b.check.overshootM - a.check.overshootM);

  const mobStats = mobilizationStats(mobs.map((m): MobLite => ({
    id: m.id, status: m.status, requestedDate: m.requestedDate, dispatchDate: m.dispatchDate,
    arrivalDate: m.arrivalDate, cost: m.cost, distanceKm: m.distanceKm, transportMode: m.transportMode,
  })));

  const activeAllocs = allocations.filter((a) => a.status === "ACTIVE");
  const projectName = new Map(projects.map((p) => [p.id, p.code]));

  /* ───────── summary stats ───────── */
  const activeProjects = projects.filter((p) => p.status === "Active");
  const totalBudget = projects.reduce((s, p) => s + p.budget, 0);
  const totalSpent = projects.reduce((s, p) => s + p.spent, 0);
  const budgetPctNum = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const budgetPct = budgetPctNum.toFixed(0);
  const budgetAccent: "emerald" | "amber" | "rose" = budgetPctNum > 80 ? "rose" : budgetPctNum >= 50 ? "amber" : "emerald";

  return (
    <div className="space-y-6">
      {/* ──────────── HEADER ──────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Sites &amp; Projects</h1>
          <p className="text-sm text-slate-500">
            Manage your construction sites — allocate machines, track geofences, and control costs
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ProjectEntry />
          <SiteForm projects={projOpts} />
          <AllocationForm assets={assetOpts} projects={projOpts} sites={siteOpts} />
          <PlanForm projects={projOpts} classes={classOpts} />
          <MobilizationForm assets={assetOpts} projects={projOpts} />
        </div>
      </div>

      {/* ──────────── SUMMARY STATS ──────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Active Projects" value={num(activeProjects.length)} sub={`${num(projects.length)} total`} accent="brand" icon={<FolderKanban className="h-5 w-5" />} />
        <StatCard label="Total Sites" value={num(sites.length)} sub={`across ${num(projects.length)} projects`} accent="emerald" icon={<MapPin className="h-5 w-5" />} />
        <StatCard label="Active Allocations" value={num(activeAllocs.length)} sub={`${num(allocations.length)} total`} accent="violet" icon={<ClipboardList className="h-5 w-5" />} />
        <StatCard label="Budget Utilisation" value={`${budgetPct}%`} sub={`${inr(totalSpent, { compact: true })} of ${inr(totalBudget, { compact: true })}`} accent={budgetAccent} icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Mobilisation Cost" value={inr(mobStats.totalCost, { compact: true })} sub={`${num(mobStats.inTransit)} in transit`} accent="rose" icon={<Truck className="h-5 w-5" />} />
      </div>

      {/* ──────────── ALERT: DOUBLE-BOOKED ──────────── */}
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
                    {asset ? (
                      <Link href={`/fleet/${c.assetId}`} className="font-semibold text-brand-700 hover:underline">{asset.code}</Link>
                    ) : (
                      <span className="font-semibold text-slate-500">—</span>
                    )}
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

      {/* ──────────── ALERT: OUTSIDE GEOFENCE ──────────── */}
      {outsideFence.length > 0 && (
        <Card className="border-amber-200 p-0">
          <div className="flex items-center gap-2 p-5 pb-3">
            <Navigation className="h-5 w-5 text-amber-600" />
            <SectionTitle title="Machines Outside Their Geofence" subtitle="Allocated to a site but reporting a position elsewhere" />
          </div>
          <div className="divide-y divide-slate-100">
            {outsideFence.slice(0, 20).map(({ alloc, site, check }) => (
              <div key={alloc.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/fleet/${alloc.assetId}`} className="font-semibold text-brand-700 hover:underline">{alloc.asset.code}</Link>
                    <span className="text-sm text-slate-500">allocated to {site.name}</span>
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

      {/* ──────────── PROJECT CARDS ──────────── */}
      {projects.map((p) => {
        const pSites = sites.filter((s) => s.projectId === p.id);
        const pAllocs = allocations.filter((a) => a.projectId === p.id);
        const pActiveAllocs = pAllocs.filter((a) => a.status === "ACTIVE");
        const pMobs = mobs.filter((m) => m.toProjectId === p.id);

        // Plan vs actual
        const pPlans: PlanLite[] = plans.filter((x) => x.projectId === p.id).map((x) => ({
          assetClass: x.assetClass, plannedCount: x.plannedCount, budgetPerDay: x.budgetPerDay,
        }));
        const actualByClass = new Map<string, number>();
        for (const a of pActiveAllocs) {
          actualByClass.set(a.asset.assetClass, (actualByClass.get(a.asset.assetClass) ?? 0) + 1);
        }
        const rows = planVsActual(pPlans, actualByClass);

        // Budget
        const pctBudget = p.budget > 0 ? (p.spent / p.budget) * 100 : 0;

        return (
          <ProjectCard
            key={p.id}
            header={
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-ink-900">{p.code} — {p.name}</h2>
                    <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">{p.status}</Badge>
                    <CardActions>
                      <ProjectEntry project={p} />
                      <ProjectDeleteButton id={p.id} code={p.code} />
                    </CardActions>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-500">
                    <MapPin className="h-3.5 w-3.5" />{p.location} · {p.client}
                  </p>
                  {/* Budget bar */}
                  <div className="mt-3 max-w-md">
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-slate-500">Budget</span>
                      <span className="font-medium text-ink-900">
                        {inr(p.spent, { compact: true })} / {inr(p.budget, { compact: true })}
                      </span>
                    </div>
                    <Progress value={pctBudget} />
                    <p className="mt-1 text-xs text-slate-400">{pctBudget.toFixed(0)}% utilised</p>
                  </div>
                </div>
                <div className="flex gap-4 text-center">
                  <div>
                    <p className="text-xs text-slate-400">Sites</p>
                    <p className="text-xl font-bold text-brand-600">{pSites.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Assets</p>
                    <p className="text-xl font-bold text-brand-600">{p._count.assets}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Allocs</p>
                    <p className="text-xl font-bold text-brand-600">{pActiveAllocs.length}</p>
                  </div>
                </div>
              </div>
            }
            sites={
              pSites.length > 0 ? (
                <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-3">
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
              ) : null
            }
          >
            {/* ── Plan vs Actual ── */}
            {rows.length > 0 && (
              <div className="border-t border-slate-100 p-5">
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

            {/* ── Project Allocations ── */}
            {pAllocs.length > 0 && (
              <div className="border-t border-slate-100 p-5">
                <SectionTitle title="Allocations" subtitle={`${pActiveAllocs.length} active · ${pAllocs.length} total for this project`} />
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Machine</th>
                        <th className="px-4 py-2.5 font-medium">Site</th>
                        <th className="px-4 py-2.5 font-medium">Period</th>
                        <th className="px-4 py-2.5 text-right font-medium">Rate/day</th>
                        <th className="px-4 py-2.5 font-medium">Purpose</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pAllocs.slice(0, 30).map((a) => (
                        <tr key={a.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                          <td className="px-4 py-2.5"><Link href={`/fleet/${a.assetId}`} className="font-semibold text-brand-700 hover:underline">{a.asset.code}</Link></td>
                          <td className="px-4 py-2.5 text-slate-600">{a.site?.name ?? "—"}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-500">{fmtDate(a.fromDate)}{a.toDate ? ` → ${fmtDate(a.toDate)}` : " → open"}</td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{a.ratePerDay ? inr(a.ratePerDay) : "—"}</td>
                          <td className="px-4 py-2.5 text-slate-500">{a.purpose ?? "—"}</td>
                          <td className="px-4 py-2.5"><Badge color={ALLOC_BADGE[a.status] ?? ALLOC_BADGE.PLANNED}>{a.status}</Badge></td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              <AllocationStatusForm alloc={{ id: a.id, status: a.status, toDate: a.toDate }} />
                              <DeleteRow id={a.id} kind="allocation" />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Project Mobilisation ── */}
            {pMobs.length > 0 && (
              <div className="border-t border-slate-100 p-5">
                <SectionTitle title="Mobilisation" subtitle={`${pMobs.length} orders targeting this project`} />
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Machine</th>
                        <th className="px-4 py-2.5 font-medium">Transport</th>
                        <th className="px-4 py-2.5 font-medium">Requested</th>
                        <th className="px-4 py-2.5 font-medium">Dispatched</th>
                        <th className="px-4 py-2.5 font-medium">Arrived</th>
                        <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pMobs.map((m) => (
                        <tr key={m.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                          <td className="px-4 py-2.5"><Link href={`/fleet/${m.assetId}`} className="font-semibold text-brand-700 hover:underline">{m.asset.code}</Link></td>
                          <td className="px-4 py-2.5 text-slate-600">
                            {TRANSPORT_LABEL[m.transportMode] ?? m.transportMode}
                            {m.distanceKm > 0 && <span className="block text-xs text-slate-400">{num(m.distanceKm)} km</span>}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{fmtDate(m.requestedDate)}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{m.dispatchDate ? fmtDate(m.dispatchDate) : "—"}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{m.arrivalDate ? fmtDate(m.arrivalDate) : "—"}</td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{m.cost ? inr(m.cost, { compact: true }) : "—"}</td>
                          <td className="px-4 py-2.5"><Badge color={MOB_BADGE[m.status] ?? MOB_BADGE.REQUESTED}>{m.status.replace("_", " ")}</Badge></td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              <MobStatusForm order={{ id: m.id, status: m.status, cost: m.cost, dispatchDate: m.dispatchDate, arrivalDate: m.arrivalDate }} />
                              <DeleteRow id={m.id} kind="mobilization" />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Empty state inside card */}
            {rows.length === 0 && pAllocs.length === 0 && pMobs.length === 0 && (
              <div className="border-t border-slate-100 px-5 py-8 text-center text-sm text-slate-400">
                No equipment plans, allocations, or mobilisation orders for this project yet.
              </div>
            )}
          </ProjectCard>
        );
      })}

      {projects.length === 0 && (
        <EmptyState
          icon={Boxes}
          title="No projects configured yet"
          description="Create your first highway, mining, or expressway project to organize sites, fuel tanks, and machine allocations."
          action={<ProjectEntry />}
        />
      )}

      {/* ──────────── GLOBAL TABLES ──────────── */}

      <CollapsibleSection
        title="All Allocations"
        subtitle={allocations.length > 50 ? `Showing 50 newest of ${num(allocations.length)} total allocations` : "Cross-project view · newest first"}
        badge={
          <Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">
            {allocations.length > 50 ? `50 of ${allocations.length}` : allocations.length}
          </Badge>
        }
      >
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
      </CollapsibleSection>

      <CollapsibleSection
        title="All Mobilisation Orders"
        subtitle={
          mobStats.avgTransitDays != null
            ? `Average ${mobStats.avgTransitDays.toFixed(1)} days in transit${mobStats.avgWaitDays != null ? `, ${mobStats.avgWaitDays.toFixed(1)} days waiting to be dispatched` : ""}`
            : "Days in transit are days nobody is producing with the machine"
        }
        badge={
          mobStats.stale.length > 0
            ? <Badge color="bg-amber-100 text-amber-700 ring-amber-600/20">{mobStats.stale.length} waiting over a week</Badge>
            : undefined
        }
      >
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
      </CollapsibleSection>
    </div>
  );
}
