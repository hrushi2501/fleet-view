"use client";

/**
 * The Fleet Edge console.
 *
 * Tata's own console is the screen this client already knows, so this one keeps
 * its shape — a live map, a status strip that doubles as a filter, a vehicle
 * list on the right, and a detail card that opens over the map. What it does
 * not keep is Fleet Edge's habit of printing a figure for everything. Every
 * value here is either measured or an em dash, because this console sits next
 * to the fuel and loss screens where a confident wrong number costs money.
 *
 * Layout is deliberately one screen with no scrolling chrome: a dispatcher
 * leaves this open all day on a wall display, and anything that needs scrolling
 * to answer "where is RJ21GE3220 and is it moving" is the wrong shape.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Search, SlidersHorizontal, Download, Share2, MapPinned, Route, Info,
  Fuel, Droplet, Clock, X, Play,
  RefreshCw, Loader2, Truck, Radio, ExternalLink, UserRound,
} from "lucide-react";
import { cn, num } from "@/lib/utils";
import { AssetGlass } from "@/components/AssetGlass";
import type { LiveFleet, LiveStatus, LiveVehicle } from "@/lib/fleet-edge-live";
import { liveVehicleReportRows } from "@/lib/live-vehicle-report";
import { toCsv } from "@/lib/reporting";
import type { FleetEdgeMapMarker, MapView } from "@/components/FleetEdgeMap";
import { PlaybackBar, useTrack } from "@/components/FleetEdgePlayback";
import { useLiveFleet } from "@/lib/query-hooks";
import { DISPATCH_STATUS_ORDER, sortLiveVehiclesByStatus } from "@/lib/live-fleet-order";

const FleetEdgeMap = dynamic(() => import("./FleetEdgeMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-500">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading map…
    </div>
  ),
});

const POLL_MS = 60_000;

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadLiveVehicleReport(vehicle: LiveVehicle) {
  // Asset codes normally contain only letters, digits and hyphens, but a
  // conservative filename keeps a malformed imported master record from
  // producing an invalid download name on any browser.
  const safeCode = vehicle.code.replace(/[^a-z0-9_-]/gi, "-") || "vehicle";
  downloadCsv(
    `fleetview-live-report-${safeCode}-${new Date().toISOString().slice(0, 10)}.csv`,
    liveVehicleReportRows(vehicle),
  );
}

// ---------------------------------------------------------------------------
// Presentation vocabulary
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<LiveStatus, string> = {
  MOVING: "Moving",
  IDLING: "Idling",
  STOPPED: "Stopped",
  OFFLINE: "Offline",
  BREAKDOWN: "Breakdown",
};

/** Order of the filter strip. Moving first: it is what a dispatcher looks at. */
const STATUS_ORDER: LiveStatus[] = [...DISPATCH_STATUS_ORDER];

const STATUS_BAR: Record<LiveStatus, string> = {
  MOVING: "bg-emerald-500",
  IDLING: "bg-amber-500",
  STOPPED: "bg-violet-500",
  OFFLINE: "bg-slate-400",
  BREAKDOWN: "bg-rose-500",
};

const STATUS_TEXT: Record<LiveStatus, string> = {
  MOVING: "text-emerald-600",
  IDLING: "text-amber-600",
  STOPPED: "text-violet-600",
  OFFLINE: "text-slate-500",
  BREAKDOWN: "text-rose-600",
};

// ---------------------------------------------------------------------------
// Formatting
//
// One rule, applied without exception: `null` renders as an em dash. A dash on
// this screen means *not measured*; it never means zero. Callers must not pass
// 0 as a stand-in for missing.
// ---------------------------------------------------------------------------

const DASH = "—";

function fmt(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return digits > 0 ? value.toFixed(digits) : num(Math.round(value));
}

function fmtDuration(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return DASH;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "12m 56s" — the age of the last sample, the way Fleet Edge stamps it. */
function fmtAge(iso: string | null, now: number): string {
  if (!iso) return "never";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtClock(iso: string | null): string {
  if (!iso) return DASH;
  return new Date(iso).toLocaleString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

/** How often the console re-reads the fleet. The sync itself runs every 2 min. */
export function FleetEdgeConsole({ initial }: { initial: LiveFleet }) {
  const { data: liveData, isFetching: refreshing, error: liveError, refetch } = useLiveFleet(initial);
  const fleet = liveData ?? initial;
  const staleError = liveError instanceof Error ? liveError.message : liveError ? "Refresh failed" : null;

  const [status, setStatus] = useState<LiveStatus | "ALL">("ALL");
  const [listTab, setListTab] = useState<"ALL" | "ON_TRIP">("ALL");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [view, setView] = useState<MapView>("streets");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [glassId, setGlassId] = useState<string | null>(null);
  const [playbackOpen, setPlaybackOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Ticks once a second purely so the "12m 56s" chips count up. Kept separate
  // from the poll so the age of the data is honest between refreshes rather
  // than frozen at whatever it was when the last response landed.
  // The first client render must use the same timestamp the server used. A
  // `Date.now()` initializer crosses a second boundary during hydration and
  // causes React to discard the tree, which then duplicates data requests.
  const initialNow = Date.parse(initial.generatedAt);
  const [now, setNow] = useState(() => Number.isFinite(initialNow) ? initialNow : 0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Whether what is on screen can still be called live.
  //
  // Polling pauses for a hidden tab, so this picture can be minutes old while
  // every row goes on counting upward once a second. Past a few poll
  // intervals, say so rather than letting the display imply the fleet went
  // quiet — the vehicles are usually fine and it is the screen that stopped.
  const stalePicture = now - Date.parse(fleet.generatedAt) > 4 * POLL_MS;

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // Selection and map focus are intentionally separate. Selecting an already
  // open vehicle must still return the map to it when a dispatcher clicks the
  // same row again after panning elsewhere.
  const focusVehicle = useCallback((vehicleId: string) => {
    setSelectedId(vehicleId);
    setFocusRequest((request) => request + 1);
  }, []);

  const selected = useMemo(
    () => fleet.vehicles.find((v) => v.id === selectedId) ?? null,
    [fleet.vehicles, selectedId],
  );

  const track = useTrack(playbackOpen ? selectedId : null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = fleet.vehicles.filter((v) => {
      if (status !== "ALL" && v.status !== status) return false;
      if (listTab === "ON_TRIP" && !v.onTrip) return false;
      if (!q) return true;
      return [v.code, v.registrationNo, v.chassisNo, v.modelLabel, v.name]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(q));
    });
    return sortLiveVehiclesByStatus(filtered);
  }, [fleet.vehicles, status, listTab, query]);

  const markers: FleetEdgeMapMarker[] = useMemo(
    () =>
      visible
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => ({
          id: v.id,
          label: v.registrationNo ?? v.code,
          status: v.status,
          lat: v.lat as number,
          lng: v.lng as number,
          headingDeg: v.headingDeg,
          driverName: v.driverName,
          onTrip: v.onTrip,
          speedKph: v.live.speedKph,
        })),
    [visible],
  );

  const unpositioned = visible.length - markers.length;
  // The map fills this container while the two panels sit above it. Give the
  // map their combined width when a vehicle is selected, so its focus point is
  // in the unobscured area rather than behind either panel.
  const focusRightInsetPx = selected
    ? sidebarOpen ? 700 : 380
    : sidebarOpen ? 320 : 0;

  return (
    <div className="space-y-3">
      {/* Leaflet panes use large internal z-indices. Isolate them so a map
          control can never rise above global UI such as the header's
          notification drawer, dialogs, or toast messages. */}
      <div className="relative z-0 isolate h-[calc(100vh-15rem)] min-h-150 w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
        <FleetEdgeMap
          markers={markers}
          selectedId={selectedId}
          focusRequest={focusRequest}
          focusRightInsetPx={focusRightInsetPx}
          onSelect={focusVehicle}
          view={view}
          track={playbackOpen ? track.points : null}
          trackCursor={playbackOpen ? track.cursor : null}
        />

        {/* Top-left: liveness and playback. */}
        <div className="pointer-events-none absolute left-3 top-3 z-1000 flex flex-col items-start gap-2">
          <span
            className={cn(
              "pointer-events-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-white shadow ring-1 ring-black/10",
              staleError ? "bg-slate-500" : "bg-rose-600",
            )}
            title={
              staleError
                ? staleError
                : `Last read ${fmtAge(fleet.generatedAt, now)} ago · refreshes every ${POLL_MS / 1000}s`
            }
          >
            <Radio className={cn("h-3.5 w-3.5", !staleError && "animate-pulse")} />
            {staleError ? "Stale" : "Live"}
          </span>

          <button
            onClick={() => {
              if (!selectedId && visible.length) focusVehicle(visible[0].id);
              setPlaybackOpen((v) => !v);
            }}
            className={cn(
              "pointer-events-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow ring-1 ring-black/10 backdrop-blur transition-colors",
              playbackOpen ? "bg-brand-600 text-white" : "bg-white/90 text-slate-700 hover:bg-white",
            )}
          >
            <Play className="h-3.5 w-3.5" /> Play Back
          </button>

          <button
            onClick={refresh}
            title={
              stalePicture
                ? "This screen has not updated recently. Click to refresh now."
                : "Refresh now"
            }
            className={cn(
              "pointer-events-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow ring-1 ring-black/10 backdrop-blur transition-colors",
              // Stale has to look different. Reading "4m ago" in the same calm
              // grey as "8s ago" is how a paused screen gets mistaken for a
              // vehicle that stopped reporting.
              stalePicture
                ? "bg-amber-100/95 text-amber-900 hover:bg-amber-100"
                : "bg-white/90 text-slate-700 hover:bg-white",
            )}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            {stalePicture ? `Not updating · ${fmtAge(fleet.generatedAt, now)} old` : `${fmtAge(fleet.generatedAt, now)} ago`}
          </button>
        </div>

        {/* Top-centre: the status strip, which is also the filter. */}
        <StatusStrip counts={fleet.counts} active={status} onChange={setStatus} />

        {/* Bottom-left: base map. */}
        <div className="absolute bottom-3 left-3 z-1000 flex overflow-hidden rounded-lg bg-white/90 shadow ring-1 ring-black/10 backdrop-blur">
          {(
            [
              ["streets", "Map"],
              ["satellite", "Satellite"],
              ["hybrid", "Hybrid"],
            ] as [MapView, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold transition-colors",
                view === v ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Vehicles with no fix at all would otherwise be silently absent from a
            screen whose whole claim is that it shows the fleet. */}
        {unpositioned > 0 && (
          <div className="absolute bottom-3 left-1/2 z-1000 -translate-x-1/2 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-600 shadow ring-1 ring-black/10 backdrop-blur">
            {unpositioned} of {visible.length} not on the map — no position reported
          </div>
        )}

        {playbackOpen && selected && (
          <PlaybackBar
            vehicle={selected}
            track={track}
            onClose={() => setPlaybackOpen(false)}
          />
        )}

        {selected && (
          <DetailCard
            v={selected}
            now={now}
            onClose={() => setSelectedId(null)}
            onOpenGlass={() => setGlassId(selected.id)}
            onPlayback={() => setPlaybackOpen(true)}
            sidebarOpen={sidebarOpen}
          />
        )}

        <aside
          className={cn(
            "absolute right-0 top-0 z-1001 flex h-full w-[min(20rem,90vw)] flex-col border-l border-slate-200 bg-white/95 shadow-xl backdrop-blur transition-transform",
            sidebarOpen ? "translate-x-0" : "translate-x-full",
          )}
        >
          <div className="flex shrink-0 overflow-hidden border-b border-slate-100">
            {(
              [
                ["ALL", "All"],
                ["ON_TRIP", "On Trip"],
              ] as ["ALL" | "ON_TRIP", string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setListTab(k)}
                className={cn(
                  "flex-1 py-2.5 text-sm font-semibold transition-colors",
                  listTab === k
                    ? "bg-ink-900 text-white"
                    : "bg-white text-slate-500 hover:bg-slate-50",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <SidebarActions
            searchOpen={searchOpen}
            onToggleSearch={() => setSearchOpen((v) => !v)}
            query={query}
            onQuery={setQuery}
            vehicles={visible}
          />

          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                No vehicle matches this filter.
              </p>
            ) : (
              visible.map((v) => (
                <VehicleCard
                  key={v.id}
                  v={v}
                  now={now}
                  active={v.id === selectedId}
                  onSelect={() => focusVehicle(v.id)}
                  onDetail={() => setGlassId(v.id)}
                  onPlayback={() => {
                    focusVehicle(v.id);
                    setPlaybackOpen(true);
                  }}
                />
              ))
            )}
          </div>
        </aside>

        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className={cn(
            "absolute top-1/2 z-1002 -translate-y-1/2 rounded-l-lg bg-white/95 py-4 pl-1.5 pr-1 text-slate-500 shadow ring-1 ring-black/10 transition-all hover:text-brand-600",
            sidebarOpen ? "right-[min(20rem,90vw)]" : "right-0",
          )}
          title={sidebarOpen ? "Hide vehicle list" : "Show vehicle list"}
        >
          <Truck className="h-4 w-4" />
        </button>
      </div>

      {glassId && <AssetGlass assetId={glassId} onClose={() => setGlassId(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status strip
// ---------------------------------------------------------------------------

function StatusStrip({
  counts,
  active,
  onChange,
}: {
  counts: LiveFleet["counts"];
  active: LiveStatus | "ALL";
  onChange: (s: LiveStatus | "ALL") => void;
}) {
  const cells: { key: LiveStatus | "ALL"; label: string; count: number; bar: string }[] = [
    { key: "ALL", label: "All", count: counts.ALL, bar: "bg-ink-900" },
    ...STATUS_ORDER.map((s) => ({
      key: s as LiveStatus | "ALL",
      label: STATUS_LABEL[s],
      count: counts[s],
      bar: STATUS_BAR[s],
    })),
  ];

  return (
    <div className="absolute left-1/2 top-3 z-1000 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 overflow-hidden rounded-xl bg-white/95 shadow-lg ring-1 ring-black/10 backdrop-blur">
      {cells.map((c) => (
        <button
          key={c.key}
          onClick={() => onChange(c.key)}
          className={cn(
            "group relative min-w-17 px-3 pb-2.5 pt-2 text-center transition-colors",
            active === c.key ? "bg-ink-900/95 text-white" : "text-slate-600 hover:bg-slate-50",
          )}
        >
          <span className="block text-lg font-bold leading-none">{c.count}</span>
          <span className="mt-0.5 block text-[11px] font-medium leading-none">{c.label}</span>
          <span className={cn("absolute inset-x-0 bottom-0 h-1", c.bar)} />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function SidebarActions({
  searchOpen,
  onToggleSearch,
  query,
  onQuery,
  vehicles,
}: {
  searchOpen: boolean;
  onToggleSearch: () => void;
  query: string;
  onQuery: (v: string) => void;
  vehicles: LiveVehicle[];
}) {
  const [copied, setCopied] = useState(false);

  /**
   * Exports exactly what is on screen, not the whole fleet.
   *
   * Anything else is a trap: somebody filters to five breakdowns, exports, and
   * gets sixty rows they then circulate as "the breakdown list".
   */
  const download = () => {
    downloadCsv(
      `fleet-live-${new Date().toISOString().slice(0, 10)}.csv`,
      vehicles.map((v) => ({
        Code: v.code, Registration: v.registrationNo ?? "", Chassis: v.chassisNo ?? "", Model: v.modelLabel,
        Status: STATUS_LABEL[v.status], "Last update": v.lastUpdate ?? "",
        "Speed (km/h)": v.live.speedKph ?? "", "Odometer (km)": v.live.odometerKm ?? "",
        "Fuel (L)": v.live.fuelLitres ?? "", "Fuel (%)": v.live.fuelPct ?? "",
        "Distance today (km)": v.today.distanceKm ?? "", "Idling today (min)": v.today.idlingMinutes ?? "",
        "km/L today": v.today.kmPerL ?? "", Confidence: v.today.confidence ?? "",
      })),
    );
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: "FleetView — Live Tracking", url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // A cancelled share sheet is not an error worth telling anyone about.
    }
  };

  return (
    <div className="shrink-0 border-b border-slate-100 px-3 py-2.5">
      <div className="grid grid-cols-4 gap-1.5">
        <ActionButton icon={Search} label="Search" active={searchOpen} onClick={onToggleSearch} />
        <ActionButton
          icon={SlidersHorizontal}
          label="Filter"
          onClick={onToggleSearch}
          title="Filter by status using the strip above the map"
        />
        <ActionButton icon={Download} label="Download" onClick={download} />
        <ActionButton icon={Share2} label={copied ? "Copied" : "Share"} onClick={share} />
      </div>

      {searchOpen && (
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Registration, chassis or code"
            className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-xs outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  active,
  title,
}: {
  icon: typeof Search;
  label: string;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[10px] font-medium transition-colors",
        active
          ? "border-brand-200 bg-brand-50 text-brand-700"
          : "border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function VehicleCard({
  v,
  now,
  active,
  onSelect,
  onDetail,
  onPlayback,
}: {
  v: LiveVehicle;
  now: number;
  active: boolean;
  onSelect: () => void;
  onDetail: () => void;
  onPlayback: () => void;
}) {
  return (
    <div
      className={cn(
        "border-b border-slate-100 transition-colors",
        active ? "bg-brand-50/70" : "hover:bg-slate-50/70",
      )}
    >
      <button onClick={onSelect} className="flex w-full gap-2.5 px-3 py-3 text-left">
        <span className={cn("w-1 shrink-0 rounded-full", STATUS_BAR[v.status])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-bold text-brand-700">
              {v.registrationNo ?? v.code}
            </p>
            <span className={cn("shrink-0 text-[10px] font-semibold", STATUS_TEXT[v.status])}>
              {STATUS_LABEL[v.status]}
            </span>
          </div>
          <p className="truncate text-[11px] text-slate-400">{v.chassisNo ?? v.code}</p>
          <p className="truncate text-[11px] text-slate-500">{v.modelLabel}</p>
          <div className="mt-1 flex items-center gap-1 text-[11px]">
            <UserRound className={cn("h-3 w-3 shrink-0", v.driverName ? "text-emerald-600" : "text-amber-500")} />
            <span className={cn("truncate font-medium", v.driverName ? "text-slate-800" : "text-amber-700")}>
              {v.driverName ? v.driverName : "No Driver Assigned"}
            </span>
          </div>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
            <Clock className="h-3 w-3 shrink-0" />
            {v.lastUpdate ? (
              <>
                <span className="font-medium">{fmtClock(v.lastUpdate)}</span>
                <span className="text-slate-400">· {fmtAge(v.lastUpdate, now)} ago</span>
              </>
            ) : (
              <span className="text-slate-400">Never reported</span>
            )}
          </p>
        </div>
      </button>

      <div className="grid grid-cols-3 gap-1 px-3 pb-2.5">
        <MiniAction icon={Route} label="Track" onClick={onPlayback} />
        <MiniAction icon={Info} label="Detail" onClick={onDetail} />
        <MiniAction icon={MapPinned} label="Locate" onClick={onSelect} />
      </div>
    </div>
  );
}

function MiniAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Route;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 rounded-md py-1 text-[10px] font-medium text-slate-500 transition-colors hover:bg-white hover:text-brand-600"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail card
// ---------------------------------------------------------------------------

function DetailCard({
  v,
  now,
  onClose,
  onOpenGlass,
  onPlayback,
  sidebarOpen,
}: {
  v: LiveVehicle;
  now: number;
  onClose: () => void;
  onOpenGlass: () => void;
  onPlayback: () => void;
  sidebarOpen: boolean;
}) {
  return (
    <div
      className={cn(
        "absolute top-3 z-1000 w-[min(23rem,calc(100%-1.5rem))] overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10",
        // Sits clear of the vehicle list rather than under it.
        sidebarOpen ? "right-[calc(min(20rem,90vw)+0.75rem)]" : "right-3",
        "max-h-[calc(100%-1.5rem)] overflow-x-auto overflow-y-auto",
      )}
    >
      <header className="sticky top-0 z-10 flex items-start gap-2.5 bg-linear-to-r from-violet-100 to-brand-50 px-3.5 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
          <Truck className="h-4.5 w-4.5 text-brand-600" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-brand-700">
            {v.registrationNo ?? v.code}
          </p>
          <p className="truncate text-[11px] text-slate-500">{v.chassisNo ?? v.code}</p>
          <p className="truncate text-[11px] text-slate-500">{v.modelLabel}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button onClick={onClose} className="text-slate-400 transition-colors hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1">
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold text-white", STATUS_BAR[v.status])}>
              {STATUS_LABEL[v.status]}
            </span>
            <span
              className="rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-bold text-white"
              title={v.lastUpdate ? `Last sample ${fmtClock(v.lastUpdate)}` : "No sample ever received"}
            >
              {fmtAge(v.lastUpdate, now)}
            </span>
          </div>
        </div>
      </header>

      {!v.live.gpsFix && v.lastUpdate && (
        <p className="border-b border-amber-100 bg-amber-50 px-3.5 py-2 text-[11px] text-amber-800">
          No GPS fix on the last sample — the position shown is the last known one, not where the
          vehicle is now.
        </p>
      )}

      <Section title="Live Vehicle Information">
        <div className="grid grid-cols-3 gap-y-3">
          <Metric label="Speed" value={`${fmt(v.live.speedKph)} Km/Hr`} muted={v.live.speedKph == null} />
          <Metric label="Odometer Reading" value={`${fmt(v.live.odometerKm)} Kms`} muted={v.live.odometerKm == null} />
          <Metric label="Fuel Level" value={v.live.fuelPct == null ? DASH : `${fmt(v.live.fuelPct)} %`} muted={v.live.fuelPct == null} />
          <Metric label="DEF Level" value={v.live.defPct == null ? "NA" : `${fmt(v.live.defPct)} %`} muted={v.live.defPct == null} />
          <Metric label="Battery Voltage" value={v.live.batteryV == null ? "NA" : `${fmt(v.live.batteryV, 1)} V`} muted={v.live.batteryV == null} />
          <Metric label="Engine Run Hrs" value={fmt(v.live.engineRunHours, 1)} muted={v.live.engineRunHours == null} />
        </div>
      </Section>

      <Section>
        <LevelBar
          icon={Fuel}
          label="Primary Fuel Level"
          litres={v.live.fuelLitres}
          capacity={v.live.fuelCapacityL}
          pct={v.live.fuelPct}
        />
        <div className="mt-3">
          <LevelBar icon={Droplet} label="DEF Level" litres={null} capacity={null} pct={v.live.defPct} />
        </div>
      </Section>

      <Section title="Today's Statistics">
        <div className="grid grid-cols-3 gap-y-3">
          <Metric
            label="Distance Travelled"
            value={v.today.distanceKm == null ? DASH : `${fmt(v.today.distanceKm, 1)} Kms`}
            muted={v.today.distanceKm == null}
          />
          <Metric label="Idling Duration" value={fmtDuration(v.today.idlingMinutes)} muted={v.today.idlingMinutes == null} />
          <Metric label="Stoppage Duration" value={fmtDuration(v.today.stoppageMinutes)} muted={v.today.stoppageMinutes == null} />
          {/* Without this the panel does not add up: distance spans the whole
              day from the odometer at each end, while idling and stoppage count
              only well-sampled intervals. Naming the remainder is what stops
              "100 km, 29 min idling" reading as a day spent driving when most
              of it was simply never seen. */}
          <Metric
            label="Not Observed"
            value={fmtDuration(v.today.unobservedMinutes)}
            muted={!v.today.unobservedMinutes}
            hint="Time today no telemetry covers — the vehicle was out of contact, so idling and stoppage exclude it. Distance still spans it, because the odometer is read at each end."
          />
          <Metric label="Engine Run Hrs" value={fmt(v.today.engineRunHours, 1)} muted={v.today.engineRunHours == null} />
          <Metric
            label="Fuel Efficiency"
            value={v.today.kmPerL == null ? DASH : `${fmt(v.today.kmPerL, 1)} Km/L`}
            muted={v.today.kmPerL == null}
            hint={
              v.today.kmPerL == null
                ? "Not enough of today has been sampled to measure a burn. Distance and tank level are still shown; mileage is withheld rather than guessed."
                : v.today.confidenceReasons.join(" ")
            }
          />
          {v.today.confidence && (
            <Metric
              label="Confidence"
              value={v.today.confidence}
              muted={v.today.confidence === "LOW"}
              hint={v.today.confidenceReasons.join(" ")}
              tone={
                v.today.confidence === "HIGH"
                  ? "text-emerald-600"
                  : v.today.confidence === "MEDIUM"
                    ? "text-amber-600"
                    : "text-rose-600"
              }
            />
          )}
        </div>
        {v.today.confidence === "LOW" && (
          <p className="mt-2.5 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] leading-relaxed text-rose-800">
            Low confidence — do not act on today&apos;s fuel figure. {v.today.confidenceReasons[0] ?? ""}
          </p>
        )}
      </Section>

      <Section title="Service Details">
        <div className="grid grid-cols-3 gap-y-3">
          <Metric
            label="Distance to Service"
            value={v.service.distanceToServiceKm == null ? "NA" : `${fmt(v.service.distanceToServiceKm)} Kms`}
            muted={v.service.distanceToServiceKm == null}
          />
          <Metric
            label="Time to service"
            value={v.service.daysToService == null ? "NA" : `${v.service.daysToService} Days`}
            muted={v.service.daysToService == null}
          />
          <Metric
            label="Service Status"
            value={v.service.status ?? "NA"}
            muted={v.service.status == null}
            tone={
              v.service.status === "OVERDUE"
                ? "text-rose-600"
                : v.service.status === "DUE"
                  ? "text-amber-600"
                  : v.service.status === "OK"
                    ? "text-emerald-600"
                    : undefined
            }
            hint={v.service.taskName ?? undefined}
          />
        </div>
      </Section>

      <Section title="Assignment">
        <div className="grid grid-cols-3 gap-y-3">
          <Metric
            label="Driver"
            value={v.driverName ? v.driverName : "No Driver Assigned"}
            muted={!v.driverName}
          />
          <Metric label="Project" value={v.projectCode ?? DASH} muted={!v.projectCode} />
          <Metric label="Trip" value={v.onTrip ? "On trip" : "Not checked in"} muted={!v.onTrip} />
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 px-3.5 py-3">
        <button
          onClick={onPlayback}
          className="rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-600"
        >
          <Route className="mr-1 inline h-3.5 w-3.5" /> Track Route
        </button>
        <Link
          href={`/fleet/${v.id}`}
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-600"
        >
          <ExternalLink className="mr-1 h-3.5 w-3.5" /> Full Page
        </Link>
        <button
          onClick={() => downloadLiveVehicleReport(v)}
          className="rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-600"
          title="Download this vehicle's details as CSV"
        >
          <Download className="mr-1 inline h-3.5 w-3.5" /> Download Report
        </button>
        <button
          onClick={onOpenGlass}
          className="rounded-lg bg-brand-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-700"
        >
          <Info className="mr-1 inline h-3.5 w-3.5" /> Details
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-100 px-3.5 py-3 first:border-t-0">
      {title && (
        <h3 className="mb-2.5 text-[13px] font-bold text-brand-700">{title}</h3>
      )}
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  muted,
  hint,
  tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  hint?: string;
  tone?: string;
}) {
  return (
    <div title={hint}>
      <p className={cn("text-sm font-bold leading-tight", tone ?? (muted ? "text-slate-300" : "text-ink-900"))}>
        {value}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-[11px] leading-tight text-slate-500">
        {label}
        {hint && <Info className="h-3 w-3 shrink-0 text-slate-300" />}
      </p>
    </div>
  );
}

function LevelBar({
  icon: Icon,
  label,
  litres,
  capacity,
  pct,
}: {
  icon: typeof Fuel;
  label: string;
  litres: number | null;
  capacity: number | null;
  pct: number | null;
}) {
  const known = pct != null;
  // Only the bar is clamped; the printed percentage stays as measured, because a
  // sender reading 103 % is a fault worth seeing rather than rounding away.
  const width = known ? Math.max(0, Math.min(100, pct)) : 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
          <Icon className="h-4 w-4 text-slate-400" />
          {label}
        </span>
        <span className="text-[13px] font-bold">
          {litres != null && (
            <>
              <span className="text-brand-600">{fmt(litres)}</span>
              <span className="text-slate-400"> / {fmt(capacity)}L</span>
            </>
          )}
          <span className={cn("ml-2", known ? "text-brand-600" : "text-slate-300")}>
            {known ? `${fmt(pct)}%` : "NA"}
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full transition-all", known ? "bg-brand-500" : "bg-transparent")}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}
