import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard, Progress } from "@/components/ui";
import { ScanButton, NewCaseForm } from "@/components/LossForms";
import { scorecard, offenderProfiles, type CaseLite } from "@/lib/loss-prevention";
import { getFraudIntelligence } from "@/app/(app)/loss-prevention/actions";
import { inr, num, fmtDate, timeAgo } from "@/lib/utils";
import { LiveAiPoller } from "@/components/LiveAiPoller";
import { ShieldAlert, HandCoins, IndianRupee, Clock, Repeat2, Fuel, Gauge } from "lucide-react";
import Link from "next/link";
import { requirePage, assetScope, projectScope } from "@/lib/access";

const SEV: Record<string, string> = {
  HIGH: "bg-rose-100 text-rose-700 ring-rose-600/20",
  MEDIUM: "bg-amber-100 text-amber-700 ring-amber-600/20",
  LOW: "bg-slate-100 text-slate-600 ring-slate-500/20",
};
const ST: Record<string, string> = {
  OPEN: "bg-rose-100 text-rose-700 ring-rose-600/20",
  INVESTIGATING: "bg-amber-100 text-amber-700 ring-amber-600/20",
  PENDING_APPROVAL: "bg-brand-100 text-brand-700 ring-brand-600/20",
  RECOVERED: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  WRITTEN_OFF: "bg-slate-100 text-slate-600 ring-slate-500/20",
  FALSE_POSITIVE: "bg-slate-100 text-slate-500 ring-slate-400/20",
  CLOSED: "bg-slate-100 text-slate-600 ring-slate-500/20",
};
const DOMAIN_LABEL: Record<string, string> = {
  FUEL: "Fuel", HIRE: "Hire / vendor", MAINTENANCE: "Maintenance", METER: "Meter", COMPLIANCE: "Compliance", TRIP: "Trips",
};

/**
 * Formal cases: something was lost, someone owns finding out, money comes back.
 *
 * Was `/loss-prevention`. It shares this screen with the fuel problem queue
 * because that is the escalation path — a scored problem nobody can explain
 * becomes a case with evidence attached — and having the two on separate menu
 * entries meant the queue got worked and the cases got forgotten.
 */
export async function LossCases() {
  const access = await requirePage("loss.view");
  // Rows, not just the page: a scoped supervisor sees their own sites.
  const visible = assetScope(access);
  const _visibleProjects = projectScope(access);
  const [cases, assets, drivers, fraudIntel] = await Promise.all([
    db.fraudCase.findMany({
      include: { asset: { select: { code: true } }, driver: { select: { name: true } }, _count: { select: { evidence: true, recoveries: true } } },
      orderBy: [{ status: "asc" }, { score: "desc" }, { openedAt: "desc" }],
      take: 300,
    }),
    db.asset.findMany({ where: visible, select: { id: true, code: true, registrationNo: true, name: true }, orderBy: { code: "asc" } }),
    db.driver.findMany({ select: { id: true, name: true, empCode: true }, orderBy: { name: "asc" } }),
    getFraudIntelligence(),
  ]);

  const assetLabel = new Map(assets.map((a) => [a.id, a.code]));
  const driverLabel = new Map(drivers.map((d) => [d.id, d.name]));

  const sc = scorecard(cases.map((c) => ({ domain: c.domain, status: c.status, amountAtRisk: c.amountAtRisk, amountRecovered: c.amountRecovered, openedAt: c.openedAt, closedAt: c.closedAt })));
  const offenders = offenderProfiles(
    cases.map((c): CaseLite => ({ domain: c.domain, status: c.status, amountAtRisk: c.amountAtRisk, amountRecovered: c.amountRecovered, vendor: c.vendor, assetId: c.assetId, driverId: c.driverId })),
    (id) => assetLabel.get(id) ?? "Unknown asset",
    (id) => driverLabel.get(id) ?? "Unknown driver"
  );

  const openCases = cases.filter((c) => ["OPEN", "INVESTIGATING", "PENDING_APPROVAL"].includes(c.status));
  const resolved = cases.filter((c) => !["OPEN", "INVESTIGATING", "PENDING_APPROVAL"].includes(c.status));

  const assetOpts = assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.registrationNo ?? a.name}` }));
  const driverOpts = drivers.map((d) => ({ id: d.id, label: `${d.empCode} — ${d.name}` }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Fuel Loss Check</h2>
          <p className="text-sm text-slate-500">
            Every signal from fuel, hire, meters and compliance in one queue — tracked from detection to rupees recovered
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveAiPoller />
          <NewCaseForm assets={assetOpts} drivers={driverOpts} />
          <ScanButton />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <StatCard label="Open Cases" value={num(sc.openCases)} sub={`${num(sc.totalCases)} total`} accent="rose" icon={<ShieldAlert className="h-5 w-5" />} />
        <StatCard label="Live Exposure" value={inr(sc.atRisk, { compact: true })} sub="open cases only" accent="rose" icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Recovered" value={inr(sc.recovered, { compact: true })} sub={sc.recoveryRate != null ? `${sc.recoveryRate.toFixed(0)}% of pursued` : "no cases pursued yet"} accent="emerald" icon={<HandCoins className="h-5 w-5" />} />
        <StatCard label="Avg Time to Resolve" value={sc.avgDaysToResolve != null ? `${sc.avgDaysToResolve.toFixed(1)}d` : "—"} sub={`${num(sc.falsePositives)} false positives`} accent="brand" icon={<Clock className="h-5 w-5" />} />
        <StatCard label="Repeat Offenders" value={num(offenders.length)} sub="2+ cases each" accent="amber" icon={<Repeat2 className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <SectionTitle title="Loss by Domain" subtitle="Where the money is leaking" />
          <div className="mt-2 space-y-3">
            {sc.byDomain.map((d) => {
              const max = Math.max(...sc.byDomain.map((x) => x.atRisk), 1);
              return (
                <div key={d.domain}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium text-ink-900">{DOMAIN_LABEL[d.domain] ?? d.domain}</span>
                    <span className="text-slate-500">{inr(d.atRisk, { compact: true })} · {d.cases} case{d.cases === 1 ? "" : "s"}</span>
                  </div>
                  <Progress value={(d.atRisk / max) * 100} />
                  {d.recovered > 0 && <p className="mt-0.5 text-xs text-emerald-600">{inr(d.recovered, { compact: true })} recovered</p>}
                </div>
              );
            })}
            {sc.byDomain.length === 0 && <p className="text-sm text-slate-400">No cases yet — run a detection scan.</p>}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle title="Repeat Offenders" subtitle="Things that repeat across the whole system — the same supplier or machine coming up again and again" />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Party</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cases</th>
                  <th className="px-4 py-2.5 text-right font-medium">Open</th>
                  <th className="px-4 py-2.5 text-right font-medium">At Risk</th>
                  <th className="px-4 py-2.5 text-right font-medium">Recovered</th>
                </tr>
              </thead>
              <tbody>
                {offenders.slice(0, 12).map((o) => (
                  <tr key={o.key} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 font-semibold text-ink-900">{o.label}</td>
                    <td className="px-4 py-2.5"><Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{o.kind}</Badge></td>
                    <td className="px-4 py-2.5 text-right font-bold text-ink-900">{o.cases}</td>
                    <td className="px-4 py-2.5 text-right text-rose-600">{o.openCases || "—"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-rose-600">{inr(o.atRisk, { compact: true })}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-600">{o.recovered > 0 ? inr(o.recovered, { compact: true }) : "—"}</td>
                  </tr>
                ))}
                {offenders.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No repeat patterns yet. A party needs 2+ cases to appear here.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* ---- Fraud Intelligence Panel ---- */}
      {(fraudIntel.fuelTheftSignals.length > 0 || fraudIntel.meterRollbacks.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-0">
            <div className="p-5 pb-3">
              <SectionTitle
                title="Fuel Theft Signals"
                subtitle={`${fraudIntel.fuelTheftSignals.length} active · ${num(fraudIntel.totalLitresAtRisk)} L at risk (${inr(fraudIntel.totalFuelAtRisk, { compact: true })})`}
                action={<Fuel className="h-4 w-4 text-rose-400" />}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Asset / Tank</th>
                    <th className="px-5 py-2.5 font-medium">Source</th>
                    <th className="px-5 py-2.5 text-right font-medium">Litres</th>
                    <th className="px-5 py-2.5 text-right font-medium">Value at Risk</th>
                    <th className="px-5 py-2.5 font-medium">Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {fraudIntel.fuelTheftSignals.map((sig) => (
                    <tr key={sig.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                      <td className="px-5 py-2.5 font-semibold text-ink-900">{sig.assetCode}</td>
                      <td className="px-5 py-2.5 text-slate-600">{sig.source === "RECEIPT" ? "Short delivery" : "Tank gap"}</td>
                      <td className="px-5 py-2.5 text-right font-medium text-ink-900">{sig.litres.toFixed(0)} L</td>
                      <td className="px-5 py-2.5 text-right font-bold text-rose-600">{inr(sig.valueAtRisk, { compact: true })}</td>
                      <td className="px-5 py-2.5">
                        <Badge color={sig.severity === "HIGH" ? "bg-rose-100 text-rose-700 ring-rose-600/20" : sig.severity === "MEDIUM" ? "bg-amber-100 text-amber-700 ring-amber-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20"}>
                          {sig.severity}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {fraudIntel.fuelTheftSignals.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No active fuel theft signals.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-0">
            <div className="p-5 pb-3">
              <SectionTitle
                title="Sensor & Meter Problems"
                subtitle={`${fraudIntel.rollbackCount} meter rollback${fraudIntel.rollbackCount === 1 ? "" : "s"} detected — readings went backwards`}
                action={<Gauge className="h-4 w-4 text-amber-400" />}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Asset</th>
                    <th className="px-5 py-2.5 text-right font-medium">Previous</th>
                    <th className="px-5 py-2.5 text-right font-medium">Current</th>
                    <th className="px-5 py-2.5 text-right font-medium">Drop</th>
                    <th className="px-5 py-2.5 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {fraudIntel.meterRollbacks.map((rb, i) => (
                    <tr key={i} className="border-t border-slate-100 hover:bg-brand-50/30">
                      <td className="px-5 py-2.5 font-semibold text-ink-900">{rb.assetCode}</td>
                      <td className="px-5 py-2.5 text-right text-slate-600">{num(rb.from)}</td>
                      <td className="px-5 py-2.5 text-right text-slate-600">{num(rb.to)}</td>
                      <td className="px-5 py-2.5 text-right font-bold text-rose-600">−{num(rb.drop)}</td>
                      <td className="px-5 py-2.5 text-slate-500">{fmtDate(rb.date)}</td>
                    </tr>
                  ))}
                  {fraudIntel.meterRollbacks.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No meter rollbacks detected. Run a detection scan to check.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionTitle title={`Open Cases (${openCases.length})`} subtitle="Highest risk score first" />
        </div>
        <div className="divide-y divide-slate-100">
          {openCases.map((c) => (
            <CaseRow key={c.id} c={c} />
          ))}
          {openCases.length === 0 && (
            <div className="py-16 text-center">
              <ShieldAlert className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-ink-900">No open cases</p>
              <p className="mt-1 text-sm text-slate-500">Run a detection scan to sweep fuel, hire, meters and compliance for signals.</p>
            </div>
          )}
        </div>
      </Card>

      {resolved.length > 0 && (
        <Card className="p-0">
          <div className="p-5 pb-3">
            <SectionTitle title={`Resolved (${resolved.length})`} subtitle="Closed, money recovered, written off, or dropped" />
          </div>
          <div className="divide-y divide-slate-100 opacity-75">
            {resolved.slice(0, 40).map((c) => <CaseRow key={c.id} c={c} />)}
          </div>
        </Card>
      )}
    </div>
  );
}

type Row = {
  id: string; caseNo: string; title: string; domain: string; severity: string; score: number; status: string;
  amountAtRisk: number; amountRecovered: number; vendor: string | null; assignedTo: string | null; openedAt: Date;
  summary: string | null; asset: { code: string } | null; driver: { name: string } | null;
  _count: { evidence: number; recoveries: number };
};

function CaseRow({ c }: { c: Row }) {
  return (
    <Link href={`/fuel/problems/${c.id}`} className="flex flex-wrap items-start gap-4 p-5 hover:bg-brand-50/30">
      <div className="flex w-14 shrink-0 flex-col items-center">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold ${c.score >= 60 ? "bg-rose-50 text-rose-600" : c.score >= 30 ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-500"}`}>
          {c.score}
        </div>
        <span className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">risk</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-slate-400">{c.caseNo}</span>
          <Badge color={SEV[c.severity] ?? SEV.LOW}>{c.severity}</Badge>
          <Badge color={ST[c.status] ?? ST.CLOSED}>{c.status.replace(/_/g, " ")}</Badge>
          <Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{DOMAIN_LABEL[c.domain] ?? c.domain}</Badge>
        </div>
        <p className="mt-1 font-semibold text-ink-900">{c.title}</p>
        {c.summary && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{c.summary.split("\n")[0]}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {c.asset && <span>Asset <strong className="text-ink-900">{c.asset.code}</strong></span>}
          {c.vendor && <span>Vendor <strong className="text-ink-900">{c.vendor}</strong></span>}
          {c.driver && <span>Driver <strong className="text-ink-900">{c.driver.name}</strong></span>}
          {c.assignedTo && <span>→ {c.assignedTo}</span>}
          <span>{c._count.evidence} evidence</span>
          <span>{timeAgo(c.openedAt)}</span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-xs uppercase tracking-wide text-slate-400">At risk</p>
        <p className="text-lg font-bold text-rose-600">{inr(c.amountAtRisk, { compact: true })}</p>
        {c.amountRecovered > 0 && <p className="text-xs font-medium text-emerald-600">{inr(c.amountRecovered, { compact: true })} recovered</p>}
      </div>
    </Link>
  );
}
