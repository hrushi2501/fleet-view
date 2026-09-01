"use client";

import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { useEffect } from "react";
import { ASSET_CLASS_LABEL } from "@/lib/utils";

export type MapMarker = {
  id: string; code: string; name: string; assetClass: string; status: string;
  lat: number; lng: number; speed: number; project: string;
};

const DOT_HEX: Record<string, string> = {
  Active: "#10b981", Idle: "#f59e0b", "Under-Maintenance": "#3b82f6",
  "In-Transit": "#8b5cf6", Breakdown: "#ef4444", "Off-hired": "#94a3b8",
};

function dotIcon(status: string, active: boolean) {
  const color = DOT_HEX[status] ?? "#3366ff";
  const size = active ? 22 : 16;
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Rajasthan approximate bounding box
const RAJASTHAN_BOUNDS: L.LatLngBoundsExpression = [
  [23.0, 69.3], // SW
  [30.2, 78.3], // NE
];

/**
 * Leaflet measures its container once, at initialisation. In a card that is
 * still being laid out — a grid column, a lazily imported map — that read is
 * too early and the map keeps the stale size, so tiles stop short of the right
 * edge and leave a grey band that reads as a failed load.
 *
 * Invalidating once after layout settles is the documented fix. It belongs
 * here, next to the map instance, rather than in a parent faking window
 * resizes, which is what made the tiles scale instead of reload.
 */
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function FitToState({ markers }: { markers: MapMarker[] }) {
  const map = useMap();
  useEffect(() => {
    if (markers.length === 1) {
      // A single marker has zero-area bounds, and padding zero area leaves it
      // zero. fitBounds then zooms as far in as it is allowed, which renders a
      // blurred crop of one street with no context. One vehicle wants a fixed,
      // sensible zoom around its own position instead.
      map.setView([markers[0].lat, markers[0].lng], 12);
    } else if (markers.length > 1) {
      // show the cluster but keep state context
      const b = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number]));
      map.fitBounds(b.pad(0.6), { maxZoom: 11 });
    } else {
      map.fitBounds(RAJASTHAN_BOUNDS);
    }
  }, [markers, map]);
  return null;
}

export type MapView = "streets" | "satellite" | "hybrid";

const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const ESRI_ROADS = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";

export default function RajasthanMap({
  markers, selectedId, onSelect, view = "streets",
}: { markers: MapMarker[]; selectedId: string | null; onSelect: (id: string) => void; view?: MapView }) {
  return (
    <MapContainer
      center={[26.9, 74.2]}
      zoom={7}
      minZoom={5}
      maxBounds={RAJASTHAN_BOUNDS}
      maxBoundsViscosity={0.7}
      scrollWheelZoom
      style={{ height: "100%", width: "100%", borderRadius: "1rem", background: "#aadaff" }}
    >
      {view === "streets" && (
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      )}
      {(view === "satellite" || view === "hybrid") && (
        <TileLayer attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics" url={ESRI_IMAGERY} maxZoom={19} />
      )}
      {view === "hybrid" && (
        <>
          <TileLayer url={ESRI_ROADS} maxZoom={19} />
          <TileLayer url={ESRI_LABELS} maxZoom={19} />
        </>
      )}
      <FitToState markers={markers} />
      <InvalidateOnResize />
      {markers.map((m) => (
        <Marker
          key={m.id}
          position={[m.lat, m.lng]}
          icon={dotIcon(m.status, selectedId === m.id)}
          eventHandlers={{ click: () => onSelect(m.id) }}
        >
          <Popup>
            <div style={{ minWidth: 160 }}>
              <strong>{m.code}</strong> — {m.status}
              <br />
              <span style={{ color: "#64748b" }}>{ASSET_CLASS_LABEL[m.assetClass] ?? m.assetClass}</span>
              <br />
              <span style={{ color: "#64748b", fontSize: 12 }}>{m.name}</span>
              <br />
              <button
                onClick={() => onSelect(m.id)}
                style={{ marginTop: 6, color: "#1f47e6", fontWeight: 600, cursor: "pointer", background: "none", border: "none", padding: 0 }}
              >
                View full details →
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
