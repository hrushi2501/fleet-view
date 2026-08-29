import { db } from "@/lib/db";
import { fleetUsage } from "@/lib/fleet-usage";
import { StatCard, Card, SectionTitle, Badge, HeroStat, MeterRow, Table, Th, Td, Tr } from "@/components/ui";
import { TrendArea, MultiBar } from "@/components/charts";
import { inr, num, timeAgo, ASSET_CLASS_LABEL, SEVERITY_COLOR, healthColor } from "@/lib/utils";
import { Fuel, TriangleAlert, Activity, ShieldAlert, ArrowRight, Gauge, IndianRupee } from "lucide-react";
import Link from "next/link";
import { businessDayShort } from "@/lib/business-time";
import { requirePage, assetScope } from "@/lib/access";
import { MorningActionCenter } from "@/components/MorningActionCenter";

export const dynamic = "force-dynamic";

/** How a status reads on the readiness meter. Anything not listed is idle. */
const DOWN_STATUSES = ["Breakdown", "Under-Maintenance"];

export default async function Dashboard() {
  const access = await requirePage(null);
  // Rows, not just the page: a scoped supervisor sees their own sites.
  const visible = assetScope(access);
  // eslint-disable-next-line react-hooks/purity
  const fuelSince = new Date(Date.now() - 30 * 86_400_000);
  const [
    assets,
    fuelIssues,
    openCritical,
    expiringDocs,
    costs,
    recentAlerts,
    breakdownsCount,
    urgentWorkOrders,
    unmarkedDriversCount,
    dieselSetting,
  ] = await db.$transaction([
    db.asset.findMany({
      where: visible,
      select: {
        id: true,
        code: true,
        name: true,
        assetClass: true,
        status: true,
        acquisitionCost: true,
        utilization: true,
        healthScore: true,
      },
    }),
    db.fuelTransaction.findMany({
      where: { type: "ISSUE", date: { gte: fuelSince }, asset: visible },
      select: { quantity: true, sensorRise: true, date: true },
    }),
    db.alert.count({ where: { status: "Open", severity: "Critical" } }),
    db.complianceDoc.count({ where: { status: { in: ["Expiring", "Expired"] } } }),
    db.costTransaction.findMany({ select: { period: true, costHead: true, amount: true } }),
    db.alert.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, severity: true, title: true, message: true, createdAt: true },
    }),
    db.workOrder.count({ where: { status: { in: ["Open", "In-Progress"] }, type: "BREAKDOWN", asset: visible } }),
    db.workOrder.findMany({
      where: { status: { in: ["Open", "In-Progress"] }, type: "BREAKDOWN", asset: visible },
      take: 4,
      select: {
        id: true,
        woNo: true,
        description: true,
        priority: true,
        asset: { select: { code: true } },
      },
      orderBy: { reportedAt: "desc" },
    }),
    db.driver.count({ where: { status: "Active" } }),
    // The rate an administrator actually set. This page used to hardcode 92.5,
    // so the moment anyone updated the setting the dashboard's rupee figure
    // quietly disagreed with every other screen that priced the same litres.
    db.setting.findUnique({ where: { key: "dieselRate" }, select: { value: true } }),
  ]);

  const configuredRate = Number(dieselSetting?.value);
  const dieselRate = Number.isFinite(configuredRate) && configuredRate > 0 ? configuredRate : 92.5;

  // Measured from OEM telemetry rather than from what anyone typed in.
  const telemetry = await fleetUsage(30);

  const totalAssets = assets.length;
  const activeCount = assets.filter((a) => a.status === "Active").length;
  const downCount = assets.filter((a) => DOWN_STATUSES.includes(a.status)).length;
  const fleetValue = assets.reduce((s, a) => s + a.acquisitionCost, 0);

  // A fleet of zero is a new account, not a fleet averaging zero percent. The
  // previous version divided by the count unguarded and rendered "NaN%".
  const avgUtil = totalAssets ? Math.round(assets.reduce((s, a) => s + a.utilization, 0) / totalAssets) : null;
  const readyPct = totalAssets ? Math.round((activeCount / totalAssets) * 100) : 0;

  // Fuel loss estimate (issued - sensor rise) * rate
  const fuelLossL = fuelIssues.reduce((s, f) => s + Math.max(0, f.quantity - f.sensorRise), 0);
  const fuelLossValue = fuelLossL * dieselRate;
  const totalIssuedL = fuelIssues.reduce((s, f) => s + f.quantity, 0);
  const fuelLossPct = totalIssuedL ? (fuelLossL / totalIssuedL) * 100 : 0;
  const fuelAnomaliesCount = fuelIssues.filter((f) => f.quantity > f.sensorRise + 5).length;

  const actionCenterData = {
    breakdownsCount,
    criticalAlertsCount: openCritical,
    expiringDocsCount: expiringDocs,
    fuelAnomaliesCount,
    unmarkedDriversCount,
    urgentWorkOrders: urgentWorkOrders.map((w) => ({
      id: w.id,
      woNo: w.woNo,
      assetCode: w.asset.code,
      description: w.description,
      priority: w.priority,
    })),
  };

  // Status split, derived from the same scoped rows the header counts. It used
  // to come from its own unscoped `groupBy`, so a supervisor restricted to one
  // site read their own fleet size beside a company-wide status breakdown.
  const statusCounts = assets.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  const statusOrder = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);

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
  const fuelSpark = fuelTrend.map((d) => d.litres);

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
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Dashboard</h1>
          <p className="text-sm text-slate-500">Aaj kya chal raha hai · {num(totalAssets)} vehicles and machines</p>
        </div>
        <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">
          <span className="pulse-dot mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
        </Badge>
      </div>

      {/* What needs somebody this morning, before any of the reporting. */}
      <MorningActionCenter data={actionCenterData} />

      {/* ── Right now ──────────────────────────────────────────────────────
          One figure leads the page. The eight equal tiles that used to sit
          here gave the eye no entry point: fleet value, breakdowns and
          expiring documents were all the same size, so nothing was the
          headline and the reader had to rank them for themselves every time
          they opened the app. */}
      <section className="space-y-4">
        <SectionTitle
          title="Right now"
          subtitle="Machines that can take work today, and what the rest are doing"
        />

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <HeroStat
              label="Ready to work"
              value={totalAssets ? `${num(activeCount)} of ${num(totalAssets)}` : "—"}
              tone={readyPct >= 80 ? "good" : readyPct >= 60 ? "warning" : "critical"}
              sub={
                totalAssets
                  ? `${readyPct}% of the fleet is available. ${num(downCount)} in the workshop or broken down${
                      avgUtil != null ? ` · ${avgUtil}% average utilisation` : ""
                    }.`
                  : "No vehicles or machines on this account yet."
              }
              action={
                <Link
                  href="/fleet"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-ink-800"
                >
                  Open fleet <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
          </div>

          {/* The status split, as a list rather than a donut. Six statuses at
              close values is exactly what a donut cannot be read for — the
              reader ends up estimating from arcs when the counts are right
              there. */}
          <Card>
            <SectionTitle title="Fleet status" subtitle="Live distribution" />
            <div className="space-y-3">
              {statusOrder.length === 0 && <p className="text-sm text-slate-400">Nothing to show yet.</p>}
              {statusOrder.map(([status, count]) => (
                <MeterRow
                  key={status}
                  label={status.replace(/-/g, " ")}
                  value={totalAssets ? (count / totalAssets) * 100 : 0}
                  display={`${num(count)}`}
                  // More broken-down is worse; more active is better. Without
                  // this the meter turns green as breakdowns climb.
                  invert={DOWN_STATUSES.includes(status)}
                />
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* ── Measured from the vehicles ─────────────────────────────────────
          Kept as its own section, and above the keyed-entry figures, because
          these come from the machines and those come from what somebody wrote
          down. Mixing the two in one grid implies they are equally trustworthy. */}
      {telemetry.totals.vehiclesReporting > 0 && (
        <section className="space-y-4">
          <SectionTitle
            title="Measured from the vehicles — last 30 days"
            subtitle={`${telemetry.totals.vehiclesReporting} vehicle${telemetry.totals.vehiclesReporting === 1 ? "" : "s"} reporting · odometer and tank readings straight from the vehicles themselves`}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Distance covered" value={`${num(telemetry.totals.distanceKm)} km`} sub="Odometer delta" accent="brand" icon={<Activity className="h-5 w-5" />} />
            <StatCard
              label="Diesel burned"
              value={telemetry.totals.avgKmPerL != null ? `${num(telemetry.totals.litresBurned)} L` : "—"}
              sub={telemetry.totals.avgKmPerL != null ? `${num(telemetry.totals.litresFilled)} L filled` : "Not measurable from this telemetry"}
              accent="amber"
              icon={<Fuel className="h-5 w-5" />}
            />
            <StatCard
              label="Fleet efficiency"
              value={telemetry.totals.avgKmPerL != null ? `${telemetry.totals.avgKmPerL} km/L` : "—"}
              sub={`Total distance ÷ total burn · ${telemetry.totals.confidence.toLowerCase()} confidence`}
              accent={telemetry.perAsset.some((a) => a.belowNorm) ? "rose" : "emerald"}
              icon={<Gauge className="h-5 w-5" />}
            />
            <StatCard
              label="Unaccounted diesel"
              value={`${num(telemetry.totals.litresUnaccounted)} L`}
              sub={telemetry.totals.litresUnaccounted > 0 ? `${inr(telemetry.totals.valueUnaccounted, { compact: true })} at risk` : "Nothing unexplained"}
              accent={telemetry.totals.litresUnaccounted > 0 ? "rose" : "emerald"}
              icon={<TriangleAlert className="h-5 w-5" />}
            />
          </div>

          {(telemetry.totals.vehiclesWithInsufficientData > 0 || telemetry.totals.worstGapHours > 1) && (
            <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
              {telemetry.totals.vehiclesWithInsufficientData > 0 && (
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Insufficient telemetry data for reliable fuel analysis on{" "}
                  {telemetry.totals.vehiclesWithInsufficientData} of {telemetry.totals.vehiclesReporting} reporting
                  vehicle{telemetry.totals.vehiclesReporting === 1 ? "" : "s"} — those vehicles are excluded from the
                  efficiency figure rather than averaged into it. Open a vehicle to see what its telemetry is missing.
                </p>
              )}
              {telemetry.totals.worstGapHours > 1 && (
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Longest gap between samples in this window: {telemetry.totals.worstGapHours} h. Sparse sampling
                  cannot separate a siphon from a hard shift — treat unaccounted diesel as a prompt to look, not a finding.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Money and paperwork ───────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionTitle
          title="Money and paperwork"
          subtitle={`From entered records · diesel priced at ₹${dieselRate}/L`}
        />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Fleet value"
            value={inr(fleetValue, { compact: true })}
            sub="Acquisition cost"
            accent="violet"
            icon={<IndianRupee className="h-5 w-5" />}
          />
          <StatCard
            label="Fuel loss (30d)"
            value={inr(fuelLossValue, { compact: true })}
            sub={`${fuelLossPct.toFixed(1)}% of ${num(totalIssuedL)} L issued`}
            accent="rose"
            icon={<Fuel className="h-5 w-5" />}
            spark={fuelSpark}
          />
          <StatCard
            label="Critical alerts"
            value={num(openCritical)}
            sub={openCritical > 0 ? "Waiting on somebody" : "Nothing open"}
            accent={openCritical > 0 ? "rose" : "emerald"}
            icon={<TriangleAlert className="h-5 w-5" />}
          />
          <StatCard
            label="Documents expiring"
            value={num(expiringDocs)}
            sub="Insurance · permit · fitness"
            accent={expiringDocs > 0 ? "amber" : "emerald"}
            icon={<ShieldAlert className="h-5 w-5" />}
          />
        </div>
      </section>

      {/* ── Trends ────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionTitle title="Trends" subtitle="Operating cost by head, and diesel going into tanks" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <SectionTitle
              title="Monthly operating cost"
              subtitle="The five largest heads · the rest are grouped, because a ninth colour is indistinguishable from one of the first eight"
            />
            <MultiBar data={costByMonth} keys={heads} xKey="month" format="inrCompact" />
          </Card>
          <Card>
            <SectionTitle
              title="Recent alerts"
              action={
                <Link href="/maintenance/reminders" className="text-xs font-medium text-brand-600 hover:underline">
                  View all
                </Link>
              }
            />
            <div className="space-y-3.5">
              {recentAlerts.length === 0 && <p className="text-sm text-slate-400">Nothing raised recently.</p>}
              {recentAlerts.map((a) => (
                <div key={a.id} className="flex items-start gap-3">
                  <Badge color={SEVERITY_COLOR[a.severity]}>{a.severity}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{a.title}</p>
                    <p className="truncate text-xs text-slate-500">{a.message}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{timeAgo(a.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <SectionTitle title="Diesel issued — last 14 days" subtitle="Litres per day across all sites" />
            <TrendArea data={fuelTrend} dataKey="litres" xKey="day" format="litres" />
          </Card>
          <Card>
            <SectionTitle title="Utilisation by class" subtitle="Average across each class" />
            <div className="space-y-3.5">
              {utilByClass.length === 0 && <p className="text-sm text-slate-400">No classes to compare yet.</p>}
              {utilByClass.map((c) => (
                <MeterRow key={c.name} label={c.name} value={c.util} />
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* ── Attention ─────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <Card>
          <SectionTitle
            title="Needs attention"
            subtitle="Lowest health scores first"
            action={
              <Link href="/fleet" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                Fleet <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Asset</Th>
                <Th>Class</Th>
                <Th>Status</Th>
                <Th numeric>Health</Th>
              </tr>
            </thead>
            <tbody>
              {attention.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <Link href={`/fleet/${a.id}`} className="group inline-block">
                      <p className="font-medium text-ink-900 group-hover:text-brand-600">{a.code}</p>
                      <p className="text-xs text-slate-400">{a.name}</p>
                    </Link>
                  </Td>
                  <Td className="text-slate-600">{ASSET_CLASS_LABEL[a.assetClass] ?? a.assetClass}</Td>
                  <Td>
                    <Badge
                      color={
                        a.status === "Breakdown"
                          ? "bg-rose-100 text-rose-700 ring-rose-600/20"
                          : a.status === "Under-Maintenance"
                            ? "bg-amber-100 text-amber-700 ring-amber-600/20"
                            : "bg-slate-100 text-slate-600 ring-slate-500/20"
                      }
                    >
                      {a.status.replace(/-/g, " ")}
                    </Badge>
                  </Td>
                  <Td numeric>
                    <span className={`font-bold ${healthColor(a.healthScore)}`}>{a.healthScore}</span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {attention.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">Nothing needs attention.</p>
          )}
        </Card>
      </section>
    </div>
  );
}
