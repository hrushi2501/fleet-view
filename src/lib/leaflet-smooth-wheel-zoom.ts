import type L from "leaflet";

declare module "leaflet" {
  interface MapOptions {
    smoothWheelZoom?: boolean | "center";
    smoothSensitivity?: number;
  }
}

/**
 * Pure interpolation step for smooth continuous zooming.
 * Uses exponential lerp (easing out towards goal zoom).
 */
export function computeSmoothZoomStep(
  currentZoom: number,
  goalZoom: number,
  factor = 0.28,
): number {
  const diff = goalZoom - currentZoom;
  if (Math.abs(diff) < 0.001) {
    return goalZoom;
  }
  return Math.round((currentZoom + diff * factor) * 1000) / 1000;
}

/**
 * Clamps target zoom level to valid bounds.
 */
export function clampZoom(zoom: number, minZoom = 0, maxZoom = 20): number {
  return Math.max(minZoom, Math.min(maxZoom, zoom));
}

let installed = false;

interface SmoothMapInstance extends L.Map {
  _limitZoom: (zoom: number) => number;
  _stop: () => void;
  _panAnim?: { stop: () => void };
  _moveStart: (zoomChanged: boolean, noMoveStart: boolean) => void;
  _move: (center: L.LatLng, zoom: number) => void;
  _moveEnd: (zoomChanged: boolean) => void;
}

/**
 * Installs the SmoothWheelZoom handler on Leaflet's L.Map.
 * Replaces discrete debounced zoom-step jumps with a 60fps requestAnimationFrame
 * continuous interpolation loop centered on the user's cursor.
 */
export function installSmoothWheelZoom(leaflet?: typeof L): void {
  if (typeof window === "undefined" || !leaflet || installed) return;
  if ((leaflet.Map as unknown as { _smoothWheelZoomInstalled?: boolean })._smoothWheelZoomInstalled) {
    installed = true;
    return;
  }

  (leaflet.Map as unknown as { _smoothWheelZoomInstalled?: boolean })._smoothWheelZoomInstalled = true;
  installed = true;

  leaflet.Map.mergeOptions({
    smoothWheelZoom: true,
    smoothSensitivity: 1,
  });

  const SmoothWheelZoomHandler = leaflet.Handler.extend({
    addHooks(this: {
      _map: SmoothMapInstance;
      _onWheelScroll: (e: Event) => void;
      _delta: number;
    }) {
      leaflet.DomEvent.on(this._map.getContainer(), "wheel", this._onWheelScroll, this);
      this._delta = 0;
    },

    removeHooks(this: {
      _map: SmoothMapInstance;
      _onWheelScroll: (e: Event) => void;
      _isWheeling: boolean;
      _zoomAnimationId?: number;
      _timeoutId?: NodeJS.Timeout | number;
    }) {
      leaflet.DomEvent.off(this._map.getContainer(), "wheel", this._onWheelScroll, this);
      this._isWheeling = false;
      if (this._zoomAnimationId) {
        cancelAnimationFrame(this._zoomAnimationId);
      }
      if (this._timeoutId) {
        clearTimeout(this._timeoutId);
      }
    },

    _onWheelScroll(this: {
      _isWheeling?: boolean;
      _onWheelStart: (e: WheelEvent) => void;
      _onWheeling: (e: WheelEvent) => void;
    }, e: Event) {
      const we = e as WheelEvent;
      if (!this._isWheeling) {
        this._onWheelStart(we);
      }
      this._onWheeling(we);
    },

    _onWheelStart(this: {
      _map: SmoothMapInstance;
      _isWheeling: boolean;
      _wheelMousePosition: L.Point;
      _centerPoint: L.Point;
      _startLatLng: L.LatLng;
      _wheelMouseLatLng: L.LatLng;
      _startZoom: number;
      _moved: boolean;
      _zooming: boolean;
      _goalZoom: number;
      _prevCenter: L.LatLng;
      _prevZoom: number;
      _zoomAnimationId: number;
      _updateWheelZoom: () => void;
    }, e: WheelEvent) {
      const map = this._map;
      this._isWheeling = true;
      this._wheelMousePosition = map.mouseEventToContainerPoint(e);
      this._centerPoint = map.getSize().divideBy(2);
      this._startLatLng = map.containerPointToLatLng(this._centerPoint);
      this._wheelMouseLatLng = map.containerPointToLatLng(this._wheelMousePosition);
      this._startZoom = map.getZoom();
      this._moved = false;
      this._zooming = true;

      map._stop();
      if (map._panAnim) map._panAnim.stop();

      this._goalZoom = map.getZoom();
      this._prevCenter = map.getCenter();
      this._prevZoom = map.getZoom();

      this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
    },

    _onWheeling(this: {
      _map: SmoothMapInstance;
      _goalZoom: number;
      _wheelMousePosition: L.Point;
      _wheelMouseLatLng: L.LatLng;
      _timeoutId?: NodeJS.Timeout | number;
      _onWheelEnd: () => void;
    }, e: WheelEvent) {
      const map = this._map;

      // Handle trackpad pinch (ctrlKey) with higher granularity vs mouse wheel notches
      const rawDelta = leaflet.DomEvent.getWheelDelta(e);
      const sensitivity = map.options.smoothSensitivity ?? 1;
      const isPinch = Boolean(e.ctrlKey);
      const factor = isPinch ? 0.007 : 0.0028;

      this._goalZoom = this._goalZoom + rawDelta * factor * sensitivity;
      const minZoom = map.getMinZoom();
      const maxZoom = map.getMaxZoom();
      this._goalZoom = clampZoom(this._goalZoom, minZoom, maxZoom);

      this._wheelMousePosition = map.mouseEventToContainerPoint(e);
      this._wheelMouseLatLng = map.containerPointToLatLng(this._wheelMousePosition);

      if (this._timeoutId) {
        clearTimeout(this._timeoutId);
      }
      this._timeoutId = setTimeout(this._onWheelEnd.bind(this), 180);

      leaflet.DomEvent.preventDefault(e);
      leaflet.DomEvent.stopPropagation(e);
    },

    _onWheelEnd(this: {
      _map: SmoothMapInstance;
      _isWheeling: boolean;
      _zoomAnimationId?: number;
    }) {
      this._isWheeling = false;
      if (this._zoomAnimationId) {
        cancelAnimationFrame(this._zoomAnimationId);
      }
      this._map._moveEnd(true);
    },

    _updateWheelZoom(this: {
      _map: SmoothMapInstance;
      _prevCenter: L.LatLng;
      _prevZoom: number;
      _goalZoom: number;
      _zoom?: number;
      _wheelMousePosition: L.Point;
      _centerPoint: L.Point;
      _startLatLng: L.LatLng;
      _wheelMouseLatLng: L.LatLng;
      _moved: boolean;
      _center?: L.LatLng;
      _zoomAnimationId: number;
      _updateWheelZoom: () => void;
    }) {
      const map = this._map;

      if (!map.getCenter().equals(this._prevCenter) || map.getZoom() !== this._prevZoom) {
        return;
      }

      this._zoom = computeSmoothZoomStep(map.getZoom(), this._goalZoom, 0.28);

      const delta = this._wheelMousePosition.subtract(this._centerPoint);

      if (map.options.smoothWheelZoom === "center" || (delta.x === 0 && delta.y === 0)) {
        this._center = this._startLatLng;
      } else {
        this._center = map.unproject(
          map.project(this._wheelMouseLatLng, this._zoom).subtract(delta),
          this._zoom,
        );
      }

      if (!this._moved) {
        map._moveStart(true, false);
        this._moved = true;
      }

      map._move(this._center, this._zoom);
      this._prevCenter = map.getCenter();
      this._prevZoom = map.getZoom();

      this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
    },
  });

  (leaflet.Map as unknown as Record<string, unknown>).SmoothWheelZoom = SmoothWheelZoomHandler;
  leaflet.Map.addInitHook("addHandler", "smoothWheelZoom", SmoothWheelZoomHandler);
}
