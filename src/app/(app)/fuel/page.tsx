import { db } from "@/lib/db";
import { fleetUsage } from "@/lib/fleet-usage";
import { StatCard, Card, SectionTitle, Badge, Progress } from "@/components/ui";
import { SimpleBar } from "@/components/charts";
import { FuelEntry, FuelEdit } from "@/components/EntryForms";
import { analyzeFleet } from "@/lib/fuel";
import { getDieselRate } from "@/lib/settings";
import { inr, num, fmtDate, ASSET_CLASS_LABEL, distanceKm } from "@/lib/utils";
import { Fuel, TriangleAlert, Droplets, Gauge, ShieldAlert, IndianRupee, TrendingUp, TrendingDown, MapPin } from "lucide-react";
import Link from "next/link";

import { FuelSubNav } from "@/components/FuelSubNav";
import { businessMonth } from "@/lib/business-time";

export const dynamic = "force-dynamic";

export default async function FuelPage() {
  const [issues, receipts, tanks, assets, projects] = await Promise.all([
    db.fuelTransaction.findMany({ where: { type: "ISSUE" }, include: { asset: true }, orderBy: { date: "asc" } }),
    db.fuelTransaction.findMany({ where: { type: "RECEIPT" } }),
    db.fuelTank.findMany(),
    db.asset.findMany({ orderBy: { code: "asc" } }),
    db.project.findMany({ orderBy: { code: "asc" } }),
  ]);

  const assetOpts = assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.registrationNo ?? a.name}` }));
  const projOpts = projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));

  const fleet = analyzeFleet(
    assets.map((a) => ({ id: a.id, code: a.code, name: a.name, assetClass: a.assetClass, category: a.category, primaryMeter: a.primaryMeter, fuelCapacity: a.fuelCapacity })),
    issues.map((t) => ({ id: t.id, assetId: t.assetId, quantity: t.quantity, meterValue: t.meterValue, rate: t.rate, amount: t.amount, date: t.date, odometerPhoto: t.odometerPhoto, pumpPhoto: t.pumpPhoto, sensorRise: t.sensorRise, anomaly: t.anomaly, captureMethod: t.captureMethod, captureConfidence: t.captureConfidence, variancePct: t.variancePct, geofenceOk: t.geofenceOk, lat: t.lat, lng: t.lng }))
  );

  // Measured from the OEM feed. Manual fuel entries answer "what did we buy";
  // telemetry answers "what actually moved and what actually burned", and the
  // second is available before anyone has typed a single fuel slip.
  const telemetry = await fleetUsage(30);
  const openAnomalies = await db.fuelAnomaly.findMany({
    where: { status: "OPEN" },
    select: { litres: true, valueAtRisk: true, severity: true },
  });
  const anomalyLitres = openAnomalies.reduce((s, a) => s + a.litres, 0);
  const anomalyValue = openAnomalies.reduce((s, a) => s + a.valueAtRisk, 0);
  const highFlagCount = fleet.highFlags.length + openAnomalies.filter((a) => a.severity === "HIGH").length;
  const allFlagCount = fleet.allFlags.length + openAnomalies.length;

  const measuredKm = telemetry.totals.distanceKm > 0 ? telemetry.totals.distanceKm : fleet.totalKm;
  const measuredKmpl = telemetry.totals.avgKmPerL ?? (fleet.avgFleetKmpl || null);
  const usingTelemetry = telemetry.totals.distanceKm > 0;

  // Ranked by measured efficiency when telemetry exists, since fuel slips may
  // not have been entered yet. Vehicles whose telemetry cannot support a fuel
  // figure are left out entirely — "worst mileage, investigate" is a real
  // accusation and thin sampling is not evidence for it.
  const rankable = telemetry.perAsset.filter((a) => a.usage.avgKmPerL != null && !a.usage.insufficientData);
  const telBest = [...rankable].sort((a, b) => b.usage.avgKmPerL! - a.usage.avgKmPerL!).slice(0, 5);
  const telWorst = [...rankable].sort((a, b) => a.usage.avgKmPerL! - b.usage.avgKmPerL!).slice(0, 5);

  const dieselRate = await getDieselRate();
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const recentFills = [...issues].reverse().slice(0, 25);

  const flaggedLitres = fleet.highFlags.reduce((s, f) => s + f.quantity, 0);
  const atRisk = flaggedLitres * 92.5;

  // monthly spend
  const byMonth: Record<string, number> = {};
  for (const t of issues) { const k = businessMonth(new Date(t.date)); byMonth[k] = (byMonth[k] || 0) + t.amount; }
  const spendTrend = Object.entries(byMonth).slice(-6).map(([m, v]) => ({ month: m.slice(2), spend: Math.round(v) }));

  const effColor = (s: string) => s === "good" ? "text-emerald-600" : s === "low" ? "text-rose-600" : s === "high" ? "text-amber-600" : "text-slate-400";

  return (
    <div className="space-y-6">
      <FuelSubNav />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Fuel Management &amp; Mileage</h1>
          <p className="text-sm text-slate-500">Per-vehicle mileage, cost/km, efficiency benchmarks &amp; theft detection</p>
        </div>
        <FuelEntry assets={assetOpts} projects={projOpts} defaultRate={dieselRate} />
      </div>


      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total Diesel Spend" value={inr(fleet.totalSpend, { compact: true })} accent="brand" icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Diesel Issued" value={`${num(fleet.totalLitres)} L`} accent="violet" icon={<Droplets className="h-5 w-5" />} />
        <StatCard label="Avg Fleet Mileage" value={measuredKmpl != null ? `${measuredKmpl.toFixed(2)} km/L` : "—"} sub={usingTelemetry ? "measured from telemetry" : "road vehicles"} accent={telemetry.perAsset.some((a) => a.belowNorm) ? "rose" : "emerald"} icon={<Gauge className="h-5 w-5" />} />
        <StatCard label="Distance Covered" value={`${num(measuredKm)} km`} sub={usingTelemetry ? "odometer delta" : undefined} accent="brand" icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard label="Theft Alerts" value={num(highFlagCount)} sub={`${allFlagCount} total flags`} accent="rose" icon={<ShieldAlert className="h-5 w-5" />} />
        <StatCard label="₹ at Risk" value={inr(atRisk + anomalyValue, { compact: true })} sub={`${num(Math.round((flaggedLitres + anomalyLitres) * 10) / 10)} L flagged`} accent="rose" icon={<TriangleAlert className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle title="Monthly Diesel Spend" subtitle="Last 6 months" />
          <SimpleBar data={spendTrend} dataKey="spend" xKey="month" />
        </Card>
        <Card>
          <SectionTitle title="Site Diesel Tanks" />
          <div className="space-y-4">
            {tanks.length === 0 && <p className="text-sm text-slate-400">No site tanks configured.</p>}
            {tanks.map((t) => {
              const pct = (t.currentLevel / t.capacity) * 100;
              return (
                <div key={t.id}>
                  <div className="mb-1 flex justify-between text-sm"><span className="font-medium text-ink-900">{t.location}</span><span className="text-slate-500">{num(t.currentLevel)}/{num(t.capacity)} L</span></div>
                  <Progress value={pct} />
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Theft / Fraud */}
      {fleet.allFlags.length > 0 && (
        <Card className="border-rose-200 p-0">
          <div className="flex items-center gap-2 p-5 pb-3"><ShieldAlert className="h-5 w-5 text-rose-600" /><SectionTitle title="Fuel Theft &amp; Fraud Detection" subtitle={`${fleet.highFlags.length} high-risk · ${fleet.allFlags.length} total — auto-detected`} /></div>
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
            {fleet.allFlags.slice(0, 40).map((f, i) => (
              <div key={i} className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <Badge color={f.level === "high" ? "bg-rose-100 text-rose-700 ring-rose-600/20" : "bg-amber-100 text-amber-700 ring-amber-600/20"}>{f.level === "high" ? "HIGH" : "Review"}</Badge>
                  <span className="text-sm font-semibold text-ink-900">{f.code}</span>
                  <span className="text-xs text-slate-400">{fmtDate(f.date)} · {num(f.quantity)} L</span>
                </div>
                <ul className="mt-1 list-inside list-disc text-xs text-slate-500">{f.reasons.map((r, j) => <li key={j}>{r}</li>)}</ul>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Efficiency leaderboard */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Best Mileage" action={<TrendingUp className="h-4 w-4 text-emerald-600" />} />
          <div className="space-y-2">
            {fleet.best.map((r) => (
              <div key={r.asset.id} className="flex items-center justify-between text-sm">
                <Link href={`/fleet/${r.asset.id}`} className="font-medium text-brand-700 hover:underline">{r.asset.code}</Link>
                <span className="font-bold text-emerald-600">{r.efficiency!.toFixed(2)} km/L</span>
              </div>
            ))}
            {fleet.best.length === 0 && telBest.map((a) => (
              <div key={a.assetId} className="flex items-center justify-between text-sm">
                <Link href={`/fleet/${a.assetId}`} className="font-medium text-brand-700 hover:underline">{a.code}</Link>
                <span className="font-bold text-emerald-600">{a.usage.avgKmPerL!.toFixed(2)} km/L</span>
              </div>
            ))}
            {fleet.best.length === 0 && telBest.length === 0 && <p className="text-sm text-slate-400">Not enough data yet.</p>}
          </div>
        </Card>
        <Card>
          <SectionTitle title="Worst Mileage — investigate" action={<TrendingDown className="h-4 w-4 text-rose-600" />} />
          <div className="space-y-2">
            {fleet.worst.map((r) => (
              <div key={r.asset.id} className="flex items-center justify-between text-sm">
                <Link href={`/fleet/${r.asset.id}`} className="font-medium text-brand-700 hover:underline">{r.asset.code}</Link>
                <span className="font-bold text-rose-600">{r.efficiency!.toFixed(2)} km/L</span>
              </div>
            ))}
            {fleet.worst.length === 0 && telWorst.map((a) => (
              <div key={a.assetId} className="flex items-center justify-between text-sm">
                <div>
                  <Link href={`/fleet/${a.assetId}`} className="font-medium text-brand-700 hover:underline">{a.code}</Link>
                  {a.norm && <span className="ml-2 text-[11px] text-slate-500">norm {a.norm.low}–{a.norm.high}</span>}
                </div>
                <span className={`font-bold ${a.belowNorm ? "text-rose-600" : "text-slate-700"}`}>{a.usage.avgKmPerL!.toFixed(2)} km/L</span>
              </div>
            ))}
            {fleet.worst.length === 0 && telWorst.length === 0 && <p className="text-sm text-slate-400">Not enough data yet.</p>}
          </div>
        </Card>
      </div>

      {/* Where fuel was filled */}
      <Card className="p-0">
        <div className="flex items-center gap-2 p-5 pb-3"><MapPin className="h-5 w-5 text-brand-600" /><SectionTitle title="Where Fuel Was Filled — Recent Fills" subtitle="Location captured from the driver's phone at fill time" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Vehicle</th>
                <th className="px-5 py-3 font-medium">Litres</th>
                <th className="px-5 py-3 font-medium">Recorded by</th>
                <th className="px-5 py-3 font-medium">Odometer</th>
                <th className="px-5 py-3 font-medium">Rate ₹/L</th>
                <th className="px-5 py-3 font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">Location</th>
                <th className="px-5 py-3 font-medium">Distance from vehicle</th>
                <th className="px-5 py-3 font-medium">Photos</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Edit</th>
              </tr>
            </thead>
            <tbody>
              {recentFills.map((f) => {
                const a = f.assetId ? assetById.get(f.assetId) : null;
                const hasLoc = f.lat != null && f.lng != null;
                const dist = hasLoc && a && (a.lat || a.lng) ? distanceKm(f.lat!, f.lng!, a.lat, a.lng) : null;
                return (
                  <tr key={f.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                    <td className="px-5 py-3 text-slate-600">{fmtDate(f.date)}</td>
                    <td className="px-5 py-3">{a ? <Link href={`/fleet/${a.id}`} className="font-semibold text-brand-700 hover:underline">{a.code}</Link> : "—"}</td>
                    <td className="px-5 py-3 font-medium text-ink-900">{num(f.quantity)} L</td>
                    <td className="px-5 py-3">
                      {f.captureMethod === "SENSOR" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                          Tank sensor
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                          {f.captureMethod === "IMAGE" ? "Gauge photo" : "Entered by hand"}
                          {f.sensorRise > 0 && " · sensor confirmed"}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{f.meterValue ? `${num(f.meterValue)}` : "—"}</td>
                    <td className="px-5 py-3 text-slate-600">₹{f.rate}</td>
                    <td className="px-5 py-3 text-slate-600">{inr(f.amount, { compact: true })}</td>
                    <td className="px-5 py-3">
                      {hasLoc ? <a href={`https://www.google.com/maps?q=${f.lat},${f.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline"><MapPin className="h-3.5 w-3.5" /> View map</a> : <span className="text-slate-300">no GPS</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{dist != null ? `${dist.toFixed(1)} km` : "—"}</td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        {f.odometerPhoto && <a href={f.odometerPhoto} target="_blank" rel="noreferrer"><img src={f.odometerPhoto} alt="odo" className="h-9 w-9 rounded object-cover ring-1 ring-slate-200" /></a>}
                        {f.pumpPhoto && <a href={f.pumpPhoto} target="_blank" rel="noreferrer"><img src={f.pumpPhoto} alt="pump" className="h-9 w-9 rounded object-cover ring-1 ring-slate-200" /></a>}
                        {!f.odometerPhoto && !f.pumpPhoto && <span className="text-slate-300">—</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3">{f.geofenceOk === false ? <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">Outside area</Badge> : <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">OK</Badge>}</td>
                    <td className="px-5 py-3"><FuelEdit txn={{ id: f.id, label: a?.code ?? "fill", quantity: f.quantity, meterValue: f.meterValue, rate: f.rate, date: f.date.toISOString() }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Per-vehicle analytics */}
      <Card className="p-0">
        <div className="p-5 pb-3"><SectionTitle title="Per-Vehicle Fuel Analytics" subtitle="Mileage & cost for every asset that has fuel records" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Vehicle</th>
                <th className="px-5 py-3 font-medium">Class</th>
                <th className="px-5 py-3 font-medium">Fills</th>
                <th className="px-5 py-3 font-medium">Diesel</th>
                <th className="px-5 py-3 font-medium">Distance / Hours</th>
                <th className="px-5 py-3 font-medium">Mileage</th>
                <th className="px-5 py-3 font-medium">Benchmark</th>
                <th className="px-5 py-3 font-medium">Cost/km</th>
                <th className="px-5 py-3 font-medium">Last Fill</th>
                <th className="px-5 py-3 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {fleet.rows.map((r) => (
                <tr key={r.asset.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                  <td className="px-5 py-3"><Link href={`/fleet/${r.asset.id}`} className="font-semibold text-brand-700 hover:underline">{r.asset.code}</Link></td>
                  <td className="px-5 py-3 text-slate-600">{ASSET_CLASS_LABEL[r.asset.assetClass] ?? r.asset.assetClass}</td>
                  <td className="px-5 py-3 text-slate-600">{r.fills}</td>
                  <td className="px-5 py-3 text-slate-600">{num(r.litres)} L</td>
                  <td className="px-5 py-3 text-slate-600">{num(r.travel)} {r.unit === "L/hr" ? "hrs" : "km"}</td>
                  <td className="px-5 py-3"><span className={`font-bold ${effColor(r.status)}`}>{r.efficiency ? `${r.efficiency.toFixed(2)} ${r.unit}` : "—"}</span></td>
                  <td className="px-5 py-3 text-xs text-slate-400">{r.benchHigh > 0 ? `${r.benchLow}–${r.benchHigh} ${r.unit}` : "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{r.costPerUnit && r.unit === "km/L" ? inr(r.costPerUnit) : "—"}</td>
                  <td className="px-5 py-3 text-xs text-slate-400">{r.lastFill ? fmtDate(r.lastFill) : "—"}</td>
                  <td className="px-5 py-3">{r.flags.length ? <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">{r.flags.length}</Badge> : <span className="text-slate-300">—</span>}</td>
                </tr>
              ))}
              {fleet.rows.length === 0 && <tr><td colSpan={10} className="px-5 py-10 text-center text-slate-400">No fuel records yet. Add entries via the driver app or “Add Fuel Entry”.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
