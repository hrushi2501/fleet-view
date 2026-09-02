import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard } from "@/components/ui";
import { AnomalyTriage } from "@/components/FuelForms";
import { inr, num, fmtDate, timeAgo } from "@/lib/utils";
import { ShieldAlert, IndianRupee, HandCoins, Search } from "lucide-react";
import Link from "next/link";

import { requirePage, assetScope, projectScope } from "@/lib/access";

const SEV: Record<string, string> = {
  HIGH: "bg-rose-100 text-rose-700 ring-rose-600/20",
  MEDIUM: "bg-amber-100 text-amber-700 ring-amber-600/20",
  LOW: "bg-slate-100 text-slate-600 ring-slate-500/20",
};
const STATUS: Record<string, string> = {
  OPEN: "bg-rose-100 text-rose-700 ring-rose-600/20",
  INVESTIGATING: "bg-amber-100 text-amber-700 ring-amber-600/20",
  RECOVERED: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  FALSE_POSITIVE: "bg-slate-100 text-slate-500 ring-slate-400/20",
  CLOSED: "bg-slate-100 text-slate-600 ring-slate-500/20",
};
const SOURCE_LABEL: Record<string, string> = {
  ISSUE: "Fuel issue",
  RECEIPT: "Short delivery",
  TANK_RECON: "Tank reconciliation",
  ASSET_EFFICIENCY: "Asset efficiency",
};

/**
 * Unexplained litres, scored and worked through to recovery.
 *
 * Was `/fuel/anomalies`. "Anomaly" is a good word for the detector and a poor
 * word for a screen a store-keeper opens; on screen these are problems, and the
 * table underneath is still `FuelAnomaly`.
 */
export async function ProblemQueue() {
  const access = await requirePage("fuel.view");
  // Rows, not just the page: a scoped supervisor sees their own sites.
  const visible = assetScope(access);
  const _visibleProjects = projectScope(access);
  // `FuelAnomaly` carries a bare `assetId` with no relation to filter through,
  // so the vehicles this caller may see are resolved first and the queue is
  // limited to them. A finding names a vehicle and a driver; it must not appear
  // to a supervisor who is not responsible for either.
  const assets = await db.asset.findMany({ where: visible, select: { id: true, code: true } });
  const scoped = Object.keys(visible).length > 0;
  const allowedIds = assets.map((a) => a.id);

  const [anomalies, tanks] = await Promise.all([
    db.fuelAnomaly.findMany({
      where: scoped ? { assetId: { in: allowedIds } } : {},
      orderBy: [{ status: "asc" }, { score: "desc" }, { detectedAt: "desc" }],
      take: 200,
    }),
    db.fuelTank.findMany({ select: { id: true, name: true } }),
  ]);

  const tankName = new Map(tanks.map((t) => [t.id, t.name]));
  const assetCode = new Map(assets.map((a) => [a.id, a.code]));

  const open = anomalies.filter((a) => a.status === "OPEN" || a.status === "INVESTIGATING");
  const atRisk = open.reduce((s, a) => s + a.valueAtRisk, 0);
  const recovered = anomalies.reduce((s, a) => s + a.recovered, 0);
  const litresOpen = open.reduce((s, a) => s + a.litres, 0);

  return (
    <div className="space-y-6">

      <div>
        <h2 className="text-lg font-bold text-ink-900">Problem Queue</h2>
        <p className="text-sm text-slate-500">
          Every unexplained litre, ranked by how much is at stake and tracked until it is settled
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-4">
        <StatCard label="Open Cases" value={num(open.length)} sub={`${num(anomalies.length)} total`} accent="rose" icon={<ShieldAlert className="h-5 w-5" />} />
        <StatCard label="Litres Unexplained" value={`${num(litresOpen)} L`} sub="open cases only" accent="amber" icon={<Search className="h-5 w-5" />} />
        <StatCard label="Value at Risk" value={inr(atRisk, { compact: true })} sub="open cases only" accent="rose" icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Recovered" value={inr(recovered, { compact: true })} sub="closed with recovery" accent="emerald" icon={<HandCoins className="h-5 w-5" />} />
      </div>

      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionTitle title="Cases" subtitle="Biggest first — open cases before closed ones" />
        </div>
        <div className="divide-y divide-slate-100">
          {anomalies.map((a) => {
            const where = a.tankId ? tankName.get(a.tankId) : a.assetId ? assetCode.get(a.assetId) : null;
            const reasons = (a.reasons ?? "").split("\n").filter(Boolean);
            const isOpen = a.status === "OPEN" || a.status === "INVESTIGATING";
            return (
              <div key={a.id} className={`flex flex-wrap items-start gap-4 p-5 ${isOpen ? "" : "opacity-70"}`}>
                <div className="flex w-14 shrink-0 flex-col items-center">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold ${
                      a.score >= 60 ? "bg-rose-50 text-rose-600" : a.score >= 30 ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-500"
                    }`}
                  >
                    {a.score}
                  </div>
                  <span className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">risk</span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color={SEV[a.severity] ?? SEV.LOW}>{a.severity}</Badge>
                    <Badge color={STATUS[a.status] ?? STATUS.CLOSED}>{a.status.replace("_", " ")}</Badge>
                    <span className="text-sm font-semibold text-ink-900">{SOURCE_LABEL[a.source] ?? a.source}</span>
                    {where && <span className="text-sm text-slate-500">· {where}</span>}
                    <span className="text-xs text-slate-400">· {timeAgo(a.detectedAt)}</span>
                  </div>

                  <ul className="mt-1.5 list-inside list-disc text-sm text-slate-600">
                    {reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>

                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    <span><strong className="text-ink-900">{num(a.litres)} L</strong> involved</span>
                    <span><strong className="text-rose-600">{inr(a.valueAtRisk, { compact: true })}</strong> at risk</span>
                    {a.recovered > 0 && <span><strong className="text-emerald-600">{inr(a.recovered, { compact: true })}</strong> recovered</span>}
                    {a.assignedTo && <span>assigned to <strong className="text-ink-900">{a.assignedTo}</strong></span>}
                    {a.resolvedAt && <span>resolved {fmtDate(a.resolvedAt)}</span>}
                  </div>

                  {a.resolution && (
                    <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <strong className="text-ink-900">Findings: </strong>{a.resolution}
                    </p>
                  )}
                </div>

                <div className="shrink-0">
                  <AnomalyTriage anomaly={{ id: a.id, status: a.status, resolution: a.resolution, recovered: a.recovered, assignedTo: a.assignedTo }} />
                </div>
              </div>
            );
          })}

          {anomalies.length === 0 && (
            <div className="py-16 text-center">
              <ShieldAlert className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-ink-900">Koi problem nahi mili</p>
              <p className="mt-1 text-sm text-slate-500">
                Record deliveries and tank dips, then run the{" "}
                <Link href="/fuel/tanks?tab=stock" className="font-medium text-brand-600 hover:underline">stock check</Link>.
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
