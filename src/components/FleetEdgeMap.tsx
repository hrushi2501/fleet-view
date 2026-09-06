"use client";

/**
 * The map under the Fleet Edge console.
 *
 * Deliberately not `RajasthanMap`. That one clamps to a Rajasthan bounding box,
 * which is right for a site map and wrong here: these are highway trucks, and a
 * vehicle that runs to Gujarat or Delhi must not be pinned to the edge of a box.
 * It also draws every asset as an identical dot, where a tracking console has to
 * say at a glance which way a vehicle is pointing and what it is doing.
 */

import L from "leaflet";
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Popup, Tooltip, useMap } from "react-leaflet";
import { useEffect, useMemo, useRef } from "react";
import type { LiveStatus } from "@/lib/fleet-edge-live";
import type { TrackPoint } from "@/components/FleetEdgePlayback";

export type MapView = "streets" | "satellite" | "hybrid";

export type FleetEdgeMapMarker = {
  id: string;
  label: string;
  status: LiveStatus;
  lat: number;
  lng: number;
  headingDeg: number | null;
  driverName?: string | null;
  onTrip?: boolean;
  speedKph?: number | null;
};

/**
 * Status colours, shared with the filter strip and the sidebar's left rule.
 *
 * One colour per state across the whole console: if green means moving on the
 * map it must mean moving in the list, or the screen teaches two vocabularies.
 */
export const STATUS_HEX: Record<LiveStatus, string> = {
  MOVING: "#10b981",
  IDLING: "#f59e0b",
  STOPPED: "#8b5cf6",
  OFFLINE: "#94a3b8",
  BREAKDOWN: "#ef4444",
};

const ESRI_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_LABELS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const ESRI_ROADS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";

/** Rajasthan, used only as the fallback view when nothing has a position yet. */
const FALLBACK_BOUNDS: L.LatLngBoundsExpression = [
  [23.0, 69.3],
  [30.2, 78.3],
];

// A street-level view that identifies the vehicle's road and nearby junctions
// without zooming so close that the dispatcher loses their surrounding area.
const VEHICLE_FOCUS_ZOOM = 11;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/**
 * A truck pointing where the vehicle is pointing, with its registration on a
 * plate underneath.
 *
 * The heading is the whole reason this is a chevron and not a dot: on a trunk
 * road, "which way is it facing" is how a dispatcher tells a truck that is
 * running late from one that is running the wrong way. When the provider sends
 * no course — a stationary vehicle usually reports none — the marker falls back
 * to a plain disc rather than inventing a direction and pointing north.
 */
function vehicleIcon(m: FleetEdgeMapMarker, active: boolean): L.DivIcon {
  const color = STATUS_HEX[m.status];
  const size = active ? 40 : 32;
  const hasHeading = m.headingDeg != null && Number.isFinite(m.headingDeg);
  const rotation = hasHeading ? (m.headingDeg as number) : 0;

  const glyph = hasHeading
    ? `<svg viewBox="0 0 24 24" width="${size * 0.55}" height="${size * 0.55}" style="transform:rotate(${rotation}deg)">
         <path d="M12 2.5 19 20l-7-4.2L5 20z" fill="#fff"/>
       </svg>`
    : `<span style="display:block;width:${size * 0.3}px;height:${size * 0.3}px;border-radius:9999px;background:#fff"></span>`;

  // The label and driver badge are part of the icon so they survive panning
  // and never need a hover — a dispatcher sees who is on which truck at a glance.
  const driverBadge = m.driverName
    ? `<span style="display:block;margin-top:1px;font-size:9px;font-weight:700;color:#047857">👤 ${escapeHtml(m.driverName)}</span>`
    : `<span style="display:block;margin-top:1px;font-size:9px;font-weight:600;color:#b45309">No Driver Assigned</span>`;

  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
      <div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:${active ? 3 : 2}px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.45)${active ? `;outline:3px solid ${color}55` : ""}">
        ${glyph}
      </div>
      <div style="margin-top:3px;padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.96);border:1px solid rgba(15,23,42,.15);box-shadow:0 2px 4px rgba(15,23,42,.2);font:600 10px/1.3 ui-sans-serif,system-ui,sans-serif;color:#0f172a;white-space:nowrap;text-align:center">
        <div>${escapeHtml(m.label)}</div>
        ${driverBadge}
      </div>
    </div>`;

  return L.divIcon({
    className: "",
    html,
    iconSize: [size, size + 28],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Frames the fleet once, then follows the selection.
 *
 * Refitting on every poll would yank the map out from under anyone reading it,
 * so the initial fit is guarded by a ref and only an explicit selection moves
 * the view afterwards.
 */
function ViewController({
  markers,
  selectedId,
  focusRequest,
  focusRightInsetPx,
}: {
  markers: FleetEdgeMapMarker[];
  selectedId: string | null;
  focusRequest: number;
  /** Pixels covered by the desktop list/detail drawers on the right. */
  focusRightInsetPx: number;
}) {
  const map = useMap();
  const fitted = useRef(false);
  const lastFocusKey = useRef<string | null>(null);

  useEffect(() => {
    if (fitted.current) return;
    if (markers.length > 0) {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number]));
      map.fitBounds(bounds.pad(0.4), { maxZoom: 12 });
    } else {
      map.fitBounds(FALLBACK_BOUNDS);
    }
    fitted.current = true;
  }, [markers, map]);

  useEffect(() => {
    // Leaflet centres against the whole container, but the vehicle list and
    // inspector deliberately cover its right side. Centre against the exposed
    // part instead, so the selected truck is not hidden beneath those drawers.
    // Re-run if the drawers finish opening after the original click.
    const focusKey = `${focusRequest}:${focusRightInsetPx}`;
    if (!selectedId || focusKey === lastFocusKey.current) return;
    lastFocusKey.current = focusKey;
    const hit = markers.find((m) => m.id === selectedId);
    if (!hit) return;

    const width = map.getSize().x;
    // Keep at least 160 px of visible map on narrow screens. The resulting
    // target can never be pushed outside Leaflet's usable viewport.
    const inset = Math.max(0, Math.min(focusRightInsetPx, Math.max(0, width - 160)));
    const desiredCenter = map.unproject(
      map.project([hit.lat, hit.lng], VEHICLE_FOCUS_ZOOM).add([inset / 2, 0]),
      VEHICLE_FOCUS_ZOOM,
    );
    map.flyTo(desiredCenter, VEHICLE_FOCUS_ZOOM, { duration: 0.8 });
  }, [selectedId, focusRequest, focusRightInsetPx, markers, map]);

  return null;
}

/** Above this, two samples are an outage rather than a leg of a journey. */
const GAP_MINUTES = 20;

/**
 * The track, drawn as what was actually observed.
 *
 * Consecutive samples inside the polling interval are joined with a solid line.
 * Where the feed went quiet, the bridging segment is drawn dashed and pale — it
 * is the only honest way to connect two points when nobody watched the road
 * between them. Fleet Edge draws one confident line throughout; that line has
 * been read as a route in a fuel dispute before, which is precisely why this
 * one refuses to.
 */
function TrackLayer({ points, cursor }: { points: TrackPoint[]; cursor: number | null }) {
  const { runs, bridges } = useMemo(() => {
    const runs: [number, number][][] = [];
    const bridges: [number, number][][] = [];
    let run: [number, number][] = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const here: [number, number] = [p.lat, p.lng];
      if (i === 0) {
        run.push(here);
        continue;
      }
      const gapMin =
        (new Date(p.at).getTime() - new Date(points[i - 1].at).getTime()) / 60_000;
      if (gapMin > GAP_MINUTES) {
        const prev: [number, number] = [points[i - 1].lat, points[i - 1].lng];
        if (run.length > 1) runs.push(run);
        bridges.push([prev, here]);
        run = [here];
      } else {
        run.push(here);
      }
    }
    if (run.length > 1) runs.push(run);
    return { runs, bridges };
  }, [points]);

  const at = cursor != null ? points[cursor] : undefined;

  return (
    <>
      {runs.map((r, i) => (
        <Polyline key={`run-${i}`} positions={r} pathOptions={{ color: "#1f47e6", weight: 4, opacity: 0.85 }} />
      ))}
      {bridges.map((b, i) => (
        <Polyline
          key={`gap-${i}`}
          positions={b}
          pathOptions={{ color: "#94a3b8", weight: 3, opacity: 0.7, dashArray: "6 8" }}
        />
      ))}
      {points.length > 0 && (
        <CircleMarker
          center={[points[0].lat, points[0].lng]}
          radius={5}
          pathOptions={{ color: "#fff", weight: 2, fillColor: "#0f172a", fillOpacity: 1 }}
        />
      )}
      {at && (
        <CircleMarker
          center={[at.lat, at.lng]}
          radius={9}
          pathOptions={{ color: "#fff", weight: 3, fillColor: "#1f47e6", fillOpacity: 1 }}
        />
      )}
    </>
  );
}

/** Keeps the scrubbed position in view without fighting the user's panning. */
function FollowCursor({ point }: { point: TrackPoint | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    if (!map.getBounds().contains([point.lat, point.lng])) {
      map.panTo([point.lat, point.lng], { animate: true });
    }
  }, [point, map]);
  return null;
}

export default function FleetEdgeMap({
  markers,
  selectedId,
  focusRequest,
  focusRightInsetPx,
  onSelect,
  view,
  track,
  trackCursor,
}: {
  markers: FleetEdgeMapMarker[];
  selectedId: string | null;
  focusRequest: number;
  focusRightInsetPx: number;
  onSelect: (id: string) => void;
  view: MapView;
  track?: TrackPoint[] | null;
  trackCursor?: number | null;
}) {
  return (
    <MapContainer
      center={[26.9, 74.2]}
      zoom={7}
      minZoom={3}
      scrollWheelZoom
      zoomControl={false}
      style={{ height: "100%", width: "100%", background: "#aadaff" }}
    >
      {view === "streets" && (
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      )}
      {(view === "satellite" || view === "hybrid") && (
        <TileLayer
          attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
          url={ESRI_IMAGERY}
          maxZoom={19}
        />
      )}
      {view === "hybrid" && (
        <>
          <TileLayer url={ESRI_ROADS} maxZoom={19} />
          <TileLayer url={ESRI_LABELS} maxZoom={19} />
        </>
      )}

      <ViewController
        markers={markers}
        selectedId={selectedId}
        focusRequest={focusRequest}
        focusRightInsetPx={focusRightInsetPx}
      />

      {track && track.length > 0 && (
        <>
          <TrackLayer points={track} cursor={trackCursor ?? null} />
          <FollowCursor point={trackCursor != null ? track[trackCursor] : undefined} />
        </>
      )}

      {markers.map((m) => (
        <Marker
          key={m.id}
          position={[m.lat, m.lng]}
          icon={vehicleIcon(m, selectedId === m.id)}
          // The icon is `pointer-events:none` so the label cannot swallow clicks;
          // the marker itself stays clickable, which is what selects a vehicle.
          interactive
          eventHandlers={{ click: () => onSelect(m.id) }}
        >
          <Tooltip direction="top" offset={[0, -20]} opacity={0.95}>
            <div style={{ font: "600 11px ui-sans-serif,system-ui,sans-serif", color: "#0f172a" }}>
              <strong>{m.label}</strong> ({m.status})<br />
              <span style={{ color: m.driverName ? "#047857" : "#b45309" }}>
                Driver: {m.driverName ? m.driverName : "No Driver Assigned"}
              </span>
              {m.speedKph != null && (
                <span style={{ color: "#64748b" }}> · {Math.round(m.speedKph)} km/h</span>
              )}
            </div>
          </Tooltip>
          <Popup>
            <div style={{ minWidth: 190, fontFamily: "ui-sans-serif,system-ui,sans-serif", padding: "2px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e2e8f0", paddingBottom: "4px" }}>
                <strong style={{ fontSize: "13px", color: "#0f172a" }}>{m.label}</strong>
                <span style={{ fontSize: "10px", fontWeight: "700", padding: "2px 6px", borderRadius: "4px", color: "#fff", background: STATUS_HEX[m.status] }}>
                  {m.status}
                </span>
              </div>
              <div style={{ marginTop: "6px", fontSize: "11px", lineHeight: 1.6 }}>
                <div style={{ margin: "3px 0" }}>
                  <span style={{ color: "#64748b" }}>Driver: </span>
                  <strong style={{ color: m.driverName ? "#047857" : "#b45309" }}>
                    {m.driverName ? m.driverName : "No Driver Assigned"}
                  </strong>
                </div>
                {m.speedKph != null && (
                  <div>
                    <span style={{ color: "#64748b" }}>Speed: </span>
                    <strong>{Math.round(m.speedKph)} km/h</strong>
                  </div>
                )}
                <div style={{ color: "#64748b", fontFamily: "monospace", fontSize: "10px", marginTop: "4px" }}>
                  {m.lat.toFixed(5)}, {m.lng.toFixed(5)}
                </div>
              </div>
              <button
                onClick={() => onSelect(m.id)}
                style={{
                  marginTop: "8px", width: "100%", padding: "5px 0",
                  background: "#1f47e6", color: "#fff", border: "none",
                  borderRadius: "6px", fontWeight: 600, fontSize: "11px", cursor: "pointer",
                }}
              >
                Inspect Vehicle Details →
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
