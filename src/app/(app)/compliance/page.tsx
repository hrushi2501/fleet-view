import { db } from "@/lib/db";
import { StatCard, Card, SectionTitle, Badge } from "@/components/ui";
import { Donut } from "@/components/charts";
import { ComplianceEntry } from "@/components/EntryForms";
import { num, fmtDate, STATUS_COLOR } from "@/lib/utils";
import { ShieldCheck, ShieldAlert, ShieldX, FileText } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CompliancePage() {
  const [docs, assets] = await Promise.all([
    db.complianceDoc.findMany({ include: { asset: true }, orderBy: { expiryDate: "asc" } }),
    db.asset.findMany({ orderBy: { code: "asc" } }),
  ]);
  const assetOpts = assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }));

  const valid = docs.filter((d) => d.status === "Valid").length;
  const expiring = docs.filter((d) => d.status === "Expiring").length;
  const expired = docs.filter((d) => d.status === "Expired").length;

  const byType = [...new Set(docs.map((d) => d.docType))].map((t) => ({ name: t, value: docs.filter((d) => d.docType === t).length }));
  const urgent = docs.filter((d) => d.status === "Expiring" || d.status === "Expired");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Compliance &amp; Documentation</h1>
          <p className="text-sm text-slate-500">RC, Insurance, Fitness, Permit, PUC &amp; Road Tax — with expiry tracking</p>
        </div>
        <ComplianceEntry assets={assetOpts} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Documents" value={num(docs.length)} accent="brand" icon={<FileText className="h-5 w-5" />} />
        <StatCard label="Valid" value={num(valid)} sub={`${((valid / docs.length) * 100).toFixed(0)}% compliant`} accent="emerald" icon={<ShieldCheck className="h-5 w-5" />} />
        <StatCard label="Expiring Soon" value={num(expiring)} sub="Within 30 days" accent="amber" icon={<ShieldAlert className="h-5 w-5" />} />
        <StatCard label="Expired" value={num(expired)} sub="Deployment-blocked" accent="rose" icon={<ShieldX className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <SectionTitle title="Documents by Type" />
          <Donut data={byType} />
        </Card>
        <Card className="lg:col-span-2 p-0">
          <div className="p-5 pb-3"><SectionTitle title="Expiry Watchlist" subtitle="Expiring & expired — needs renewal" /></div>
          <div className="max-h-[320px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Asset</th>
                  <th className="px-5 py-3 font-medium">Document</th>
                  <th className="px-5 py-3 font-medium">Number</th>
                  <th className="px-5 py-3 font-medium">Expiry</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {urgent.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100 hover:bg-amber-50/30">
                    <td className="px-5 py-3">{d.asset ? <Link href={`/fleet/${d.assetId}`} className="font-semibold text-brand-700 hover:underline">{d.asset.code}</Link> : "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{d.docType}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{d.number}</td>
                    <td className="px-5 py-3 text-slate-600">{fmtDate(d.expiryDate)}</td>
                    <td className="px-5 py-3"><Badge color={STATUS_COLOR[d.status]}>{d.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
