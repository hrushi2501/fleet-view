"use client";

/**
 * Play Back — scrubbing a vehicle's day.
 *
 * Fleet Edge draws a smooth line through its samples. This does not, and the
 * difference is the point: our sampling has gaps, and a line drawn straight
 * across a two-hour outage looks exactly like a truck that drove the motorway
 * at a steady sixty. The track here is the observed points joined in order,
 * with the wide gaps drawn as a dashed segment and named in the readout, so a
 * playback can never imply a journey nobody watched.
 *
 * Everything the scrubber prints — speed, fuel, odometer — is the value of the
 * sample at the cursor, not an interpolation between two of them.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Pause, Play, X, TriangleAlert, Loader2, Gauge, Fuel, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveVehicle } from "@/lib/fleet-edge-live";

export type TrackPoint = {
  at: string;
  lat: number;
  lng: number;
  speedKph: number | null;
  headingDeg: number | null;
  odometerKm: number | null;
  fuelLevelL: number | null;
  fuelLevelPct: number | null;
  ignitionOn: boolean | null;
};

export type TrackMeta = {
  sampleCount: number;
  positionedCount: number;
  gpsKm: number;
  worstGapMinutes: number;
  truncated: boolean;
};

export type TrackState = {
  points: TrackPoint[];
  meta: TrackMeta | null;
  cursor: number;
  setCursor: (i: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  loading: boolean;
  error: string | null;
};

/** Cursor advances one sample per tick — a day of 2-minute polling in ~30 s. */
const TICK_MS = 250;

export function useTrack(assetId: string | null): TrackState {
  const [userCursor, setUserCursor] = useState<{ assetId: string; index: number } | null>(null);
  const [playing, setPlaying] = useState(false);

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: queryKeys.fleet.track(assetId ?? ""),
    queryFn: async ({ signal }) => {
      if (!assetId) return null;
      const res = await fetch(`/api/telematics/track?assetId=${encodeURIComponent(assetId)}`, {
        signal,
      });
      if (!res.ok) throw new Error(`Could not load track (${res.status})`);
      return res.json();
    },
    enabled: Boolean(assetId),
    staleTime: 60 * 1000,
  });

  const points = useMemo(() => (assetId && data?.points ? (data.points as TrackPoint[]) : []), [assetId, data]);
  const meta = useMemo(
    () =>
      assetId && data
        ? {
            sampleCount: data.sampleCount ?? 0,
            positionedCount: data.positionedCount ?? 0,
            gpsKm: data.gpsKm ?? 0,
            worstGapMinutes: data.worstGapMinutes ?? 0,
            truncated: Boolean(data.truncated),
          }
        : null,
    [assetId, data]
  );

  const defaultCursor = points.length > 0 ? points.length - 1 : 0;
  const cursor =
    userCursor && userCursor.assetId === assetId
      ? Math.min(Math.max(0, userCursor.index), defaultCursor)
      : defaultCursor;

  const setCursor = (i: number) => {
    if (assetId) {
      setUserCursor({ assetId, index: i });
    }
  };

  const error = queryError ? (queryError instanceof Error ? queryError.message : "Could not load track") : null;
  const loading = Boolean(assetId && isLoading);

  const cursorRef = useRef(cursor);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    if (!playing || points.length === 0) return;
    const t = setInterval(() => {
      const next = cursorRef.current + 1;
      if (next >= points.length) {
        setPlaying(false);
        return;
      }
      if (assetId) {
        setUserCursor({ assetId, index: next });
      }
    }, TICK_MS);
    return () => clearInterval(t);
  }, [playing, points.length, assetId]);

  return {
    points,
    meta,
    cursor,
    setCursor,
    playing,
    setPlaying,
    loading,
    error,
  };
}

// ---------------------------------------------------------------------------

function fmtTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function PlaybackBar({
  vehicle,
  track,
  onClose,
}: {
  vehicle: LiveVehicle;
  track: TrackState;
  onClose: () => void;
}) {
  const { points, meta, cursor, setCursor, playing, setPlaying, loading, error } = track;
  const current = points[cursor];

  const atEnd = points.length > 0 && cursor >= points.length - 1;

  const summary = useMemo(() => {
    if (!meta) return null;
    const missing = meta.sampleCount - meta.positionedCount;
    return { missing, ...meta };
  }, [meta]);

  return (
    <div className="absolute bottom-3 left-1/2 z-1001 w-[min(46rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-xl bg-white/97 p-3 shadow-2xl ring-1 ring-black/10 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => {
            if (atEnd) setCursor(0);
            setPlaying(!playing);
          }}
          disabled={loading || points.length === 0}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:bg-slate-300"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="ml-0.5 h-4 w-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-xs font-bold text-ink-900">
              {vehicle.registrationNo ?? vehicle.code}
              <span className="ml-2 font-medium text-slate-400">Today&apos;s track</span>
            </p>
            <p className="shrink-0 text-xs font-semibold text-brand-600">
              {fmtTime(current?.at)}
            </p>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(0, points.length - 1)}
            value={cursor}
            onChange={(e) => {
              setPlaying(false);
              setCursor(Number(e.target.value));
            }}
            disabled={points.length === 0}
            className="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600"
          />

          <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
            <span>{fmtTime(points[0]?.at)}</span>
            <span>
              {points.length > 0 ? `${cursor + 1} / ${points.length} samples` : "no samples"}
            </span>
            <span>{fmtTime(points[points.length - 1]?.at)}</span>
          </div>
        </div>

        <div className="hidden shrink-0 gap-4 border-l border-slate-200 pl-3 sm:flex">
          <Readout
            icon={Gauge}
            label="Speed"
            value={current?.speedKph == null ? "—" : `${Math.round(current.speedKph)} km/h`}
          />
          <Readout
            icon={Fuel}
            label="Fuel"
            value={current?.fuelLevelL == null ? "—" : `${Math.round(current.fuelLevelL)} L`}
          />
          <Readout
            icon={Clock}
            label="Odometer"
            value={current?.odometerKm == null ? "—" : `${Math.round(current.odometerKm)} km`}
          />
        </div>

        <button
          onClick={onClose}
          className="shrink-0 self-start text-slate-400 transition-colors hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-800">{error}</p>
      )}

      {!loading && !error && points.length === 0 && (
        <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
          No positioned samples for this vehicle today. Either it has not reported since midnight,
          or every sample arrived without a GPS fix.
        </p>
      )}

      {summary && points.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span>
            <span className="font-semibold text-ink-900">{summary.gpsKm} km</span> straight-line
            track
          </span>
          {summary.missing > 0 && (
            <span>
              {summary.missing} of {summary.sampleCount} samples had no fix
            </span>
          )}
          {summary.worstGapMinutes > 20 && (
            <span className="inline-flex items-center gap-1 font-medium text-amber-700">
              <TriangleAlert className="h-3 w-3" />
              Widest gap {summary.worstGapMinutes} min — the line across it is not an observed route
            </span>
          )}
          {summary.truncated && (
            <span className="font-medium text-amber-700">
              Truncated at the sample cap — showing the earliest part of the day
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function Readout({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
}) {
  return (
    <div className="text-center">
      <p className="flex items-center justify-center gap-1 text-xs font-bold text-ink-900">
        <Icon className={cn("h-3 w-3 text-slate-400")} />
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-slate-400">{label}</p>
    </div>
  );
}
