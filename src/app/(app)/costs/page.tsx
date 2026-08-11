import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard, Progress } from "@/components/ui";
import { CostForm, RevenueForm, DepreciationForm, DeleteRow } from "@/components/ProdCostForms";
import { assetCost, depreciation, projectPnL, replaceVsRepair, COST_HEAD_LABEL } from "@/lib/costing";
import { inr, num, fmtDate, ASSET_CLASS_LABEL } from "@/lib/utils";
import { IndianRupee, TrendingUp, TrendingDown, Wallet, Recycle } from "lucide-react";
import Link from "next/link";

import { supportedQty, type ContractLite, type LogLite } from "@/lib/hire";

export const dynamic = "force-dynamic";

/** Cost window — one year, so depreciation and maintenance trends are meaningful. */
const WINDOW_DAYS = 365;

export default async function CostsPage() {
  const now = new Date();
  const since = new Date(now); since.setDate(since.getDate() - WINDOW_DAYS);

  const [assets, projects, fuelAgg, woAgg, hireContracts, manualCosts, revenues, prodAgg, recentCosts, allocations, fuelTxnsForP, wosForP] = await Promise.all([
    db.asset.findMany({ orderBy: { code: "asc" } }),
    db.project.findMany({ orderBy: { code: "asc" } }),
    db.fuelTransaction.groupBy({ by: ["assetId"], where: { type: "ISSUE", date: { gte: since } }, _sum: { amount: true } }),
    db.workOrder.groupBy({ by: ["assetId"], where: { reportedAt: { gte: since } }, _sum: { totalCost: true, downtimeHrs: true } }),
    db.hireContract.findMany({ include: { logs: { where: { date: { gte: since } } } } }),
    db.costTransaction.findMany({ where: { date: { gte: since } } }),
    db.projectRevenue.findMany({ include: { project: true }, orderBy: { date: "desc" } }),
    db.productionLog.groupBy({ by: ["assetId"], where: { date: { gte: since } }, _sum: { tonnage: true, volumeM3: true, trips: true, workedHours: true, distanceKm: true } }),
    db.costTransaction.findMany({ where: { date: { gte: since } }, include: { asset: true, project: true }, orderBy: { date: "desc" }, take: 30 }),
    db.allocation.findMany({ where: { status: { not: "CANCELLED" }, OR: [ { toDate: null }, { toDate: { gte: since } } ], fromDate: { lte: now } } }),
    db.fuelTransaction.findMany({ where: { type: "ISSUE", date: { gte: since } }, select: { assetId: true, projectId: true, amount: true } }),
    db.workOrder.findMany({ where: { reportedAt: { gte: since } }, select: { assetId: true, projectId: true, totalCost: true } }),
  ]);

  const fuelBy = new Map(fuelAgg.map((f) => [f.assetId ?? "", f._sum.amount ?? 0]));
  const woBy = new Map(woAgg.map((w) => [w.assetId, { cost: w._sum.totalCost ?? 0, downtime: w._sum.downtimeHrs ?? 0 }]));
  const prodBy = new Map(prodAgg.map((p) => [p.assetId, p._sum]));

  // Hire cost calculated from contract rates & site logs
  const hireBy = new Map<string, number>();
  for (const c of hireContracts) {
    const lite: ContractLite = {
      id: c.id, vendor: c.vendor, rateType: c.rateType as ContractLite["rateType"], rate: c.rate,
      overtimeRate: c.overtimeRate, minGuarantee: c.minGuarantee, guaranteeUnit: c.guaranteeUnit,
      fuelBorneBy: c.fuelBorneBy, breakdownBillable: c.breakdownBillable, idleBillable: c.idleBillable,
    };
    const logs: LogLite[] = c.logs.map((l) => ({
      date: l.date, present: l.present, workedHours: l.workedHours, idleHours: l.idleHours,
      breakdownHours: l.breakdownHours, km: l.km, trips: l.trips, source: l.source,
    }));
    const sup = supportedQty(lite, logs);
    const cost = sup.qty * c.rate;
    hireBy.set(c.assetId, (hireBy.get(c.assetId) ?? 0) + cost);
  }

  const manualByAsset = new Map<string, { costHead: string; amount: number }[]>();
  for (const c of manualCosts) {
    if (!c.assetId) continue;
    const arr = manualByAsset.get(c.assetId) ?? [];
    arr.push({ costHead: c.costHead, amount: c.amount });
    manualByAsset.set(c.assetId, arr);
  }

  const rows = assets.map((a) => {
    const dep = depreciation({
      acquisitionCost: a.acquisitionCost, salvageValue: a.salvageValue, usefulLifeYears: a.usefulLifeYears,
      method: a.depMethod, inServiceDate: a.inServiceDate, yearMfg: a.yearMfg,
    });
    const prod = prodBy.get(a.id);
    const wo = woBy.get(a.id) ?? { cost: 0, downtime: 0 };

    const serviceStart = a.inServiceDate ?? (a.yearMfg > 1970 ? new Date(a.yearMfg, 0, 1) : null);
    const daysInService = serviceStart ? Math.max(0, Math.min(365, (now.getTime() - serviceStart.getTime()) / 8.64e7)) : 365;
    const depreciationForPeriod = (dep.annual * daysInService) / 365;

    const cost = assetCost(
      {
        fuel: fuelBy.get(a.id) ?? 0,
        maintenance: wo.cost,
        hire: hireBy.get(a.id) ?? 0,
        manual: manualByAsset.get(a.id) ?? [],
        depreciationForPeriod,
      },
      {
        km: prod?.distanceKm ?? 0,
        engineHours: prod?.workedHours ?? 0,
        tonnage: prod?.tonnage ?? 0,
        volumeM3: prod?.volumeM3 ?? 0,
        trips: prod?.trips ?? 0,
      }
    );

    const advice = replaceVsRepair(wo.cost, dep, wo.downtime, dep.ageYears, a.usefulLifeYears);
    return { asset: a, dep, cost, advice, depreciationForPeriod };
  });

  const withCost = rows.filter((r) => r.cost.total > 0).sort((a, b) => b.cost.total - a.cost.total);

  const fleetTotal = rows.reduce((s, r) => s + r.cost.total, 0);
  const fleetCash = rows.reduce((s, r) => s + r.cost.cashTotal, 0);
  const fleetDep = rows.reduce((s, r) => s + r.depreciationForPeriod, 0);
  const fleetBook = rows.reduce((s, r) => s + r.dep.bookValue, 0);
  const replaceCount = rows.filter((r) => r.advice.verdict === "replace").length;

  const headTotals = new Map<string, number>();
  for (const r of rows) for (const h of r.cost.byHead) headTotals.set(h.head, (headTotals.get(h.head) ?? 0) + h.amount);
  const headRows = [...headTotals.entries()].map(([head, amount]) => ({ head, amount })).sort((a, b) => b.amount - a.amount);
  const maxHead = Math.max(...headRows.map((h) => h.amount), 1);

  // Project P&L — asset costs attributed to where they were actually used/allocated.
  const costByProject = new Map<string, Map<string, number>>();
  const addP = (pid: string, head: string, amt: number) => {
    if (!pid || !amt) return;
    const m = costByProject.get(pid) ?? new Map<string, number>();
    m.set(head, (m.get(head) ?? 0) + amt);
    costByProject.set(pid, m);
  };

  const nowMs = now.getTime();
  const sinceMs = since.getTime();
  const getAssetAllocationWeights = (assetId: string, currentProjectId: string | null) => {
    const assetAllocs = allocations.filter((al) => al.assetId === assetId);
    if (assetAllocs.length === 0) {
      return currentProjectId ? [{ projectId: currentProjectId, weight: 1.0 }] : [];
    }

    const projectDurations = new Map<string, number>();
    let totalDuration = 0;

    for (const alloc of assetAllocs) {
      const start = Math.max(alloc.fromDate.getTime(), sinceMs);
      const end = Math.min(alloc.toDate?.getTime() ?? nowMs, nowMs);
      const duration = Math.max(0, end - start);
      if (duration > 0) {
        projectDurations.set(alloc.projectId, (projectDurations.get(alloc.projectId) ?? 0) + duration);
        totalDuration += duration;
      }
    }

    if (totalDuration === 0) {
      return currentProjectId ? [{ projectId: currentProjectId, weight: 1.0 }] : [];
    }

    return [...projectDurations.entries()].map(([pid, dur]) => ({
      projectId: pid,
      weight: dur / totalDuration,
    }));
  };

  // 1. Direct transaction costs attributed by their recorded projectId
  for (const f of fuelTxnsForP) {
    if (f.projectId) addP(f.projectId, "FUEL", f.amount);
  }
  for (const w of wosForP) {
    if (w.projectId) addP(w.projectId, "MAINTENANCE", w.totalCost);
  }
  for (const c of manualCosts) {
    if (c.projectId) {
      addP(c.projectId, c.costHead, c.amount);
    } else if (c.assetId) {
      const assetObj = assets.find((a) => a.id === c.assetId);
      const weights = getAssetAllocationWeights(c.assetId, assetObj?.projectId ?? null);
      for (const w of weights) {
        addP(w.projectId, c.costHead, c.amount * w.weight);
      }
    }
  }

  // 2. Asset-level general costs (Depreciation and Hire) distributed by allocation weights
  for (const r of rows) {
    const weights = getAssetAllocationWeights(r.asset.id, r.asset.projectId);
    const assetHire = hireBy.get(r.asset.id) ?? 0;
    const assetDep = r.depreciationForPeriod;

    for (const w of weights) {
      if (assetHire > 0) {
        addP(w.projectId, "HIRE", assetHire * w.weight);
      }
      if (assetDep > 0) {
        addP(w.projectId, "DEPRECIATION", assetDep * w.weight);
      }
    }
  }

  const revByProject = new Map<string, number>();
  for (const rv of revenues) revByProject.set(rv.projectId, (revByProject.get(rv.projectId) ?? 0) + rv.amount);

  const pnls = projects.map((p) =>
    projectPnL(
      p.id,
      revByProject.get(p.id) ?? 0,
      [...(costByProject.get(p.id) ?? new Map<string, number>()).entries()].map(([head, amount]) => ({ head, amount })),
      p.budget
    )
  );
  const totalRevenue = pnls.reduce((s, p) => s + p.revenue, 0);
  const totalMargin = pnls.reduce((s, p) => s + p.margin, 0);

  const assetOpts = assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.registrationNo ?? a.name}` }));
  const projOpts = projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));

  const verdictBadge = (v: string) =>
    v === "replace" ? "bg-rose-100 text-rose-700 ring-rose-600/20" : v === "watch" ? "bg-amber-100 text-amber-700 ring-amber-600/20" : "bg-emerald-100 text-emerald-700 ring-emerald-600/20";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Cost, TCO &amp; Profitability</h1>
          <p className="text-sm text-slate-500">
            True cost per km, per engine-hour and per m³ — assembled from fuel, workshop and hire, not hand-keyed
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CostForm assets={assetOpts} projects={projOpts} />
          <RevenueForm projects={projOpts} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total Cost" value={inr(fleetTotal, { compact: true })} sub="last 12 months" accent="brand" icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Cash Cost" value={inr(fleetCash, { compact: true })} sub="excludes depreciation" accent="violet" icon={<Wallet className="h-5 w-5" />} />
        <StatCard label="Depreciation" value={inr(fleetDep, { compact: true })} sub={`${inr(fleetBook, { compact: true })} book value`} accent="amber" icon={<TrendingDown className="h-5 w-5" />} />
        <StatCard label="Revenue" value={inr(totalRevenue, { compact: true })} sub={`${inr(totalMargin, { compact: true })} margin`} accent={totalMargin >= 0 ? "emerald" : "rose"} icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard label="Replace Candidates" value={num(replaceCount)} sub="upkeep vs book value" accent="rose" icon={<Recycle className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <SectionTitle title="Cost by Head" subtitle="Where the money goes" />
          <div className="mt-2 space-y-3">
            {headRows.map((h) => (
              <div key={h.head}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium text-ink-900">{COST_HEAD_LABEL[h.head] ?? h.head}</span>
                  <span className="text-slate-500">{inr(h.amount, { compact: true })}</span>
                </div>
                <Progress value={(h.amount / maxHead) * 100} />
              </div>
            ))}
            {headRows.length === 0 && <p className="text-sm text-slate-400">No costs recorded in the last 12 months.</p>}
          </div>
        </Card>

        <Card className="p-0 lg:col-span-2">
          <div className="p-5 pb-3">
            <SectionTitle title="Project Profitability" subtitle="Revenue minus true fleet cost, against budget" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Project</th>
                  <th className="px-5 py-3 text-right font-medium">Revenue</th>
                  <th className="px-5 py-3 text-right font-medium">Fleet Cost</th>
                  <th className="px-5 py-3 text-right font-medium">Margin</th>
                  <th className="px-5 py-3 text-right font-medium">Margin %</th>
                  <th className="px-5 py-3 font-medium">Budget</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p, i) => {
                  const pn = pnls[i];
                  return (
                    <tr key={p.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                      <td className="px-5 py-3">
                        <span className="font-semibold text-ink-900">{p.code}</span>
                        <p className="text-xs text-slate-400">{p.name}</p>
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">{inr(pn.revenue, { compact: true })}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{inr(pn.cost, { compact: true })}</td>
                      <td className={`px-5 py-3 text-right font-bold ${pn.margin >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{inr(pn.margin, { compact: true })}</td>
                      <td className="px-5 py-3 text-right">
                        {pn.revenue > 0 ? <span className={`font-semibold ${pn.marginPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{pn.marginPct.toFixed(1)}%</span> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        {pn.budget > 0 ? (
                          <div className="w-28">
                            <Progress value={Math.min(100, pn.budgetUsedPct)} />
                            <p className={`mt-0.5 text-xs ${pn.overBudget ? "font-semibold text-rose-600" : "text-slate-400"}`}>{pn.budgetUsedPct.toFixed(0)}% used</p>
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
                {projects.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">No projects yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionTitle title="Cost per Asset" subtitle="Unit costs need production data — log output in Production to fill the per-tonne and per-m³ columns" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Asset</th>
                <th className="px-5 py-3 font-medium">Class</th>
                <th className="px-5 py-3 text-right font-medium">Total Cost</th>
                <th className="px-5 py-3 text-right font-medium">₹/km</th>
                <th className="px-5 py-3 text-right font-medium">₹/hr</th>
                <th className="px-5 py-3 text-right font-medium">₹/t</th>
                <th className="px-5 py-3 text-right font-medium">₹/m³</th>
                <th className="px-5 py-3 text-right font-medium">Book Value</th>
                <th className="px-5 py-3 font-medium">Verdict</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {withCost.slice(0, 60).map((r) => (
                <tr key={r.asset.id} className="border-t border-slate-100 align-top hover:bg-brand-50/30">
                  <td className="px-5 py-3">
                    <Link href={`/fleet/${r.asset.id}`} className="font-semibold text-brand-700 hover:underline">{r.asset.code}</Link>
                    <p className="text-xs text-slate-400">{r.asset.registrationNo ?? r.asset.name}</p>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{ASSET_CLASS_LABEL[r.asset.assetClass] ?? r.asset.assetClass}</td>
                  <td className="px-5 py-3 text-right font-bold text-ink-900">{inr(r.cost.total, { compact: true })}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{r.cost.perKm != null ? inr(r.cost.perKm) : "—"}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{r.cost.perHour != null ? inr(r.cost.perHour) : "—"}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{r.cost.perTonne != null ? inr(r.cost.perTonne) : "—"}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{r.cost.perM3 != null ? inr(r.cost.perM3) : "—"}</td>
                  <td className="px-5 py-3 text-right">
                    <span className="font-medium text-ink-900">{inr(r.dep.bookValue, { compact: true })}</span>
                    <span className="block text-xs text-slate-400">{r.dep.ageYears.toFixed(1)} yrs · {r.asset.depMethod}</span>
                  </td>
                  <td className="px-5 py-3">
                    <Badge color={verdictBadge(r.advice.verdict)}>{r.advice.verdict}</Badge>
                    {r.advice.reasons.length > 0 && (
                      <ul className="mt-1 max-w-xs list-inside list-disc text-xs text-slate-500">
                        {r.advice.reasons.slice(0, 2).map((x, i) => <li key={i}>{x}</li>)}
                      </ul>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <DepreciationForm asset={{ id: r.asset.id, code: r.asset.code, acquisitionCost: r.asset.acquisitionCost, salvageValue: r.asset.salvageValue, usefulLifeYears: r.asset.usefulLifeYears, depMethod: r.asset.depMethod, inServiceDate: r.asset.inServiceDate }} />
                  </td>
                </tr>
              ))}
              {withCost.length === 0 && (
                <tr><td colSpan={10} className="px-5 py-10 text-center text-slate-400">
                  No costs yet. They appear automatically as fuel is issued, work orders are closed and hire invoices are verified.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="p-5 pb-3"><SectionTitle title="Manual Cost Lines" subtitle="Tyres, insurance, EMI, tolls — fuel, maintenance and hire flow in automatically" /></div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Head</th>
                  <th className="px-5 py-2.5 font-medium">Asset</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {recentCosts.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-5 py-2.5 whitespace-nowrap text-slate-600">{fmtDate(c.date)}</td>
                    <td className="px-5 py-2.5 text-slate-600">{COST_HEAD_LABEL[c.costHead] ?? c.costHead}</td>
                    <td className="px-5 py-2.5 text-slate-600">{c.asset?.code ?? c.project?.code ?? "Fleet"}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-ink-900">{inr(c.amount, { compact: true })}</td>
                    <td className="px-5 py-2.5 text-right"><DeleteRow id={c.id} kind="cost" /></td>
                  </tr>
                ))}
                {recentCosts.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No manual cost lines.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-0">
          <div className="p-5 pb-3"><SectionTitle title="Project Revenue" subtitle="RA bills and advances" /></div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Project</th>
                  <th className="px-5 py-2.5 font-medium">Description</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {revenues.slice(0, 30).map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-5 py-2.5 whitespace-nowrap text-slate-600">{fmtDate(r.date)}</td>
                    <td className="px-5 py-2.5 font-medium text-ink-900">{r.project.code}</td>
                    <td className="px-5 py-2.5 text-slate-600">{r.description}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-emerald-600">{inr(r.amount, { compact: true })}</td>
                    <td className="px-5 py-2.5 text-right"><DeleteRow id={r.id} kind="revenue" /></td>
                  </tr>
                ))}
                {revenues.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No revenue recorded — project margin can&apos;t be computed without it.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
