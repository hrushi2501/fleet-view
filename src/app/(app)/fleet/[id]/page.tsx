import { db } from "@/lib/db";
import { Card, Badge, SectionTitle, Progress } from "@/components/ui";
import { inr, num, fmtDate, timeAgo, ASSET_CLASS_LABEL, STATUS_COLOR, healthColor } from "@/lib/utils";
import { AssetEntry, DeleteButton } from "@/components/EntryForms";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Gauge, Fuel, Wrench, ShieldCheck, MapPin } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AssetDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await db.asset.findUnique({
    where: { id },
    include: {
      project: true,
      driver: true,
      trips: { orderBy: { startTime: "desc" }, take: 5 },
      fuelTxns: { where: { type: "ISSUE" }, orderBy: { date: "desc" }, take: 5 },
      workOrders: { orderBy: { reportedAt: "desc" }, take: 5 },
      compliance: { orderBy: { expiryDate: "asc" } },
      costs: true,
    },
  });
  if (!asset) notFound();

  const projects = await db.project.findMany({ orderBy: { code: "asc" } });
  const projOpts = projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));
  const assetData = {
    id: asset.id, code: asset.code, name: asset.name, assetClass: asset.assetClass, category: asset.category,
    ownershipType: asset.ownershipType, make: asset.make, model: asset.model, yearMfg: asset.yearMfg,
    primaryMeter: asset.primaryMeter, meterValue: asset.meterValue, fuelCapacity: asset.fuelCapacity,
    status: asset.status, registrationNo: asset.registrationNo, acquisitionCost: asset.acquisitionCost,
    healthScore: asset.healthScore, utilization: asset.utilization, projectId: asset.projectId,
    serviceDueDate: asset.serviceDueDate ? asset.serviceDueDate.toISOString() : null,
    lastServiceDate: asset.lastServiceDate ? asset.lastServiceDate.toISOString() : null,
    lat: asset.lat, lng: asset.lng,
  };

  const costByHead: Record<string, number> = {};
  for (const c of asset.costs) costByHead[c.costHead] = (costByHead[c.costHead] || 0) + c.amount;
  const totalCost = Object.values(costByHead).reduce((s, v) => s + v, 0);
  const totalKm = asset.trips.reduce((s, t) => s + t.distanceKm, 0);
  const meterUnit = asset.primaryMeter === "SMU" ? "engine hours" : "km";

  return (
    <div className="space-y-6">
      <Link href="/fleet" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Back to Fleet
      </Link>

      <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500 text-xl font-bold text-white">
            {asset.code.split("-")[0]}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-ink-900">{asset.code}</h1>
              <Badge color={STATUS_COLOR[asset.status]}>{asset.status}</Badge>
            </div>
            <p className="text-sm text-slate-500">
              {asset.name} · {ASSET_CLASS_LABEL[asset.assetClass]} · {asset.ownershipType}
              {asset.registrationNo ? ` · ${asset.registrationNo}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-slate-400">Health Score</p>
            <p className={`text-3xl font-bold ${healthColor(asset.healthScore)}`}>{asset.healthScore}</p>
          </div>
          <div className="flex flex-col gap-2">
            <AssetEntry projects={projOpts} asset={assetData} />
            <DeleteButton kind="asset" id={asset.id} label={asset.code} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <div className="flex items-center gap-2 text-slate-500"><Gauge className="h-4 w-4" /><span className="text-sm">Meter</span></div>
          <p className="mt-1 text-xl font-bold text-ink-900">{num(asset.meterValue)}</p>
          <p className="text-xs text-slate-400">{meterUnit}</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-slate-500"><MapPin className="h-4 w-4" /><span className="text-sm">Project</span></div>
          <p className="mt-1 text-base font-bold text-ink-900">{asset.project?.code ?? "—"}</p>
          <p className="text-xs text-slate-400">{asset.project?.location ?? ""}</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-slate-500"><span className="text-sm">Utilization</span></div>
          <p className="mt-1 text-xl font-bold text-ink-900">{asset.utilization}%</p>
          <Progress value={asset.utilization} className="mt-2" />
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-slate-500"><span className="text-sm">Total Cost (6mo)</span></div>
          <p className="mt-1 text-xl font-bold text-ink-900">{inr(totalCost, { compact: true })}</p>
          <p className="text-xs text-slate-400">Acq. {inr(asset.acquisitionCost, { compact: true })}</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Specifications" />
          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            {[
              ["Make / Model", `${asset.make} ${asset.model}`],
              ["Year", String(asset.yearMfg)],
              ["Category", asset.category],
              ["Primary Meter", asset.primaryMeter],
              ["Fuel Capacity", `${asset.fuelCapacity} L`],
              ["Assigned Operator", asset.driver?.name ?? "—"],
              ["Last Seen", timeAgo(asset.lastSeen)],
              ["Acquisition Cost", inr(asset.acquisitionCost)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-400">{k}</dt>
                <dd className="font-medium text-ink-900">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <SectionTitle title="Cost Breakdown (6 months)" />
          <div className="space-y-2.5">
            {Object.entries(costByHead).sort((a, b) => b[1] - a[1]).map(([head, val]) => (
              <div key={head}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-slate-600">{head}</span>
                  <span className="font-medium text-ink-900">{inr(val, { compact: true })}</span>
                </div>
                <Progress value={(val / totalCost) * 100} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Compliance" action={<ShieldCheck className="h-4 w-4 text-slate-400" />} />
          <div className="space-y-2">
            {asset.compliance.map((c) => (
              <div key={c.id} className="flex items-center justify-between border-b border-slate-50 py-1.5 last:border-0">
                <div>
                  <p className="text-sm font-medium text-ink-900">{c.docType}</p>
                  <p className="text-xs text-slate-400">{c.number} · exp {fmtDate(c.expiryDate)}</p>
                </div>
                <Badge color={STATUS_COLOR[c.status]}>{c.status}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Recent Work Orders" action={<Wrench className="h-4 w-4 text-slate-400" />} />
          <div className="space-y-2">
            {asset.workOrders.length === 0 && <p className="text-sm text-slate-400">No work orders.</p>}
            {asset.workOrders.map((w) => (
              <div key={w.id} className="flex items-center justify-between border-b border-slate-50 py-1.5 last:border-0">
                <div>
                  <p className="text-sm font-medium text-ink-900">{w.woNo} · {w.type}</p>
                  <p className="text-xs text-slate-400">{w.description}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-ink-900">{inr(w.totalCost, { compact: true })}</p>
                  <Badge color={STATUS_COLOR[w.status]}>{w.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle title="Recent Fuel Issues" action={<Fuel className="h-4 w-4 text-slate-400" />} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Issued (L)</th>
                <th className="py-2 font-medium">Sensor Rise (L)</th>
                <th className="py-2 font-medium">Variance</th>
                <th className="py-2 font-medium">Flag</th>
              </tr>
            </thead>
            <tbody>
              {asset.fuelTxns.map((f) => (
                <tr key={f.id} className="border-t border-slate-50">
                  <td className="py-2 text-slate-600">{fmtDate(f.date)}</td>
                  <td className="py-2 font-medium text-ink-900">{num(f.quantity)}</td>
                  <td className="py-2 text-slate-600">{num(f.sensorRise)}</td>
                  <td className={`py-2 font-medium ${f.variancePct > 10 ? "text-rose-600" : "text-slate-600"}`}>{f.variancePct.toFixed(1)}%</td>
                  <td className="py-2">{f.anomaly ? <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">Anomaly</Badge> : <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">OK</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
