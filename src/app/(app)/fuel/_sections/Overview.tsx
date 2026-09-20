import { db } from "@/lib/db";
import { fleetUsage } from "@/lib/fleet-usage";
import { StatCard, Card, SectionTitle, Badge, Progress } from "@/components/ui";
import { SimpleBar } from "@/components/charts";
import { FuelEntry, FuelEdit, FuelRateSetter } from "@/components/EntryForms";
import { analyzeFleet } from "@/lib/fuel";
import { getFuelRates, normalizeFuelType } from "@/lib/settings";
import { inr, num, fmtDate, ASSET_CLASS_LABEL, distanceKm } from "@/lib/utils";
import { Fuel, TriangleAlert, Droplets, Gauge, ShieldAlert, IndianRupee, TrendingUp, TrendingDown, MapPin, CalendarDays } from "lucide-react";
import Link from "next/link";

import { businessMonth } from "@/lib/business-time";
import { assetScope, projectScope, type Access } from "@/lib/access";
import { getDetectedFills } from "@/lib/fuel-fill-reconcile";
import { dailyFillsByVehicle } from "@/lib/fuel-daily-fills";
import { fuelHeadline } from "@/lib/fuel-headline";
import { lastTheftScan } from "@/lib/theft-scan-status";
import { Txt } from "@/components/Txt";
import { fuelAnomalyScope, recordScope } from "@/lib/record-access";

/**
 * Diesel in, diesel out, and what it bought — the module's front page.
 *
 * Formerly `/fuel` on its own; `/fuel/summary` (the timestamped record of every
 * fill) is now the second tab rather than a separate route, because "how much
 * are we burning" and "show me the actual fills" are the same conversation two
 * minutes apart.
 */
export async function Overview({ access }: { access: Access }) {
  // Rows, not just the page: a scoped supervisor sees their own sites.
  const visible = assetScope(access);
  const fuelRatesPromise = getFuelRates();
  // Keep interactive navigation on a bounded live window. The telemetry table
  // currently receives roughly 12,000 rows per day; scanning 14-30 days here
  // made a cold Fuel request process 175k-200k rows and exceed the production
  // function timeout. Historical incidents remain available from the persisted
  // anomaly records and nightly theft scan below.
  const liveWindowDays = 1;
  const detectedPromise = fuelRatesPromise.then((rates) => getDetectedFills(visible, rates, liveWindowDays));
  const dailyPromise = fuelRatesPromise.then((rates) =>
    dailyFillsByVehicle(visible, rates, liveWindowDays, detectedPromise),
  );
  const anomalyPromise = fuelAnomalyScope(access).then((scope) =>
    db.fuelAnomaly.findMany({
      where: { status: "OPEN", ...scope },
      select: { litres: true, valueAtRisk: true, severity: true },
    }),
  );

  // Start every independent read together. The old page completed the first
  // batch and then waited through telemetry, anomalies, settings, two complete
  // fill scans, the daily roll-up and scan status in sequence. On a remote
  // transaction pooler, those waits accumulated into several seconds.
  const [issues, tanks, assets, projects, norms, telemetry, openAnomalies, fuelRates, detectedLive, daily, scan] =
    await Promise.all([
      db.fuelTransaction.findMany({
        where: { type: "ISSUE", asset: visible },
        include: { session: { select: { driver: { select: { name: true, empCode: true } } } } },
        orderBy: { date: "asc" },
      }),
      db.fuelTank.findMany({ where: recordScope("fuelTank", access) }),
      db.asset.findMany({ where: visible, orderBy: { code: "asc" } }),
      db.project.findMany({ where: projectScope(access), orderBy: { code: "asc" } }),
      db.consumptionNorm.findMany(),
      fleetUsage(liveWindowDays, visible),
      anomalyPromise,
      fuelRatesPromise,
      detectedPromise,
      dailyPromise,
      lastTheftScan(),
    ]);

  const assetOpts = assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.registrationNo ?? a.name}`, fuelType: normalizeFuelType(a.fuelType) }));
  const projOpts = projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));

  const fleet = analyzeFleet(
    assets.map((a) => ({ id: a.id, code: a.code, name: a.name, assetClass: a.assetClass, category: a.category, primaryMeter: a.primaryMeter, fuelCapacity: a.fuelCapacity })),
    issues.map((t) => ({ id: t.id, assetId: t.assetId, quantity: t.quantity, meterValue: t.meterValue, rate: t.rate, amount: t.amount, date: t.date, odometerPhoto: t.odometerPhoto, pumpPhoto: t.pumpPhoto, sensorRise: t.sensorRise, anomaly: t.anomaly, captureMethod: t.captureMethod, captureConfidence: t.captureConfidence, variancePct: t.variancePct, geofenceOk: t.geofenceOk, lat: t.lat, lng: t.lng })),
    norms,
  );

  // Measured from the OEM feed. Manual fuel entries answer "what did we buy";
  // telemetry answers "what actually moved and what actually burned", and the
  // second is available before anyone has typed a single fuel slip.
  const anomalyLitres = openAnomalies.reduce((s, a) => s + a.litres, 0);
  const anomalyValue = openAnomalies.reduce((s, a) => s + a.valueAtRisk, 0);
  const highFlagCount = fleet.highFlags.length + openAnomalies.filter((a) => a.severity === "HIGH").length;
  const allFlagCount = fleet.allFlags.length + openAnomalies.length;

  // Mileage is an OEM-only operational KPI.  Do not silently fall back to
  // manual slips, parked assets, or equipment: an unavailable number is more
  // honest than a plausible-looking mixed-fleet average.
  const measuredKm = telemetry.totals.distanceKm;
  const measuredKmpl = telemetry.totals.avgKmPerL;
  const usingTelemetry = telemetry.totals.activeVehicles > 0;
  const measuredLitres = telemetry.totals.litresBurned;
  const mileageEquation = measuredKmpl != null
    ? `${num(measuredKm)} km ÷ ${num(measuredLitres)} L · ${telemetry.totals.activeVehicles} vehicle${telemetry.totals.activeVehicles === 1 ? "" : "s"}`
    : "no active Tata vehicle with usable mileage";

  // Ranked by measured efficiency when telemetry exists, since fuel slips may
  // not have been entered yet. Vehicles whose telemetry cannot support a fuel
  // figure are left out entirely — "worst mileage, investigate" is a real
  // accusation and thin sampling is not evidence for it.
  const rankable = telemetry.perAsset.filter((a) => a.usage.avgKmPerL != null && !a.usage.insufficientData);
  const telBest = [...rankable].sort((a, b) => b.usage.avgKmPerL! - a.usage.avgKmPerL!).slice(0, 5);
  const telWorst = [...rankable].sort((a, b) => a.usage.avgKmPerL! - b.usage.avgKmPerL!).slice(0, 5);

  // Fuel the tank saw arrive with no entry behind it. Kept separate from the
  // theft figures on purpose: an unlogged fill is usually a receipt not yet
  // entered, and folding it into "at risk" would call ordinary paperwork lag a
  // loss. But it cannot sit only on the other tab either — this page reported
  // "Theft Alerts 0 · ₹0 at risk" while ₹21.7 K of diesel stood unaccounted one
  // click away, which reads as all-clear.
  const liveWindowStart = new Date();
  liveWindowStart.setDate(liveWindowStart.getDate() - liveWindowDays);
  const detectedFills = detectedLive.fills.filter((fill) => fill.at >= liveWindowStart);
  const unreliableSenders = detectedLive.unreliable;

  // Filling, day by day, across every vehicle rather than only the ones with
  // paperwork. The per-vehicle table further down is built from
  // `FuelTransaction` and so is blank for eleven trucks whose sender watched
  // the diesel go in.
  // Whether anything is actually watching for theft, so an empty list of
  // findings cannot be mistaken for a clean fleet.
  const unloggedFills = detectedFills.filter((f) => !f.logged);
  const unloggedLitres = unloggedFills.reduce((s, f) => s + f.litresAdded, 0);
  const allUnloggedPriced = unloggedFills.every((fill) => fill.estimatedValue != null);
  const unloggedValue = unloggedFills.reduce((s, f) => s + (f.estimatedValue ?? 0), 0);
  const headline = fuelHeadline(
    { litres: fleet.totalLitres, spend: fleet.totalSpend, entries: issues.length },
    { litres: unloggedLitres, fills: unloggedFills.length },
  );
  const detectionIncomplete = unreliableSenders.length > 0;
  const noRecordedFlagsButUnassessed = allFlagCount === 0 && scan.stale;
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const issueAmountById = new Map(issues.map((issue) => [issue.id, issue.amount]));
  const recentFills = [...issues].reverse().slice(0, 25);

  const flaggedLitres = fleet.highFlags.reduce((s, f) => s + f.quantity, 0);
  // A recorded fill already has its actual historical amount. Repricing every
  // old flag at today's diesel rate would invent a value that was never paid.
  const atRisk = fleet.highFlags.reduce((total, flag) => total + (issueAmountById.get(flag.entryId) ?? 0), 0);

  // monthly spend
  const byMonth: Record<string, number> = {};
  for (const t of issues) { const k = businessMonth(new Date(t.date)); byMonth[k] = (byMonth[k] || 0) + t.amount; }
  const spendTrend = Object.entries(byMonth).slice(-6).map(([m, v]) => ({ month: m.slice(2), spend: Math.round(v) }));

  const effColor = (s: string) => s === "good" ? "text-emerald-600" : s === "low" ? "text-rose-600" : s === "high" ? "text-amber-600" : "text-slate-400";

  return (
    <div className="space-y-6">

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Fuel Use &amp; Mileage</h2>
          <p className="text-sm text-slate-500"><Txt text="Mileage and cost per km for each vehicle, and fills that look wrong" /></p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {access.can("admin.settings") ? <FuelRateSetter current={fuelRates} /> : null}
          <FuelEntry assets={assetOpts} projects={projOpts} fuelRates={fuelRates} />
        </div>
      </div>


      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6">
        {/* The two ledger cards stay recorded-only. A sender observation remains
            visible below as an operational lead, but it cannot alter litres or
            rupees until someone confirms the fill and records the paperwork. */}
        <StatCard
          label="Total Recorded Fuel Spend"
          value={inr(headline.recorded.spend, { compact: true })}
          sub={headline.sensorOnly.litres > 0 ? `all recorded history · ${num(headline.sensorOnly.litres)} L sensor-only excluded` : "all recorded history"}
          accent="brand"
          icon={<IndianRupee className="h-5 w-5" />}
        />
        <StatCard
          label="Recorded Fuel Issued"
          value={`${num(headline.recorded.litres)} L`}
          sub={
            headline.sensorOnly.litres > 0
              ? `${num(headline.sensorOnly.litres)} L sensor-only shown separately`
              : `${headline.recorded.entries} recorded ${headline.recorded.entries === 1 ? "entry" : "entries"}`
          }
          accent="violet"
          icon={<Droplets className="h-5 w-5" />}
        />
        <StatCard label="Avg Fleet Mileage" value={measuredKmpl != null ? `${measuredKmpl.toFixed(2)} km/L` : "—"} sub={mileageEquation} accent={telemetry.perAsset.some((a) => a.belowNorm) ? "rose" : "emerald"} icon={<Gauge className="h-5 w-5" />} />
        <StatCard label="Distance Covered" value={usingTelemetry ? `${num(measuredKm)} km` : "—"} sub={usingTelemetry ? `${telemetry.totals.activeVehicles} eligible Tata vehicle${telemetry.totals.activeVehicles === 1 ? "" : "s"} · last 24 hours` : "not inferred from manual entries"} accent="brand" icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard label="Theft Alerts" value={noRecordedFlagsButUnassessed ? "—" : num(highFlagCount)} sub={noRecordedFlagsButUnassessed ? "not assessed; nightly check overdue" : `${allFlagCount} total recorded flags · historical`} accent={noRecordedFlagsButUnassessed ? "amber" : highFlagCount > 0 ? "rose" : "emerald"} icon={<ShieldAlert className="h-5 w-5" />} />
        <StatCard label="₹ at Risk" value={noRecordedFlagsButUnassessed ? "—" : inr(atRisk + anomalyValue, { compact: true })} sub={noRecordedFlagsButUnassessed ? "not assessed; no current check" : `${num(Math.round((flaggedLitres + anomalyLitres) * 10) / 10)} L · recorded transaction and anomaly values`} accent={noRecordedFlagsButUnassessed ? "amber" : atRisk + anomalyValue > 0 ? "rose" : "emerald"} icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard
          label="Unlogged Fills"
          value={unloggedFills.length === 0 && detectionIncomplete ? "—" : unloggedFills.length === 0 ? "0" : allUnloggedPriced ? inr(unloggedValue, { compact: true }) : "Rate needed"}
          sub={
            unreliableSenders.length > 0
              // Say so on the tile itself. A quietly reduced count reads as
              // "nothing to see", and the excluded vehicle is the one that
              // needs a fitter.
              ? `${unloggedFills.length === 0 ? "not assessed across all vehicles" : `${num(unloggedLitres)} L · ${unloggedFills.length} fill${unloggedFills.length === 1 ? "" : "s"}`} · ${unreliableSenders.length} sender${unreliableSenders.length === 1 ? "" : "s"} excluded`
              : unloggedFills.length === 0
                ? "all fills have an entry"
                : `${num(unloggedLitres)} L · ${unloggedFills.length} fill${unloggedFills.length === 1 ? "" : "s"}, last 24 hours`
          }
          accent={unloggedFills.length === 0 && !detectionIncomplete ? "emerald" : "amber"}
          icon={<Fuel className="h-5 w-5" />}
        />
      </div>

      <Card className="border-brand-200 bg-brand-50/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink-900">How fleet mileage is calculated</p>
            {measuredKmpl != null ? (
              <p className="mt-1 text-sm text-slate-600">
                <span className="font-semibold text-ink-900">{num(measuredKm)} km</span> measured distance ÷{" "}
                <span className="font-semibold text-ink-900">{num(measuredLitres)} L</span> measured fuel burned ={" "}
                <span className="font-semibold text-emerald-700">{measuredKmpl.toFixed(2)} km/L</span> over the last 24 hours.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-600">No Tata road vehicle has a complete, credible distance-and-fuel window in the last 24 hours.</p>
            )}
          </div>
          <Link href="/fleet/trips" className="text-sm font-semibold text-brand-700 hover:underline">View vehicle-by-vehicle calculation</Link>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          {telemetry.totals.activeVehicles} of {telemetry.totals.vehiclesReporting} reporting Tata vehicle{telemetry.totals.vehiclesReporting === 1 ? "" : "s"} included · {telemetry.totals.confidence.toLowerCase()} confidence
          {telemetry.totals.vehiclesWithInsufficientData > 0 ? ` · ${telemetry.totals.vehiclesWithInsufficientData} excluded because their telemetry could not support a reliable fuel figure` : ""}.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle title="Monthly Fuel Spend" subtitle="Last 6 months" />
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

      {/* Is anything actually watching? */}
      <Card
        className={
          "flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm " +
          (scan.stale ? "border-amber-300 bg-amber-50" : "")
        }
      >
        <ShieldAlert className={"h-4 w-4 " + (scan.stale ? "text-amber-600" : "text-emerald-600")} />
        {scan.neverRun ? (
          <span className="font-medium text-amber-900">
            The nightly fuel-theft check has not run yet. Nothing is watching for theft.
          </span>
        ) : scan.stale ? (
          <span className="font-medium text-amber-900">
            Last fuel-theft check was {scan.hoursAgo} hours ago — it should run every night. Please tell
            support, because no one is watching for theft right now.
          </span>
        ) : (
          <span className="text-slate-600">
            Fuel-theft check last ran <span className="font-medium text-ink-900">{fmtDate(scan.lastRunAt!)}</span>
            {scan.scanned != null ? ` · ${scan.scanned} vehicles checked` : ""}
            {scan.raised === 0 ? " · nothing found" : scan.raised != null ? ` · ${scan.raised} raised` : ""}
          </span>
        )}
      </Card>

      {/* Theft / Fraud */}
      {fleet.allFlags.length > 0 && (
        <Card className="border-rose-200 p-0">
          <div className="flex items-center gap-2 p-5 pb-3"><ShieldAlert className="h-5 w-5 text-rose-600" /><SectionTitle title="Fuel Theft Checks" subtitle={`${fleet.highFlags.length} need urgent checking · ${fleet.allFlags.length} found in total`} /></div>
          <div className="max-h-96 overflow-x-auto overflow-y-auto divide-y divide-slate-50">
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
          <SectionTitle title="Best Measured Mileage" subtitle="Eligible Tata vehicles · last 24 hours" action={<TrendingUp className="h-4 w-4 text-emerald-600" />} />
          <div className="space-y-2">
            {telBest.map((a) => (
              <div key={a.assetId} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <Link href={`/fleet/${a.assetId}`} className="font-medium text-brand-700 hover:underline">{a.code}</Link>
                <span className="font-bold text-emerald-600">{a.usage.avgKmPerL!.toFixed(2)} km/L</span>
              </div>
            ))}
            {telBest.length === 0 && <p className="text-sm text-slate-400">Not enough measured data in the last 24 hours.</p>}
          </div>
        </Card>
        <Card>
          <SectionTitle title="Lowest Measured Mileage" subtitle="Eligible Tata vehicles · last 24 hours" action={<TrendingDown className="h-4 w-4 text-rose-600" />} />
          <div className="space-y-2">
            {telWorst.map((a) => (
              <div key={a.assetId} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div>
                  <Link href={`/fleet/${a.assetId}`} className="font-medium text-brand-700 hover:underline">{a.code}</Link>
                  {a.norm && <span className="ml-2 text-[11px] text-slate-500">norm {a.norm.low}–{a.norm.high}</span>}
                </div>
                <span className={`font-bold ${a.belowNorm ? "text-rose-600" : "text-slate-700"}`}>{a.usage.avgKmPerL!.toFixed(2)} km/L</span>
              </div>
            ))}
            {telWorst.length === 0 && <p className="text-sm text-slate-400">Not enough measured data in the last 24 hours.</p>}
          </div>
        </Card>
      </div>

      {/* Where fuel was filled */}
      <Card className="p-0">
        <div className="flex items-center gap-2 p-5 pb-3"><MapPin className="h-5 w-5 text-brand-600" /><SectionTitle title="Where Fuel Was Filled" subtitle="Place taken from the driver's phone when filling" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium"><Txt text="Date" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Vehicle" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Litres" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Driver / source" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Odometer" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Rate ₹/L" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Amount" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Location" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Distance from vehicle" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Photos" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Status" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Edit" /></th>
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
                      {f.session?.driver ? (
                        <span className="inline-flex flex-col rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
                          <span>{f.session.driver.name}</span>
                          <span className="text-brand-500">{f.session.driver.empCode} · active claim</span>
                        </span>
                      ) : f.issuedBy ? (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">{f.issuedBy}</span>
                      ) : f.captureMethod === "SENSOR" ? (
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
                        {f.afterOdometerPhoto && <a href={f.afterOdometerPhoto} target="_blank" rel="noreferrer"><img src={f.afterOdometerPhoto} alt="dashboard after fuelling" className="h-9 w-9 rounded object-cover ring-1 ring-slate-200" /></a>}
                        {!f.odometerPhoto && !f.pumpPhoto && !f.afterOdometerPhoto && <span className="text-slate-300">—</span>}
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

      {/* Filled per day, every vehicle */}
      <Card className="p-0">
        <div className="flex items-center gap-2 p-5 pb-3">
          <CalendarDays className="h-5 w-5 text-brand-600" />
          <SectionTitle
            title="Fuel Filled Today — All Vehicles"
            subtitle="Last 24 hours — from the fuel sensor and from fills entered by hand"
          />
        </div>

        {daily.days.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-500">No fills recorded in the last 24 hours.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-slate-100 px-5 py-3 text-sm">
              <span className="text-slate-500">
                Total <span className="font-semibold text-ink-900">{num(daily.totals.litres)} L</span>
              </span>
              <span className="text-slate-500">
                Across <span className="font-semibold text-ink-900">{daily.totals.vehicles}</span> vehicles
              </span>
              <span className="text-slate-500">
                Logged <span className="font-semibold text-ink-900">{num(daily.totals.loggedLitres)} L</span>
              </span>
              <span className="text-slate-500">
                From sensor only <span className="font-semibold text-ink-900">{num(daily.totals.sensorLitres)} L</span>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium"><Txt text="Day" /></th>
                    <th className="px-5 py-3 font-medium"><Txt text="Total" /></th>
                    <th className="px-5 py-3 font-medium"><Txt text="Which vehicles, and how much" /></th>
                    <th className="px-5 py-3 font-medium"><Txt text="Approx. Cost" /></th>
                  </tr>
                </thead>
                <tbody>
                  {daily.days.map((d) => (
                    <tr key={d.day} className="border-t border-slate-100 align-top hover:bg-brand-50/30">
                      <td className="whitespace-nowrap px-5 py-3 font-medium text-ink-900">
                        {fmtDate(new Date(`${d.day}T12:00:00+05:30`))}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 font-semibold text-ink-900">{num(d.litres)} L</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {d.vehicles.map((v) => (
                            <Link
                              key={v.assetId}
                              href={`/fleet/${v.assetId}`}
                              title={
                                v.priced
                                  ? `${v.fills} fill${v.fills > 1 ? "s" : ""} entered, with a bill on record`
                                  : `${v.fills} fill${v.fills > 1 ? "s" : ""} seen by the fuel sensor — no bill entered yet`
                              }
                              className={
                                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition hover:brightness-95 " +
                                (v.priced
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                  : "border-slate-200 bg-slate-50 text-slate-700")
                              }
                            >
                              <span className="font-semibold">{v.assetCode}</span>
                              <span className="tabular-nums">{num(v.litres)} L</span>
                              {v.fills > 1 ? <span className="text-[10px] opacity-70">×{v.fills}</span> : null}
                            </Link>
                          ))}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600">{d.value == null ? "Rate not configured" : inr(d.value, { compact: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-1 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              <p>
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400 align-middle" />
Green means a bill was entered — the litres and the money are both correct.
                <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-full bg-slate-400 align-middle" />
                Grey was seen by the fuel sensor only. The litres are measured; money uses that vehicle&apos;s
                configured diesel or petrol rate, and stays blank when either is missing.
              </p>
              {daily.excluded.length > 0 ? (
                <p>
                  Not shown: {daily.excluded.map((e) => e.assetCode).join(", ")} — the fuel sensor on{" "}
                  {daily.excluded.length === 1 ? "this vehicle" : "these vehicles"} is giving wrong readings,
                  so its fills cannot be trusted.
                </p>
              ) : null}
            </div>
          </>
        )}
      </Card>

      {/* Per-vehicle analytics */}
      <Card className="p-0">
        <div className="p-5 pb-3"><SectionTitle title="Fuel Use by Vehicle" subtitle="Mileage and cost for every machine with fuel records" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium"><Txt text="Vehicle" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Class" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Fills" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Fuel" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Distance / Hours" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Mileage" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Benchmark" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Cost/km" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Last Fill" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Flags" /></th>
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
