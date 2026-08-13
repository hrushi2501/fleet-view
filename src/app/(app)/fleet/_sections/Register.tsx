import { db } from "@/lib/db";
import { FleetTable } from "@/components/FleetTable";
import { AssetEntry } from "@/components/EntryForms";
import { StatCard } from "@/components/ui";
import { num } from "@/lib/utils";
import { Truck, CircleCheck, CirclePause, Wrench } from "lucide-react";
import { assetScope, requirePage } from "@/lib/access";

/**
 * The vehicle and equipment register — what the company owns, hires and runs.
 *
 * Formerly the whole of `/fleet`; it is now the first tab of the Fleet module,
 * sitting beside the detailed records that used to live at `/master/assets`.
 */
export async function Register() {
  const access = await requirePage("fleet.view");
  const [assets, projects] = await Promise.all([
    db.asset.findMany({ where: assetScope(access), include: { project: true }, orderBy: { code: "asc" } }),
    db.project.findMany({ orderBy: { code: "asc" } }),
  ]);
  const projOpts = projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));
  const rows = assets.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    assetClass: a.assetClass,
    ownershipType: a.ownershipType,
    status: a.status,
    healthScore: a.healthScore,
    utilization: a.utilization,
    meterValue: a.meterValue,
    primaryMeter: a.primaryMeter,
    registrationNo: a.registrationNo,
    project: a.project?.code ?? "—",
  }));

  const active = assets.filter((a) => a.status === "Active").length;
  const idle = assets.filter((a) => a.status === "Idle").length;
  const maint = assets.filter((a) => a.status === "Under-Maintenance" || a.status === "Breakdown").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Vehicles &amp; Equipment</h2>
          <p className="text-sm text-slate-500">One register — owned, leased, hired and contractor machines</p>
        </div>
        <AssetEntry projects={projOpts} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Vehicles" value={num(assets.length)} accent="brand" icon={<Truck className="h-5 w-5" />} />
        <StatCard label="Active" value={num(active)} accent="emerald" icon={<CircleCheck className="h-5 w-5" />} />
        <StatCard label="Idle" value={num(idle)} accent="amber" icon={<CirclePause className="h-5 w-5" />} />
        <StatCard label="In Workshop / Down" value={num(maint)} accent="rose" icon={<Wrench className="h-5 w-5" />} />
      </div>

      <FleetTable rows={rows} />
    </div>
  );
}
