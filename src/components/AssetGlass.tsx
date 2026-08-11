"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Gauge, MapPin, Fuel, Wrench, ShieldCheck, Loader2, ExternalLink, User, Activity } from "lucide-react";
import { inr, num, fmtDate, timeAgo, ASSET_CLASS_LABEL, STATUS_COLOR, healthColor } from "@/lib/utils";

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
    litresBurned: number; litresFilled: number; avgKmPerL: number | null;
    suspectSegments: number; litresUnaccounted: number; worstGapHours: number;
    norm: { low: number; high: number; unit: string } | null;
  };
  segments?: {
    from: string; to: string; hours: number; distanceKm: number | null;
    litresConsumed: number | null; kmPerL: number | null; event: string;
    excessLitres: number; confidence: string; reasons: string[];
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

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/50 bg-white/40 px-3 py-2 backdrop-blur-sm">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-ink-900">{value}</p>
    </div>
  );
}

export function AssetGlass({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    fetch(`/api/assets/${assetId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load"))))
      .then(setData)
      .catch((e) => setErr(e.message));
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [assetId, onClose]);

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center overflow-y-auto bg-gradient-to-br from-brand-900/40 via-slate-900/50 to-violet-900/40 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative my-8 w-full max-w-3xl overflow-hidden rounded-3xl border border-white/50 bg-white/60 shadow-[0_20px_70px_rgba(15,23,42,0.35)] backdrop-blur-2xl animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* decorative glass blobs */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-400/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-violet-400/25 blur-3xl" />

        <button onClick={onClose} className="absolute right-4 top-4 z-10 rounded-full bg-white/60 p-2 text-slate-600 ring-1 ring-white/60 backdrop-blur transition-colors hover:bg-white">
          <X className="h-5 w-5" />
        </button>

        {!data && !err && (
          <div className="flex h-72 items-center justify-center text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading asset details…
          </div>
        )}
        {err && <div className="flex h-48 items-center justify-center text-rose-600">{err}</div>}

        {data && (
          <div className="relative max-h-[84vh] overflow-y-auto p-6 sm:p-8">
            {/* header */}
            <div className="flex flex-wrap items-start justify-between gap-4 pr-10">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-bold text-white shadow-lg shadow-brand-500/30">
                  {data.code.split("-")[0]}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-bold text-ink-900">{data.code}</h2>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_COLOR[data.status] ?? "bg-slate-100 text-slate-600 ring-slate-500/20"}`}>{data.status}</span>
                  </div>
                  <p className="text-sm text-slate-600">{data.name}</p>
                  <p className="text-xs text-slate-500">{ASSET_CLASS_LABEL[data.assetClass] ?? data.assetClass} · {data.ownershipType}{data.registrationNo ? ` · ${data.registrationNo}` : ""}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-white/50 bg-white/50 px-4 py-2 text-center backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Health</p>
                <p className={`text-3xl font-bold ${healthColor(data.healthScore)}`}>{data.healthScore}</p>
              </div>
            </div>

            {/* quick chips */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Chip label={data.primaryMeter === "SMU" ? "Engine Hours" : "Odometer"} value={`${num(data.meterValue)} ${data.primaryMeter === "SMU" ? "h" : "km"}`} />
              <Chip label="Utilization" value={`${data.utilization}%`} />
              <Chip label="Year" value={data.yearMfg ? String(data.yearMfg) : "—"} />
              <Chip label="Project" value={data.project?.code ?? "—"} />
            </div>

            {/* details grid */}
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              {/* specs */}
              <div className="rounded-2xl border border-white/50 bg-white/45 p-4 backdrop-blur-sm">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900"><Activity className="h-4 w-4 text-brand-600" /> Specifications</h3>
                <dl className="grid grid-cols-2 gap-y-2.5 text-sm">
                  {[
                    ["Make / Model", `${data.make} ${data.model}`.trim()],
                    ["Category", data.category],
                    ["Fuel Capacity", data.fuelCapacity ? `${data.fuelCapacity} L` : "—"],
                    ["Operator", data.driver?.name ?? "—"],
                    ["Location", data.project?.location ?? "—"],
                    ["Last reported", timeAgo(data.lastSeen)],
                    ["Fuel level", data.telemetry?.fuelLevelPct != null
                      ? `${data.telemetry.fuelLevelPct.toFixed(1)}%${data.telemetry.fuelLevelL != null ? ` · ${data.telemetry.fuelLevelL} L` : ""}`
                      : "—"],
                    ["Acq. Cost", data.acquisitionCost ? inr(data.acquisitionCost, { compact: true }) : "—"],
                    ["Coordinates", `${data.lat.toFixed(3)}, ${data.lng.toFixed(3)}`],
                  ].map(([k, v]) => (
                    <div key={k}><dt className="text-[11px] text-slate-500">{k}</dt><dd className="font-medium text-ink-900">{v}</dd></div>
                  ))}
                </dl>
              </div>

              {/* usage & fuel analysis — derived from consecutive samples */}
              {data.usage && data.usage.segments > 0 && (
                <div className="rounded-2xl border border-white/50 bg-white/45 p-4 backdrop-blur-sm lg:col-span-2">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900">
                    <Gauge className="h-4 w-4 text-violet-600" /> Usage &amp; Fuel Analysis
                  </h3>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    <Chip label="Distance" value={`${data.usage.distanceKm.toLocaleString("en-IN")} km`} />
                    <Chip label="Diesel burned" value={`${data.usage.litresBurned} L`} />
                    <Chip
                      label="Efficiency"
                      value={data.usage.avgKmPerL != null ? `${data.usage.avgKmPerL} km/L` : "—"}
                    />
                    <Chip
                      label="Norm"
                      value={data.usage.norm ? `${data.usage.norm.low}–${data.usage.norm.high} km/L` : "—"}
                    />
                    <Chip label="Unaccounted" value={`${data.usage.litresUnaccounted} L`} />
                  </div>

                  {data.usage.norm && data.usage.avgKmPerL != null && data.usage.avgKmPerL < data.usage.norm.low && (
                    <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-800 ring-1 ring-inset ring-rose-200">
                      Running at <strong>{data.usage.avgKmPerL} km/L</strong> against a norm of{" "}
                      {data.usage.norm.low}–{data.usage.norm.high} km/L — roughly{" "}
                      <strong>{Math.round((1 - data.usage.avgKmPerL / data.usage.norm.low) * 100)}% worse</strong>{" "}
                      than the worst the norm allows. Either the vehicle is working far harder than the norm
                      assumes, or diesel is leaving the tank without moving it.
                    </p>
                  )}

                  {data.usage.worstGapHours > 1 && (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Longest gap between samples: {data.usage.worstGapHours} h. Fuel-theft detection needs
                      15-minute sampling to separate a siphon from a hard shift — treat findings below as
                      indicative, not conclusive.
                    </p>
                  )}

                  {data.segments && data.segments.length > 0 && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[560px] text-left text-[12px]">
                        <thead className="text-[11px] uppercase tracking-wider text-slate-500">
                          <tr>
                            <th className="py-1.5 pr-3">Window</th>
                            <th className="py-1.5 pr-3">Distance</th>
                            <th className="py-1.5 pr-3">Diesel</th>
                            <th className="py-1.5 pr-3">km/L</th>
                            <th className="py-1.5">Verdict</th>
                          </tr>
                        </thead>
                        <tbody className="text-ink-900">
                          {data.segments.map((s, i) => (
                            <tr key={i} className="border-t border-white/60">
                              <td className="py-1.5 pr-3 whitespace-nowrap">
                                {fmtDate(s.to)} <span className="text-slate-400">· {s.hours}h</span>
                              </td>
                              <td className="py-1.5 pr-3">{s.distanceKm != null ? `${s.distanceKm} km` : "—"}</td>
                              <td className="py-1.5 pr-3">{s.litresConsumed != null ? `${s.litresConsumed} L` : "—"}</td>
                              <td className="py-1.5 pr-3">{s.kmPerL ?? "—"}</td>
                              <td className="py-1.5">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                                    s.event === "STATIONARY_DROP"
                                      ? "bg-rose-50 text-rose-700 ring-rose-200"
                                      : s.event === "EXCESS_CONSUMPTION"
                                        ? "bg-amber-50 text-amber-800 ring-amber-200"
                                        : s.event === "REFUEL"
                                          ? "bg-sky-50 text-sky-700 ring-sky-200"
                                          : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                  }`}
                                >
                                  {s.event.replace(/_/g, " ").toLowerCase()}
                                </span>
                                {s.excessLitres > 0 && (
                                  <span className="ml-1.5 text-[11px] text-slate-500">
                                    +{s.excessLitres} L · {s.confidence.toLowerCase()} confidence
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* live telemetry — every field the OEM reports */}
              {data.telemetry && (
                <div className="rounded-2xl border border-white/50 bg-white/45 p-4 backdrop-blur-sm lg:col-span-2">
                  <h3 className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-900">
                    <Activity className="h-4 w-4 text-emerald-600" /> Live Telemetry
                    {data.telemetry.provider && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                        {data.telemetry.provider}
                      </span>
                    )}
                  </h3>
                  <p className="mb-3 text-[11px] text-slate-500">
                    Vehicle reported {timeAgo(data.telemetry.recordedAt)}
                    {data.telemetry.lastSyncAt && <> · last polled {timeAgo(data.telemetry.lastSyncAt)}</>}
                    {data.telemetry.lastSyncStatus && <> · sync {data.telemetry.lastSyncStatus}</>}
                  </p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-3 lg:grid-cols-4">
                    {Object.entries(data.telemetry.raw ?? {})
                      .filter(([, v]) => typeof v !== "object")
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-[11px] text-slate-500">{humanise(k)}</dt>
                          <dd className="font-medium text-ink-900">{renderValue(v)}</dd>
                        </div>
                      ))}
                  </dl>
                  {!data.telemetry.raw && (
                    <p className="text-sm text-slate-400">
                      Full payload not stored for this reading — it predates raw capture.
                    </p>
                  )}
                </div>
              )}

              {/* compliance */}
              <div className="rounded-2xl border border-white/50 bg-white/45 p-4 backdrop-blur-sm">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Compliance</h3>
                <div className="space-y-1.5">
                  {data.compliance.length === 0 && <p className="text-sm text-slate-400">No documents on record.</p>}
                  {data.compliance.map((c) => (
                    <div key={c.docType} className="flex items-center justify-between text-sm">
                      <div><p className="font-medium text-ink-900">{c.docType}</p><p className="text-[11px] text-slate-500">exp {fmtDate(c.expiryDate)}</p></div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_COLOR[c.status]}`}>{c.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* work orders */}
              <div className="rounded-2xl border border-white/50 bg-white/45 p-4 backdrop-blur-sm">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900"><Wrench className="h-4 w-4 text-blue-600" /> Recent Work Orders</h3>
                {data.workOrders.length === 0 && <p className="text-sm text-slate-400">No work orders yet.</p>}
                <div className="space-y-2">
                  {data.workOrders.map((w) => (
                    <div key={w.woNo} className="flex items-center justify-between text-sm">
                      <div className="min-w-0"><p className="font-medium text-ink-900">{w.woNo} · {w.type}</p><p className="truncate text-[11px] text-slate-500">{w.description}</p></div>
                      <span className="text-xs font-medium text-ink-900">{inr(w.totalCost, { compact: true })}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* fuel */}
              <div className="rounded-2xl border border-white/50 bg-white/45 p-4 backdrop-blur-sm">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-900"><Fuel className="h-4 w-4 text-amber-600" /> Recent Fuel Issues</h3>
                {data.fuel.length === 0 && <p className="text-sm text-slate-400">No fuel entries yet.</p>}
                <div className="space-y-1.5">
                  {data.fuel.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">{fmtDate(f.date)}</span>
                      <span className="font-medium text-ink-900">{num(f.quantity)} L</span>
                      <span className={f.anomaly ? "text-xs font-medium text-rose-600" : "text-xs text-emerald-600"}>{f.anomaly ? `${f.variancePct}% ⚠` : "OK"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* footer */}
            <div className="mt-6 flex items-center justify-between">
              <p className="text-xs text-slate-500">Total cost (6 mo): <span className="font-semibold text-ink-900">{data.totalCost ? inr(data.totalCost, { compact: true }) : "—"}</span></p>
              <Link href={`/fleet/${data.id}`} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 hover:bg-brand-600">
                Open full page <ExternalLink className="h-4 w-4" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
