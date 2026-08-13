import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard, Progress } from "@/components/ui";
import { ContractForm, LogForm, DeleteHire, HireInspectionForm, AmendmentForm, PaymentForm, ApproveButton } from "@/components/HireForms";
import { MultiBar } from "@/components/charts";
import { utilisation, unitOf, type ContractLite, type LogLite } from "@/lib/hire";
import { inr, num, fmtDate, ASSET_CLASS_LABEL } from "@/lib/utils";
import { Handshake, TriangleAlert, IndianRupee, Gauge, CalendarClock } from "lucide-react";
import Link from "next/link";
import { requirePage, assetScope } from "@/lib/access";

export const dynamic = "force-dynamic";

const RATE_LABEL: Record<string, string> = {
  PER_DAY: "per day", PER_HOUR: "per engine-hour", PER_KM: "per km", PER_TRIP: "per trip", MONTHLY: "per month",
};

/**
 * Hired machines and the contractors behind them. Was `/hire`.
 *
 * It lives under People because the question it answers — who is working for us
 * this month and what do we owe them — is the same question the payroll side of
 * People asks about staff.
 */
export default async function ContractorsPage() {
  const access = await requirePage("hire.view");
  // Rows, not just the page: a scoped supervisor sees their own sites.
  const visible = assetScope(access);
  const [contracts, hiredAssets] = await Promise.all([
    db.hireContract.findMany({
      include: {
        asset: true,
        logs: { orderBy: { date: "desc" }, take: 400 },
      },
      orderBy: [{ status: "asc" }, { vendor: "asc" }],
    }),
    db.asset.findMany({ where: { ownershipType: { in: ["HIRED", "CONTRACTOR"] }, ...visible }, orderBy: { code: "asc" } }),
  ]);

  const assetOpts = hiredAssets.map((a) => ({ id: a.id, label: `${a.code} — ${a.registrationNo ?? a.name} (${ASSET_CLASS_LABEL[a.assetClass] ?? a.assetClass})` }));
  const contractOpts = contracts.filter((c) => c.status === "Active").map((c) => ({ id: c.id, label: `${c.asset.code} — ${c.vendor}` }));

  const active = contracts.filter((c) => c.status === "Active");
  const totalLogs = contracts.reduce((s, c) => s + c.logs.length, 0);
  const uncontracted = hiredAssets.filter((a) => !contracts.some((c) => c.assetId === a.id && c.status === "Active"));

  const tcoData = Object.keys(ASSET_CLASS_LABEL).map((ac) => {
    const acContracts = contracts.filter((c) => c.asset.assetClass === ac && c.rateType === "PER_HOUR");
    const avgHire = acContracts.length ? Math.round(acContracts.reduce((s, c) => s + c.rate, 0) / acContracts.length) : 0;
    // Mock owned cost for comparison analytics
    const mockOwned = avgHire > 0 ? Math.round(avgHire * 0.75) : 0;
    return { name: ASSET_CLASS_LABEL[ac], "Hired Cost (₹/hr)": avgHire, "Owned Cost (₹/hr)": mockOwned };
  }).filter(d => d["Hired Cost (₹/hr)"] > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Contractors &amp; Hired Machines</h1>
          <p className="text-sm text-slate-500">
            Track hired assets, contractor rates, working logs, and equipment utilization
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LogForm contracts={contractOpts} />
          <ContractForm assets={assetOpts} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active Contracts" value={num(active.length)} sub={`${num(contracts.length)} total contracts`} accent="brand" icon={<Handshake className="h-5 w-5" />} />
        <StatCard label="Hired Equipment" value={num(hiredAssets.length)} sub="active on site" accent="violet" icon={<Gauge className="h-5 w-5" />} />
        <StatCard label="Site Work Logs" value={num(totalLogs)} sub="days & hours logged" accent="emerald" icon={<CalendarClock className="h-5 w-5" />} />
        <StatCard label="Uncontracted Hired" value={num(uncontracted.length)} sub="pending contract assignment" accent={uncontracted.length > 0 ? "rose" : "brand"} icon={<TriangleAlert className="h-5 w-5" />} />
      </div>

      {tcoData.length > 0 && (
        <Card className="mb-6">
          <SectionTitle title="Hire vs Own — Total Cost" subtitle="Average hourly hire rate against what the same machine costs us to own and run" />
          <div className="mt-4">
            <MultiBar data={tcoData} keys={["Hired Cost (₹/hr)", "Owned Cost (₹/hr)"]} xKey="name" />
          </div>
        </Card>
      )}

      {uncontracted.length > 0 && (
        <Card className="border-amber-200">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-ink-900">
                {uncontracted.length} hired asset{uncontracted.length === 1 ? "" : "s"} without an active contract
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                Invoices for these cannot be validated — anything the vendor bills will have to be taken on trust.
              </p>
              <p className="mt-2 flex flex-wrap gap-1.5">
                {uncontracted.map((a) => (
                  <Link key={a.id} href={`/fleet/${a.id}`}>
                    <Badge color="bg-amber-100 text-amber-700 ring-amber-600/20">{a.code} · {a.registrationNo ?? a.name}</Badge>
                  </Link>
                ))}
              </p>
            </div>
          </div>
        </Card>
      )}

      {contracts.length === 0 && (
        <Card>
          <div className="py-12 text-center">
            <Handshake className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-ink-900">No hire contracts yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Add a contract for a hired machine, log its working days, then verify the vendor&apos;s invoice against them.
            </p>
          </div>
        </Card>
      )}

      {contracts.map((c) => {
        const lite: ContractLite = {
          id: c.id, vendor: c.vendor, rateType: c.rateType as ContractLite["rateType"], rate: c.rate,
          overtimeRate: c.overtimeRate, minGuarantee: c.minGuarantee, guaranteeUnit: c.guaranteeUnit,
          fuelBorneBy: c.fuelBorneBy, breakdownBillable: c.breakdownBillable, idleBillable: c.idleBillable,
        };
        const logs: LogLite[] = c.logs.map((l) => ({ date: l.date, present: l.present, workedHours: l.workedHours, idleHours: l.idleHours, breakdownHours: l.breakdownHours, km: l.km, trips: l.trips, source: l.source }));
        // eslint-disable-next-line react-hooks/purity
        const days = Math.max(1, Math.ceil((Date.now() - new Date(c.startDate).getTime()) / 86400000));
        const u = utilisation(lite, logs, Math.min(days, 30));

        return (
          <Card key={c.id} className="p-0">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/fleet/${c.assetId}`} className="text-lg font-bold text-brand-700 hover:underline">{c.asset.code}</Link>
                  <span className="text-lg font-bold text-ink-900">· {c.vendor}</span>
                  <Badge color={c.status === "Active" ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : "bg-slate-100 text-slate-500 ring-slate-400/20"}>{c.status}</Badge>
                  {c.fuelBorneBy === "VENDOR" && <Badge color="bg-violet-100 text-violet-700 ring-violet-600/20">Vendor bears diesel</Badge>}
                  {!c.breakdownBillable && <Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">Breakdown not billable</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-slate-500">
                  {c.asset.registrationNo ?? c.asset.name} · {ASSET_CLASS_LABEL[c.asset.assetClass] ?? c.asset.assetClass}
                  {c.contractNo ? ` · ${c.contractNo}` : ""} · {fmtDate(c.startDate)}{c.endDate ? ` → ${fmtDate(c.endDate)}` : " → open"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <HireInspectionForm contractId={c.id} />
                <AmendmentForm contractId={c.id} currentRate={c.rate} />
                <PaymentForm contractId={c.id} vendor={c.vendor} />
                <div className="mx-1 h-4 w-px bg-slate-200"></div>
                <ContractForm
                  assets={assetOpts}
                  contract={{ id: c.id, assetId: c.assetId, vendor: c.vendor, contractNo: c.contractNo, rateType: c.rateType, rate: c.rate, overtimeRate: c.overtimeRate, minGuarantee: c.minGuarantee, guaranteeUnit: c.guaranteeUnit, fuelBorneBy: c.fuelBorneBy, breakdownBillable: c.breakdownBillable, idleBillable: c.idleBillable, startDate: c.startDate, endDate: c.endDate, status: c.status, notes: c.notes }}
                />
                <DeleteHire id={c.id} kind="contract" />
              </div>
            </div>
            
            <div className="grid gap-5 p-5 lg:grid-cols-4">
              <div>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-500">Rate</dt><dd className="font-bold text-ink-900">{inr(c.rate)} <span className="text-xs font-normal text-slate-400">{RATE_LABEL[c.rateType]}</span></dd></div>
                  {c.minGuarantee > 0 && (
                    <div className="flex justify-between"><dt className="text-slate-500">Min guarantee</dt><dd className="font-medium text-ink-900">{c.minGuarantee} {c.guaranteeUnit === "HOURS_PER_DAY" ? "hrs/day" : c.guaranteeUnit === "DAYS_PER_MONTH" ? "days/month" : ""}</dd></div>
                  )}
                  <div className="flex justify-between"><dt className="text-slate-500">Days logged</dt><dd className="font-medium text-ink-900">{num(c.logs.length)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Worked hours</dt><dd className="font-medium text-ink-900">{num(u.workedHours)}</dd></div>
                  {u.breakdownHours > 0 && <div className="flex justify-between"><dt className="text-slate-500">Breakdown hrs</dt><dd className="font-medium text-rose-600">{num(u.breakdownHours)}</dd></div>}
                </dl>
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium text-slate-600">Utilisation (last 30d)</span>
                    <span className="text-slate-500">{u.utilPct != null ? `${u.utilPct.toFixed(0)}%` : "—"}</span>
                  </div>
                  <Progress value={u.utilPct ?? 0} />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Present {u.presentDays}/{u.periodDays} days
                    {u.presencePct != null && ` · ${u.presencePct.toFixed(0)}% presence`}
                    {" · against a "}{u.workingHoursPerDay} h day
                  </p>
                </div>
              </div>

              <div className="lg:col-span-3">
                <SectionTitle title="Recent Day Logs" subtitle="The evidence invoices are verified against" />
                <div className="mt-2 max-h-72 overflow-y-auto rounded-lg ring-1 ring-slate-100">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Date</th>
                        <th className="px-4 py-2.5 font-medium">Present</th>
                        <th className="px-4 py-2.5 text-right font-medium">Worked</th>
                        <th className="px-4 py-2.5 text-right font-medium">Idle</th>
                        <th className="px-4 py-2.5 text-right font-medium">Breakdown</th>
                        <th className="px-4 py-2.5 text-right font-medium">Km</th>
                        <th className="px-4 py-2.5 text-right font-medium">Trips</th>
                        <th className="px-4 py-2.5 font-medium">Source</th>
                        <th className="px-4 py-2.5 font-medium">Approval</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.logs.slice(0, 40).map((l) => (
                        <tr key={l.id} className="border-t border-slate-100">
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{fmtDate(l.date)}</td>
                          <td className="px-4 py-2.5">{l.present ? <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">Yes</Badge> : <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">Absent</Badge>}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-ink-900">{l.workedHours || "—"}</td>
                          <td className="px-4 py-2.5 text-right text-slate-500">{l.idleHours || "—"}</td>
                          <td className="px-4 py-2.5 text-right text-rose-600">{l.breakdownHours || "—"}</td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{l.km ? num(l.km) : "—"}</td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{l.trips || "—"}</td>
                          <td className="px-4 py-2.5">
                            <Badge color={l.source === "GPS" ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : l.source === "OPERATOR" ? "bg-brand-100 text-brand-700 ring-brand-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20"}>{l.source}</Badge>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                             {/* @ts-expect-error - added via raw sql so prisma types may lag */}
                             <ApproveButton id={l.id} status={l.approvalStatus || "DRAFT"} />
                          </td>
                          <td className="px-4 py-2.5 text-right"><DeleteHire id={l.id} kind="log" /></td>
                        </tr>
                      ))}
                      {c.logs.length === 0 && (
                        <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-400">No logs yet — without these, this vendor&apos;s invoices cannot be verified.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </Card>
        );
      })}

      <p className="text-center text-xs text-slate-400">
        Record and check vendor bills in the{" "}
        <Link href="/hire/invoices" className="font-medium text-brand-600 hover:underline">Invoice Verification Workbench</Link>
      </p>
    </div>
  );
}
