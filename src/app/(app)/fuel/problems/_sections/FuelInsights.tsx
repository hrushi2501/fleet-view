import { db } from "@/lib/db";
import { StatCard, Card, SectionTitle, Badge } from "@/components/ui";
import { inr, num, fmtDate, ASSET_CLASS_LABEL } from "@/lib/utils";
import { resolveTankThresholds, reconcileTankDynamic, calculateSupplierScorecard } from "@/lib/fuel-recon-engine";
import { analyzeFleet } from "@/lib/fuel";
import { getDieselRate } from "@/lib/settings";
import { NormForm, DipForm, TankForm } from "@/components/FuelForms";
import { ShieldAlert, IndianRupee, Fuel, HandCoins, ArrowRight, Scale, TrendingUp, TrendingDown } from "lucide-react";
import Link from "next/link";

import { requirePage, assetScope, projectScope } from "@/lib/access";
import { Txt } from "@/components/Txt";

/** A failed optional read must stay distinguishable from a successful empty result. */
async function safeFindMany<T>(fn: () => Promise<T[]>): Promise<{ data: T[]; available: boolean }> {
  try { return { data: await fn(), available: true }; } catch { return { data: [], available: false }; }
}

/**
 * The patterns behind the individual problems: which tanks leak, which
 * suppliers deliver short, which vehicles drink.
 *
 * Was `/fuel/intelligence`. Two of its four cards were links to pages that are
 * now tabs on this very screen, which is the clearest possible argument that it
 * was never a page in its own right.
 */
export async function FuelInsights() {
  const access = await requirePage("fuel.view");
  // Rows, not just the page: a scoped supervisor sees their own sites.
  const visible = assetScope(access);
  const _visibleProjects = projectScope(access);
  const [tanks, issues, receipts, assets, normsResult, dieselRate] = await Promise.all([
    db.fuelTank.findMany({
      include: {
        receipts: true,
        dips: true,
        issues: { where: { type: "ISSUE" } },
      },
      orderBy: { name: "asc" },
    }),
    db.fuelTransaction.findMany({ where: { type: "ISSUE", asset: visible }, include: { asset: true }, orderBy: { date: "asc" } }),
    db.fuelReceipt.findMany({ orderBy: { date: "desc" } }),
    db.asset.findMany({ where: visible, orderBy: { code: "asc" } }),
    safeFindMany(() => db.consumptionNorm.findMany({ orderBy: [{ unit: "asc" }, { assetClass: "asc" }] })),
    getDieselRate(),
  ]);
  const norms = normsResult.data;

  // Fetch unified anomalies safely (table may not exist)
  const unifiedResult = await safeFindMany(() =>
    db.unifiedAnomaly.findMany({ orderBy: [{ status: "asc" }, { score: "desc" }, { detectedAt: "desc" }], take: 100 })
  );
  const unifiedAnomalies = unifiedResult.data;

  const tankOpts = tanks.map((t: { id: string; name: string; location: string }) => ({ id: t.id, label: `${t.name} — ${t.location}` }));
  const classOpts = Object.entries(ASSET_CLASS_LABEL).map(([value, label]) => ({ value, label }));

  // Live dynamic reconciliation across all site tanks
  const liveRecons = await Promise.all(
    tanks.map(async (t) => {
      const thresholds = await resolveTankThresholds(t.id, t.projectId);
      return reconcileTankDynamic(
        { id: t.id, name: t.name, location: t.location, capacity: t.capacity, minLevel: t.minLevel },
        t.receipts.map((r) => ({ id: r.id, date: r.date, qtyInvoiced: r.qtyInvoiced, qtyReceived: r.qtyReceived, amount: r.amount, supplier: r.supplier, shortfall: r.shortfall })),
        t.issues.map((i) => ({ id: i.id, date: i.date, quantity: i.quantity, assetId: i.assetId, amount: i.amount })),
        t.dips.map((p) => ({ id: p.id, date: p.date, level: p.level })),
        thresholds
      );
    })
  );

  const assessedRecons = liveRecons.filter((r) => r.status !== "insufficient");
  const totalUnaccountedL = assessedRecons.length > 0
    ? assessedRecons.reduce((s: number, r) => s + Math.max(0, -r.varianceL), 0)
    : null;
  const openCases = unifiedAnomalies.filter((a: { status?: string }) => a.status === "OPEN" || a.status === "INVESTIGATING");
  const valueAtRisk = openCases.reduce((s: number, a: { valueAtRisk?: number }) => s + (a.valueAtRisk ?? 0), 0);
  const recoveredInr = (unifiedAnomalies as { recoveredInr?: number }[]).reduce((s: number, a) => s + (a.recoveredInr ?? 0), 0);

  const fleet = analyzeFleet(
    assets.map((a) => ({ id: a.id, code: a.code, name: a.name, assetClass: a.assetClass, category: a.category, primaryMeter: a.primaryMeter, fuelCapacity: a.fuelCapacity })),
    issues.map((t) => ({ id: t.id, assetId: t.assetId, quantity: t.quantity, meterValue: t.meterValue, rate: t.rate, amount: t.amount, date: t.date, odometerPhoto: t.odometerPhoto, pumpPhoto: t.pumpPhoto, sensorRise: t.sensorRise, anomaly: t.anomaly, variancePct: t.variancePct, geofenceOk: t.geofenceOk, lat: t.lat, lng: t.lng }))
  );

  const supplierScorecard = calculateSupplierScorecard(receipts);

  const _effColor = (s: string) => s === "good" ? "text-emerald-600" : s === "low" ? "text-rose-600" : s === "high" ? "text-amber-600" : "text-slate-400";

  return (
    <div className="space-y-6">

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Patterns</h2>
          <p className="text-sm text-slate-500">
            Where the losses cluster — by tank, by supplier and by vehicle
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NormForm classes={classOpts} />
          <DipForm tanks={tankOpts} />
          <TankForm projects={[]} />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-4">
        <StatCard label="Open Risk Cases" value={unifiedResult.available ? num(openCases.length) : "—"} sub={unifiedResult.available ? `${num(unifiedAnomalies.length)} total cases` : "case data unavailable"} accent={unifiedResult.available ? "rose" : "amber"} icon={<ShieldAlert className="h-5 w-5" />} />
        <StatCard label="Litres Unaccounted" value={totalUnaccountedL == null ? "—" : `${num(totalUnaccountedL)} L`} sub={totalUnaccountedL == null ? "not assessed; two dips required" : "assessed tank variance"} accent="amber" icon={<Fuel className="h-5 w-5" />} />
        <StatCard label="Value at Risk" value={unifiedResult.available ? inr(valueAtRisk, { compact: true }) : "—"} sub={unifiedResult.available ? `@ ₹${dieselRate}/L` : "case data unavailable"} accent={unifiedResult.available ? "rose" : "amber"} icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Recovered Value" value={unifiedResult.available ? inr(recoveredInr, { compact: true }) : "—"} sub={unifiedResult.available ? "closed cases" : "case data unavailable"} accent={unifiedResult.available ? "emerald" : "amber"} icon={<HandCoins className="h-5 w-5" />} />
      </div>

      {/* Quick links to dedicated pages */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Link href="/fuel/problems" className="group">
          <Card className="flex flex-wrap items-center justify-between gap-3 transition-all hover:ring-2 hover:ring-brand-200">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-ink-900">Problem Queue</p>
                <p className="text-sm text-slate-500">{unifiedResult.available ? `${num(openCases.length)} open cases · ${num(unifiedAnomalies.length)} total` : "Case data unavailable"}</p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-brand-600" />
          </Card>
        </Link>
        <Link href="/fuel/tanks?tab=stock" className="group">
          <Card className="flex flex-wrap items-center justify-between gap-3 transition-all hover:ring-2 hover:ring-brand-200">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Scale className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-ink-900">Tank Stock Check</p>
                <p className="text-sm text-slate-500">{num(tanks.length)} tanks · {totalUnaccountedL == null ? "not assessed" : `${num(totalUnaccountedL)} L unaccounted`}</p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-brand-600" />
          </Card>
        </Link>
      </div>

      {/* Dynamic Tank Reconciliation Summary */}
      {liveRecons.length > 0 && (
        <Card className="p-0">
          <div className="p-5 pb-3">
            <SectionTitle title="Site Tank Check" subtitle="Limits set for each tank, then each site, then the whole company" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium"><Txt text="Tank" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Opening Dip" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Received" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Issued" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Expected" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Actual Dip" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Variance" /></th>
                  <th className="px-5 py-3 font-medium"><Txt text="Status" /></th>
                </tr>
              </thead>
              <tbody>
                {liveRecons.map((r) => (
                  <tr key={r.tank.id} className="border-t border-slate-100 align-top">
                    <td className="px-5 py-3">
                      <span className="font-semibold text-ink-900">{r.tank.name}</span>
                      <p className="text-xs text-slate-400">{r.tank.location}</p>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">{r.status === "insufficient" ? "—" : `${num(r.openingDip)} L`}</td>
                    <td className="px-5 py-3 text-right font-medium text-emerald-600">+{num(r.receiptsL)} L</td>
                    <td className="px-5 py-3 text-right font-medium text-brand-700">−{num(r.issuesL)} L</td>
                    <td className="px-5 py-3 text-right font-semibold text-ink-900">{num(r.expectedClosing)} L</td>
                    <td className="px-5 py-3 text-right font-semibold text-ink-900">{r.closingDip == null ? "—" : `${num(r.closingDip)} L`}</td>
                    <td className="px-5 py-3 text-right">
                      {r.status === "insufficient" ? <span className="text-slate-400">—</span> : (
                        <span className={`font-bold ${r.varianceL < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {r.varianceL > 0 ? "+" : ""}{num(r.varianceL)} L
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge color={r.status === "ok" ? "bg-emerald-100 text-emerald-700" : r.status === "watch" ? "bg-amber-100 text-amber-700" : r.status === "insufficient" ? "bg-slate-100 text-slate-600" : "bg-rose-100 text-rose-700"}>{r.status === "insufficient" ? "not assessed" : r.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Fleet Efficiency Overview */}
      {fleet.rows.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <SectionTitle title="Best Mileage" action={<TrendingUp className="h-4 w-4 text-emerald-600" />} />
            <div className="space-y-2">
              {fleet.best.map((r) => (
                <div key={r.asset.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <Link href={`/fleet/${r.asset.id}`} className="font-medium text-brand-700 hover:underline">{r.asset.code}</Link>
                  <span className="font-bold text-emerald-600">{r.efficiency!.toFixed(2)} km/L</span>
                </div>
              ))}
              {fleet.best.length === 0 && <p className="text-sm text-slate-400">Not enough data yet.</p>}
            </div>
          </Card>
          <Card>
            <SectionTitle title="Worst Mileage — check these" action={<TrendingDown className="h-4 w-4 text-rose-600" />} />
            <div className="space-y-2">
              {fleet.worst.map((r) => (
                <div key={r.asset.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <Link href={`/fleet/${r.asset.id}`} className="font-medium text-brand-700 hover:underline">{r.asset.code}</Link>
                  <span className="font-bold text-rose-600">{r.efficiency!.toFixed(2)} km/L</span>
                </div>
              ))}
              {fleet.worst.length === 0 && <p className="text-sm text-slate-400">Not enough data yet.</p>}
            </div>
          </Card>
        </div>
      )}

      {/* Supplier Scorecard */}
      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionTitle title="Supplier Short-Delivery Scorecard" subtitle="Compare the litres on the bill with the litres actually measured in the tank" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium"><Txt text="Supplier" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Deliveries" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Invoiced Litres" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Dipped Litres" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Total Shortfall" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Shortfall %" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Total Spend" /></th>
              </tr>
            </thead>
            <tbody>
              {supplierScorecard.map((s) => (
                <tr key={s.supplier} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-semibold text-ink-900">{s.supplier}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{s.totalDeliveries}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{num(s.totalInvoiced)} L</td>
                  <td className="px-5 py-3 text-right text-slate-600">{num(s.totalReceived)} L</td>
                  <td className="px-5 py-3 text-right font-bold text-rose-600">−{num(s.totalShortfall)} L</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`font-bold ${s.shortfallRatioPct > 1.0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {s.shortfallRatioPct.toFixed(2)}%
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-ink-900">{inr(s.totalSpend)}</td>
                </tr>
              ))}
              {supplierScorecard.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">No diesel receipt records yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Consumption Norms */}
      {norms.length > 0 && (
        <Card className="p-0">
          <div className="p-5 pb-3">
            <SectionTitle title="Expected Fuel Use" subtitle="Normal diesel use for each machine type — anything outside this range is flagged" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium"><Txt text="Asset Class" /></th>
                  <th className="px-5 py-3 font-medium"><Txt text="Unit" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Norm Band" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Tolerance" /></th>
                  <th className="px-5 py-3 font-medium"><Txt text="Updated" /></th>
                </tr>
              </thead>
              <tbody>
                {(norms as { id: string; assetClass: string | null; unit: string; normLow: number; normHigh: number; tolerancePct: number; updatedAt: Date }[]).map((nm) => (
                  <tr key={nm.id} className="border-t border-slate-100">
                    <td className="px-5 py-3 font-medium text-ink-900">{nm.assetClass ? ASSET_CLASS_LABEL[nm.assetClass] ?? nm.assetClass : "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{nm.unit === "LPH" ? "L / engine-hour" : "km / litre"}</td>
                    <td className="px-5 py-3 text-right font-semibold text-ink-900">{nm.normLow} – {nm.normHigh}</td>
                    <td className="px-5 py-3 text-right text-slate-600">±{nm.tolerancePct}%</td>
                    <td className="px-5 py-3 text-xs text-slate-400">{fmtDate(nm.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
