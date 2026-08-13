import { db } from "@/lib/db";
import { fleetUsage } from "@/lib/fleet-usage";
import { StatCard, Card, SectionTitle, Badge, Progress } from "@/components/ui";
import { TrendArea, MultiBar, Donut } from "@/components/charts";
import { inr, num, timeAgo, ASSET_CLASS_LABEL, SEVERITY_COLOR, healthColor } from "@/lib/utils";
import { Truck, Fuel, TriangleAlert, Activity, Wrench, ShieldAlert, ArrowRight } from "lucide-react";
import Link from "next/link";
import { businessDayShort } from "@/lib/business-time";
import { requirePage } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requirePage(null);
  const [assets, statusGroups, fuelIssues, openCritical, expiringDocs, costs, recentAlerts] = await Promise.all([
    db.asset.findMany(),
    db.asset.groupBy({ by: ["status"], _count: true }),
    db.fuelTransaction.findMany({ where: { type: "ISSUE" } }),
    db.alert.count({ where: { status: "Open", severity: "Critical" } }),
    db.complianceDoc.count({ where: { status: { in: ["Expiring", "Expired"] } } }),
    db.costTransaction.findMany(),
    db.alert.findMany({ orderBy: { createdAt: "desc" }, take: 6, include: { asset: true } }),
  ]);

  // Measured from OEM telemetry rather than from what anyone typed in.
  const telemetry = await fleetUsage(30);

  const totalAssets = assets.length;
  const activeCount = assets.filter((a) => a.status === "Active").length;
  const fleetValue = assets.reduce((s, a) => s + a.acquisitionCost, 0);
  const avgUtil = Math.round(assets.reduce((s, a) => s + a.utilization, 0) / totalAssets);

  // Fuel loss estimate (issued - sensor rise) * rate
  const fuelLossL = fuelIssues.reduce((s, f) => s + Math.max(0, f.quantity - f.sensorRise), 0);
  const fuelLossValue = fuelLossL * 92.5;
  const totalIssuedL = fuelIssues.reduce((s, f) => s + f.quantity, 0);
  const fuelLossPct = totalIssuedL ? (fuelLossL / totalIssuedL) * 100 : 0;

  // Status donut
  const statusData = statusGroups.map((g) => ({ name: g.status, value: g._count }));

  // Cost by month & head
  const months = [...new Set(costs.map((c) => c.period))].sort();
  const heads = ["FUEL", "MAINTENANCE", "OPERATOR", "DEPRECIATION", "HIRE", "EMI", "INSURANCE", "TYRE", "TOLL"];
  const costByMonth = months.map((m) => {
    const row: Record<string, number | string> = { month: m.slice(2) };
    for (const h of heads) {
      row[h] = costs.filter((c) => c.period === m && c.costHead === h).reduce((s, c) => s + c.amount, 0);
    }
    return row;
  });

  // Fuel issued last 14 days
  const fuelByDay: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
  // eslint-disable-next-line react-hooks/purity
    const d = businessDayShort(new Date(Date.now() - i * 86400000));
    fuelByDay[d] = 0;
  }
  for (const f of fuelIssues) {
    const k = businessDayShort(new Date(f.date));
    if (k in fuelByDay) fuelByDay[k] += f.quantity;
  }
  const fuelTrend = Object.entries(fuelByDay).map(([day, litres]) => ({ day, litres: Math.round(litres) }));

  // Utilization by class
  const classMap: Record<string, { sum: number; n: number }> = {};
  for (const a of assets) {
    classMap[a.assetClass] = classMap[a.assetClass] || { sum: 0, n: 0 };
    classMap[a.assetClass].sum += a.utilization;
    classMap[a.assetClass].n++;
  }
  const utilByClass = Object.entries(classMap)
    .map(([c, v]) => ({ name: ASSET_CLASS_LABEL[c] ?? c, util: Math.round(v.sum / v.n) }))
    .sort((a, b) => b.util - a.util);

  const attention = [...assets].sort((a, b) => a.healthScore - b.healthScore).slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Dashboard</h1>
          <p className="text-sm text-slate-500">Aaj kya chal raha hai · {num(totalAssets)} vehicles and machines</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">
            <span className="pulse-dot mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Fleet" value={num(totalAssets)} sub={`${activeCount} active now`} accent="brand" icon={<Truck className="h-5 w-5" />} />
        <StatCard label="Fleet Value" value={inr(fleetValue, { compact: true })} sub="Acquisition cost" accent="violet" icon={<Activity className="h-5 w-5" />} />
        <StatCard
          label="Fuel Loss (30d)"
          value={inr(fuelLossValue, { compact: true })}
          sub={`${fuelLossPct.toFixed(1)}% · ${num(fuelLossL)} L`}
          accent="rose"
          icon={<Fuel className="h-5 w-5" />}
          trend={{ dir: "down", value: "Detection active", good: true }}
        />
        <StatCard label="Avg Utilization" value={`${avgUtil}%`} sub="Across all classes" accent="emerald" icon={<Activity className="h-5 w-5" />} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Critical Alerts" value={num(openCritical)} sub="Needs action" accent="rose" icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="Docs Expiring" value={num(expiringDocs)} sub="Insurance / permit / fitness" accent="amber" icon={<ShieldAlert className="h-5 w-5" />} />
        <StatCard label="Under Maintenance" value={num(statusGroups.find((s) => s.status === "Under-Maintenance")?._count ?? 0)} sub="In workshop" accent="brand" icon={<Wrench className="h-5 w-5" />} />
        <StatCard label="Breakdowns" value={num(statusGroups.find((s) => s.status === "Breakdown")?._count ?? 0)} sub="Down now" accent="rose" icon={<TriangleAlert className="h-5 w-5" />} />
      </div>

      {telemetry.totals.vehiclesReporting > 0 && (
        <section className="mt-6">
          <SectionTitle
            title="Measured from the Vehicles — Last 30 Days"
            subtitle={`${telemetry.totals.vehiclesReporting} vehicle${telemetry.totals.vehiclesReporting === 1 ? "" : "s"} reporting · odometer and tank readings straight from the vehicles themselves`}
          />
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Distance Covered" value={`${num(telemetry.totals.distanceKm)} km`} sub="Odometer delta" accent="brand" icon={<Activity className="h-5 w-5" />} />
            <StatCard
              label="Diesel Burned"
              value={telemetry.totals.avgKmPerL != null ? `${num(telemetry.totals.litresBurned)} L` : "—"}
              sub={telemetry.totals.avgKmPerL != null ? `${num(telemetry.totals.litresFilled)} L filled` : "Not measurable from this telemetry"}
              accent="amber"
              icon={<Fuel className="h-5 w-5" />}
            />
            <StatCard
              label="Fleet Efficiency"
              value={telemetry.totals.avgKmPerL != null ? `${telemetry.totals.avgKmPerL} km/L` : "—"}
              sub={`Total distance ÷ total burn · ${telemetry.totals.confidence.toLowerCase()} confidence`}
              accent={telemetry.perAsset.some((a) => a.belowNorm) ? "rose" : "emerald"}
              icon={<Activity className="h-5 w-5" />}
            />
            <StatCard
              label="Unaccounted Diesel"
              value={`${num(telemetry.totals.litresUnaccounted)} L`}
              sub={telemetry.totals.litresUnaccounted > 0 ? `${inr(telemetry.totals.valueUnaccounted, { compact: true })} at risk` : "Nothing unexplained"}
              accent={telemetry.totals.litresUnaccounted > 0 ? "rose" : "emerald"}
              icon={<TriangleAlert className="h-5 w-5" />}
            />
          </div>
          {telemetry.totals.vehiclesWithInsufficientData > 0 && (
            <p className="mt-2 text-[11px] text-slate-500">
              Insufficient telemetry data for reliable fuel analysis on{" "}
              {telemetry.totals.vehiclesWithInsufficientData} of {telemetry.totals.vehiclesReporting} reporting
              vehicle{telemetry.totals.vehiclesReporting === 1 ? "" : "s"} — those vehicles are excluded from the
              efficiency figure rather than averaged into it. Open a vehicle to see what its telemetry is missing.
            </p>
          )}
          {telemetry.totals.worstGapHours > 1 && (
            <p className="mt-2 text-[11px] text-slate-500">
              Longest gap between samples in this window: {telemetry.totals.worstGapHours} h. Sparse sampling
              cannot separate a siphon from a hard shift — treat unaccounted diesel as a prompt to look, not a finding.
            </p>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle title="Monthly Operating Cost by Head" subtitle="Last 6 months · all cost heads" />
          <MultiBar data={costByMonth} keys={heads} xKey="month" />
        </Card>
        <Card>
          <SectionTitle title="Fleet Status" subtitle="Live distribution" />
          <Donut data={statusData} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle title="Diesel Issued — Last 14 Days" subtitle="Litres per day across all sites" />
          <TrendArea data={fuelTrend} dataKey="litres" xKey="day" />
        </Card>
        <Card>
          <SectionTitle title="Recent Alerts" action={<Link href="/maintenance/reminders" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>} />
          <div className="space-y-3">
            {recentAlerts.map((a) => (
              <div key={a.id} className="flex items-start gap-3">
                <Badge color={SEVERITY_COLOR[a.severity]}>{a.severity}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">{a.title}</p>
                  <p className="truncate text-xs text-slate-500">{a.message}</p>
                  <p className="text-[11px] text-slate-400">{timeAgo(a.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle title="Assets Needing Attention" subtitle="Lowest health scores" action={<Link href="/fleet" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">Fleet <ArrowRight className="h-3 w-3" /></Link>} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="py-2 font-medium">Asset</th>
                  <th className="py-2 font-medium">Class</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Health</th>
                </tr>
              </thead>
              <tbody>
                {attention.map((a) => (
                  <tr key={a.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5">
                      <p className="font-medium text-ink-900">{a.code}</p>
                      <p className="text-xs text-slate-400">{a.name}</p>
                    </td>
                    <td className="py-2.5 text-slate-600">{ASSET_CLASS_LABEL[a.assetClass]}</td>
                    <td className="py-2.5">
                      <Badge color={a.status === "Breakdown" ? "bg-rose-100 text-rose-700 ring-rose-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20"}>{a.status}</Badge>
                    </td>
                    <td className="py-2.5">
                      <span className={`font-bold ${healthColor(a.healthScore)}`}>{a.healthScore}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <SectionTitle title="Utilization by Class" />
          <div className="space-y-3">
            {utilByClass.map((c) => (
              <div key={c.name}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-medium text-slate-700">{c.name}</span>
                  <span className="text-slate-500">{c.util}%</span>
                </div>
                <Progress value={c.util} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
