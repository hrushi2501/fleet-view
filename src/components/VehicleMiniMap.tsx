"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { Loader2, MapPinOff } from "lucide-react";
import type { MapMarker } from "@/components/RajasthanMap";

const RajasthanMap = dynamic(() => import("./RajasthanMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-50 text-xs text-slate-400">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading map…
    </div>
  ),
});

/**
 * Where this vehicle actually is, at the size the design allots.
 *
 * The design's map is a schematic — a drawn route between two pins. Drawing
 * that here would put a journey on screen that the vehicle did not make, so
 * this renders the real map with the one real position instead. It is the same
 * card, the same size, and it is true.
 *
 * A vehicle that has never reported gets an empty state rather than the map's
 * default centre, because a marker at 0,0 or at the middle of the state reads
 * as a location.
 */
export function VehicleMiniMap({ marker }: { marker: MapMarker | null }) {
  // A fresh array literal every render made the map's fit effect re-run on each
  // pass, which is what kept re-zooming it mid-tile-load.
  const markers = useMemo(() => (marker ? [marker] : []), [marker]);

  if (!marker) {
    return (
      <div className="flex h-42.5 flex-col items-center justify-center rounded-xl bg-slate-50 text-center">
        <MapPinOff className="mb-2 h-7 w-7 text-slate-300" />
        <b className="text-[13px] font-semibold text-[#1c2a42]">No position reported</b>
        <span className="text-xs text-[#667085]">This vehicle has not sent a location yet</span>
      </div>
    );
  }

  return (
    <div className="h-42.5 overflow-hidden rounded-xl">
      <RajasthanMap markers={markers} selectedId={marker.id} onSelect={noop} />
    </div>
  );
}

const noop = () => {};
