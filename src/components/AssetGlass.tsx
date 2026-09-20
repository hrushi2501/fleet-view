"use client";

import { useEffect } from "react";
import Link from "next/link";
import { X, Gauge, Fuel, Wrench, ShieldCheck, Loader2, ExternalLink, Activity, Radio, IdCard } from "lucide-react";
import { inr, num, fmtDate, timeAgo, ASSET_CLASS_LABEL, STATUS_COLOR } from "@/lib/utils";
import { Panel, PanelTitle, DetailList, type Row } from "@/components/VehicleDetail";
import { VehicleHero, type HeroSpec } from "@/components/VehicleHero";
import { vehiclePhoto } from "@/lib/vehicle-photo";
import { useAssetDetail } from "@/lib/query-hooks";
import { Txt } from "@/components/Txt";

type Detail = {
  id: string; code: string; name: string; registrationNo: string | null; assetClass: string; category: string;
  ownershipType: string; make: string; model: string; yearMfg: number; primaryMeter: string; meterValue: number;
  fuelCapacity: number; status: string; healthScore: number; utilization: number; acquisitionCost: number;
  lat: number; lng: number; lastSeen: string;
  project: { code: string; name: string; location: string } | null; driver: { name: string } | null;
  compliance: { docType: string; number: string; expiryDate: string; status: string }[];
  workOrders: { woNo: string; type: string; description: string; totalCost: number; status: string }[];
  fuel: { date: string; quantity: number; sensorRise: number; variancePct: number; anomaly: boolean }[];
  costByHead: Record<string, number>; totalCost: number;
  usage?: {
    segments: number; windowHours: number; distanceKm: number;
    distanceSource: "ODOMETER" | "GPS" | "NONE"; gpsDistanceKm: number | null;
    litresBurned: number | null; litresBurnedUncertainty: number; litresFilled: number | null;
    refuelEvents: number | null; avgKmPerL: number | null;
    suspectSegments: number | null; litresUnaccounted: number | null; worstGapHours: number;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    confidenceReasons: string[];
    insufficientData: boolean;
    fuelResolution: "RESOLVED" | "UNRESOLVED_CONTRADICTORY_SENDER" | "UNRESOLVED_IMPLAUSIBLE_MOVEMENT";
    norm: { low: number; high: number; unit: string } | null;
  };
  refuels?: {
    at: string; fromL: number; toL: number; litresAdded: number;
    confidence: string; hoursObserved: number;
  }[];
  segments?: {
    from: string; to: string; hours: number; distanceKm: number | null;
    fuelDeltaL: number | null; litresConsumed: number | null; kmPerL: number | null;
    event: string; rawEvent?: string; excessLitres: number | null; confidence: string; reasons: string[];
  }[];
  telemetry?: {
    recordedAt: string; source: string; provider: string | null;
    lastSyncAt: string | null; lastSyncStatus: string | null;
    speedKph: number | null; headingDeg: number | null; odometerKm: number | null;
    engineHours: number | null; fuelLevelPct: number | null; fuelLevelL: number | null;
    ignitionOn: boolean | null;
    raw: Record<string, unknown> | null;
  } | null;
};

/** "primaryFuelTankCapacity" -> "Primary Fuel Tank Capacity" */
function humanise(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function renderValue(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toString();
  return String(v);
}

/**
 * The small figure tile, drawn to the same specification as the full vehicle
 * page rather than the translucent one this card used to have. A dash means the
 * figure is not available, and it is deliberately grey so it never reads as a
 * measured zero.
 */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const blank = value === "—";
  return (
    <div className="rounded-[10px] border border-[#e9eef5] bg-white px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-[#8b93a5]">{label}</p>
      <p className={"text-sm font-bold tabular-nums " + (blank ? "text-slate-300" : "text-[#17233b]")}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] leading-snug text-[#8b93a5]">{sub}</p>}
    </div>
  );
}

const CONFIDENCE_STYLE: Record<string, string> = {
  HIGH: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  MEDIUM: "bg-amber-50 text-amber-800 ring-amber-200",
  LOW: "bg-slate-100 text-slate-600 ring-slate-300",
};

/**
 * Fields the adapter deliberately does not use. Showing them unannotated in a
 * panel headed "Live Telemetry" invites someone to read 1,500 L of fuel off a
 * vehicle that has a 300 L tank.
 */
const RAW_FIELD_NOTES: Record<string, string> = {
  secondaryFuelLevel1: "not used — no second tank fitted",
  secondaryFuelTankCapacity1: "not used — placeholder value",
  engineRunHour: "not used — carries the odometer, not hours",
  defLevel: "raw sensor value, unscaled",
};

const SEGMENT_STYLE: Record<string, string> = {
  STATIONARY_DROP: "bg-rose-50 text-rose-700 ring-rose-200",
  EXCESS_CONSUMPTION: "bg-amber-50 text-amber-800 ring-amber-200",
  IMPLAUSIBLE_DROP: "bg-violet-50 text-violet-700 ring-violet-200",
  REFUEL: "bg-sky-50 text-sky-700 ring-sky-200",
  NOISE: "bg-slate-100 text-slate-500 ring-slate-300",
  NORMAL: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export function AssetGlass({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const { data, error: queryError } = useAssetDetail<Detail>(assetId);
  const err = queryError ? (queryError instanceof Error ? queryError.message : "Failed to load") : "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const meterUnit = data?.primaryMeter === "SMU" ? "h" : "km";

  const heroSpecs: HeroSpec[] = data
    ? [
        { label: "MAKE & MODEL", value: [data.make, data.model].filter(Boolean).join(" ") || null, icon: "engine" },
        { label: "CLASS", value: ASSET_CLASS_LABEL[data.assetClass] ?? data.assetClass, icon: "power" },
        {
          label: data.primaryMeter === "SMU" ? "ENGINE HOURS" : "ODOMETER",
          value: data.meterValue > 0 ? `${num(data.meterValue)} ${meterUnit}` : null,
          icon: "torque",
        },
      ]
    : [];

  // Every one of these renders "Not recorded" rather than a dash or a zero when
  // the column is empty, exactly as the full page does. Half this fleet's
  // records are part-filled, and a blank that reads as zero is the specific
  // mistake this product exists to stop making.
  const identityRows: Row[] = data
    ? [
        { label: "Registration", value: data.registrationNo },
        { label: "Category", value: data.category },
        { label: "Ownership", value: data.ownershipType },
        { label: "Year", value: data.yearMfg ? String(data.yearMfg) : null, numeric: true },
        { label: "Tank capacity", value: data.fuelCapacity > 0 ? `${num(data.fuelCapacity)} L` : null, numeric: true },
        { label: "Operator", value: data.driver?.name ?? "No Driver Assigned" },
        { label: "Site", value: data.project ? `${data.project.code} — ${data.project.name}` : null },
        { label: "Acquisition cost", value: data.acquisitionCost > 0 ? inr(data.acquisitionCost) : null, numeric: true },
      ]
    : [];

  const fuelPct = data?.telemetry?.fuelLevelPct;
  const fuelUnresolved = data?.usage?.fuelResolution != null && data.usage.fuelResolution !== "RESOLVED";
  const liveRows: Row[] = data
    ? [
        { label: "Last reported", value: timeAgo(data.lastSeen), tone: "good" },
        { label: "Coordinates", value: data.lat || data.lng ? `${data.lat.toFixed(4)}, ${data.lng.toFixed(4)}` : null },
        {
          label: "Fuel level",
          // Never a zero here. A tank with no reading is unknown, and a 0 has
          // been read as an empty tank before.
          value: fuelPct != null
            ? `${fuelPct.toFixed(1)}%${data.telemetry?.fuelLevelL != null ? ` · ${data.telemetry.fuelLevelL} L` : ""}`
            : null,
          hint: fuelUnresolved ? "sender readings conflict; level not assessed" : undefined,
          numeric: true,
        },
        { label: "Speed", value: data.telemetry?.speedKph != null ? `${num(data.telemetry.speedKph)} km/h` : null, numeric: true },
        { label: "Odometer (reported)", value: data.telemetry?.odometerKm != null ? `${num(data.telemetry.odometerKm)} km` : null, numeric: true },
        { label: "Ignition", value: data.telemetry?.ignitionOn == null ? null : data.telemetry.ignitionOn ? "On" : "Off" },
        { label: "Source", value: data.telemetry?.source ?? null },
        { label: "Last polled", value: data.telemetry?.lastSyncAt ? timeAgo(data.telemetry.lastSyncAt) : null },
      ]
    : [];

  return (
    <div
      // A neutral scrim. The old one was a brand-to-violet gradient blur, which
      // tinted the card's own whites and made two views of the same vehicle
      // look like two different products.
      className="fixed inset-0 z-2000 flex items-start justify-center overflow-x-auto overflow-y-auto bg-slate-900/55 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="relative my-4 w-full max-w-4xl overflow-hidden rounded-2xl bg-[#f6f8fc] shadow-[0_24px_70px_rgba(15,23,42,0.35)] animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-5 rounded-full bg-white/90 p-2 text-slate-700 shadow-sm ring-1 ring-black/5 transition-colors hover:bg-white"
        >
          <X className="h-5 w-5" />
        </button>

        {!data && !err && (
          <div className="flex h-72 items-center justify-center bg-white text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading asset details…
          </div>
        )}
        {err && <div className="flex h-48 items-center justify-center bg-white text-rose-600">{err}</div>}

        {data && (
          <div className="relative max-h-[86vh] overflow-x-auto overflow-y-auto">
            {/* The same band the full vehicle page opens with, at the height a
                floating card can afford. Two views of one vehicle should not
                look like two products. */}
            <VehicleHero
              compact
              status={data.status.replace(/-/g, " ").toUpperCase()}
              statusTone={
                data.status === "Breakdown" || data.status === "Under-Maintenance"
                  ? "down"
                  : data.status === "Active" || data.status === "In-Transit"
                    ? "live"
                    : "idle"
              }
              titleTop={data.code}
              titleBottom={data.registrationNo ?? data.model ?? ""}
              description=""
              specs={heroSpecs}
              image={vehiclePhoto(data.assetClass, data.model)}
            />

            <div className="space-y-3.5 p-5 sm:p-6">
              {/* headline figures */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat
                  label={data.primaryMeter === "SMU" ? "Engine hours" : "Odometer"}
                  value={data.meterValue > 0 ? `${num(data.meterValue)} ${data.primaryMeter === "SMU" ? "h" : "km"}` : "—"}
                />
                <Stat label="Health" value={`${data.healthScore}`} sub={data.healthScore >= 75 ? "good" : data.healthScore >= 55 ? "watch" : "poor"} />
                <Stat label="Usage" value={`${data.utilization}%`} />
                <Stat label="Year" value={data.yearMfg ? String(data.yearMfg) : "—"} />
                <Stat label="Project" value={data.project?.code ?? "—"} sub={data.project?.name} />
              </div>

              <div className="grid gap-3.5 lg:grid-cols-2">
                <Panel>
                  <PanelTitle icon={IdCard}>IDENTITY &amp; SPECIFICATION</PanelTitle>
                  <DetailList rows={identityRows} />
                </Panel>

                <Panel>
                  <PanelTitle icon={Activity} note={data.telemetry?.provider ? `Reporting through ${data.telemetry.provider}.` : undefined}>
                    POSITION &amp; TANK
                  </PanelTitle>
                  <DetailList rows={liveRows} />
                </Panel>
              </div>

              <div className="grid gap-3.5 lg:grid-cols-2">
              </div>

              {/* usage & fuel analysis — derived from consecutive samples */}
              {data.usage && data.usage.segments > 0 && (
                <Panel>
                  <div className="mb-4 flex flex-wrap items-center gap-2.5 text-[12px] font-extrabold tracking-[.4px] text-[#155eef]">
                    <Gauge className="h-4 w-4" /> USAGE &amp; FUEL ANALYSIS
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                        CONFIDENCE_STYLE[data.usage.confidence] ?? CONFIDENCE_STYLE.LOW
                      }`}
                    >
                      {data.usage.confidence.toLowerCase()} confidence
                    </span>
                  </div>

                  {data.usage.insufficientData && (
                    <p className="mb-3 rounded-xl bg-slate-100 px-3 py-2 text-[12px] text-slate-700 ring-1 ring-inset ring-slate-300">
                      <strong>Insufficient telemetry data for reliable fuel analysis.</strong> Consumption and
                      efficiency are withheld rather than shown as a precise-looking number this data cannot
                      support. Distance and the measured tank levels are still shown, and the reasons are
                      listed below — they say what has to improve before these figures mean anything.
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <Stat
                      label="Distance"
                      value={`${data.usage.distanceKm.toLocaleString("en-IN")} km`}
                      sub={data.usage.distanceSource === "ODOMETER" ? "from odometer" : data.usage.distanceSource === "GPS" ? "from GPS track" : "no source"}
                    />
                    <Stat
                      label="Fuel burned"
                      value={data.usage.insufficientData || data.usage.litresBurned == null ? "—" : `${data.usage.litresBurned} L`}
                      sub={data.usage.insufficientData ? "not measurable" : `±${data.usage.litresBurnedUncertainty} L sender tolerance`}
                    />
                    <Stat
                      label="Efficiency"
                      value={data.usage.avgKmPerL != null && !data.usage.insufficientData ? `${data.usage.avgKmPerL} km/L` : "—"}
                      sub={data.usage.avgKmPerL != null && !data.usage.insufficientData ? "distance ÷ measured burn" : undefined}
                    />
                    <Stat
                      label="Norm"
                      value={data.usage.norm ? `${data.usage.norm.low}–${data.usage.norm.high} km/L` : "—"}
                    />
                    <Stat
                      label="Refuelled"
                      value={data.usage.litresFilled == null ? "—" : `${data.usage.litresFilled} L`}
                      sub={data.usage.refuelEvents == null ? "not assessed" : `${data.usage.refuelEvents} confirmed fill${data.usage.refuelEvents === 1 ? "" : "s"}`}
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {/* Unaccounted fuel is an accusation in waiting, so it is
                        only stated when the data can carry it. */}
                    <Stat
                      label="Unaccounted"
                      value={data.usage.insufficientData || data.usage.litresUnaccounted == null ? "—" : `${data.usage.litresUnaccounted} L`}
                      sub={
                        data.usage.insufficientData || data.usage.litresUnaccounted == null
                          ? "not assessable"
                          : data.usage.litresUnaccounted > 0
                            ? "beyond journey + idling + tolerance"
                            : "journey explains the fuel"
                      }
                    />
                    <Stat label="Window" value={`${data.usage.windowHours} h`} sub={`${data.usage.segments + 1} samples`} />
                    <Stat label="Longest gap" value={`${data.usage.worstGapHours} h`} sub="between samples" />
                  </div>

                  {data.usage.norm &&
                    data.usage.avgKmPerL != null &&
                    data.usage.avgKmPerL < data.usage.norm.low &&
                    data.usage.confidence !== "LOW" && (
                      <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-800 ring-1 ring-inset ring-rose-200">
                        Running at <strong>{data.usage.avgKmPerL} km/L</strong> against a norm of{" "}
                        {data.usage.norm.low}–{data.usage.norm.high} km/L — roughly{" "}
                        <strong>{Math.round((1 - data.usage.avgKmPerL / data.usage.norm.low) * 100)}% worse</strong>{" "}
                        than the worst the norm allows. Either the vehicle is working far harder than the norm
                        assumes, or fuel is leaving the tank without moving it.
                      </p>
                    )}

                  {data.usage.confidenceReasons.length > 0 && (
                    <div className="mt-3 rounded-xl bg-white/50 px-3 py-2 ring-1 ring-inset ring-white/60">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        How much this measurement can carry
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {data.usage.confidenceReasons.map((r, i) => (
                          <li key={i} className="text-[11px] text-slate-600">· {r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {data.refuels && data.refuels.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Sensor-detected fills
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {data.refuels.map((r, i) => (
                          <li key={i} className="text-[11px] text-slate-600">
                            {fmtDate(r.at)} · <strong>+{r.litresAdded} L</strong> ({r.fromL} → {r.toL} L)
                            {" · "}seen across {r.hoursObserved} h · {r.confidence.toLowerCase()} confidence
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {data.segments && data.segments.length > 0 && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-170 text-left text-[12px]">
                        <thead className="text-[11px] uppercase tracking-wider text-slate-500">
                          <tr>
                            <th className="py-1.5 pr-3"><Txt text="Window" /></th>
                            <th className="py-1.5 pr-3"><Txt text="Distance" /></th>
                            <th className="py-1.5 pr-3"><Txt text="Tank moved" /></th>
                            <th className="py-1.5 pr-3"><Txt text="Counted as burn" /></th>
                            <th className="py-1.5 pr-3"><Txt text="km/L" /></th>
                            <th className="py-1.5"><Txt text="Verdict" /></th>
                          </tr>
                        </thead>
                        <tbody className="text-ink-900">
                          {data.segments.map((s, i) => (
                            <tr key={i} className="border-t border-white/60">
                              <td className="py-1.5 pr-3 whitespace-nowrap">
                                {fmtDate(s.to)} <span className="text-slate-400">· {s.hours}h</span>
                              </td>
                              <td className="py-1.5 pr-3">{s.distanceKm != null ? `${s.distanceKm} km` : "—"}</td>
                              <td className="py-1.5 pr-3 text-slate-500">
                                {s.fuelDeltaL != null ? `${s.fuelDeltaL > 0 ? "+" : ""}${s.fuelDeltaL} L` : "—"}
                              </td>
                              <td className="py-1.5 pr-3">{s.litresConsumed != null ? `${s.litresConsumed} L` : "—"}</td>
                              <td className="py-1.5 pr-3">{s.kmPerL ?? "—"}</td>
                              <td className="py-1.5">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                                    SEGMENT_STYLE[s.event] ?? SEGMENT_STYLE.NORMAL
                                  }`}
                                >
                                  {s.event.replace(/_/g, " ").toLowerCase()}
                                </span>
                                {s.excessLitres != null && s.excessLitres > 0 && (
                                  <span className="ml-1.5 text-[11px] text-slate-500">
                                    +{s.excessLitres} L · {s.confidence.toLowerCase()} confidence
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-2 text-[11px] text-slate-500">
                        &ldquo;Tank moved&rdquo; is the raw sender difference; &ldquo;counted as burn&rdquo; is
                        what survived validation. A tank that moves less than the sender can resolve is marked
                        <em> noise</em> and contributes nothing to the totals above — the window&rsquo;s
                        consumption comes from its start and end levels plus any confirmed fills, so a wobble
                        that goes down and back up cannot be charged twice. An unresolved row is raw sender
                        movement retained for repair work; it is not a confirmed fill, burn, or loss.
                      </p>
                    </div>
                  )}
                </Panel>
              )}

              {/* live telemetry — every field the OEM reports */}
              {data.telemetry && (
                <Panel>
                  <PanelTitle icon={Radio}>
                    EVERY FIELD THE VEHICLE REPORTS
                  </PanelTitle>
                  <p className="-mt-3 mb-3 text-[11px] text-[#667085]">
                    Vehicle reported {timeAgo(data.telemetry.recordedAt)}
                    {data.telemetry.lastSyncAt && <> · last polled {timeAgo(data.telemetry.lastSyncAt)}</>}
                    {data.telemetry.lastSyncStatus && <> · sync {data.telemetry.lastSyncStatus}</>}
                    {" · "}struck-through fields are reported by the vehicle but not trusted by the ERP.
                  </p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-3 lg:grid-cols-4">
                    {Object.entries(data.telemetry.raw ?? {})
                      .filter(([, v]) => typeof v !== "object")
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-[11px] text-slate-500">{humanise(k)}</dt>
                          <dd className={RAW_FIELD_NOTES[k] ? "font-medium text-slate-400 line-through" : "font-medium text-ink-900"}>
                            {renderValue(v)}
                          </dd>
                          {RAW_FIELD_NOTES[k] && (
                            <p className="text-[10px] text-slate-400">{RAW_FIELD_NOTES[k]}</p>
                          )}
                        </div>
                      ))}
                  </dl>
                  {!data.telemetry.raw && (
                    <p className="text-sm text-slate-400">
                      Full payload not stored for this reading — it predates raw capture.
                    </p>
                  )}
                </Panel>
              )}

              {/* compliance */}
              <Panel>
                <PanelTitle icon={ShieldCheck}>COMPLIANCE</PanelTitle>
                <div className="space-y-1.5">
                  {data.compliance.length === 0 && <p className="text-sm text-slate-400">No documents on record.</p>}
                  {data.compliance.map((c) => (
                    <div key={c.docType} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <div><p className="font-medium text-ink-900">{c.docType}</p><p className="text-[11px] text-slate-500">exp {fmtDate(c.expiryDate)}</p></div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_COLOR[c.status]}`}>{c.status}</span>
                    </div>
                  ))}
                </div>
              </Panel>

              {/* work orders */}
              <Panel>
                <PanelTitle icon={Wrench}>RECENT WORK ORDERS</PanelTitle>
                {data.workOrders.length === 0 && <p className="text-sm text-slate-400">No work orders yet.</p>}
                <div className="space-y-2">
                  {data.workOrders.map((w) => (
                    <div key={w.woNo} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <div className="min-w-0"><p className="font-medium text-ink-900">{w.woNo} · {w.type}</p><p className="truncate text-[11px] text-slate-500">{w.description}</p></div>
                      <span className="text-xs font-medium text-ink-900">{inr(w.totalCost, { compact: true })}</span>
                    </div>
                  ))}
                </div>
              </Panel>

              {/* fuel */}
              <Panel>
                <PanelTitle icon={Fuel}>RECENT FUEL ISSUES</PanelTitle>
                {data.fuel.length === 0 && <p className="text-sm text-slate-400">No fuel entries yet.</p>}
                <div className="space-y-1.5">
                  {data.fuel.map((f, i) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <span className="text-slate-600">{fmtDate(f.date)}</span>
                      <span className="font-medium text-ink-900">{num(f.quantity)} L</span>
                      <span className={f.anomaly ? "text-xs font-medium text-rose-600" : f.sensorRise > 0 ? "text-xs text-slate-600" : "text-xs text-slate-400"}>
                        {f.anomaly ? `${f.variancePct}% ⚠` : f.sensorRise > 0 ? "Within range" : "Not assessed"}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>

              {/* footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-xs text-[#667085]">
                  Total cost (6 mo):{" "}
                  <span className="font-semibold text-[#17233b]">
                    {data.totalCost ? inr(data.totalCost, { compact: true }) : "not booked"}
                  </span>
                </p>
                <Link
                  href={`/fleet/${data.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#155eef] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1250cc]"
                >
                  Open full page <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
