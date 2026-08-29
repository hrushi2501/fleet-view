import { db } from "@/lib/db";
import { Badge, Progress } from "@/components/ui";
import {
  inr, num, fmtDate, timeAgo, calendarDaysUntil,
  ASSET_CLASS_LABEL, STATUS_COLOR, healthColor,
} from "@/lib/utils";
import { AssetEntry, DeleteButton } from "@/components/EntryForms";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Fuel, Wrench, Activity, Cog, Settings2, Package, MapPin,
  ClipboardCheck, ShieldCheck, IdCard, Banknote, Radio, Route, UserRound,
} from "lucide-react";
import { requirePage, canSeeAsset } from "@/lib/access";
import { requiredDocsFor, DOC_LABEL } from "@/lib/compliance";
import { vehiclePhoto } from "@/lib/vehicle-photo";
import { VehicleHero, type HeroSpec } from "@/components/VehicleHero";
import { VehicleMiniMap } from "@/components/VehicleMiniMap";
import { Panel, PanelTitle, DetailList, AttentionItem, Chip, type Row } from "@/components/VehicleDetail";
import { analyseUsage, type AnalyticsReading } from "@/lib/fleet-analytics";
import { specCards, estimatedRangeKm } from "@/lib/vehicle-spec";
import { depreciation } from "@/lib/costing";

export const dynamic = "force-dynamic";

const SPEC_ICON = { engine: Cog, transmission: Settings2, payload: Package, fuel: Fuel } as const;

/** "primaryFuelTankCapacity" -> "Primary Fuel Tank Capacity" */
const humanise = (k: string) =>
  k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

const showValue = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-IN") : String(v);
  return String(v);
};

/**
 * Fields the vehicle sends that this system deliberately does not use.
 *
 * Showing them unannotated under a heading like "what the vehicle reports"
 * invites somebody to read 1,500 L of diesel off a truck with a 300 L tank.
 * They are struck through and given the reason, because the honest thing is to
 * show what arrived *and* say which parts are not believed.
 */
const UNTRUSTED_FIELDS: Record<string, string> = {
  secondaryFuelLevel1: "no second tank fitted — constant 1,500 L sentinel",
  secondaryFuelTankCapacity1: "placeholder 55,555 L, not a real tank",
  engineRunHour: "carries the odometer, not engine hours",
  defLevel: "constant 65,000 — unscaled sensor value",
  defQuality: "unscaled sensor value",
  gpsAltitude: "unscaled; not used for anything",
};

/** A row in the LIVE TELEMETRY card — 52px tall, hairline between. */
function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-[52px] items-center justify-between gap-3 border-b border-[#edf0f4] text-[13px] last:border-b-0">
      <span className="shrink-0 text-[#17233b]">{label}</span>
      {children}
    </div>
  );
}

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
      telematicsProvider: true,
      trips: { orderBy: { startTime: "desc" }, take: 5 },
      fuelTxns: { where: { type: "ISSUE" }, orderBy: { date: "desc" }, take: 8 },
      workOrders: { orderBy: { reportedAt: "desc" }, take: 6 },
      compliance: { orderBy: { expiryDate: "asc" } },
      costs: true,
      tyres: true,
      components: true,
    },
  });
  if (!asset) notFound();

  // eslint-disable-next-line react-hooks/purity
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);

  const [readings, telemetryAgg, projects, latestRaw] = await Promise.all([
    db.telemetryReading.findMany({
      where: { assetId: asset.id, recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
      select: {
        recordedAt: true, lat: true, lng: true, speedKph: true,
        odometerKm: true, fuelLevelL: true, fuelLevelPct: true, ignitionOn: true,
      },
    }),
    db.telemetryReading.aggregate({
      where: { assetId: asset.id },
      _count: { _all: true },
      _min: { recordedAt: true },
      _max: { recordedAt: true },
    }),
    db.project.findMany({ orderBy: { code: "asc" } }),
    // The newest reading in full. The floating card has always shown every
    // field the vehicle reports; the page it links to showed a curated nine,
    // so the richer view was the one you had to close to read the record.
    db.telemetryReading.findFirst({
      where: { assetId: id },
      orderBy: { recordedAt: "desc" },
      select: { recordedAt: true, source: true, raw: true },
    }),
  ]);

  // Efficiency and distance for this one vehicle, measured rather than assumed.
  // Same routine the fleet screens use, so the two cannot disagree.
  const measured =
    readings.length >= 2
      ? analyseUsage(readings as AnalyticsReading[], null, asset.fuelCapacity || null).usage
      : null;
  const kmPerL = measured && !measured.insufficientData ? measured.avgKmPerL : null;

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
    // Every specification field must round-trip through the form. Omit one and
    // saving any unrelated edit writes null over it, so a record would quietly
    // empty itself each time somebody corrected a service date.
    chassisNo: asset.chassisNo, engineNo: asset.engineNo, fuelType: asset.fuelType,
    emissionNorm: asset.emissionNorm, segment: asset.segment,
    vehicleApplication: asset.vehicleApplication, branch: asset.branch,
    specification: asset.specification, engineModel: asset.engineModel,
    transmission: asset.transmission, enginePowerHp: asset.enginePowerHp,
    torqueNm: asset.torqueNm, ladenWeightKg: asset.ladenWeightKg,
    unladenWeightKg: asset.unladenWeightKg, tonnage: asset.tonnage,
    registrationDate: asset.registrationDate ? asset.registrationDate.toISOString() : null,
  };

  /* ── derived facts ──────────────────────────────────────────────────── */

  const meterUnit = asset.primaryMeter === "SMU" ? "engine hours" : "km";
  const hasPosition = asset.lat !== 0 || asset.lng !== 0;
  const fuelPct = asset.fuelLevelPct;
  const rangeKm = estimatedRangeKm(fuelPct, asset.fuelCapacity, kmPerL);

  const serviceDueInDays = asset.serviceDueDate ? calendarDaysUntil(asset.serviceDueDate, now) : null;
  const serviceOverdue = serviceDueInDays != null && serviceDueInDays < 0;

  const dep = depreciation(
    {
      acquisitionCost: asset.acquisitionCost,
      salvageValue: asset.salvageValue,
      usefulLifeYears: asset.usefulLifeYears,
      method: asset.depMethod,
      inServiceDate: asset.inServiceDate,
      yearMfg: asset.yearMfg,
    },
    now
  );

  const costByHead: Record<string, number> = {};
  for (const c of asset.costs) costByHead[c.costHead] = (costByHead[c.costHead] || 0) + c.amount;
  const totalCost = Object.values(costByHead).reduce((s, v) => s + v, 0);

  // What this machine is actually required to hold. A stationary batch plant
  // has no pollution certificate and no permit; asking for them, and then
  // reporting them missing forever, is how a warning stops being read.
  const requiredDocs = requiredDocsFor(asset.category, asset.assetClass);
  const requiredLabel = requiredDocs.map((d) => DOC_LABEL[d] ?? d).join(", ");
  const missingDocs = requiredDocs.filter(
    (t) => !asset.compliance.some((c) => c.docType === t)
  );

  const openWorkOrders = asset.workOrders.filter((w) => w.status === "Open" || w.status === "In-Progress");
  const expiringDocs = asset.compliance.filter((c) => c.status === "Expiring" || c.status === "Expired");

  // The sender is judged from what it is actually sending, not from the flag on
  // the record — a flag stays true long after a sender dies.
  const lastFuelAt = asset.fuelLevelAt;
  const sensorFresh = lastFuelAt != null && now.getTime() - lastFuelAt.getTime() < 24 * 3_600_000;

  const lastSeenMins = (now.getTime() - asset.lastSeen.getTime()) / 60_000;
  const reportingNow = lastSeenMins < 60;

  /* ── what needs somebody ────────────────────────────────────────────── */

  const attention: React.ReactNode[] = [];
  if (serviceOverdue) {
    attention.push(
      <AttentionItem
        key="svc"
        tone="bad"
        title={`Service overdue by ${Math.abs(serviceDueInDays!)} days`}
        detail={`Due ${fmtDate(asset.serviceDueDate!)}. Last serviced ${asset.lastServiceDate ? fmtDate(asset.lastServiceDate) : "— no record"}.`}
        href="/maintenance/reminders"
        action="Schedule"
      />
    );
  } else if (serviceDueInDays != null && serviceDueInDays <= 15) {
    attention.push(
      <AttentionItem
        key="svc"
        tone="warn"
        title={`Service due in ${serviceDueInDays} days`}
        detail={`Due ${fmtDate(asset.serviceDueDate!)}.`}
        href="/maintenance/reminders"
        action="Schedule"
      />
    );
  }
  if (missingDocs.length > 0) {
    attention.push(
      <AttentionItem
        key="docs"
        tone="bad"
        title={
          asset.compliance.length === 0
            ? "No compliance documents on file"
            : `${missingDocs.length} required document${missingDocs.length === 1 ? "" : "s"} missing`
        }
        detail={`${missingDocs.map((d) => DOC_LABEL[d] ?? d).join(", ")} not recorded. Nothing here proves this machine is uncovered — only that the system cannot show that it is.`}
        href="/compliance"
        action="Add"
      />
    );
  }
  if (expiringDocs.length > 0) {
    attention.push(
      <AttentionItem
        key="docs"
        tone="warn"
        title={`${expiringDocs.length} document${expiringDocs.length === 1 ? "" : "s"} expiring or expired`}
        detail={expiringDocs.map((d) => d.docType).join(", ")}
        href="/compliance"
        action="Review"
      />
    );
  }
  if (!asset.driverId) {
    attention.push(
      <AttentionItem
        key="drv"
        tone="warn"
        title="No operator assigned"
        detail="Fuel issues and trips recorded against this vehicle cannot be attributed to anyone."
        href="/drivers"
        action="Assign"
      />
    );
  }
  if (!asset.projectId) {
    attention.push(
      <AttentionItem
        key="proj"
        tone="info"
        title="Not allocated to a site"
        detail="Its running costs will not appear in any project's P&L until it is."
        href="/projects"
        action="Allocate"
      />
    );
  }
  if (asset.acquisitionCost <= 0) {
    attention.push(
      <AttentionItem
        key="cost"
        tone="info"
        title="No acquisition cost recorded"
        detail="Depreciation, book value and cost-per-km cannot be calculated for this vehicle."
        action="Edit"
        href={`/fleet/${asset.id}`}
      />
    );
  }

  /* ── the design's hero ──────────────────────────────────────────────── */

  const statusTone =
    asset.status === "Breakdown" || asset.status === "Under-Maintenance"
      ? "down"
      : asset.status === "Active" || asset.status === "In-Transit"
        ? "live"
        : "idle";

  const heroSpecs: HeroSpec[] = [
    { label: "MAKE & MODEL", value: [asset.make, asset.model].filter(Boolean).join(" ") || null, icon: "engine" },
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

  const cards = specCards({
    fuelCapacity: asset.fuelCapacity, engineNo: asset.engineNo, chassisNo: asset.chassisNo,
    make: asset.make, model: asset.model, yearMfg: asset.yearMfg,
    engineModel: asset.engineModel, enginePowerHp: asset.enginePowerHp,
    torqueNm: asset.torqueNm, transmission: asset.transmission,
    ladenWeightKg: asset.ladenWeightKg, unladenWeightKg: asset.unladenWeightKg,
    fuelType: asset.fuelType,
  });

  /* ── the record, grouped ────────────────────────────────────────────── */

  const identityRows: Row[] = [
    { label: "Asset code", value: asset.code },
    { label: "Registration", value: asset.registrationNo },
    { label: "Class", value: ASSET_CLASS_LABEL[asset.assetClass] ?? asset.assetClass },
    { label: "Category", value: asset.category },
    { label: "Make", value: asset.make || null },
    { label: "Model", value: asset.model || null },
    { label: "Year of manufacture", value: asset.yearMfg ? String(asset.yearMfg) : null, numeric: true },
    { label: "Chassis number / VIN", value: asset.chassisNo },
    { label: "Engine number", value: asset.engineNo },
    { label: "Fuel type", value: asset.fuelType },
    { label: "Emission norm", value: asset.emissionNorm },
    { label: "Segment", value: asset.segment },
    { label: "Vehicle application", value: asset.vehicleApplication },
    { label: "Registration date", value: asset.registrationDate ? fmtDate(asset.registrationDate) : null },
    { label: "Branch", value: asset.branch },
    { label: "Specification", value: asset.specification },
    { label: "Description", value: asset.name || null },
  ];

  const assignmentRows: Row[] = [
    {
      label: "Site / project",
      value: asset.project ? `${asset.project.code} — ${asset.project.name}` : null,
      href: asset.project ? `/projects` : undefined,
    },
    { label: "Location on site", value: asset.project?.location ?? null },
    { label: "Operator", value: asset.driver?.name ?? null, href: asset.driver ? `/drivers` : undefined },
    { label: "Operator licence", value: asset.driver?.licenseNo ?? null },
    { label: "Ownership", value: asset.ownershipType },
    { label: "Status", value: asset.status.replace(/-/g, " ") },
  ];

  const serviceRows: Row[] = [
    {
      label: "Next service due",
      value: asset.serviceDueDate ? fmtDate(asset.serviceDueDate) : null,
      hint:
        serviceDueInDays == null
          ? undefined
          : serviceOverdue
            ? `${Math.abs(serviceDueInDays)} days overdue`
            : `in ${serviceDueInDays} days`,
      tone: serviceOverdue ? "bad" : serviceDueInDays != null && serviceDueInDays <= 15 ? "warn" : "default",
    },
    {
      label: "Last serviced",
      value: asset.lastServiceDate ? fmtDate(asset.lastServiceDate) : null,
      hint: asset.lastServiceDate ? timeAgo(asset.lastServiceDate) : undefined,
    },
    { label: "Open work orders", value: String(openWorkOrders.length), numeric: true, tone: openWorkOrders.length ? "warn" : "good" },
    { label: "Work orders (all time)", value: String(asset.workOrders.length), numeric: true },
    { label: "Health score", value: `${asset.healthScore}`, numeric: true },
    { label: "Tyres on record", value: asset.tyres.length ? String(asset.tyres.length) : null, numeric: true },
    { label: "Major components", value: asset.components.length ? String(asset.components.length) : null, numeric: true },
    { label: "Primary meter", value: `${asset.primaryMeter} · ${num(asset.meterValue)} ${meterUnit}` },
  ];

  const financeRows: Row[] = [
    { label: "Acquisition cost", value: asset.acquisitionCost > 0 ? inr(asset.acquisitionCost) : null, numeric: true },
    { label: "Insured value", value: asset.insuredValue > 0 ? inr(asset.insuredValue) : null, numeric: true },
    { label: "Depreciation method", value: asset.depMethod === "WDV" ? "Written-down value" : "Straight line" },
    { label: "Useful life", value: `${asset.usefulLifeYears} years`, numeric: true },
    { label: "Salvage value", value: asset.salvageValue > 0 ? inr(asset.salvageValue) : null, numeric: true },
    // `known` is false when there is no cost or no in-service date. The zeros it
    // returns then are the absence of a figure, not a machine that is worth
    // nothing — printing them as money is how a fleet reports fictional profit.
    { label: "Book value today", value: dep.known ? inr(dep.bookValue) : null, numeric: true, hint: dep.known ? `${dep.ageYears.toFixed(1)} years old` : "Needs acquisition cost and in-service date" },
    { label: "Accumulated depreciation", value: dep.known ? inr(dep.accumulated) : null, numeric: true },
    { label: "Cost booked (all time)", value: totalCost > 0 ? inr(totalCost) : null, numeric: true },
    { label: "In service since", value: asset.inServiceDate ? fmtDate(asset.inServiceDate) : null },
    { label: "Commissioned", value: asset.commissionedOn ? fmtDate(asset.commissionedOn) : null },
  ];

  const samplesPerDay =
    telemetryAgg._min.recordedAt && telemetryAgg._max.recordedAt && telemetryAgg._count._all > 1
      ? telemetryAgg._count._all /
        Math.max(1, (telemetryAgg._max.recordedAt.getTime() - telemetryAgg._min.recordedAt.getTime()) / 86_400_000)
      : null;

  const telemetryRows: Row[] = [
    { label: "Provider", value: asset.telematicsProvider?.name ?? null },
    { label: "Device / IMEI", value: asset.deviceId },
    { label: "Last reported", value: timeAgo(asset.lastSeen), tone: reportingNow ? "good" : "warn", hint: fmtDate(asset.lastSeen) },
    { label: "Readings stored", value: num(telemetryAgg._count._all), numeric: true },
    { label: "Reporting since", value: telemetryAgg._min.recordedAt ? fmtDate(telemetryAgg._min.recordedAt) : null },
    { label: "Sampling rate", value: samplesPerDay ? `${num(samplesPerDay)} / day` : null, numeric: true },
    { label: "Fuel sender", value: sensorFresh ? "Reporting" : asset.hasFuelSensor ? "Fitted, silent" : null, tone: sensorFresh ? "good" : "warn", hint: lastFuelAt ? `last level ${timeAgo(lastFuelAt)}` : undefined },
    { label: "Tank capacity", value: asset.fuelCapacity > 0 ? `${num(asset.fuelCapacity)} L` : null, numeric: true },
  ];

  const usageRows: Row[] = measured
    ? [
        { label: "Distance (30 days)", value: `${num(measured.distanceKm)} km`, numeric: true, hint: `from ${measured.distanceSource.toLowerCase()}` },
        { label: "Diesel burned", value: measured.insufficientData ? null : `${num(measured.litresBurned)} L`, numeric: true, hint: measured.insufficientData ? "telemetry too sparse to say" : `±${measured.litresBurnedUncertainty} L` },
        { label: "Diesel filled", value: `${num(measured.litresFilled)} L`, numeric: true, hint: `${measured.refuelEvents} refuel event${measured.refuelEvents === 1 ? "" : "s"}` },
        { label: "Efficiency", value: kmPerL != null ? `${kmPerL} km/L` : null, numeric: true, hint: kmPerL != null ? `${measured.confidence.toLowerCase()} confidence` : "needs denser telemetry" },
        { label: "Unaccounted diesel", value: measured.insufficientData ? null : `${num(measured.litresUnaccounted)} L`, numeric: true, tone: measured.litresUnaccounted > 0 ? "warn" : "good" },
        { label: "Longest data gap", value: `${measured.worstGapHours} h`, numeric: true, tone: measured.worstGapHours > 6 ? "warn" : "default" },
        { label: "Utilisation", value: `${asset.utilization}%`, numeric: true },
        { label: "Segments analysed", value: num(measured.segments), numeric: true },
      ]
    : [];

  return (
    <div className="space-y-6 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/fleet" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-600">
          <ArrowLeft className="h-4 w-4" /> Back to Fleet
        </Link>
        <div className="flex items-center gap-2">
          <AssetEntry projects={projOpts} asset={assetData} />
          <DeleteButton kind="asset" id={asset.id} label={asset.code} />
        </div>
      </div>

      {/* Bled to the edges of the content column, as the design has it. */}
      <div className="-mx-4 overflow-hidden lg:-mx-8">
        <VehicleHero
          status={asset.status.replace(/-/g, " ").toUpperCase()}
          statusTone={statusTone}
          titleTop={asset.code}
          titleBottom={asset.registrationNo ?? asset.model ?? asset.name}
          description={heroDescription}
          specs={heroSpecs}
          image={vehiclePhoto(asset.assetClass, asset.model)}
        />
      </div>

      {/* Whoever opens a vehicle is usually asking "is anything wrong with this
          one". The answer goes here, not six cards down behind reference data. */}
      {attention.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2">{attention}</div>
      )}

      {/* ── Lifetime and measured figures ───────────────────────────────────
          Two different things side by side, each labelled with what it covers.
          The odometer and hour meter are lifetime totals the vehicle carries
          itself. Efficiency and diesel burned are measured from telemetry, and
          this system has only been receiving it since August — presenting a
          30-day figure as "overall", the way a provider dashboard does, would
          be a wrong number wearing a confident label. */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Panel>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#8b93a5]">
            {asset.primaryMeter === "SMU" ? "Engine hours" : "Odometer"}
          </p>
          <p className="mt-1.5 text-[22px] font-extrabold tracking-[-.4px] text-[#17233b]">
            {asset.meterValue > 0 ? num(asset.meterValue) : "—"}
            <span className="ml-1 text-[13px] font-semibold text-[#667085]">{meterUnit}</span>
          </p>
          <p className="mt-1 text-[11px] text-[#8b93a5]">Lifetime, as the vehicle reports it</p>
        </Panel>

        <Panel>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#8b93a5]">Engine hours</p>
          <p className="mt-1.5 text-[22px] font-extrabold tracking-[-.4px] text-[#17233b]">
            {asset.hourMeterValue > 0 ? num(asset.hourMeterValue) : <span className="text-slate-300">—</span>}
            {asset.hourMeterValue > 0 && <span className="ml-1 text-[13px] font-semibold text-[#667085]">h</span>}
          </p>
          <p className="mt-1 text-[11px] text-[#8b93a5]">
            {asset.hourMeterValue > 0 ? "Lifetime run hours" : "This vehicle sends the odometer in the hour field"}
          </p>
        </Panel>

        <Panel>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#8b93a5]">Fuel efficiency</p>
          <p className="mt-1.5 text-[22px] font-extrabold tracking-[-.4px] text-[#17233b]">
            {kmPerL != null ? `${kmPerL}` : <span className="text-slate-300">—</span>}
            {kmPerL != null && <span className="ml-1 text-[13px] font-semibold text-[#667085]">km/L</span>}
          </p>
          <p className="mt-1 text-[11px] text-[#8b93a5]">
            {kmPerL != null ? "Measured over the last 30 days" : "Needs denser telemetry"}
          </p>
        </Panel>

        <Panel>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#8b93a5]">Diesel burned</p>
          <p className="mt-1.5 text-[22px] font-extrabold tracking-[-.4px] text-[#17233b]">
            {measured && !measured.insufficientData
              ? num(measured.litresBurned)
              : <span className="text-slate-300">—</span>}
            {measured && !measured.insufficientData && (
              <span className="ml-1 text-[13px] font-semibold text-[#667085]">L</span>
            )}
          </p>
          <p className="mt-1 text-[11px] text-[#8b93a5]">
            {measured && !measured.insufficientData
              ? "Last 30 days, not lifetime"
              : "Telemetry too sparse to measure"}
          </p>
        </Panel>
      </div>

      {/* ── The designed grid ────────────────────────────────────────────── */}
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
              {hasPosition ? `${asset.lat.toFixed(4)}, ${asset.lng.toFixed(4)}` : "Not reporting"}
            </strong>
          </Metric>

          <Metric label="Fuel Level">
            {fuelPct == null ? (
              // Never `?? 0`. A tank with no reading is unknown, and a zero here
              // has previously been read as an empty tank.
              <strong className="text-sm font-medium italic text-slate-400">No sensor reading</strong>
            ) : (
              <>
                <div className="ml-auto mr-3 h-[9px] w-[120px] overflow-hidden rounded-full bg-[#e6ebf3]">
                  <div className="h-full rounded-full bg-[#2d66ed]" style={{ width: `${Math.max(0, Math.min(100, fuelPct))}%` }} />
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

          <Metric label="Speed">
            <strong className="text-sm font-bold text-[#17233b]">
              {reportingNow ? `${num(asset.speed)} km/h` : "—"}
            </strong>
          </Metric>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <Chip tone={reportingNow ? "good" : "warn"}>
              {reportingNow ? "Live" : `Last seen ${timeAgo(asset.lastSeen)}`}
            </Chip>
            {sensorFresh && <Chip tone="good">Tank sender</Chip>}
            {asset.telematicsProvider && <Chip>{asset.telematicsProvider.name}</Chip>}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-[#667085]">
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
                  <p className={`mt-1.5 truncate text-[19px] font-extrabold tracking-[-.2px] ${c.value ? "text-[#17233b]" : "text-slate-300"}`}>
                    {c.value ?? "—"}
                  </p>
                  <p className="mt-1 text-xs text-[#667085]">{c.sub}</p>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      {/* ── Map and maintenance ──────────────────────────────────────────── */}
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
            {hasPosition ? `Last reported ${timeAgo(asset.lastSeen)} · ${asset.lat.toFixed(4)}, ${asset.lng.toFixed(4)}` : "Waiting on a first position report."}
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
                <b className="mb-1.5 block text-[13px] font-semibold text-[#1c2a42]">
                  {serviceOverdue ? "No work orders raised" : "No maintenance scheduled"}
                </b>
                <span className="text-xs text-[#667085]">
                  {serviceOverdue
                    ? `Service is ${Math.abs(serviceDueInDays!)} days overdue and nothing has been raised`
                    : "All systems are running smoothly"}
                </span>
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
                    <p className="text-[13px] font-bold tabular-nums text-[#17233b]">{inr(w.totalCost, { compact: true })}</p>
                    <Badge color={STATUS_COLOR[w.status]}>{w.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── The record ───────────────────────────────────────────────────── */}
      <div className="grid gap-3.5 lg:grid-cols-2">
        <Panel>
          <PanelTitle icon={IdCard}>IDENTITY &amp; REGISTRATION</PanelTitle>
          <DetailList rows={identityRows} />
        </Panel>

        <Panel>
          <PanelTitle icon={UserRound}>ASSIGNMENT</PanelTitle>
          <DetailList rows={assignmentRows} />
        </Panel>

        <Panel>
          <PanelTitle icon={Wrench}>SERVICE &amp; CONDITION</PanelTitle>
          <DetailList rows={serviceRows} />
        </Panel>

        <Panel>
          <PanelTitle
            icon={Banknote}
            note={dep.known ? undefined : "Book value and depreciation stay blank until an acquisition cost and in-service date are recorded — a zero here would read as a machine worth nothing."}
          >
            OWNERSHIP &amp; FINANCE
          </PanelTitle>
          <DetailList rows={financeRows} />
        </Panel>

        <Panel>
          <PanelTitle icon={Radio}>TELEMETRY &amp; DEVICE</PanelTitle>
          <DetailList rows={telemetryRows} />
        </Panel>

        <Panel>
          <PanelTitle
            icon={Route}
            note={
              measured?.insufficientData
                ? "Fuel figures are withheld for this window: the sampling is too sparse to separate consumption from sender noise."
                : undefined
            }
          >
            MEASURED USE — LAST 30 DAYS
          </PanelTitle>
          {usageRows.length > 0 ? (
            <DetailList rows={usageRows} />
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">
              Not enough telemetry in the last 30 days to measure anything.
            </p>
          )}
        </Panel>
      </div>

      {/* ── Everything the vehicle reports ───────────────────────────────── */}
      {latestRaw?.raw && typeof latestRaw.raw === "object" && (
        <Panel>
          <PanelTitle
            icon={Radio}
            note={`Newest reading, ${timeAgo(latestRaw.recordedAt)} via ${latestRaw.source}. Struck-through fields are sent by the vehicle but not trusted by this system, with the reason given.`}
          >
            EVERY FIELD THIS VEHICLE REPORTS
          </PanelTitle>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
            {Object.entries(latestRaw.raw as Record<string, unknown>)
              .filter(([, v]) => typeof v !== "object")
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="truncate text-[11px] font-medium uppercase tracking-wide text-[#8b93a5]">
                    {humanise(k)}
                  </dt>
                  <dd
                    className={
                      "mt-1 truncate text-[13px] font-semibold tabular-nums " +
                      (UNTRUSTED_FIELDS[k] ? "text-slate-400 line-through" : "text-[#17233b]")
                    }
                    title={showValue(v)}
                  >
                    {showValue(v)}
                  </dd>
                  {UNTRUSTED_FIELDS[k] && (
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{UNTRUSTED_FIELDS[k]}</p>
                  )}
                </div>
              ))}
          </dl>
        </Panel>
      )}

      {/* ── Compliance ───────────────────────────────────────────────────── */}
      <Panel>
        <PanelTitle
          icon={ShieldCheck}
          href="/compliance"
          linkLabel="Manage"
          note={`Required for a ${(ASSET_CLASS_LABEL[asset.assetClass] ?? asset.assetClass).toLowerCase()}: ${requiredLabel}. Anything else is recorded but not demanded.`}
        >
          COMPLIANCE DOCUMENTS
        </PanelTitle>
        {asset.compliance.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center">
            <p className="text-[13px] font-semibold text-[#1c2a42]">No documents on file</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-[#667085]">
              This {(ASSET_CLASS_LABEL[asset.assetClass] ?? asset.assetClass).toLowerCase()} is required to hold{" "}
              {requiredLabel}. Nothing here proves it is uncovered — only that this system cannot show that it is.
            </p>
          </div>
        ) : (
          <div className="-mx-6 overflow-x-auto px-6">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="pb-2">Document</th>
                  <th className="pb-2">Number</th>
                  <th className="pb-2">Issued</th>
                  <th className="pb-2">Expires</th>
                  <th className="pb-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {asset.compliance.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 font-medium text-ink-900">{c.docType}</td>
                    {/* The compliance register this fleet keeps records expiry
                        dates only, so most rows have neither a number nor an
                        issue date. Saying so is the honest rendering. */}
                    <td className="py-2.5 tabular-nums text-slate-600">
                      {c.number ? c.number : <span className="italic text-slate-400">Not recorded</span>}
                    </td>
                    <td className="py-2.5 text-slate-600">
                      {c.issueDate ? fmtDate(c.issueDate) : <span className="italic text-slate-400">Not recorded</span>}
                    </td>
                    <td className="py-2.5 text-slate-600">
                      {fmtDate(c.expiryDate)}
                      <span className="ml-2 text-[11px] text-slate-400">{timeAgo(c.expiryDate)}</span>
                    </td>
                    <td className="py-2.5 text-right"><Badge color={STATUS_COLOR[c.status]}>{c.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ── Fuel ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-3.5 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelTitle
            icon={Fuel}
            href="/fuel"
            linkLabel="All fuel"
            note="Issued is what somebody keyed in; sensor rise is what the tank actually gained. The gap between them is the question worth asking."
          >
            RECENT FUEL ISSUES
          </PanelTitle>
          {asset.fuelTxns.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No fuel issues recorded against this vehicle.</p>
          ) : (
            <div className="-mx-6 overflow-x-auto px-6">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="pb-2">Date</th>
                    <th className="pb-2 text-right">Issued</th>
                    <th className="pb-2 text-right">Sensor rise</th>
                    <th className="pb-2 text-right">Variance</th>
                    <th className="pb-2 text-right">Amount</th>
                    <th className="pb-2 text-right">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {asset.fuelTxns.map((f) => (
                    <tr key={f.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-2.5 text-slate-600">{fmtDate(f.date)}</td>
                      <td className="py-2.5 text-right font-medium tabular-nums text-ink-900">{num(f.quantity)} L</td>
                      <td className="py-2.5 text-right tabular-nums text-slate-600">{num(f.sensorRise)} L</td>
                      <td className={`py-2.5 text-right font-medium tabular-nums ${f.variancePct > 10 ? "text-rose-600" : "text-slate-600"}`}>
                        {f.variancePct.toFixed(1)}%
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-slate-600">{inr(f.amount)}</td>
                      <td className="py-2.5 text-right">
                        {f.anomaly
                          ? <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">Check</Badge>
                          : <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">OK</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          <PanelTitle icon={Banknote} href="/costs" linkLabel="Costs">
            COST BY HEAD
          </PanelTitle>
          {totalCost > 0 ? (
            <div className="space-y-3">
              {Object.entries(costByHead).sort((a, b) => b[1] - a[1]).map(([head, val]) => (
                <div key={head}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate font-medium text-slate-700">{head}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">{inr(val, { compact: true })}</span>
                  </div>
                  <Progress value={(val / totalCost) * 100} />
                </div>
              ))}
              <div className="border-t border-slate-100 pt-3 text-sm">
                <span className="text-slate-500">Total</span>
                <span className="float-right font-bold tabular-nums text-ink-900">{inr(totalCost)}</span>
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">
              No costs booked against this vehicle.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
