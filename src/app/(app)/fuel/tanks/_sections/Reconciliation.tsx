import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard } from "@/components/ui";
import { RunReconButton, DipForm, NormForm } from "@/components/FuelForms";
import { reconcileTank, DIP_TOLERANCE_L, type TankLite } from "@/lib/fuel-recon";
import { getDieselRate } from "@/lib/settings";
import { inr, num, fmtDate, ASSET_CLASS_LABEL } from "@/lib/utils";
import { Scale, TriangleAlert, CheckCircle2, HelpCircle, IndianRupee } from "lucide-react";
import Link from "next/link";

import { requirePage } from "@/lib/access";
import { Txt } from "@/components/Txt";

const STATUS_BADGE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  watch: "bg-amber-100 text-amber-700 ring-amber-600/20",
  critical: "bg-rose-100 text-rose-700 ring-rose-600/20",
  insufficient: "bg-slate-100 text-slate-500 ring-slate-400/20",
};
const STATUS_LABEL: Record<string, string> = {
  ok: "Reconciled",
  watch: "Watch",
  critical: "Critical gap",
  insufficient: "Needs a dip",
};

/**
 * Book stock against dipped stock, tank by tank.
 *
 * Was `/fuel/reconciliation`, and it keeps its own `fuel.reconcile` guard even
 * though the tab that offers it is already hidden from people without the
 * permission. Hiding a tab is a courtesy; the guard is the control.
 */
export async function Reconciliation() {
  await requirePage("fuel.reconcile");
  const [tanks, history, norms, dieselRate] = await Promise.all([
    db.fuelTank.findMany({
      include: {
        receipts: true,
        dips: true,
        issues: { where: { type: "ISSUE" } },
      },
      orderBy: { name: "asc" },
    }),
    db.fuelReconciliation.findMany({ include: { tank: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.consumptionNorm.findMany({ orderBy: [{ unit: "asc" }, { assetClass: "asc" }] }),
    getDieselRate(),
  ]);

  const tankOpts = tanks.map((t) => ({ id: t.id, label: `${t.name} — ${t.location}` }));

  // Live reconciliation against every tank's full dip history.
  const live = tanks.map((t) => {
    const lite: TankLite = { id: t.id, name: t.name, location: t.location, capacity: t.capacity, minLevel: t.minLevel };
    return reconcileTank(
      lite,
      t.receipts.map((r) => ({ id: r.id, date: r.date, qtyInvoiced: r.qtyInvoiced, qtyReceived: r.qtyReceived, amount: r.amount, supplier: r.supplier, shortfall: r.shortfall })),
      t.issues.map((i) => ({ id: i.id, date: i.date, quantity: i.quantity, assetId: i.assetId, amount: i.amount })),
      t.dips.map((p) => ({ id: p.id, date: p.date, level: p.level }))
    );
  });

  const missingL = live.reduce((s, r) => s + Math.max(0, -r.varianceL), 0);
  const throughput = live.reduce((s, r) => s + r.throughput, 0);
  const shrinkagePct = throughput > 0 ? (missingL / throughput) * 100 : 0;
  const criticalCount = live.filter((r) => r.status === "critical").length;
  const needDip = live.filter((r) => r.status === "insufficient").length;

  const classOpts = Object.entries(ASSET_CLASS_LABEL).map(([value, label]) => ({ value, label }));

  return (
    <div className="space-y-6">

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Stock Check</h2>
          <p className="text-sm text-slate-500">
            Opening dip + deliveries − issues = expected stock. Anything the physical dip doesn&apos;t agree with is unaccounted fuel.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NormForm classes={classOpts} />
          <DipForm tanks={tankOpts} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-4">
        <StatCard label="Unaccounted Fuel" value={`${num(missingL)} L`} sub="across all tanks" accent="rose" icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="Value at Risk" value={inr(missingL * dieselRate, { compact: true })} sub={`@ ₹${dieselRate}/L`} accent="rose" icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Shrinkage" value={`${shrinkagePct.toFixed(2)}%`} sub={`of ${num(throughput)} L throughput`} accent={shrinkagePct > 1 ? "rose" : "emerald"} icon={<Scale className="h-5 w-5" />} />
        <StatCard label="Tanks Needing a Dip" value={num(needDip)} sub={`${criticalCount} critical gap${criticalCount === 1 ? "" : "s"}`} accent="amber" icon={<HelpCircle className="h-5 w-5" />} />
      </div>

      {/* Live reconciliation per tank */}
      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionTitle
            title="Live Tank Check"
            subtitle={`Computed between each tank's first and last dip · tolerance ±${DIP_TOLERANCE_L} L`}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium"><Txt text="Tank" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Period" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Opening Dip" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Received" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Issued" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Expected" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Actual Dip" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Variance" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Status" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Action" /></th>
              </tr>
            </thead>
            <tbody>
              {live.map((r) => (
                <tr key={r.tank.id} className="border-t border-slate-100 align-top hover:bg-brand-50/30">
                  <td className="px-5 py-3">
                    <Link href="/fuel/tanks" className="font-semibold text-brand-700 hover:underline">{r.tank.name}</Link>
                    <p className="text-xs text-slate-400">{r.tank.location}</p>
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-xs text-slate-500">
                    {r.status === "insufficient" ? "—" : <>{fmtDate(r.periodStart)}<br />→ {fmtDate(r.periodEnd)}</>}
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">{num(r.openingDip)} L</td>
                  <td className="px-5 py-3 text-right font-medium text-emerald-600">
                    +{num(r.receiptsL)} L
                    {r.shortDeliveryL > 0 && <p className="text-xs font-normal text-rose-600">short {num(r.shortDeliveryL)} L</p>}
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-brand-700">−{num(r.issuesL)} L</td>
                  <td className="px-5 py-3 text-right font-semibold text-ink-900">{num(r.expectedClosing)} L</td>
                  <td className="px-5 py-3 text-right font-semibold text-ink-900">{r.closingDip == null ? "—" : `${num(r.closingDip)} L`}</td>
                  <td className="px-5 py-3 text-right">
                    {r.status === "insufficient" ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <span className={`font-bold ${r.varianceL < -DIP_TOLERANCE_L ? "text-rose-600" : Math.abs(r.varianceL) <= DIP_TOLERANCE_L ? "text-emerald-600" : "text-amber-600"}`}>
                        {r.varianceL > 0 ? "+" : ""}{num(r.varianceL)} L
                        <span className="block text-xs font-normal text-slate-400">{r.variancePct.toFixed(2)}%</span>
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <Badge color={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    {r.reasons.length > 0 && (
                      <ul className="mt-1.5 max-w-xs list-inside list-disc text-xs text-slate-500">
                        {r.reasons.map((x, i) => <li key={i}>{x}</li>)}
                      </ul>
                    )}
                  </td>
                  <td className="px-5 py-3"><RunReconButton tankId={r.tank.id} tankName={r.tank.name} /></td>
                </tr>
              ))}
              {live.length === 0 && (
                <tr><td colSpan={10} className="px-5 py-10 text-center text-slate-400">
                  No tanks configured. Add one under <Link href="/fuel/tanks" className="text-brand-600 hover:underline">Site Tanks</Link>.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Consumption norms */}
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
              {norms.map((nm) => (
                <tr key={nm.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium text-ink-900">{nm.assetClass ? ASSET_CLASS_LABEL[nm.assetClass] ?? nm.assetClass : "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{nm.unit === "LPH" ? "L / engine-hour" : "km / litre"}</td>
                  <td className="px-5 py-3 text-right font-semibold text-ink-900">{nm.normLow} – {nm.normHigh}</td>
                  <td className="px-5 py-3 text-right text-slate-600">±{nm.tolerancePct}%</td>
                  <td className="px-5 py-3 text-xs text-slate-400">{fmtDate(nm.updatedAt)}</td>
                </tr>
              ))}
              {norms.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">
                  No norms set yet — built-in class benchmarks are used until you define your own.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Saved history */}
      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionTitle title="Past Tank Checks" subtitle="Signed-off periods — the audit trail finance reviews" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium"><Txt text="Run On" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Tank" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Period" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Expected" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Actual" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Variance" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Status" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="By" /></th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                  <td className="px-5 py-3 whitespace-nowrap text-slate-600">{fmtDate(h.createdAt)}</td>
                  <td className="px-5 py-3 font-medium text-ink-900">{h.tank.name}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-xs text-slate-500">{fmtDate(h.periodStart)} → {fmtDate(h.periodEnd)}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{num(h.expectedClosing)} L</td>
                  <td className="px-5 py-3 text-right text-slate-600">{num(h.actualClosing)} L</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`font-bold ${h.varianceL < -DIP_TOLERANCE_L ? "text-rose-600" : Math.abs(h.varianceL) <= DIP_TOLERANCE_L ? "text-emerald-600" : "text-amber-600"}`}>
                      {h.varianceL > 0 ? "+" : ""}{num(h.varianceL)} L
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <Badge color={h.status === "CLOSED" ? STATUS_BADGE.ok : h.status === "ESCALATED" ? STATUS_BADGE.critical : STATUS_BADGE.watch}>{h.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">{h.closedBy ?? "—"}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-400">
                  No reconciliation runs saved yet. Press <strong>Reconcile</strong> on a tank above.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Gaps beyond tolerance are pushed to the{" "}
        <Link href="/fuel/problems" className="font-medium text-brand-600 hover:underline">Fuel Problems</Link> for investigation.
      </div>
    </div>
  );
}
