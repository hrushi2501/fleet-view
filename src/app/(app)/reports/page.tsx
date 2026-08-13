import { db } from "@/lib/db";
import { Card, SectionTitle, Badge } from "@/components/ui";
import { inr, num } from "@/lib/utils";
import { FileDown, FileText } from "lucide-react";
import { REPORT_CATALOGUE } from "@/lib/reporting";
import { requirePage, assetScope } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const access = await requirePage("reports.view");
  // Rows, not just the page: a scoped supervisor sees their own sites.
  const visible = assetScope(access);
  const [assets, fuelIssues, trips, wos, docs, costs] = await Promise.all([
    db.asset.findMany({ where: visible }),
    db.fuelTransaction.findMany({ where: { type: "ISSUE", asset: visible } }),
    db.trip.findMany(),
    db.workOrder.findMany(),
    db.complianceDoc.findMany(),
    db.costTransaction.findMany(),
  ]);

  const avgUtil = assets.length > 0 ? Math.round(assets.reduce((s, a) => s + a.utilization, 0) / assets.length) : 0;
  const avgHealth = assets.length > 0 ? Math.round(assets.reduce((s, a) => s + a.healthScore, 0) / assets.length) : 0;
  const issuedL = fuelIssues.reduce((s, f) => s + f.quantity, 0);
  const lossL = fuelIssues.reduce((s, f) => s + Math.max(0, f.quantity - f.sensorRise), 0);
  const fuelLossPct = issuedL > 0 ? ((lossL / issuedL) * 100).toFixed(1) : "0.0";
  const totalKm = trips.reduce((s, t) => s + t.distanceKm, 0);
  const totalEngHrs = trips.reduce((s, t) => s + t.engineHours, 0);
  const idleHrs = trips.reduce((s, t) => s + t.idleHours, 0);
  const idlePct = totalEngHrs > 0 ? ((idleHrs / totalEngHrs) * 100).toFixed(1) : "0.0";
  const completed = wos.filter((w) => w.completedAt);
  const mttr = completed.length > 0 ? (completed.reduce((s, w) => s + w.downtimeHrs, 0) / completed.length).toFixed(1) : "0.0";
  const fuelCost = costs.filter((c) => c.costHead === "FUEL").reduce((s, c) => s + c.amount, 0);
  const costPerKm = inr(totalKm ? fuelCost / totalKm : 0);
  const compliancePct = docs.length > 0 ? ((docs.filter((d) => d.status === "Valid").length / docs.length) * 100).toFixed(0) : "0";

  const kpis = [
    { label: "Fleet Utilization", value: `${avgUtil}%`, target: "65–80%", good: avgUtil >= 65 },
    { label: "Idle %", value: `${idlePct}%`, target: "<15%", good: parseFloat(idlePct) < 15 },
    { label: "Asset Health Score", value: `${avgHealth}`, target: ">75", good: avgHealth > 75 },
    { label: "Fuel Loss %", value: `${fuelLossPct}%`, target: "<4%", good: parseFloat(fuelLossPct) < 4 },
    { label: "Cost per KM (fuel)", value: costPerKm, target: "benchmark", good: true },
    { label: "Avg MTTR", value: `${mttr} h`, target: "↓ trend", good: true },
    { label: "Compliance On-time", value: `${compliancePct}%`, target: "100%", good: parseFloat(compliancePct) > 90 },
    { label: "Total Distance (14d)", value: `${num(totalKm)} km`, target: "—", good: true },
    { label: "Engine Hours (14d)", value: `${num(totalEngHrs)} h`, target: "—", good: true },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Reports</h1>
        <p className="text-sm text-slate-500">Live performance measures with their targets, plus every report you can pull</p>
      </div>

      <Card>
        <SectionTitle title="Performance Measures" subtitle="Where each number stands against its target" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-xl border border-slate-100 p-4">
              <p className="text-xs text-slate-500">{k.label}</p>
              <p className="mt-1 text-2xl font-bold text-ink-900">{k.value}</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-xs text-slate-400">Target {k.target}</span>
                <Badge color={k.good ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : "bg-rose-100 text-rose-700 ring-rose-600/20"}>{k.good ? "On track" : "Off target"}</Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle title="Report Library" subtitle="Generate, schedule & export (PDF / Excel)" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {REPORT_CATALOGUE.map((r) => (
            <a
              key={r.key}
              href={`/api/export/${r.key}`}
              className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5 transition-colors hover:border-brand-200 hover:bg-brand-50/30 text-left"
            >
              <div className="flex items-start gap-2">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div>
                  <span className="block text-sm font-semibold text-ink-900">{r.label}</span>
                  <span className="block text-xs text-slate-400">{r.description}</span>
                </div>
              </div>
              <FileDown className="h-4 w-4 shrink-0 text-brand-500" />
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
