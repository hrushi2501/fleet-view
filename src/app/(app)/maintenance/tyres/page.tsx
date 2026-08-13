import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard, Progress } from "@/components/ui";
import { TyreForm, TyreActionForm, ComponentForm, ComponentActionForm, DeleteRow } from "@/components/MaintTyreForms";
import { tyreHealth, componentHealth, detectSwaps, LEGAL_MIN_TREAD_MM, type TyreLite, type EventLite } from "@/lib/tyres";
import { inr, num, fmtDate } from "@/lib/utils";
import { CircleDot, TriangleAlert, IndianRupee, ShieldAlert, Recycle, Warehouse } from "lucide-react";
import Link from "next/link";
import { requirePage } from "@/lib/access";

export const dynamic = "force-dynamic";

const HEALTH: Record<string, string> = {
  good: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  monitor: "bg-amber-100 text-amber-700 ring-amber-600/20",
  replace: "bg-rose-100 text-rose-700 ring-rose-600/20",
  unsafe: "bg-rose-600 text-white ring-rose-700/20",
};
const STATUS_BADGE: Record<string, string> = {
  IN_USE: "bg-brand-100 text-brand-700 ring-brand-600/20",
  IN_STOCK: "bg-slate-100 text-slate-600 ring-slate-500/20",
  REMOVED: "bg-amber-100 text-amber-700 ring-amber-600/20",
  RETREADED: "bg-violet-100 text-violet-700 ring-violet-600/20",
  SCRAPPED: "bg-slate-100 text-slate-500 ring-slate-400/20",
  REBUILT: "bg-violet-100 text-violet-700 ring-violet-600/20",
};

/**
 * Tyres and the other big-ticket components that get moved between machines.
 * Was `/tyres`; it belongs under Maintenance because fitting and removing them
 * is maintenance work.
 */
export default async function TyresPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePage("maintenance.view");
  const resolvedParams = await searchParams;
  const tab = resolvedParams?.tab || "register";

  const [tyres, events, components, assets, warehouses] = await Promise.all([
    db.tyre.findMany({ include: { asset: true, warehouse: true }, orderBy: { serialNo: "asc" } }),
    db.tyreEvent.findMany({ orderBy: { date: "desc" }, take: 500 }),
    db.majorComponent.findMany({ include: { asset: true, warehouse: true }, orderBy: { serialNo: "asc" } }),
    db.asset.findMany({ orderBy: { code: "asc" } }),
    db.inventoryWarehouse.findMany({ where: { active: true }, include: { tyres: { include: { asset: true } }, components: { include: { asset: true } } }, orderBy: { code: "asc" } }),
  ]);

  const assetOpts = assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.registrationNo ?? a.name}` }));
  const tyreOpts = tyres.map((t) => ({ id: t.id, label: `${t.serialNo} — ${t.make} ${t.size}${t.asset ? ` (on ${t.asset.code})` : t.warehouse ? ` (in ${t.warehouse.code})` : ""}` }));
  const componentOpts = components.map((c) => ({ id: c.id, label: `${c.serialNo} — ${c.make ?? ""} ${c.type}${c.asset ? ` (on ${c.asset.code})` : c.warehouse ? ` (in ${c.warehouse.code})` : ""}` }));
  const warehouseOpts = warehouses.map((w) => ({ id: w.id, label: `${w.code} — ${w.name}` }));
  const meterOf = new Map(assets.map((a) => [a.id, a.meterValue]));

  const lites: TyreLite[] = tyres.map((t) => ({
    id: t.id, serialNo: t.serialNo, make: t.make, size: t.size, status: t.status, assetId: t.assetId,
    position: t.position, cost: t.cost, treadNewMm: t.treadNewMm, currentTreadMm: t.currentTreadMm,
    expectedLifeKm: t.expectedLifeKm, fittedMeter: t.fittedMeter, totalKm: t.totalKm,
    retreadCount: t.retreadCount, purchaseDate: t.purchaseDate,
  }));

  const health = lites.map((t) => tyreHealth(t, t.assetId ? meterOf.get(t.assetId) ?? null : null));
  const swaps = detectSwaps(lites, events.map((e): EventLite => ({ tyreId: e.tyreId, kind: e.kind, date: e.date, assetId: e.assetId, position: e.position, treadMm: e.treadMm })));

  const inUse = health.filter((h) => h.tyre.status === "IN_USE");
  const unsafe = health.filter((h) => h.status === "unsafe");
  const replace = health.filter((h) => h.status === "replace");
  const tyreSpend = tyres.reduce((s, t) => s + t.cost, 0);
  const withCpk = health.filter((h) => h.costPerKm != null);
  const avgCpk = withCpk.length ? withCpk.reduce((s, h) => s + h.costPerKm!, 0) / withCpk.length : 0;

  const compHealth = components.map((c) =>
    componentHealth(
      { id: c.id, serialNo: c.serialNo, type: c.type, status: c.status, cost: c.cost, fittedMeter: c.fittedMeter, expectedLifeHours: c.expectedLifeHours, hoursUsed: c.hoursUsed, rebuildCount: c.rebuildCount },
      c.assetId ? meterOf.get(c.assetId) ?? null : null
    )
  );
  const compReplace = compHealth.filter((c) => c.status === "replace").length;

  const tabClass = (t: string) => `px-4 py-2 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${tab === t
      ? "border-brand-600 text-brand-600"
      : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
    }`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Tyres &amp; Parts</h1>
          <p className="text-sm text-slate-500">
            Every casing tracked by serial — cost per kilometre, life remaining, and swaps that don&apos;t add up
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TyreActionForm kind="INSPECT" tyres={tyreOpts} assets={assetOpts} />
          <TyreActionForm kind="REMOVE" tyres={tyreOpts} assets={assetOpts} warehouses={warehouseOpts} />
          <TyreActionForm kind="TRANSFER" tyres={tyreOpts} assets={assetOpts} warehouses={warehouseOpts} />
          <TyreActionForm kind="FIT" tyres={tyreOpts} assets={assetOpts} />
          <TyreForm warehouses={warehouseOpts} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Tyres Tracked" value={num(tyres.length)} sub={`${num(inUse.length)} fitted`} accent="brand" icon={<CircleDot className="h-5 w-5" />} />
        <StatCard label="Unsafe / Replace" value={num(unsafe.length + replace.length)} sub={`${num(unsafe.length)} below legal tread`} accent="rose" icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="Tyre Spend" value={inr(tyreSpend, { compact: true })} sub="purchase value" accent="violet" icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Avg Cost / km" value={avgCpk > 0 ? `₹${avgCpk.toFixed(2)}` : "—"} sub={`${num(withCpk.length)} with km data`} accent="emerald" icon={<Recycle className="h-5 w-5" />} />
        <StatCard label="Swap Signals" value={num(swaps.length)} sub={`${num(compReplace)} components due`} accent={swaps.length > 0 ? "rose" : "amber"} icon={<ShieldAlert className="h-5 w-5" />} />
      </div>

      {swaps.length > 0 && (
        <Card className="border-rose-200 p-0">
          <div className="flex items-center gap-2 p-5 pb-3">
            <ShieldAlert className="h-5 w-5 text-rose-600" />
            <SectionTitle title="Possible Tyre Swaps" subtitle="Movements the records can't explain — worth a physical check" />
          </div>
          <div className="divide-y divide-slate-100">
            {swaps.map((s, i) => (
              <div key={i} className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">{s.serialNo}</Badge>
                  <span className="text-xs text-slate-400">{fmtDate(s.date)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-700">{s.reason}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-1 overflow-x-auto">
        <Link href="/maintenance/tyres?tab=register" className={tabClass("register")}>📋 Serial Register</Link>
        <Link href="/maintenance/tyres?tab=stock" className={tabClass("stock")}>🏢 Store &amp; Yard Stock</Link>
        <Link href="/maintenance/tyres?tab=history" className={tabClass("history")}>📜 Event History</Link>
      </div>

      {tab === "register" && (
        <>
          {tyres.length === 0 && (
            <Card>
              <div className="py-12 text-center">
                <CircleDot className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-ink-900">No tyres in the register</p>
                <p className="mt-1 text-sm text-slate-500">
                  Add tyres by serial number, then fit them to machines. Cost per km and remaining life build up from there.
                </p>
              </div>
            </Card>
          )}

          {tyres.length > 0 && (
            <Card className="p-0">
              <div className="p-5 pb-3">
                <SectionTitle title="Tyre Register" subtitle={`Legal minimum tread is ${LEGAL_MIN_TREAD_MM} mm — anything at or below is not roadworthy`} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Serial</th>
                      <th className="px-5 py-3 font-medium">Make / Size</th>
                      <th className="px-5 py-3 font-medium">Fitted To / Location</th>
                      <th className="px-5 py-3 font-medium">Tread</th>
                      <th className="px-5 py-3 font-medium">Wear</th>
                      <th className="px-5 py-3 text-right font-medium">Km Run</th>
                      <th className="px-5 py-3 text-right font-medium">₹/km</th>
                      <th className="px-5 py-3 text-right font-medium">Projected Life</th>
                      <th className="px-5 py-3 font-medium">Health</th>
                      <th className="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.map((h) => {
                      const t = tyres.find((x) => x.id === h.tyre.id)!;
                      return (
                        <tr key={h.tyre.id} className="border-t border-slate-100 align-top hover:bg-brand-50/30">
                          <td className="px-5 py-3">
                            <span className="font-mono text-xs font-semibold text-ink-900">{h.tyre.serialNo}</span>
                            <p className="mt-0.5"><Badge color={STATUS_BADGE[h.tyre.status] ?? STATUS_BADGE.IN_STOCK}>{h.tyre.status.replace("_", " ")}</Badge></p>
                          </td>
                          <td className="px-5 py-3 text-slate-600">
                            {h.tyre.make}
                            <p className="text-xs text-slate-400">{h.tyre.size}{h.tyre.retreadCount > 0 ? ` · ${h.tyre.retreadCount}× retread` : ""}</p>
                          </td>
                          <td className="px-5 py-3">
                            {t.asset ? (
                              <>
                                <Link href={`/fleet/${t.assetId}`} className="font-semibold text-brand-700 hover:underline">{t.asset.code}</Link>
                                {h.tyre.position && <p className="text-xs text-slate-400">{h.tyre.position}</p>}
                              </>
                            ) : t.warehouse ? (
                              <div className="flex flex-col">
                                <span className="font-medium text-slate-600">{t.warehouse.code}</span>
                                <span className="text-xs text-slate-400">{t.warehouse.name}</span>
                              </div>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`font-bold ${h.tyre.currentTreadMm <= LEGAL_MIN_TREAD_MM ? "text-rose-600" : h.tyre.currentTreadMm <= 3 ? "text-amber-600" : "text-ink-900"}`}>
                              {h.tyre.currentTreadMm} mm
                            </span>
                            <p className="text-xs text-slate-400">new {h.tyre.treadNewMm} mm</p>
                          </td>
                          <td className="px-5 py-3">
                            <div className="w-20">
                              <Progress value={Math.min(100, h.wearPct)} />
                              <p className="mt-0.5 text-xs text-slate-400">{h.wearPct.toFixed(0)}%</p>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right text-slate-600">{h.kmRun > 0 ? num(h.kmRun) : "—"}</td>
                          <td className="px-5 py-3 text-right font-medium text-ink-900">{h.costPerKm != null ? `₹${h.costPerKm.toFixed(2)}` : "—"}</td>
                          <td className="px-5 py-3 text-right text-slate-600">
                            {h.projectedLifeKm != null ? (
                              <>
                                {num(h.projectedLifeKm)}
                                <span className="block text-xs text-slate-400">exp. {num(h.tyre.expectedLifeKm)}</span>
                              </>
                            ) : "—"}
                          </td>
                          <td className="px-5 py-3">
                            <Badge color={HEALTH[h.status]}>{h.status}</Badge>
                            {h.flags.length > 0 && (
                              <ul className="mt-1 max-w-xs list-inside list-disc text-xs text-slate-500">
                                {h.flags.map((f, i) => <li key={i}>{f}</li>)}
                              </ul>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <TyreForm tyre={{ id: t.id, serialNo: t.serialNo, make: t.make, pattern: t.pattern, size: t.size, cost: t.cost, treadNewMm: t.treadNewMm, currentTreadMm: t.currentTreadMm, expectedLifeKm: t.expectedLifeKm, purchaseDate: t.purchaseDate, status: t.status, warehouseId: t.warehouseId }} warehouses={warehouseOpts} />
                              <DeleteRow id={t.id} kind="tyre" />
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

          <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <h2 className="text-lg font-bold text-ink-900">Major Components</h2>
            <div className="flex gap-2">
              <ComponentActionForm components={componentOpts} warehouses={warehouseOpts} />
              <TyreActionForm kind="RETREAD" tyres={tyreOpts} assets={assetOpts} warehouses={warehouseOpts} />
              <ComponentForm assets={assetOpts} warehouses={warehouseOpts} />
            </div>
          </div>

          <Card className="p-0">
            <div className="p-5 pb-3">
              <SectionTitle title="Component Register" subtitle="Buckets, undercarriage, engines — tracked by serial and hours" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Serial</th>
                    <th className="px-5 py-3 font-medium">Type</th>
                    <th className="px-5 py-3 font-medium">Fitted To / Location</th>
                    <th className="px-5 py-3 text-right font-medium">Hours Run</th>
                    <th className="px-5 py-3 font-medium">Life Used</th>
                    <th className="px-5 py-3 text-right font-medium">₹/hr</th>
                    <th className="px-5 py-3 font-medium">Health</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {compHealth.map((c) => {
                    const raw = components.find((x) => x.id === c.component.id)!;
                    return (
                      <tr key={c.component.id} className="border-t border-slate-100 align-top hover:bg-brand-50/30">
                        <td className="px-5 py-3">
                          <span className="font-mono text-xs font-semibold text-ink-900">{c.component.serialNo}</span>
                          <p className="mt-0.5"><Badge color={STATUS_BADGE[c.component.status] ?? STATUS_BADGE.IN_STOCK}>{c.component.status.replace("_", " ")}</Badge></p>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{c.component.type.charAt(0) + c.component.type.slice(1).toLowerCase()}</td>
                        <td className="px-5 py-3">
                          {raw.asset ? (
                            <Link href={`/fleet/${raw.assetId}`} className="font-semibold text-brand-700 hover:underline">{raw.asset.code}</Link>
                          ) : raw.warehouse ? (
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-600">{raw.warehouse.code}</span>
                              <span className="text-xs text-slate-400">{raw.warehouse.name}</span>
                            </div>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-600">{num(c.hoursRun)}</td>
                        <td className="px-5 py-3">
                          <div className="w-24">
                            <Progress value={c.lifeUsedPct != null ? Math.min(100, c.lifeUsedPct) : 0} />
                            <p className="mt-0.5 text-xs text-slate-400">{c.lifeUsedPct != null ? `${c.lifeUsedPct.toFixed(0)}% of ${num(c.component.expectedLifeHours)}h` : "expected life not set"}</p>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-ink-900">{c.costPerHour != null ? `₹${c.costPerHour.toFixed(2)}` : "—"}</td>
                        <td className="px-5 py-3">
                          <Badge color={HEALTH[c.status]}>{c.status}</Badge>
                          {c.flags.length > 0 && (
                            <ul className="mt-1 max-w-xs list-inside list-disc text-xs text-slate-500">
                              {c.flags.map((f, i) => <li key={i}>{f}</li>)}
                            </ul>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <ComponentForm assets={assetOpts} component={{ id: raw.id, serialNo: raw.serialNo, type: raw.type, make: raw.make, assetId: raw.assetId, status: raw.status, cost: raw.cost, expectedLifeHours: raw.expectedLifeHours, hoursUsed: raw.hoursUsed, fittedMeter: raw.fittedMeter, fittedDate: raw.fittedDate, warehouseId: raw.warehouseId }} warehouses={warehouseOpts} />
                            <DeleteRow id={raw.id} kind="component" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {components.length === 0 && (
                    <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-400">
                      No components registered. Add buckets, undercarriage or engines to track their hours and rebuild cycles.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "stock" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <SectionTitle title="Store &amp; Yard Inventory" subtitle="Stock levels of tyres and components kept at each site location" />
          </div>

          {warehouses.length === 0 && (
            <Card>
              <div className="py-12 text-center text-slate-500">
                <Warehouse className="mx-auto h-12 w-12 text-slate-300 mb-2" />
                <p className="font-semibold text-ink-900">No stores or warehouses configured</p>
                <p className="text-sm">Active warehouses are required to manage local inventories.</p>
              </div>
            </Card>
          )}

          {warehouses.map((w) => {
            const whTyres = tyres.filter((t) => t.warehouseId === w.id);
            const whComponents = components.filter((c) => c.warehouseId === w.id);

            return (
              <Card key={w.id} className="p-0 border border-slate-100 overflow-hidden shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50 px-5 py-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-base font-bold text-ink-900 flex items-center gap-2">
                      <Warehouse className="h-5 w-5 text-slate-500" />
                      {w.name} <span className="text-slate-400 font-mono text-sm">({w.code})</span>
                    </h3>
                    {w.location && <p className="text-xs text-slate-500 mt-0.5">{w.location}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Badge color="bg-brand-50 text-brand-700 ring-brand-600/20">{whTyres.length} tyres</Badge>
                    <Badge color="bg-violet-50 text-violet-700 ring-violet-600/20">{whComponents.length} components</Badge>
                  </div>
                </div>

                <div className="p-5 space-y-6">
                  {whTyres.length === 0 && whComponents.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-4">No serialised stock currently stored at this location.</p>
                  ) : (
                    <>
                      {whTyres.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Tyres in Stock</h4>
                          <div className="overflow-x-auto border border-slate-100 rounded-lg">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-50 text-left text-xs text-slate-500 border-b border-slate-100">
                                <tr>
                                  <th className="px-4 py-2 font-medium">Serial</th>
                                  <th className="px-4 py-2 font-medium">Make / Size</th>
                                  <th className="px-4 py-2 font-medium">Current Tread</th>
                                  <th className="px-4 py-2 text-right font-medium">Cost</th>
                                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {whTyres.map((t) => {
                                  return (
                                    <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                                      <td className="px-4 py-2 font-mono text-xs font-semibold text-ink-900">{t.serialNo}</td>
                                      <td className="px-4 py-2 text-xs text-slate-600">
                                        {t.make} <span className="text-slate-400">({t.size})</span>
                                      </td>
                                      <td className="px-4 py-2 text-xs font-semibold text-ink-900">{t.currentTreadMm} mm</td>
                                      <td className="px-4 py-2 text-xs text-right text-slate-600">{inr(t.cost)}</td>
                                      <td className="px-4 py-2 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                          <TyreForm tyre={{ id: t.id, serialNo: t.serialNo, make: t.make, pattern: t.pattern, size: t.size, cost: t.cost, treadNewMm: t.treadNewMm, currentTreadMm: t.currentTreadMm, expectedLifeKm: t.expectedLifeKm, purchaseDate: t.purchaseDate, status: t.status, warehouseId: t.warehouseId }} warehouses={warehouseOpts} />
                                          <TyreActionForm kind="TRANSFER" tyres={[{ id: t.id, label: `${t.serialNo} — ${t.make}` }]} assets={assetOpts} warehouses={warehouseOpts} />
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {whComponents.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Major Components in Stock</h4>
                          <div className="overflow-x-auto border border-slate-100 rounded-lg">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-50 text-left text-xs text-slate-500 border-b border-slate-100">
                                <tr>
                                  <th className="px-4 py-2 font-medium">Serial</th>
                                  <th className="px-4 py-2 font-medium">Type</th>
                                  <th className="px-4 py-2 font-medium">Make</th>
                                  <th className="px-4 py-2 text-right font-medium">Hours Run</th>
                                  <th className="px-4 py-2 text-right font-medium">Cost</th>
                                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {whComponents.map((c) => {
                                  return (
                                    <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                                      <td className="px-4 py-2 font-mono text-xs font-semibold text-ink-900">{c.serialNo}</td>
                                      <td className="px-4 py-2 text-xs text-slate-600">{c.type.charAt(0) + c.type.slice(1).toLowerCase()}</td>
                                      <td className="px-4 py-2 text-xs text-slate-500">{c.make ?? "—"}</td>
                                      <td className="px-4 py-2 text-xs text-right text-slate-600">{num(c.hoursUsed)} hrs</td>
                                      <td className="px-4 py-2 text-xs text-right text-slate-600">{inr(c.cost)}</td>
                                      <td className="px-4 py-2 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                          <ComponentForm assets={assetOpts} component={{ id: c.id, serialNo: c.serialNo, type: c.type, make: c.make, assetId: c.assetId, status: c.status, cost: c.cost, expectedLifeHours: c.expectedLifeHours, hoursUsed: c.hoursUsed, fittedMeter: c.fittedMeter, fittedDate: c.fittedDate, warehouseId: c.warehouseId }} warehouses={warehouseOpts} />
                                          <ComponentActionForm components={[{ id: c.id, label: `${c.serialNo} — ${c.make ?? ""} ${c.type}` }]} warehouses={warehouseOpts} />
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "history" && (
        <>
          {events.length === 0 && (
            <Card>
              <div className="py-12 text-center text-slate-400">No events logged in history.</div>
            </Card>
          )}

          {events.length > 0 && (
            <Card className="p-0">
              <div className="p-5 pb-3"><SectionTitle title="Tyre History" subtitle="Fitments, removals, inspections and retreads" /></div>
              <div className="max-h-[500px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Date</th>
                      <th className="px-5 py-2.5 font-medium">Serial</th>
                      <th className="px-5 py-2.5 font-medium">Event</th>
                      <th className="px-5 py-2.5 font-medium">Machine / Location</th>
                      <th className="px-5 py-2.5 text-right font-medium">Meter</th>
                      <th className="px-5 py-2.5 text-right font-medium">Tread</th>
                      <th className="px-5 py-2.5 font-medium">Reason / Note</th>
                      <th className="px-5 py-2.5 font-medium">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.slice(0, 200).map((e) => {
                      const t = tyres.find((x) => x.id === e.tyreId);
                      const a = e.assetId ? assets.find((x) => x.id === e.assetId) : null;
                      return (
                        <tr key={e.id} className="border-t border-slate-100">
                          <td className="px-5 py-2.5 whitespace-nowrap text-slate-600">{fmtDate(e.date)}</td>
                          <td className="px-5 py-2.5 font-mono text-xs text-ink-900">{t?.serialNo ?? "—"}</td>
                          <td className="px-5 py-2.5"><Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{e.kind}</Badge></td>
                          <td className="px-5 py-2.5 text-slate-600">{a?.code ?? "—"}{e.position ? ` · ${e.position}` : ""}</td>
                          <td className="px-5 py-2.5 text-right text-slate-600">{e.meterValue ? num(e.meterValue) : "—"}</td>
                          <td className="px-5 py-2.5 text-right text-slate-600">{e.treadMm ? `${e.treadMm} mm` : "—"}</td>
                          <td className="px-5 py-2.5 text-slate-500">{e.note || e.reason || "—"}</td>
                          <td className="px-5 py-2.5 text-xs text-slate-400">{e.by ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
