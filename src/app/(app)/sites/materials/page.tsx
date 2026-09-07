import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard } from "@/components/ui";
import { TicketForm, DeleteTicketButton } from "@/components/AdminWeighForms";
import {
  reconcilePairs,
  byMaterial,
  byVehicle,
  TRANSIT_LOSS_PCT,
  type TicketLite,
} from "@/lib/weighbridge";
import { inr, num, fmtDate } from "@/lib/utils";
import { Scale, TriangleAlert, FileQuestion, IndianRupee } from "lucide-react";
import Link from "next/link";
import { projectIdScope, requirePage } from "@/lib/access";
import { Txt } from "@/components/Txt";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  ok: { label: "Matches", cls: "bg-emerald-100 text-emerald-700 ring-emerald-600/20" },
  watch: { label: "Check", cls: "bg-amber-100 text-amber-700 ring-amber-600/20" },
  shortage: { label: "Short", cls: "bg-rose-100 text-rose-700 ring-rose-600/20" },
  unmatched: { label: "No receipt", cls: "bg-slate-100 text-slate-600 ring-slate-500/20" },
};

/**
 * Material weighed out against material weighed in.
 *
 * This is the old `/weighbridge` route, which had been reduced to a redirect at
 * some point even though the tickets, the actions and the whole reconciliation
 * engine in `lib/weighbridge.ts` were still there and still being written to.
 * The consolidation gave it a home — Sites, because a load is dispatched from
 * one site and received at another — and a screen to be seen on again.
 *
 * The wording avoids "reconciliation" and "variance": what a site clerk wants
 * to know is how many tonnes left, how many arrived, and what the gap is worth.
 */
export default async function MaterialsPage() {
  const access = await requirePage("weighbridge.view");

  const [tickets, assets, drivers, projects] = await Promise.all([
    db.weighbridgeTicket.findMany({
      where: projectIdScope(access),
      include: { asset: { select: { id: true, code: true, registrationNo: true } } },
      orderBy: { date: "desc" },
      take: 400,
    }),
    db.asset.findMany({ select: { id: true, code: true, registrationNo: true, name: true }, orderBy: { code: "asc" } }),
    db.driver.findMany({ select: { id: true, empCode: true, name: true }, orderBy: { name: "asc" } }),
    db.project.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]);

  const lite: TicketLite[] = tickets.map((t) => ({
    id: t.id,
    ticketNo: t.ticketNo,
    kind: t.kind,
    date: t.date,
    material: t.material,
    grossKg: t.grossKg,
    tareKg: t.tareKg,
    netKg: t.netKg,
    billedKg: t.billedKg,
    rate: t.rate,
    amount: t.amount,
    assetId: t.assetId,
    vendor: t.vendor,
    pairedTicketNo: t.pairedTicketNo,
  }));

  const pairs = reconcilePairs(lite);
  const materials = byMaterial(pairs);
  const vehicles = byVehicle(pairs);
  const assetCode = new Map(assets.map((a) => [a.id, a.code]));

  const shortTrips = pairs.filter((p) => p.status === "shortage").length;
  const unmatched = pairs.filter((p) => p.status === "unmatched").length;
  const atRisk = pairs.reduce((s, p) => s + p.valueAtRisk, 0);
  const movedKg = pairs.reduce((s, p) => s + p.dispatch.netKg, 0);

  const assetOpts = assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.registrationNo ?? a.name}` }));
  const driverOpts = drivers.map((d) => ({ id: d.id, label: `${d.empCode} — ${d.name}` }));
  const projOpts = projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));
  // Only dispatches still waiting for a receipt are worth offering when someone
  // records an arrival — pairing against an already-answered slip is the most
  // common way these tickets get mis-keyed.
  const openDispatchNos = pairs.filter((p) => !p.receipt).map((p) => p.dispatch.ticketNo);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900"><Txt text="Material Weighing" /></h1>
          <p className="text-sm text-slate-500">
            Kitna maal nikla aur kitna pahuncha — every load weighed out, weighed in, and the gap between the two
          </p>
        </div>
        <TicketForm assets={assetOpts} drivers={driverOpts} projects={projOpts} dispatchNos={openDispatchNos} />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-4">
        <StatCard label="Material Moved" value={`${num(movedKg / 1000)} t`} sub={`${num(pairs.length)} loads`} accent="brand" icon={<Scale className="h-5 w-5" />} />
        <StatCard label="Short Loads" value={num(shortTrips)} sub={`over ${TRANSIT_LOSS_PCT}% missing`} accent={shortTrips ? "rose" : "emerald"} icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="Receipt Missing" value={num(unmatched)} sub="slip never recorded" accent={unmatched ? "amber" : "emerald"} icon={<FileQuestion className="h-5 w-5" />} />
        <StatCard label="Value at Stake" value={inr(atRisk, { compact: true })} sub="short + unrecorded" accent="rose" icon={<IndianRupee className="h-5 w-5" />} />
      </div>

      <Card className="border-brand-200">
        <div className="flex items-start gap-3">
          <Scale className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
          <div>
            <p className="text-sm font-semibold text-ink-900">Missing slip is not the same as missing material</p>
            <p className="mt-0.5 text-sm text-slate-600">
              A load with no arrival slip is counted separately from a load that arrived light. The first is usually the
              site office being behind on paperwork; only the second is measured loss. Mixing them makes the shortage
              percentage jump every time a clerk is on leave, and that number is what a claim against a haulier rests on.
            </p>
          </div>
        </div>
      </Card>

      {materials.length > 0 && (
        <Card className="p-0">
          <div className="p-5 pb-3">
            <SectionTitle title="By Material" subtitle="Biggest shortage first" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium"><Txt text="Material" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Loads" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Sent" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Arrived" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Short" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Short %" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="No receipt" /></th>
                  <th className="px-5 py-3 text-right font-medium"><Txt text="Value" /></th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => (
                  <tr key={m.material} className="border-t border-slate-100 hover:bg-brand-50/30">
                    <td className="px-5 py-3 font-medium text-ink-900">{m.material}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{num(m.trips)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">{num(m.dispatchedKg / 1000)} t</td>
                    <td className="px-5 py-3 text-right text-slate-600">{num(m.receivedKg / 1000)} t</td>
                    <td className="px-5 py-3 text-right font-medium text-ink-900">{num(m.shortageKg / 1000)} t</td>
                    <td className="px-5 py-3 text-right">
                      {m.shortagePct != null ? (
                        <span className={m.shortagePct > TRANSIT_LOSS_PCT ? "font-semibold text-rose-600" : "text-slate-600"}>
                          {m.shortagePct.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-500">
                      {m.unmatchedTrips > 0 ? `${num(m.unmatchedTrips)} loads` : "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-rose-600">{inr(m.valueAtRisk, { compact: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {vehicles.length > 0 && (
        <Card className="p-0">
          <div className="p-5 pb-3">
            <SectionTitle title="By Vehicle" subtitle="Shortage that follows one vehicle is worth a conversation" />
          </div>
          <div className="divide-y divide-slate-100">
            {vehicles.slice(0, 15).map((v) => (
              <div key={v.assetId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <Link href={`/fleet/${v.assetId}`} className="font-semibold text-brand-700 hover:underline">
                    {assetCode.get(v.assetId) ?? "—"}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {num(v.trips)} loads{v.unmatchedTrips > 0 ? ` · ${num(v.unmatchedTrips)} without a receipt` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-rose-600">{num(v.shortageKg / 1000)} t short</p>
                  <p className="text-xs text-slate-500">{v.shortagePct != null ? `${v.shortagePct.toFixed(2)}% of what it carried` : "not measurable"}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionTitle title="Loads" subtitle="Newest first — each dispatch with the receipt that answers it" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium"><Txt text="Date" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Slip" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Vehicle" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Material" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Sent" /></th>
                <th className="px-5 py-3 text-right font-medium"><Txt text="Arrived" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Status" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="What it says" /></th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {pairs.slice(0, 60).map((p) => {
                const st = STATUS[p.status];
                return (
                  <tr key={p.dispatch.id} className="border-t border-slate-100 align-top hover:bg-brand-50/30">
                    <td className="px-5 py-3 whitespace-nowrap text-slate-600">{fmtDate(p.dispatch.date)}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">{p.dispatch.ticketNo}</td>
                    <td className="px-5 py-3">
                      {p.dispatch.assetId ? (
                        <Link href={`/fleet/${p.dispatch.assetId}`} className="font-semibold text-brand-700 hover:underline">
                          {assetCode.get(p.dispatch.assetId) ?? "—"}
                        </Link>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{p.dispatch.material}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{(p.dispatch.netKg / 1000).toFixed(2)} t</td>
                    <td className="px-5 py-3 text-right text-slate-700">
                      {p.receipt ? `${(p.receipt.netKg / 1000).toFixed(2)} t` : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-3"><Badge color={st.cls}>{st.label}</Badge></td>
                    <td className="px-5 py-3">
                      {p.reasons.length ? (
                        <ul className="max-w-md list-inside list-disc text-xs text-slate-500">
                          {p.reasons.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      ) : (
                        <span className="text-xs text-slate-400">Sent and arrived agree.</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right"><DeleteTicketButton id={p.dispatch.id} /></td>
                  </tr>
                );
              })}
              {pairs.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-slate-400">
                    Abhi koi weighing slip record nahi hui. Record a dispatch when a load leaves, and its receipt when it lands.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}