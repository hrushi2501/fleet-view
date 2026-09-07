import { db } from "@/lib/db";
import { Card, SectionTitle, Badge } from "@/components/ui";
import { buildKpis, kpiBand, REPORT_CATALOGUE, type KpiInput } from "@/lib/reporting";
import { assetCompleteness } from "@/lib/master";
import { reliability, pmDue, type WoLite, type ScheduleLite } from "@/lib/maintenance";
import { assetCompliance, type DocLite } from "@/lib/compliance";
import { reconcileTank, type TankLite } from "@/lib/fuel-recon";
import { reconcilePairs, type TicketLite } from "@/lib/weighbridge";
import { inr, num } from "@/lib/utils";
import { ArrowLeft, Download, TrendingUp, TrendingDown, Minus } from "lucide-react";
import Link from "next/link";
import { requirePage, assetScope } from "@/lib/access";
import { Txt } from "@/components/Txt";

export const dynamic = "force-dynamic";

const fmt = (v: number, unit: string) => {
  if (unit === "₹") return inr(v, { compact: true });
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "L/t" || unit === "₹/t") return `${unit === "₹/t" ? "₹" : ""}${v.toFixed(2)}${unit === "L/t" ? " L/t" : "/t"}`;
  return num(v);
};

const BAND: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  watch: "bg-amber-50 text-amber-700 ring-amber-600/20",
  bad: "bg-rose-50 text-rose-700 ring-rose-600/20",
  none: "bg-slate-50 text-slate-600 ring-slate-500/20",
};

/**
 * The one-screen answer to "how is the business doing this month".
 *
 * Was `/reports/executive`, titled "Executive Dashboard" — a name that told the
 * reader who it was for rather than what was on it, and one that quietly
 * discouraged the site managers who most needed the numbers from opening it.
 */
export default async function ManagementSummaryPage() {
  const access = await requirePage("cost.view");
  // Rows, not just the page: a scoped supervisor sees their own sites.
  const visible = assetScope(access);
  const since = new Date(); since.setDate(since.getDate() - 365);

  const [
    assets, fuelAgg, production, tanks, receipts, dips, fuelIssues,
    cases, hireInvoices, wos, schedules, docs, revenues, costTxns, tickets,
  ] = await Promise.all([
    db.asset.findMany({ where: visible }),
    db.fuelTransaction.aggregate({ where: { type: "ISSUE", date: { gte: since } }, _sum: { quantity: true, amount: true } }),
    db.productionLog.aggregate({ where: { date: { gte: since } }, _sum: { tonnage: true, volumeM3: true, workedHours: true, idleHours: true } }),
    db.fuelTank.findMany(),
    db.fuelReceipt.findMany(),
    db.tankDip.findMany(),
    db.fuelTransaction.findMany({ where: { type: "ISSUE", asset: visible } }),
    db.fraudCase.findMany(),
    db.hireInvoice.findMany(),
    db.workOrder.findMany({ where: { reportedAt: { gte: since } } }),
    db.maintenanceSchedule.findMany({ where: { active: true }, include: { asset: true } }),
    db.complianceDoc.findMany(),
    db.projectRevenue.aggregate({ _sum: { amount: true } }),
    db.costTransaction.aggregate({ where: { date: { gte: since } }, _sum: { amount: true } }),
    db.weighbridgeTicket.findMany({ take: 2000, orderBy: { date: "desc" } }),
  ]);

  // Fuel shrinkage across all tanks that have enough dips to reconcile.
  const recons = tanks.map((t) => {
    const lite: TankLite = { id: t.id, name: t.name, location: t.location, capacity: t.capacity, minLevel: t.minLevel };
    return reconcileTank(
      lite,
      receipts.filter((r) => r.tankId === t.id).map((r) => ({ id: r.id, date: r.date, qtyInvoiced: r.qtyInvoiced, qtyReceived: r.qtyReceived, amount: r.amount, supplier: r.supplier, shortfall: r.shortfall })),
      fuelIssues.filter((i) => i.tankId === t.id).map((i) => ({ id: i.id, date: i.date, quantity: i.quantity, assetId: i.assetId, amount: i.amount })),
      dips.filter((d) => d.tankId === t.id).map((d) => ({ id: d.id, date: d.date, level: d.level }))
    );
  }).filter((r) => r.status !== "insufficient");
  const throughput = recons.reduce((s, r) => s + r.throughput, 0);
  const missing = recons.reduce((s, r) => s + Math.max(0, -r.varianceL), 0);

  // Maintenance
  const rel = reliability(wos.map((w): WoLite => ({ id: w.id, type: w.type, status: w.status, totalCost: w.totalCost, downtimeHrs: w.downtimeHrs, reportedAt: w.reportedAt, completedAt: w.completedAt })), 365);
  const pmOverdue = schedules.filter((x) => x.asset).filter((x) => {
    const lite: ScheduleLite = { id: x.id, taskName: x.taskName, intervalKm: x.intervalKm, intervalHours: x.intervalHours, intervalDays: x.intervalDays, lastDoneMeter: x.lastDoneMeter, lastDoneDate: x.lastDoneDate, estimatedCost: x.estimatedCost };
    return pmDue(lite, x.asset!.meterValue, x.asset!.primaryMeter === "SMU").status === "overdue";
  }).length;

  // Compliance
  const docsByAsset = new Map<string, DocLite[]>();
  for (const d of docs) {
    const arr = docsByAsset.get(d.assetId) ?? [];
    arr.push({ id: d.id, docType: d.docType, number: d.number, issueDate: d.issueDate, expiryDate: d.expiryDate, reminderDays: d.reminderDays, documentUrl: d.documentUrl });
    docsByAsset.set(d.assetId, arr);
  }
  const notOperable = assets.filter((a) => !assetCompliance(a.id, a.category, docsByAsset.get(a.id) ?? [], new Date(), a.assetClass).operable).length;

  // Weighbridge
  const pairs = reconcilePairs(tickets.map((x): TicketLite => ({
    id: x.id, ticketNo: x.ticketNo, kind: x.kind, date: x.date, material: x.material, grossKg: x.grossKg,
    tareKg: x.tareKg, netKg: x.netKg, billedKg: x.billedKg, rate: x.rate, amount: x.amount,
    assetId: x.assetId, vendor: x.vendor, pairedTicketNo: x.pairedTicketNo,
  })));
  // Only trips whose load was actually weighed at both ends can measure transit
  // loss. A dispatch with no receipt scores as a 100% shortage inside
  // `reconcilePairs`, which is the right flag for that ticket but ruins the KPI:
  // a week of missing paperwork would read as the fleet losing all its material.
  const matchedPairs = pairs.filter((p) => p.receipt);
  const dispatched = matchedPairs.reduce((s, p) => s + p.dispatch.netKg, 0);
  const shortKg = matchedPairs.reduce((s, p) => s + Math.max(0, p.shortageKg), 0);

  // Master data
  const completeness = assets.length
    ? assets.reduce((s, a) => s + assetCompleteness({
        registrationNo: a.registrationNo, chassisNo: a.chassisNo, engineNo: a.engineNo, make: a.make, model: a.model,
        yearMfg: a.yearMfg, acquisitionCost: a.acquisitionCost, insuredValue: a.insuredValue, meterValue: a.meterValue,
        fuelCapacity: a.fuelCapacity, projectId: a.projectId, driverId: a.driverId,
        commissionedOn: a.commissionedOn, inServiceDate: a.inServiceDate,
      }).score, 0) / assets.length
    : 0;

  const worked = production._sum.workedHours ?? 0;
  const idle = production._sum.idleHours ?? 0;
  const fuelSpend = fuelAgg._sum.amount ?? 0;
  const maintCost = wos.reduce((s, w) => s + w.totalCost, 0);
  const hirePayable = hireInvoices.reduce((s, h) => s + h.payableAmount, 0);
  const totalCost = fuelSpend + maintCost + hirePayable + (costTxns._sum.amount ?? 0);

  const input: KpiInput = {
    fuelLitres: fuelAgg._sum.quantity ?? 0,
    fuelSpend,
    fuelShrinkagePct: throughput > 0 ? (missing / throughput) * 100 : null,
    productionTonnes: production._sum.tonnage ?? 0,
    productionM3: production._sum.volumeM3 ?? 0,
    idlePct: worked + idle > 0 ? (idle / (worked + idle)) * 100 : null,
    totalCost,
    revenue: revenues._sum.amount ?? 0,
    openCases: cases.filter((c) => ["OPEN", "INVESTIGATING", "PENDING_APPROVAL"].includes(c.status)).length,
    atRisk: cases.filter((c) => ["OPEN", "INVESTIGATING", "PENDING_APPROVAL"].includes(c.status)).reduce((s, c) => s + c.amountAtRisk, 0),
    recovered: cases.reduce((s, c) => s + c.amountRecovered, 0),
    overbilled: hireInvoices.reduce((s, h) => s + Math.max(0, h.varianceAmount), 0),
    breakdowns: rel.breakdowns,
    plannedRatio: wos.length > 0 ? rel.plannedRatio : null,
    pmOverdue,
    notOperable,
    assetCount: assets.length,
    activeAssets: assets.filter((a) => a.status === "Active").length,
    dataCompleteness: completeness,
    weighShortagePct: dispatched > 0 ? (shortKg / dispatched) * 100 : null,
  };

  const kpis = buildKpis(input);
  const unavailable = kpis.filter((k) => !k.available);

  return (
    <div className="space-y-6">
      <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Reports
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900"><Txt text="Management Summary" /></h1>
        <p className="text-sm text-slate-500">
          Every module on one page, last 12 months. A dash means the figure cannot be computed yet — not that it is zero.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k) => {
          const band = kpiBand(k);
          const Icon = k.direction === "higher-better" ? TrendingUp : k.direction === "lower-better" ? TrendingDown : Minus;
          return (
            <div key={k.key} className={`rounded-xl p-4 ring-1 ${BAND[band]}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide opacity-70">{k.label}</p>
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-50" />
              </div>
              <p className="mt-1 text-2xl font-bold tracking-tight">
                {k.available ? fmt(k.value, k.unit) : <span className="text-slate-300">—</span>}
              </p>
              <p className="mt-1 text-[11px] leading-snug opacity-70">{k.meaning}</p>
              <div className="mt-2 flex items-center justify-between text-[10px] opacity-60">
                <span className="font-mono">{k.module}</span>
                {k.target != null && k.available && <span>target {fmt(k.target, k.unit)}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {unavailable.length > 0 && (
        <Card className="border-amber-200">
          <SectionTitle title={`${unavailable.length} figures cannot be computed yet`} subtitle="Shown as a dash rather than a misleading zero — here is what each one needs" />
          <ul className="mt-2 space-y-1.5 text-sm">
            {unavailable.map((k) => (
              <li key={k.key} className="flex flex-wrap items-baseline gap-2">
                <Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{k.module}</Badge>
                <span className="font-medium text-ink-900">{k.label}</span>
                <span className="text-slate-500">— {k.meaning}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionTitle title="Export" subtitle="Downloads as a CSV file that opens correctly in Excel" />
        </div>
        <div className="grid gap-2 p-5 pt-0 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3">
          {REPORT_CATALOGUE.map((r) => (
            <a
              key={r.key}
              href={`/api/export/${r.key}`}
              className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 transition-colors hover:bg-brand-50"
            >
              <Download className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <span>
                <span className="block text-sm font-medium text-ink-900">{r.label}</span>
                <span className="block text-xs text-slate-500">{r.description}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{r.module}</span>
              </span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}