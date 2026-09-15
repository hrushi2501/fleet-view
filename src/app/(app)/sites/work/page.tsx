import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard, Progress } from "@/components/ui";
import { ProductionForm, ProdNormForm, SeedProdNormsButton, DeleteRow } from "@/components/ProdCostForms";
import { assetProductivity, projectProduction, unitFor, UNIT_LABEL, type LogLite, type Norm, type ProdUnit } from "@/lib/production";
import { inr, num, fmtDate, ASSET_CLASS_LABEL } from "@/lib/utils";
import { Boxes, Gauge, TriangleAlert, Timer, Layers } from "lucide-react";
import Link from "next/link";
import { ProductionContainer } from "@/components/ProductionContainer";
import { projectIdScope, requirePage } from "@/lib/access";
import { Txt } from "@/components/Txt";

export const dynamic = "force-dynamic";

/**
 * What each machine actually produced, and what the diesel behind it cost.
 *
 * Was `/production`. `/production/entry` came here too — the daily entry form
 * was already the second tab of this screen via `ProductionContainer`, so the
 * separate route was a second door into the same room.
 */
export default async function SiteWorkPage() {
  const access = await requirePage("production.view");
  const since = new Date(); since.setDate(since.getDate() - 30);

  const [logs, assets, projects, drivers, norms, fuel] = await Promise.all([
    db.productionLog.findMany({
      where: { date: { gte: since }, ...projectIdScope(access) },
      select: {
        id: true, assetId: true, date: true, shift: true, trips: true, tonnage: true,
        volumeM3: true, cycles: true, workedHours: true, idleHours: true, distanceKm: true,
        leadKm: true, material: true, projectId: true, driverId: true, source: true,
      },
      orderBy: { date: "desc" },
      take: 300,
    }),
    db.asset.findMany({
      select: { id: true, code: true, name: true, registrationNo: true, assetClass: true, category: true },
      orderBy: { code: "asc" },
    }),
    db.project.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    db.driver.findMany({
      select: { id: true, empCode: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.productionNorm.findMany(),
    db.fuelTransaction.groupBy({
      by: ["assetId"],
      where: { type: "ISSUE", date: { gte: since } },
      _sum: { quantity: true, amount: true },
    }),
  ]);

  const assetOpts = assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.registrationNo ?? a.name} (${ASSET_CLASS_LABEL[a.assetClass] ?? a.assetClass})` }));
  const projOpts = projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));
  const driverOpts = drivers.map((d) => ({ id: d.id, label: `${d.empCode} — ${d.name}` }));
  const classOpts = Object.entries(ASSET_CLASS_LABEL).map(([value, label]) => ({ value, label }));

  const fuelByAsset = new Map(fuel.map((f) => [f.assetId ?? "", { litres: f._sum.quantity ?? 0, spend: f._sum.amount ?? 0 }]));
  const normFor = (assetClass: string): Norm | null => {
    const unit = unitFor(assetClass);
    const nm = norms.find((x) => x.assetClass === assetClass && x.unit === unit);
    return nm ? { unit: nm.unit as ProdUnit, targetLow: nm.targetLow, targetHigh: nm.targetHigh } : null;
  };

  const logsByAsset = new Map<string, LogLite[]>();
  for (const l of logs) {
    const lite: LogLite = {
      assetId: l.assetId, date: l.date, shift: l.shift, trips: l.trips, tonnage: l.tonnage, volumeM3: l.volumeM3,
      cycles: l.cycles, workedHours: l.workedHours, idleHours: l.idleHours, distanceKm: l.distanceKm,
      leadKm: l.leadKm, material: l.material, projectId: l.projectId, driverId: l.driverId, source: l.source,
    };
    const arr = logsByAsset.get(l.assetId) ?? [];
    arr.push(lite);
    logsByAsset.set(l.assetId, arr);
  }

  const rows = assets
    .filter((a) => logsByAsset.has(a.id))
    .map((a) => {
      const f = fuelByAsset.get(a.id) ?? { litres: 0, spend: 0 };
      return assetProductivity(
        { id: a.id, code: a.code, name: a.name, assetClass: a.assetClass, category: a.category },
        logsByAsset.get(a.id)!, f.litres, f.spend, normFor(a.assetClass)
      );
    })
    // Unmeasured output sorts last rather than being treated as zero output.
    .sort((x, y) => (y.output ?? -1) - (x.output ?? -1));

  const allLogs: LogLite[] = [...logsByAsset.values()].flat();
  const totalTonnage = allLogs.reduce((s, l) => s + l.tonnage, 0);
  const totalM3 = allLogs.reduce((s, l) => s + l.volumeM3, 0);
  const totalTrips = allLogs.reduce((s, l) => s + l.trips, 0);
  const worked = allLogs.reduce((s, l) => s + l.workedHours, 0);
  const idle = allLogs.reduce((s, l) => s + l.idleHours, 0);
  const idlePct = worked + idle > 0 ? (idle / (worked + idle)) * 100 : 0;
  const below = rows.filter((r) => r.status === "below").length;
  const totalLitres = rows.reduce((s, r) => s + r.litres, 0);

  const statusColor = (s: string) => s === "above" ? "text-emerald-600" : s === "on" ? "text-brand-700" : s === "below" ? "text-rose-600" : "text-slate-400";

  return (
    <ProductionContainer assets={assetOpts} projects={projOpts} drivers={driverOpts}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink-900">Machine Output &amp; Diesel Used</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {norms.length === 0 && <SeedProdNormsButton />}
            <ProdNormForm classes={classOpts} />
            <ProductionForm assets={assetOpts} projects={projOpts} drivers={driverOpts} />
          </div>
        </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <StatCard label="Tonnage Moved" value={`${num(totalTonnage)} t`} sub="last 90 days" accent="brand" icon={<Boxes className="h-5 w-5" />} />
        <StatCard label="Volume Moved" value={`${num(totalM3)} m³`} sub="earthwork / BCM" accent="violet" icon={<Layers className="h-5 w-5" />} />
        <StatCard label="Trips" value={num(totalTrips)} sub={`${num(worked)} worked hrs`} accent="emerald" icon={<Gauge className="h-5 w-5" />} />
        <StatCard label="Idle Time" value={`${idlePct.toFixed(0)}%`} sub={`${num(idle)} idle hrs`} accent={idlePct > 30 ? "rose" : "amber"} icon={<Timer className="h-5 w-5" />} />
        <StatCard label="Below Target" value={num(below)} sub={`${num(totalLitres)} L consumed`} accent="rose" icon={<TriangleAlert className="h-5 w-5" />} />
      </div>

      {logs.length === 0 && (
        <Card>
          <div className="py-12 text-center">
            <Boxes className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-ink-900">No production logged yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Log a shift&apos;s output to start measuring litres per tonne and cost per m³ — the numbers that make fuel figures meaningful.
            </p>
          </div>
        </Card>
      )}

      {rows.length > 0 && (
        <Card className="p-0">
          <div className="p-5 pb-3">
            <SectionTitle title="Productivity by Machine" subtitle="Each machine type is measured its own way — trips for tippers, m³/hr for excavators" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium"><Txt text="Machine" /></th>
                  <th className="px-5 py-3 font-medium"><Txt text="Class" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Output" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Target" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Worked" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Idle" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Diesel" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="L / unit" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="₹ / unit" /></th>
                  <th className="px-5 py-3 font-medium"><Txt text="Flags" /></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const perUnitL = r.litresPerM3 ?? r.litresPerTonne ?? r.litresPerTrip;
                  const perUnitC = r.costPerM3 ?? r.costPerTonne ?? r.costPerTrip;
                  const unitName = r.litresPerM3 ? "m³" : r.litresPerTonne ? "t" : r.litresPerTrip ? "trip" : "";
                  return (
                    <tr key={r.asset.id} className="border-t border-slate-100 align-top hover:bg-brand-50/30">
                      <td className="px-5 py-3">
                        <Link href={`/sites/work/${r.asset.id}`} className="font-semibold text-brand-700 hover:underline">{r.asset.code}</Link>
                        <p className="text-xs text-slate-400">{r.days} day{r.days === 1 ? "" : "s"} logged</p>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{ASSET_CLASS_LABEL[r.asset.assetClass] ?? r.asset.assetClass}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`font-bold ${statusColor(r.status)}`}>{r.output != null ? r.output.toFixed(1) : "—"}</span>
                        <span className="block text-xs text-slate-400">{UNIT_LABEL[r.unit]}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-xs text-slate-500">
                        {r.target ? `${r.target.targetLow}–${r.target.targetHigh}` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">{num(r.workedHours)} h</td>
                      <td className="px-5 py-3 text-right">
                        <span className={r.idlePct != null && r.idlePct > 30 ? "font-semibold text-rose-600" : "text-slate-500"}>{r.idlePct != null ? `${r.idlePct.toFixed(0)}%` : "—"}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">{num(r.litres)} L</td>
                      <td className="px-5 py-3 text-right font-medium text-ink-900">{perUnitL != null ? `${perUnitL.toFixed(2)} L/${unitName}` : "—"}</td>
                      <td className="px-5 py-3 text-right font-medium text-ink-900">{perUnitC != null ? `${inr(perUnitC)}/${unitName}` : "—"}</td>
                      <td className="px-5 py-3">
                        {r.flags.length ? (
                          <ul className="max-w-xs list-inside list-disc text-xs text-slate-500">
                            {r.flags.map((f, i) => <li key={i}>{f}</li>)}
                          </ul>
                        ) : <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">OK</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {projects.length > 0 && logs.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((p) => {
            const pp = projectProduction(p.id, allLogs);
            if (pp.tonnage === 0 && pp.volumeM3 === 0 && pp.trips === 0) return null;
            const maxMat = Math.max(...pp.byMaterial.map((m) => m.tonnage + m.volumeM3), 1);
            return (
              <Card key={p.id}>
                <SectionTitle title={`${p.code} — ${p.name}`} subtitle={`${pp.machines} machine${pp.machines === 1 ? "" : "s"} · ${num(pp.workedHours)} worked hours`} />
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Tonnage</p>
                    <p className="mt-0.5 font-bold text-ink-900">{num(pp.tonnage)} t</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Volume</p>
                    <p className="mt-0.5 font-bold text-ink-900">{num(pp.volumeM3)} m³</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Trips</p>
                    <p className="mt-0.5 font-bold text-ink-900">{num(pp.trips)}</p>
                  </div>
                </div>
                {pp.byMaterial.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-slate-600">By material</p>
                    {pp.byMaterial.slice(0, 6).map((m) => (
                      <div key={m.material}>
                        <div className="mb-0.5 flex justify-between text-xs">
                          <span className="font-medium text-ink-900">{m.material}</span>
                          <span className="text-slate-500">
                            {m.tonnage > 0 ? `${num(m.tonnage)} t` : ""}{m.tonnage > 0 && m.volumeM3 > 0 ? " · " : ""}{m.volumeM3 > 0 ? `${num(m.volumeM3)} m³` : ""}
                          </span>
                        </div>
                        <Progress value={((m.tonnage + m.volumeM3) / maxMat) * 100} />
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Card className="p-0">
        <div className="p-5 pb-3"><SectionTitle title="Recent Production Logs" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium"><Txt text="Date" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Machine" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Shift" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Material" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Trips" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Tonnes" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="m³" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Worked" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Idle" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Source" /></th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 50).map((l) => {
                const a = assets.find((x) => x.id === l.assetId);
                return (
                  <tr key={l.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                    <td className="px-5 py-3 whitespace-nowrap text-slate-600">{fmtDate(l.date)}</td>
                    <td className="px-5 py-3 font-medium text-ink-900">{a?.code ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-500">{l.shift}</td>
                    <td className="px-5 py-3 text-slate-600">{l.material ?? "—"}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{l.trips || "—"}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{l.tonnage ? num(l.tonnage) : "—"}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{l.volumeM3 ? num(l.volumeM3) : "—"}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{l.workedHours || "—"}</td>
                    <td className="px-5 py-3 text-right text-slate-500">{l.idleHours || "—"}</td>
                    <td className="px-5 py-3">
                      <Badge color={l.source === "WEIGHBRIDGE" || l.source === "GPS" ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20"}>{l.source}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right"><DeleteRow id={l.id} kind="production" /></td>
                  </tr>
                );
              })}
              {logs.length === 0 && <tr><td colSpan={11} className="px-5 py-10 text-center text-slate-400">Pichhle 30 din mein koi entry nahi hui.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
    </ProductionContainer>
  );
}
