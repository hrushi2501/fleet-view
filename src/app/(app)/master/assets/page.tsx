import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard, Progress } from "@/components/ui";
import { ReadingForm, AssetMasterForm, LifecycleForm, DeleteRow } from "@/components/MasterForms";
import { assetCompleteness } from "@/lib/master";
import { inr, num, fmtDate, ASSET_CLASS_LABEL } from "@/lib/utils";
import { Database, TriangleAlert, Gauge, History, ClipboardList } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AssetMasterPage() {
  const [assets, readings, lifecycle] = await Promise.all([
    db.asset.findMany({ orderBy: { code: "asc" } }),
    db.meterReading.findMany({ include: { asset: true }, orderBy: { date: "desc" }, take: 200 }),
    db.assetLifecycleEvent.findMany({ include: { asset: true }, orderBy: { date: "desc" }, take: 50 }),
  ]);

  const assetOpts = assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.registrationNo ?? a.name}` }));

  const rows = assets.map((a) => ({
    asset: a,
    c: assetCompleteness({
      registrationNo: a.registrationNo, chassisNo: a.chassisNo, engineNo: a.engineNo,
      make: a.make, model: a.model, yearMfg: a.yearMfg, acquisitionCost: a.acquisitionCost,
      insuredValue: a.insuredValue, meterValue: a.meterValue, fuelCapacity: a.fuelCapacity,
      projectId: a.projectId, driverId: a.driverId, commissionedOn: a.commissionedOn, inServiceDate: a.inServiceDate,
    }),
  })).sort((x, y) => x.c.score - y.c.score);

  const avg = rows.length ? rows.reduce((s, r) => s + r.c.score, 0) / rows.length : 0;
  const poor = rows.filter((r) => r.c.score < 60).length;
  const rollbacks = readings.filter((r) => r.isRollback).length;
  const noCost = assets.filter((a) => a.acquisitionCost <= 0).length;

  // Which fields are missing most often across the fleet.
  const gapCount = new Map<string, { label: string; count: number; why: string }>();
  for (const r of rows) {
    for (const m of r.c.missing) {
      const cur = gapCount.get(m.field) ?? { label: m.label, count: 0, why: m.why };
      cur.count++;
      gapCount.set(m.field, cur);
    }
  }
  const gaps = [...gapCount.values()].sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Asset Master Data</h1>
          <p className="text-sm text-slate-500">
            Dual meters, identity numbers and completeness — every downstream number is only as good as this record
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LifecycleForm assets={assetOpts} />
          <ReadingForm assets={assetOpts} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Data Completeness" value={`${avg.toFixed(0)}%`} sub="fleet average, weighted" accent={avg >= 80 ? "emerald" : "amber"} icon={<Database className="h-5 w-5" />} />
        <StatCard label="Poor Records" value={num(poor)} sub="below 60%" accent="rose" icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="No Acquisition Cost" value={num(noCost)} sub="depreciation reads zero" accent={noCost > 0 ? "rose" : "emerald"} icon={<ClipboardList className="h-5 w-5" />} />
        <StatCard label="Meter Readings" value={num(readings.length)} sub="recent history" accent="brand" icon={<Gauge className="h-5 w-5" />} />
        <StatCard label="Rollbacks Flagged" value={num(rollbacks)} sub="meter ran backwards" accent={rollbacks > 0 ? "rose" : "emerald"} icon={<History className="h-5 w-5" />} />
      </div>

      {noCost > 0 && (
        <Card className="border-amber-200">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-ink-900">{noCost} machine{noCost === 1 ? " has" : "s have"} no acquisition cost</p>
              <p className="mt-0.5 text-sm text-slate-600">
                Depreciation, book value and total cost of ownership all compute to zero for these, so they will look
                cheaper to run than they are — and the replace-vs-repair verdict cannot be trusted for them either.
                Set the cost under Cost &amp; TCO → Set Basis, or complete the record below.
              </p>
            </div>
          </div>
        </Card>
      )}

      {gaps.length > 0 && (
        <Card>
          <SectionTitle title="Most Common Gaps" subtitle="Fixing the top of this list moves the whole fleet's score" />
          <div className="mt-2 space-y-3">
            {gaps.slice(0, 8).map((g) => (
              <div key={g.label}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium text-ink-900">{g.label}</span>
                  <span className="text-slate-500">{g.count} of {assets.length} missing</span>
                </div>
                <Progress value={(g.count / Math.max(1, assets.length)) * 100} />
                <p className="mt-0.5 text-xs text-slate-400">{g.why}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-0">
        <div className="p-5 pb-3"><SectionTitle title="Asset Records" subtitle="Weakest records first" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Asset</th>
                <th className="px-5 py-3 font-medium">Class</th>
                <th className="px-5 py-3 text-right font-medium">Odometer</th>
                <th className="px-5 py-3 text-right font-medium">Hour-meter</th>
                <th className="px-5 py-3 font-medium">Chassis / Engine</th>
                <th className="px-5 py-3 text-right font-medium">Acq. Cost</th>
                <th className="px-5 py-3 font-medium">Completeness</th>
                <th className="px-5 py-3 font-medium">Missing</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 80).map(({ asset: a, c }) => (
                <tr key={a.id} className="border-t border-slate-100 align-top hover:bg-brand-50/30">
                  <td className="px-5 py-3">
                    <Link href={`/fleet/${a.id}`} className="font-semibold text-brand-700 hover:underline">{a.code}</Link>
                    <p className="text-xs text-slate-400">{a.registrationNo ?? a.name}</p>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{ASSET_CLASS_LABEL[a.assetClass] ?? a.assetClass}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{a.meterValue ? num(a.meterValue) : <span className="text-rose-500">—</span>}</td>
                  <td className="px-5 py-3 text-right text-slate-600">{a.hourMeterValue ? num(a.hourMeterValue) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-5 py-3 text-xs text-slate-500">
                    {a.chassisNo ?? <span className="text-rose-500">no chassis</span>}
                    <span className="block">{a.engineNo ?? <span className="text-slate-300">no engine no.</span>}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {a.acquisitionCost > 0 ? <span className="text-slate-600">{inr(a.acquisitionCost, { compact: true })}</span> : <span className="font-medium text-rose-600">not set</span>}
                  </td>
                  <td className="px-5 py-3">
                    <div className="w-20">
                      <Progress value={c.score} />
                      <p className="mt-0.5 text-xs text-slate-400">{c.score}%</p>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {c.missing.length ? (
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {c.missing.slice(0, 4).map((m) => <Badge key={m.field} color="bg-amber-100 text-amber-700 ring-amber-600/20">{m.label}</Badge>)}
                        {c.missing.length > 4 && <span className="text-xs text-slate-400">+{c.missing.length - 4}</span>}
                      </div>
                    ) : <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">Complete</Badge>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <AssetMasterForm asset={{ id: a.id, code: a.code, chassisNo: a.chassisNo, engineNo: a.engineNo, insuredValue: a.insuredValue, hourMeterValue: a.hourMeterValue, commissionedOn: a.commissionedOn }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="p-5 pb-3"><SectionTitle title="Meter History" subtitle="Flagged rows ran backwards" /></div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Asset</th>
                  <th className="px-5 py-2.5 font-medium">Meter</th>
                  <th className="px-5 py-2.5 text-right font-medium">Reading</th>
                  <th className="px-5 py-2.5 font-medium">Source</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {readings.map((r) => (
                  <tr key={r.id} className={`border-t border-slate-100 ${r.isRollback ? "bg-rose-50/50" : ""}`}>
                    <td className="px-5 py-2.5 whitespace-nowrap text-slate-600">{fmtDate(r.date)}</td>
                    <td className="px-5 py-2.5 font-medium text-ink-900">{r.asset.code}</td>
                    <td className="px-5 py-2.5 text-slate-600">{r.meterType === "HOURS" ? "Hours" : "Odometer"}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-ink-900">{num(r.value)}</td>
                    <td className="px-5 py-2.5">
                      <Badge color={r.isRollback ? "bg-rose-100 text-rose-700 ring-rose-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20"}>
                        {r.isRollback ? "ROLLBACK" : r.source}
                      </Badge>
                    </td>
                    <td className="px-5 py-2.5 text-right"><DeleteRow id={r.id} kind="reading" /></td>
                  </tr>
                ))}
                {readings.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">No readings recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-0">
          <div className="p-5 pb-3"><SectionTitle title="Lifecycle Events" subtitle="Commissioning, transfers and disposal" /></div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Asset</th>
                  <th className="px-5 py-2.5 font-medium">Event</th>
                  <th className="px-5 py-2.5 font-medium">Change</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lifecycle.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="px-5 py-2.5 whitespace-nowrap text-slate-600">{fmtDate(e.date)}</td>
                    <td className="px-5 py-2.5 font-medium text-ink-900">{e.asset.code}</td>
                    <td className="px-5 py-2.5"><Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{e.kind}</Badge></td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">{[e.fromValue, e.toValue].filter(Boolean).join(" → ") || e.note || "—"}</td>
                    <td className="px-5 py-2.5 text-right text-slate-600">{e.amount ? inr(e.amount, { compact: true }) : "—"}</td>
                  </tr>
                ))}
                {lifecycle.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No lifecycle events recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
