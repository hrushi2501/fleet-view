"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ASSET_CLASS_LABEL, timeAgo, num, cn } from "@/lib/utils";
import { AssetGlass } from "@/components/AssetGlass";
import { Navigation, Gauge, Loader2 } from "lucide-react";

const RajasthanMap = dynamic(() => import("./RajasthanMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-100 text-slate-500">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading Rajasthan map…
    </div>
  ),
});

type Marker = {
  id: string; code: string; name: string; assetClass: string; status: string;
  speed: number; lat: number; lng: number; lastSeen: string; project: string;
  meterValue: number; primaryMeter: string;
};

const DOT: Record<string, string> = {
  Active: "bg-emerald-500", Idle: "bg-amber-500", "Under-Maintenance": "bg-blue-500",
  "In-Transit": "bg-violet-500", Breakdown: "bg-rose-500", "Off-hired": "bg-slate-400",
};

type MapView = "streets" | "satellite" | "hybrid";

export function LiveMap({ markers }: { markers: Marker[] }) {
  const [filter, setFilter] = useState("ALL");
  const [glassId, setGlassId] = useState<string | null>(null);
  const [view, setView] = useState<MapView>("streets");

  const shown = filter === "ALL" ? markers : markers.filter((m) => m.status === filter);
  const statusCounts = markers.reduce<Record<string, number>>((acc, m) => { acc[m.status] = (acc[m.status] || 0) + 1; return acc; }, {});

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="mb-3 flex flex-wrap gap-2">
          <button onClick={() => setFilter("ALL")} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${filter === "ALL" ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-slate-600 ring-slate-200"}`}>All ({markers.length})</button>
          {Object.entries(statusCounts).map(([s, c]) => (
            <button key={s} onClick={() => setFilter(s)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${filter === s ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-slate-600 ring-slate-200"}`}>
              <span className={`h-2 w-2 rounded-full ${DOT[s]}`} /> {s} ({c})
            </button>
          ))}
        </div>

        <div className="relative h-[560px] w-full overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          <div className="absolute right-3 top-3 z-[1000] rounded-lg bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-700 shadow ring-1 ring-black/5 backdrop-blur">
            <Navigation className="mr-1 inline h-3 w-3 text-brand-600" /> Rajasthan · {shown.length} assets live
          </div>
          <div className="absolute bottom-3 left-3 z-[1000] flex overflow-hidden rounded-lg bg-white/90 shadow ring-1 ring-black/10 backdrop-blur">
            {([["streets", "Map"], ["satellite", "Satellite"], ["hybrid", "Hybrid"]] as [MapView, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold transition-colors",
                  view === v ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <RajasthanMap markers={shown} selectedId={glassId} onSelect={setGlassId} view={view} />
        </div>
      </div>

      <div className="card max-h-[600px] overflow-y-auto p-0">
        <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-3">
          <p className="font-semibold text-ink-900">Asset List</p>
          <p className="text-xs text-slate-400">{shown.length} shown · click to view & locate</p>
        </div>
        <div className="divide-y divide-slate-50">
          {shown.map((m) => (
            <button key={m.id} onClick={() => setGlassId(m.id)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-50/40", glassId === m.id && "bg-brand-50/60")}>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[m.status]}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-900">{m.code}</p>
                <p className="truncate text-xs text-slate-400">{ASSET_CLASS_LABEL[m.assetClass] ?? m.assetClass} · {m.project}</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                {m.speed > 0 ? <span className="inline-flex items-center gap-1"><Gauge className="h-3 w-3" />{Math.round(m.speed)}</span> : <span>{num(m.meterValue)} {m.primaryMeter === "SMU" ? "h" : "km"}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {glassId && <AssetGlass assetId={glassId} onClose={() => setGlassId(null)} />}
    </div>
  );
}
