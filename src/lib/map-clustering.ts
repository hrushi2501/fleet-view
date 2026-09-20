/**
 * Pure mathematical projection, overlap resolution, and spiderfying utilities for map markers.
 *
 * Designed to run in both Node.js (unit tests) and the browser without depending
 * on Leaflet globals or DOM elements.
 */

import type { LiveStatus } from "./fleet-edge-live";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface ClusterableMarker extends GeoPoint {
  id: string;
  status: LiveStatus;
  [key: string]: unknown;
}

export interface OverlappingGroup<T extends ClusterableMarker> {
  id: string;
  center: GeoPoint;
  markers: T[];
  count: number;
  statusCounts: Partial<Record<LiveStatus, number>>;
}

export interface PlacedMarker<T extends ClusterableMarker> {
  marker: T;
  displayLat: number;
  displayLng: number;
  realLat: number;
  realLng: number;
  groupId: string | null;
  groupCount: number;
  groupIndex: number;
  isOffset: boolean;
  isSpiderfied: boolean;
  spiderLine?: [[number, number], [number, number]];
}

const TILE_SIZE = 256;
const PI = Math.PI;
const RAD = PI / 180;
const DEG = 180 / PI;

/**
 * Projects latitude/longitude to 2D pixel coordinates at a given zoom level using EPSG:3857 (Web Mercator).
 */
export function projectLatLngToPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * scale;
  const sinLat = Math.max(-0.9999, Math.min(0.9999, Math.sin(lat * RAD)));
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * PI)) * scale;
  return { x, y };
}

/**
 * Unprojects 2D pixel coordinates at a given zoom level back to latitude/longitude.
 */
export function unprojectPixelToLatLng(x: number, y: number, zoom: number): GeoPoint {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const lng = (x / scale) * 360 - 180;
  const y2 = 0.5 - y / scale;
  const lat = 90 - 2 * Math.atan(Math.exp(-y2 * 2 * PI)) * DEG;
  return { lat, lng };
}

/** Distance threshold in degrees considered coincident coordinates (~15 meters) */
export const SAME_LOCATION_THRESHOLD_DEG = 0.00015;

/**
 * Resolves overlapping vehicle markers without hiding vehicles behind cluster bubbles.
 *
 * Every vehicle that is at a distinct location is displayed directly at its real GPS coordinate.
 * Only vehicles that share the exact same location (or within 15m) are resolved:
 *  - Groups of 2 to 4 overlapping vehicles receive a gentle micro-offset (~16px) so all
 *    overlapping vehicles are immediately visible and clickable.
 *  - When spiderfied (by clicking or via sidebar selection), the overlapping group expands
 *    radially (~55px) with connector lines to the origin hub.
 *  - Real GPS coordinates in data models and popups are always preserved without mutation.
 */
export function resolveOverlappingFleet<T extends ClusterableMarker>(
  markers: T[],
  zoom: number,
  spiderfiedGroupId: string | null = null,
): {
  placed: PlacedMarker<T>[];
  groups: OverlappingGroup<T>[];
} {
  if (markers.length === 0) return { placed: [], groups: [] };

  // Group strictly coincident / overlapping coordinates (< 15 meters)
  const groupsMap: { center: GeoPoint; markers: T[] }[] = [];

  for (const m of markers) {
    let matched = false;
    for (const g of groupsMap) {
      if (Math.hypot(m.lat - g.center.lat, m.lng - g.center.lng) <= SAME_LOCATION_THRESHOLD_DEG) {
        g.markers.push(m);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groupsMap.push({
        center: { lat: m.lat, lng: m.lng },
        markers: [m],
      });
    }
  }

  const placed: PlacedMarker<T>[] = [];
  const groups: OverlappingGroup<T>[] = [];

  groupsMap.forEach((g, gIdx) => {
    const count = g.markers.length;
    const groupId = `overlap-${gIdx}-${g.markers[0].id}`;

    const statusCounts: Partial<Record<LiveStatus, number>> = {};
    for (const m of g.markers) {
      statusCounts[m.status] = (statusCounts[m.status] || 0) + 1;
    }

    const groupObj: OverlappingGroup<T> = {
      id: groupId,
      center: g.center,
      markers: g.markers,
      count,
      statusCounts,
    };
    groups.push(groupObj);

    if (count === 1) {
      const m = g.markers[0];
      placed.push({
        marker: m,
        displayLat: m.lat,
        displayLng: m.lng,
        realLat: m.lat,
        realLng: m.lng,
        groupId: null,
        groupCount: 1,
        groupIndex: 0,
        isOffset: false,
        isSpiderfied: false,
      });
      return;
    }

    // Multiple overlapping vehicles at this coordinate
    const isSpiderfied = spiderfiedGroupId === groupId;
    const centerPx = projectLatLngToPixel(g.center.lat, g.center.lng, zoom);

    if (isSpiderfied) {
      // Expanded spiderfy circle with connector lines
      const radius = Math.max(55, 35 + count * 5);
      const angleStep = (2 * PI) / count;
      const startAngle = -PI / 2;

      g.markers.forEach((m, idx) => {
        const angle = startAngle + idx * angleStep;
        const sx = centerPx.x + radius * Math.cos(angle);
        const sy = centerPx.y + radius * Math.sin(angle);
        const pt = unprojectPixelToLatLng(sx, sy, zoom);

        placed.push({
          marker: m,
          displayLat: pt.lat,
          displayLng: pt.lng,
          realLat: m.lat,
          realLng: m.lng,
          groupId,
          groupCount: count,
          groupIndex: idx,
          isOffset: true,
          isSpiderfied: true,
          spiderLine: [
            [g.center.lat, g.center.lng],
            [pt.lat, pt.lng],
          ],
        });
      });
    } else if (count <= 4) {
      // Gentle micro-offset (~16px) so every overlapping vehicle is directly visible and clickable
      const radius = 16;
      const angleStep = (2 * PI) / count;
      const startAngle = -PI / 2;

      g.markers.forEach((m, idx) => {
        const angle = startAngle + idx * angleStep;
        const sx = centerPx.x + radius * Math.cos(angle);
        const sy = centerPx.y + radius * Math.sin(angle);
        const pt = unprojectPixelToLatLng(sx, sy, zoom);

        placed.push({
          marker: m,
          displayLat: pt.lat,
          displayLng: pt.lng,
          realLat: m.lat,
          realLng: m.lng,
          groupId,
          groupCount: count,
          groupIndex: idx,
          isOffset: true,
          isSpiderfied: false,
        });
      });
    } else {
      // Stack of > 4 vehicles: render at center with stack badge, clickable to spiderfy
      g.markers.forEach((m, idx) => {
        placed.push({
          marker: m,
          displayLat: g.center.lat,
          displayLng: g.center.lng,
          realLat: m.lat,
          realLng: m.lng,
          groupId,
          groupCount: count,
          groupIndex: idx,
          isOffset: false,
          isSpiderfied: false,
        });
      });
    }
  });

  return { placed, groups };
}
