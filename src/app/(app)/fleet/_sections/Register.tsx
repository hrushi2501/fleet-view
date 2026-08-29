import { db } from "@/lib/db";
import { FleetTable } from "@/components/FleetTable";
import { AssetEntry } from "@/components/EntryForms";
import { StatCard } from "@/components/ui";
import { num } from "@/lib/utils";
import { Truck, CircleCheck, Radio, Wrench } from "lucide-react";
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

  // ───────────────────────────────────────────────────────────────────────────
  // Connected vehicles first.
  //
  // Thirteen of fifty-three report telemetry. Sorted by asset code they were
  // scattered through the list, so the ones with live position, fuel and
  // odometer sat between rows whose every live column is blank — and the
  // screen a supervisor opens to ask "where is it" mostly answered "no idea".
  //
  // Ordered by how recently each vehicle actually spoke, so a tracker that
  // stops reporting sinks on its own rather than holding a place it no longer
  // earns. Code order is kept within each group so the rest of the register
  // still reads as a register.
  // ───────────────────────────────────────────────────────────────────────────
  const REPORTING_WINDOW_MS = 24 * 3_600_000;
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const lastSeenMs = (a: (typeof assets)[number]) => a.lastSeen?.getTime() ?? 0;
  const isConnected = (a: (typeof assets)[number]) => now - lastSeenMs(a) < REPORTING_WINDOW_MS;

  const ordered = [...assets].sort((a, b) => {
    const ca = isConnected(a) ? 1 : 0;
    const cb = isConnected(b) ? 1 : 0;
    if (ca !== cb) return cb - ca;
    if (ca === 1) return lastSeenMs(b) - lastSeenMs(a);
    return a.code.localeCompare(b.code);
  });

  const connectedCount = assets.filter(isConnected).length;

  const rows = ordered.map((a) => ({
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
  const maint = assets.filter((a) => a.status === "Under-Maintenance" || a.status === "Breakdown").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Vehicles &amp; Equipment</h2>
          <p className="text-sm text-slate-500">
            One register — owned, leased, hired and contractor machines.{" "}
            {connectedCount > 0 && (
              <span className="font-medium text-emerald-700">
                {num(connectedCount)} reporting telemetry, listed first.
              </span>
            )}
          </p>
        </div>
        <AssetEntry projects={projOpts} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Vehicles" value={num(assets.length)} accent="brand" icon={<Truck className="h-5 w-5" />} />
        {/* The register's own count of what the system can actually see. A
            fleet screen that says "53" while 40 of them have never sent a
            position is answering a different question from the one being
            asked. */}
        <StatCard
          label="Reporting telemetry"
          value={`${num(connectedCount)} of ${num(assets.length)}`}
          sub={connectedCount ? "position, fuel and odometer are live" : "no vehicle has reported in 24 h"}
          accent={connectedCount > 0 ? "emerald" : "amber"}
          icon={<Radio className="h-5 w-5" />}
        />
        <StatCard label="Active" value={num(active)} accent="brand" icon={<CircleCheck className="h-5 w-5" />} />
        <StatCard label="In Workshop / Down" value={num(maint)} accent="rose" icon={<Wrench className="h-5 w-5" />} />
      </div>

      <FleetTable rows={rows} />
    </div>
  );
}
