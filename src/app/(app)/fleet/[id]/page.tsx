import { db } from "@/lib/db";
import { Card, Badge, SectionTitle, Progress } from "@/components/ui";
import { inr, num, fmtDate, timeAgo, ASSET_CLASS_LABEL, STATUS_COLOR, healthColor } from "@/lib/utils";
import { AssetEntry, DeleteButton } from "@/components/EntryForms";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Fuel, Wrench, ShieldCheck, Activity, Cog, Settings2,
  Package, MapPin, ClipboardCheck,
} from "lucide-react";
import { requirePage, canSeeAsset } from "@/lib/access";
import { VehicleHero, type HeroSpec } from "@/components/VehicleHero";
import { VehicleMiniMap } from "@/components/VehicleMiniMap";
import { analyseUsage, type AnalyticsReading } from "@/lib/fleet-analytics";
import { specCards, estimatedRangeKm } from "@/lib/vehicle-spec";

export const dynamic = "force-dynamic";

/** The design's card shell: 13px radius, hairline, 20/24 padding. */
function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[13px] border border-[#e9eef5] bg-white px-6 py-5 shadow-[0_2px_8px_rgba(16,24,40,.035)] ${className}`}
    >
      {children}
    </div>
  );
}

/** The blue all-caps card heading, with an optional link on the right. */
function PanelTitle({
  icon: Icon,
  children,
  href,
  linkLabel,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-5 flex items-center gap-2.5 text-[12px] font-extrabold tracking-[.4px] text-[#155eef]">
      <Icon className="h-4 w-4" />
      {children}
      {href && linkLabel && (
        <Link href={href} className="ml-auto text-[12px] font-bold text-[#155eef] hover:underline">
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

/** A row in the LIVE TELEMETRY card — 52px tall, hairline between. */
function Metric({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-[52px] items-center justify-between gap-3 border-b border-[#edf0f4] text-[13px] last:border-b-0">
      <span className="shrink-0 text-[#17233b]">{label}</span>
      {children}
    </div>
  );
}

/**
 * Classes the supplied photograph is honestly a picture of.
 *
 * Everything else — excavators, rollers, graders, cranes, backhoes — gets the
 * plain navy band rather than a tipper wearing its name.
 */
const PHOTO_CLASSES = ["DUMPER", "TIPPER", "TRUCK", "TRANSIT_MIXER", "WATER_TANKER", "PICKUP"];

const SPEC_ICON = {
  engine: Cog,
  transmission: Settings2,
  payload: Package,
  fuel: Fuel,
} as const;

export default async function AssetDetail({ params }: { params: Promise<{ id: string }> }) {
  const access = await requirePage("fleet.view");
  const { id } = await params;

  // Holding fleet.view is permission to see *your* vehicles, not any vehicle
  // whose id you can type. Not-found rather than forbidden: telling a scoped
  // supervisor that a record exists is how you enumerate the rest of the fleet.
  if (!(await canSeeAsset(access, id))) notFound();
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

  // Efficiency for this one vehicle, measured rather than assumed. Same routine
  // the fleet screens use, so the range shown here cannot drift from them.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - 30 * 86_400_000);
  const readings = await db.telemetryReading.findMany({
    where: { assetId: asset.id, recordedAt: { gte: since } },
    orderBy: { recordedAt: "asc" },
    select: {
      recordedAt: true, lat: true, lng: true, speedKph: true,
      odometerKm: true, fuelLevelL: true, fuelLevelPct: true, ignitionOn: true,
    },
  });
  const measured =
    readings.length >= 2
      ? analyseUsage(readings as AnalyticsReading[], null, asset.fuelCapacity || null).usage
      : null;
  const kmPerL = measured && !measured.insufficientData ? measured.avgKmPerL : null;

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
  const meterUnit = asset.primaryMeter === "SMU" ? "engine hours" : "km";

  // ── Hero ────────────────────────────────────────────────────────────────
  const statusTone =
    asset.status === "Breakdown" || asset.status === "Under-Maintenance"
      ? "down"
      : asset.status === "Active" || asset.status === "In-Transit"
        ? "live"
        : "idle";

  const heroSpecs: HeroSpec[] = [
    { label: "MAKE", value: asset.make || null, icon: "engine" },
    { label: "YEAR", value: asset.yearMfg ? String(asset.yearMfg) : null, icon: "power" },
    {
      label: asset.primaryMeter === "SMU" ? "ENGINE HOURS" : "ODOMETER",
      value: asset.meterValue > 0 ? `${num(asset.meterValue)} ${meterUnit}` : null,
      icon: "torque",
    },
  ];

  const heroDescription =
    `${ASSET_CLASS_LABEL[asset.assetClass] ?? asset.assetClass} on ${asset.ownershipType.toLowerCase()} terms` +
    (asset.project ? `, working ${asset.project.name}` : ", not allocated to a site") +
    (asset.driver ? `. Operator ${asset.driver.name}.` : ". No operator assigned.");

  // ── Telemetry card ──────────────────────────────────────────────────────
  const fuelPct = asset.fuelLevelPct;
  const rangeKm = estimatedRangeKm(fuelPct, asset.fuelCapacity, kmPerL);
  const hasPosition = asset.lat !== 0 || asset.lng !== 0;

  const cards = specCards({
    fuelCapacity: asset.fuelCapacity,
    engineNo: asset.engineNo,
    chassisNo: asset.chassisNo,
    make: asset.make,
    model: asset.model,
    yearMfg: asset.yearMfg,
  });

  return (
    <div className="space-y-6">
      <Link href="/fleet" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Back to Fleet
      </Link>

      {/* Bled to the edges of the content column, as the design has it. */}
      <div className="-mx-4 overflow-hidden rounded-none lg:-mx-8">
        <VehicleHero
          status={asset.status.replace(/-/g, " ").toUpperCase()}
          statusTone={statusTone}
          titleTop={asset.code}
          titleBottom={asset.registrationNo ?? asset.model ?? asset.name}
          description={heroDescription}
          specs={heroSpecs}
          image={PHOTO_CLASSES.includes(asset.assetClass) ? "/vehicles/hero-truck.jpg" : null}
        />
      </div>

      {/* ── The designed grid: telemetry down the left, four spec cards right ── */}
      <div className="grid gap-3.5 lg:grid-cols-[1.05fr_1fr_1fr]">
        <Panel className="lg:row-span-2">
          <PanelTitle icon={Activity} href="/fleet/tracking" linkLabel="View Details">
            LIVE TELEMETRY
          </PanelTitle>

          <Metric label="Health Score">
            <strong className={`text-sm font-bold ${healthColor(asset.healthScore)}`}>{asset.healthScore}%</strong>
          </Metric>

          <Metric label="Current Location">
            <strong className="truncate text-sm font-bold text-[#17233b]">
              {hasPosition ? `${asset.lat.toFixed(3)}, ${asset.lng.toFixed(3)}` : "Not reporting"}
            </strong>
          </Metric>

          <Metric label="Fuel Level">
            {fuelPct == null ? (
              // Never `?? 0`. A tank with no reading is unknown, and a zero here
              // has previously been read as an empty tank.
              <strong className="text-sm font-medium italic text-slate-400">No sensor reading</strong>
            ) : (
              <>
                <div className="ml-auto mr-3 h-[9px] w-[145px] overflow-hidden rounded-full bg-[#e6ebf3]">
                  <div
                    className="h-full rounded-full bg-[#2d66ed]"
                    style={{ width: `${Math.max(0, Math.min(100, fuelPct))}%` }}
                  />
                </div>
                <strong className="text-sm font-bold text-[#17233b]">{Math.round(fuelPct)}%</strong>
              </>
            )}
          </Metric>

          <Metric label="Est. Range">
            <strong className={rangeKm == null ? "text-sm font-medium italic text-slate-400" : "text-sm font-bold text-[#17233b]"}>
              {rangeKm == null ? "Needs measured km/L" : `${num(rangeKm)} km`}
            </strong>
          </Metric>

          <p className="mt-4 text-[11px] leading-relaxed text-[#667085]">
            {kmPerL != null
              ? `Range from ${kmPerL} km/L measured over the last 30 days.`
              : "Range appears once this vehicle has enough telemetry to measure its own consumption — an assumed figure would be a guess someone dispatches on."}
          </p>
        </Panel>

        {cards.map((c) => {
          const Icon = SPEC_ICON[c.icon];
          return (
            <Panel key={c.label}>
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#eef4ff] text-[#155eef]">
                  <Icon className="h-[22px] w-[22px]" />
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-extrabold tracking-[.4px] text-[#155eef]">{c.label}</p>
                  {c.value ? (
                    <p className="mt-1.5 text-[19px] font-extrabold tracking-[-.2px] text-[#17233b]">{c.value}</p>
                  ) : (
                    <p className="mt-1.5 text-[19px] font-extrabold tracking-[-.2px] text-slate-300">—</p>
                  )}
                  <p className="mt-1 text-xs text-[#667085]">{c.sub}</p>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      {/* ── Map and maintenance, side by side as designed ────────────────── */}
      <div className="grid gap-3.5 lg:grid-cols-2">
        <Panel>
          <PanelTitle icon={MapPin} href="/fleet/tracking" linkLabel="View Map">
            ROUTING MAP
          </PanelTitle>
          <VehicleMiniMap
            marker={
              hasPosition
                ? {
                    id: asset.id, code: asset.code, name: asset.name,
                    assetClass: asset.assetClass, status: asset.status,
                    lat: asset.lat, lng: asset.lng, speed: asset.speed,
                    project: asset.project?.code ?? "—",
                  }
                : null
            }
          />
          <p className="mt-3 text-[11px] text-[#667085]">
            {hasPosition ? `Last reported ${timeAgo(asset.lastSeen)}.` : "Waiting on a first position report."}
          </p>
        </Panel>

        <Panel>
          <PanelTitle icon={Wrench} href="/maintenance" linkLabel="View All">
            MAINTENANCE LOG
          </PanelTitle>
          {asset.workOrders.length === 0 ? (
            <div className="grid h-[170px] place-items-center text-center">
              <div>
                <ClipboardCheck className="mx-auto mb-3 h-11 w-11 text-slate-200" />
                <b className="mb-1.5 block text-[13px] font-semibold text-[#1c2a42]">No maintenance scheduled</b>
                <span className="text-xs text-[#667085]">All systems are running smoothly</span>
              </div>
            </div>
          ) : (
            <div className="h-[170px] space-y-2 overflow-y-auto pr-1">
              {asset.workOrders.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-3 border-b border-[#edf0f4] pb-2 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-[#17233b]">{w.woNo} · {w.type}</p>
                    <p className="truncate text-xs text-[#667085]">{w.description}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-bold text-[#17233b]">{inr(w.totalCost, { compact: true })}</p>
                    <Badge color={STATUS_COLOR[w.status]}>{w.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Everything the page already did, kept ─────────────────────────── */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-ink-900">{asset.code}</h2>
            <Badge color={STATUS_COLOR[asset.status]}>{asset.status}</Badge>
          </div>
          <p className="text-sm text-slate-500">
            {asset.name} · {ASSET_CLASS_LABEL[asset.assetClass]} · {asset.ownershipType}
            {asset.registrationNo ? ` · ${asset.registrationNo}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AssetEntry projects={projOpts} asset={assetData} />
          <DeleteButton kind="asset" id={asset.id} label={asset.code} />
        </div>
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
              ["Fuel Capacity", asset.fuelCapacity > 0 ? `${asset.fuelCapacity} L` : "—"],
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
                  <span className="font-medium tabular-nums text-ink-900">{inr(val, { compact: true })}</span>
                </div>
                <Progress value={totalCost ? (val / totalCost) * 100 : 0} />
              </div>
            ))}
            {Object.keys(costByHead).length === 0 && <p className="text-sm text-slate-400">No costs booked.</p>}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Compliance" action={<ShieldCheck className="h-4 w-4 text-slate-400" />} />
          <div className="space-y-2">
            {asset.compliance.length === 0 && <p className="text-sm text-slate-400">No documents on file.</p>}
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
                    <td className="py-2 font-medium tabular-nums text-ink-900">{num(f.quantity)}</td>
                    <td className="py-2 tabular-nums text-slate-600">{num(f.sensorRise)}</td>
                    <td className={`py-2 font-medium tabular-nums ${f.variancePct > 10 ? "text-rose-600" : "text-slate-600"}`}>{f.variancePct.toFixed(1)}%</td>
                    <td className="py-2">{f.anomaly ? <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">Check</Badge> : <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">OK</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {asset.fuelTxns.length === 0 && <p className="py-3 text-sm text-slate-400">No fuel issues recorded.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
