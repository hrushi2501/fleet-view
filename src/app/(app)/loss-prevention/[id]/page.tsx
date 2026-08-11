import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard } from "@/components/ui";
import { CaseStatusForm, NoteForm, EvidenceForm, RecoveryForm, DeleteCaseButton } from "@/components/LossForms";
import { inr, num, fmtDate, timeAgo } from "@/lib/utils";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, HandCoins, IndianRupee, Paperclip, History, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

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
const METHOD_LABEL: Record<string, string> = {
  SALARY_DEDUCTION: "Salary deduction", VENDOR_DEBIT_NOTE: "Vendor debit note", CASH: "Cash / bank", INSURANCE: "Insurance", WRITE_OFF: "Write-off",
};

export default async function CaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await db.fraudCase.findUnique({
    where: { id },
    include: {
      asset: true,
      driver: true,
      project: true,
      evidence: { orderBy: { addedAt: "desc" } },
      actions: { orderBy: { at: "desc" } },
      recoveries: { orderBy: { date: "desc" } },
    },
  });
  if (!c) notFound();

  const outstanding = Math.max(0, c.amountAtRisk - c.amountRecovered);
  const rule = c.ruleCode ? await db.controlRule.findUnique({ where: { code: c.ruleCode } }) : null;

  return (
    <div className="space-y-6">
      <Link href="/loss-prevention" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Loss Prevention
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-slate-400">{c.caseNo}</span>
            <Badge color={SEV[c.severity] ?? SEV.LOW}>{c.severity}</Badge>
            <Badge color={ST[c.status] ?? ST.CLOSED}>{c.status.replace(/_/g, " ")}</Badge>
            <Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{c.domain}</Badge>
            {rule && <span className="text-xs text-slate-400">rule {rule.code}</span>}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900">{c.title}</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Opened {fmtDate(c.openedAt)} by {c.openedBy ?? "—"}
            {c.assignedTo ? ` · assigned to ${c.assignedTo}` : ""}
            {c.dueDate ? ` · due ${fmtDate(c.dueDate)}` : ""}
            {c.closedAt ? ` · closed ${fmtDate(c.closedAt)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RecoveryForm caseId={c.id} />
          <CaseStatusForm c={{ id: c.id, status: c.status, assignedTo: c.assignedTo, rootCause: c.rootCause, disposition: c.disposition, dueDate: c.dueDate }} />
          <DeleteCaseButton id={c.id} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Risk Score" value={String(c.score)} sub={`${c.severity} severity`} accent={c.score >= 60 ? "rose" : c.score >= 30 ? "amber" : "brand"} icon={<ShieldAlert className="h-5 w-5" />} />
        <StatCard label="Amount at Risk" value={inr(c.amountAtRisk, { compact: true })} accent="rose" icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Recovered" value={inr(c.amountRecovered, { compact: true })} sub={`${c.recoveries.length} entr${c.recoveries.length === 1 ? "y" : "ies"}`} accent="emerald" icon={<HandCoins className="h-5 w-5" />} />
        <StatCard label="Outstanding" value={inr(outstanding, { compact: true })} sub={c.amountAtRisk > 0 ? `${((c.amountRecovered / c.amountAtRisk) * 100).toFixed(0)}% recovered` : "—"} accent="amber" icon={<IndianRupee className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <SectionTitle title="Summary" />
            <div className="mt-2 space-y-3 text-sm">
              {(c.summary ?? "").split("\n").filter(Boolean).map((line, i) => (
                <p key={i} className="text-slate-700">{line}</p>
              ))}
              {!c.summary && <p className="text-slate-400">No summary recorded.</p>}
              {rule && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  <strong className="text-ink-900">Triggered by: </strong>{rule.name} — {rule.description}
                </p>
              )}
              {c.rootCause && <p className="rounded-lg bg-amber-50 px-3 py-2 text-slate-700"><strong className="text-ink-900">Root cause: </strong>{c.rootCause}</p>}
              {c.disposition && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-slate-700"><strong className="text-ink-900">Disposition: </strong>{c.disposition}</p>}
            </div>
          </Card>

          <Card className="p-0">
            <div className="flex items-center justify-between p-5 pb-3">
              <SectionTitle title="Evidence" subtitle={`${c.evidence.length} item${c.evidence.length === 1 ? "" : "s"} — the pack handed to whoever decides`} action={<Paperclip className="h-4 w-4 text-slate-400" />} />
              <EvidenceForm caseId={c.id} />
            </div>
            <div className="divide-y divide-slate-100">
              {c.evidence.map((e) => (
                <div key={e.id} className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{e.kind.replace(/_/g, " ")}</Badge>
                    <span className="text-sm font-semibold text-ink-900">{e.label}</span>
                    {e.url && (
                      <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
                        <ExternalLink className="h-3 w-3" /> open
                      </a>
                    )}
                  </div>
                  {e.detail && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{e.detail}</p>}
                  <p className="mt-1 text-xs text-slate-400">{e.addedBy ?? "—"} · {timeAgo(e.addedAt)}</p>
                </div>
              ))}
              {c.evidence.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">No evidence attached yet.</p>}
            </div>
          </Card>

          {c.recoveries.length > 0 && (
            <Card className="p-0">
              <div className="p-5 pb-3"><SectionTitle title="Recoveries" subtitle="Money actually clawed back" /></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-5 py-3 font-medium">Method</th>
                      <th className="px-5 py-3 font-medium">Reference</th>
                      <th className="px-5 py-3 text-right font-medium">Amount</th>
                      <th className="px-5 py-3 font-medium">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.recoveries.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-5 py-3 whitespace-nowrap text-slate-600">{fmtDate(r.date)}</td>
                        <td className="px-5 py-3 text-slate-600">{METHOD_LABEL[r.method] ?? r.method}</td>
                        <td className="px-5 py-3 text-slate-500">{r.reference ?? "—"}</td>
                        <td className="px-5 py-3 text-right font-bold text-emerald-600">{inr(r.amount)}</td>
                        <td className="px-5 py-3 text-xs text-slate-400">{r.by ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <SectionTitle title="Subject" />
            <dl className="mt-2 space-y-2 text-sm">
              {c.asset && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Asset</dt>
                  <dd><Link href={`/fleet/${c.asset.id}`} className="font-semibold text-brand-700 hover:underline">{c.asset.code}</Link></dd>
                </div>
              )}
              {c.driver && <div className="flex justify-between"><dt className="text-slate-500">Driver</dt><dd className="font-medium text-ink-900">{c.driver.name}</dd></div>}
              {c.vendor && <div className="flex justify-between"><dt className="text-slate-500">Vendor</dt><dd className="font-medium text-ink-900">{c.vendor}</dd></div>}
              {c.project && <div className="flex justify-between"><dt className="text-slate-500">Project</dt><dd className="font-medium text-ink-900">{c.project.code}</dd></div>}
              {!c.asset && !c.driver && !c.vendor && !c.project && <p className="text-sm text-slate-400">Not linked to a specific party.</p>}
            </dl>
          </Card>

          <Card className="p-0">
            <div className="p-5 pb-3">
              <SectionTitle title="Timeline" subtitle="Audit trail" action={<History className="h-4 w-4 text-slate-400" />} />
            </div>
            <div className="px-5 pb-4">
              <NoteForm caseId={c.id} />
            </div>
            <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {c.actions.map((a) => (
                <div key={a.id} className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{a.action.replace(/_/g, " ")}</Badge>
                    <span className="text-xs text-slate-400">{timeAgo(a.at)}</span>
                  </div>
                  {a.note && <p className="mt-1 text-sm text-slate-700">{a.note}</p>}
                  <p className="mt-0.5 text-xs text-slate-400">{a.by ?? "—"}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
