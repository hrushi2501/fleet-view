import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard, Progress } from "@/components/ui";
import { DocumentForm, RefreshStatusButton, DeleteRow } from "@/components/PeopleDocForms";
import { assetCompliance, renewalForecast, REQUIRED_DOCS, DOC_LABEL, type DocLite } from "@/lib/compliance";
import { inr, num, fmtDate, ASSET_CLASS_LABEL } from "@/lib/utils";
import { ShieldCheck, Ban, FileWarning, CalendarClock, IndianRupee, ArrowLeft, FileX2 } from "lucide-react";
import Link from "next/link";
import { requirePage, assetScope } from "@/lib/access";

export const dynamic = "force-dynamic";

const STATE_BADGE: Record<string, string> = {
  valid: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  expiring: "bg-amber-100 text-amber-700 ring-amber-600/20",
  expired: "bg-rose-100 text-rose-700 ring-rose-600/20",
  missing: "bg-rose-600 text-white ring-rose-700/20",
};

const DOC_TYPES = ["RC", "Insurance", "Fitness", "Permit", "PUC", "RoadTax"];

/**
 * Every vehicle's papers, and whether it may legally be on the road today.
 * Was `/compliance/audit`; "audit" reads as an event, and this is a standing
 * check anyone can open.
 */
export default async function ComplianceChecksPage() {
  const access = await requirePage("compliance.view");
  // Rows, not just the page: a supervisor scoped to a site sees that site.
  const visible = assetScope(access);
  const [assets, docs] = await Promise.all([
    db.asset.findMany({ where: visible, orderBy: { code: "asc" } }),
    db.complianceDoc.findMany({ where: { asset: visible }, orderBy: { expiryDate: "asc" } }),
  ]);

  const assetOpts = assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.registrationNo ?? a.name}` }));
  const docTypeOpts = DOC_TYPES.map((t) => ({ value: t, label: DOC_LABEL[t] ?? t }));

  const docsByAsset = new Map<string, DocLite[]>();
  for (const d of docs) {
    const arr = docsByAsset.get(d.assetId) ?? [];
    arr.push({ id: d.id, docType: d.docType, number: d.number, issueDate: d.issueDate, expiryDate: d.expiryDate, reminderDays: d.reminderDays, documentUrl: d.documentUrl });
    docsByAsset.set(d.assetId, arr);
  }

  const results = assets.map((a) => ({
    asset: a,
    compliance: assetCompliance(a.id, a.category, docsByAsset.get(a.id) ?? [], new Date(), a.assetClass),
  }));

  const grounded = results.filter((r) => !r.compliance.operable);
  const totalMissing = results.reduce((s, r) => s + r.compliance.missing, 0);
  const totalExpired = results.reduce((s, r) => s + r.compliance.expired, 0);
  const totalExpiring = results.reduce((s, r) => s + r.compliance.expiring, 0);
  const forecast = renewalForecast(docs.map((d) => ({ docType: d.docType, expiryDate: d.expiryDate, cost: d.cost })), 90);
  const avgScore = results.length ? results.reduce((s, r) => s + r.compliance.score, 0) / results.length : 0;

  return (
    <div className="space-y-6">
      <Link href="/compliance" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Compliance
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Documents &amp; Checks</h1>
          <p className="text-sm text-slate-500">
            Is each machine legal to send out today — including the documents that were never recorded at all
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RefreshStatusButton />
          <DocumentForm assets={assetOpts} docTypes={docTypeOpts} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Not Legal to Operate" value={num(grounded.length)} sub={`of ${num(assets.length)} machines`} accent="rose" icon={<Ban className="h-5 w-5" />} />
        <StatCard label="Missing Documents" value={num(totalMissing)} sub="never recorded" accent="rose" icon={<FileX2 className="h-5 w-5" />} />
        <StatCard label="Expired" value={num(totalExpired)} sub={`${num(totalExpiring)} expiring soon`} accent="amber" icon={<FileWarning className="h-5 w-5" />} />
        <StatCard label="Compliance Score" value={`${avgScore.toFixed(0)}%`} sub="fleet average" accent={avgScore >= 90 ? "emerald" : "amber"} icon={<ShieldCheck className="h-5 w-5" />} />
        <StatCard label="90-Day Renewals" value={inr(forecast.total, { compact: true })} sub={`${num(forecast.count)} documents`} accent="brand" icon={<IndianRupee className="h-5 w-5" />} />
      </div>

      <Card className="border-amber-200">
        <div className="flex items-start gap-3">
          <FileX2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-semibold text-ink-900">Why missing documents are listed as a problem</p>
            <p className="mt-0.5 text-sm text-slate-600">
              An expired document turns red on a screen. A document that was never entered stays invisible, and absence of
              evidence quietly reads as compliance. Every machine is checked against the full list it is required to hold
              — {REQUIRED_DOCS.VEHICLE.map((d) => DOC_LABEL[d] ?? d).join(", ")} for road vehicles, insurance for yard equipment.
            </p>
          </div>
        </div>
      </Card>

      {grounded.length > 0 && (
        <Card className="border-rose-200 p-0">
          <div className="flex items-center gap-2 p-5 pb-3">
            <Ban className="h-5 w-5 text-rose-600" />
            <SectionTitle title="Not Legal to Operate" subtitle="A blocking document is expired or was never recorded — seizure, fines and void insurance claims" />
          </div>
          <div className="divide-y divide-slate-100">
            {grounded.slice(0, 40).map(({ asset, compliance }) => (
              <div key={asset.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/fleet/${asset.id}`} className="font-semibold text-brand-700 hover:underline">{asset.code}</Link>
                  <span className="text-sm text-slate-500">{asset.registrationNo ?? asset.name}</span>
                  <Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{ASSET_CLASS_LABEL[asset.assetClass] ?? asset.assetClass}</Badge>
                  <Badge color={asset.status === "Active" ? "bg-rose-100 text-rose-700 ring-rose-600/20" : "bg-slate-100 text-slate-500 ring-slate-400/20"}>
                    {asset.status === "Active" ? "still marked Active" : asset.status}
                  </Badge>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {compliance.findings
                    .filter((f) => f.blocking && (f.state === "expired" || f.state === "missing"))
                    .map((f) => (
                      <li key={f.docType} className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge color={STATE_BADGE[f.state]}>{f.state}</Badge>
                        <span className="text-slate-700">{f.message}</span>
                        <DocumentForm
                          assets={assetOpts}
                          docTypes={docTypeOpts}
                          preset={{ assetId: asset.id, docType: f.docType, supersedesId: f.doc?.id, label: f.state === "missing" ? "Add" : "Renew" }}
                        />
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionTitle title="Machine Compliance Matrix" subtitle="Every required document per machine — grey means never recorded" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Machine</th>
                {DOC_TYPES.map((t) => <th key={t} className="px-3 py-3 text-center font-medium">{t}</th>)}
                <th className="px-5 py-3 font-medium">Score</th>
                <th className="px-5 py-3 font-medium">Operable</th>
              </tr>
            </thead>
            <tbody>
              {results.slice(0, 80).map(({ asset, compliance }) => (
                <tr key={asset.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                  <td className="px-5 py-3">
                    <Link href={`/fleet/${asset.id}`} className="font-semibold text-brand-700 hover:underline">{asset.code}</Link>
                    <p className="text-xs text-slate-400">{ASSET_CLASS_LABEL[asset.assetClass] ?? asset.assetClass} · {asset.category}</p>
                  </td>
                  {DOC_TYPES.map((t) => {
                    const f = compliance.findings.find((x) => x.docType === t);
                    const requiredHere = (REQUIRED_DOCS[asset.category] ?? REQUIRED_DOCS.VEHICLE).includes(t);
                    if (!f) return <td key={t} className="px-3 py-3 text-center text-slate-200">{requiredHere ? "—" : "·"}</td>;
                    return (
                      <td key={t} className="px-3 py-3 text-center">
                        <span
                          className={`inline-block h-3 w-3 rounded-full ${
                            f.state === "valid" ? "bg-emerald-500" : f.state === "expiring" ? "bg-amber-500" : f.state === "expired" ? "bg-rose-500" : "bg-slate-400"
                          }`}
                          title={f.message}
                        />
                        {f.days != null && <p className="mt-0.5 text-[10px] text-slate-400">{f.days < 0 ? `${Math.abs(f.days)}d ago` : `${f.days}d`}</p>}
                        {f.state === "missing" && <p className="mt-0.5 text-[10px] text-slate-400">none</p>}
                      </td>
                    );
                  })}
                  <td className="px-5 py-3">
                    <div className="w-20">
                      <Progress value={compliance.score} />
                      <p className="mt-0.5 text-xs text-slate-400">{compliance.score}%</p>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge color={compliance.operable ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : "bg-rose-100 text-rose-700 ring-rose-600/20"}>
                      {compliance.operable ? "Yes" : "No"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-emerald-500" /> Valid</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-amber-500" /> Expiring</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-rose-500" /> Expired</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full bg-slate-400" /> Never recorded</span>
          <span className="flex items-center gap-1.5"><span className="text-slate-200">·</span> Not required for this category</span>
        </div>
      </Card>

      {forecast.byType.length > 0 && (
        <Card>
          <SectionTitle title="Renewal Forecast — next 90 days" subtitle="Budget for what is about to fall due" />
          <div className="mt-2 space-y-3">
            {forecast.byType.map((f) => {
              const max = Math.max(...forecast.byType.map((x) => x.count), 1);
              return (
                <div key={f.docType}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium text-ink-900">{DOC_LABEL[f.docType] ?? f.docType}</span>
                    <span className="text-slate-500">{f.count} due · {f.cost > 0 ? inr(f.cost, { compact: true }) : "cost not set"}</span>
                  </div>
                  <Progress value={(f.count / max) * 100} />
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
