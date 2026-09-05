"use client";

import React, { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fuel,
  Route,
  Wrench,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { logDriverTrip } from "@/app/(app)/my/actions";
import { DriverTripEndScanner } from "@/components/DriverTripEndScanner";

interface DriverQuickHubProps {
  driverName?: string;
  vehicle: {
    id: string;
    code: string;
    name: string;
    registrationNo: string | null;
    meterValue: number;
    primaryMeter: string;
    fuelLevelPct: number | null;
    fuelCapacity: number;
  };
  expiredDocsCount?: number;
  overdueServiceCount?: number;
}

export function DriverQuickHub({
  driverName: _driverName,
  vehicle,
  expiredDocsCount: _expiredDocsCount,
  overdueServiceCount: _overdueServiceCount,
}: DriverQuickHubProps) {
  const [tripModalOpen, setTripModalOpen] = useState(false);
  const [tripForm, setTripForm] = useState({
    origin: "Quarry Pit #2",
    destination: "Crusher Plant A",
    material: "Aggregate 20mm",
    tonnage: "32.5",
    distanceKm: "14",
    endMeter: String(vehicle.meterValue + 14),
  });

  // Periodic background telemetry ping from driver device while shift is active
  useEffect(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) return;

    let cancelled = false;

    const sendPing = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) return;
          try {
            const speedKph =
              pos.coords.speed != null && pos.coords.speed >= 0
                ? Math.round(pos.coords.speed * 3.6)
                : null;
            await fetch("/api/session/ping", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                speed: speedKph,
                accuracy: pos.coords.accuracy,
              }),
            });
          } catch {
            // Mobile ping is best-effort — ignore network/intermittent drops
          }
        },
        () => {
          // Geolocation permission denied or unavailable
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
      );
    };

    sendPing();
    const interval = setInterval(sendPing, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const handleTripSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("assetId", vehicle.id);
    fd.set("origin", tripForm.origin);
    fd.set("destination", tripForm.destination);
    fd.set("material", tripForm.material);
    fd.set("tonnage", tripForm.tonnage);
    fd.set("distanceKm", tripForm.distanceKm);
    fd.set("endMeter", tripForm.endMeter);

    startTransition(async () => {
      try {
        await logDriverTrip(fd);
        toast.success(`✓ Trip recorded: ${tripForm.origin} ➔ ${tripForm.destination} (${tripForm.tonnage} MT)`);
        setTripModalOpen(false);
        router.refresh();
      } catch (err: unknown) {
        toast.error("Trip Log Failed", err instanceof Error ? err.message : "Could not record trip");
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* 1. Live Active Shift Control Card */}
      <div className="overflow-hidden rounded-3xl border border-emerald-500/30 bg-linear-to-br from-emerald-600 to-teal-800 p-5 text-white shadow-xl shadow-emerald-700/15">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-300 animate-ping" />
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-100">Duty Active</span>
          </div>
          <DriverTripEndScanner vehicleCode={vehicle.code} />
        </div>

        <div className="mt-3 flex items-baseline justify-between">
          <div>
            <h3 className="text-xl font-black">{vehicle.code}</h3>
            <p className="text-xs text-emerald-100/90">{vehicle.name} {vehicle.registrationNo ? `· ${vehicle.registrationNo}` : ""}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-black">{vehicle.meterValue.toLocaleString()} <span className="text-xs font-normal text-emerald-200">{vehicle.primaryMeter === "SMU" ? "hrs" : "km"}</span></p>
            <p className="text-[11px] text-emerald-200">Current Meter</p>
          </div>
        </div>

        {/* Quick Meter / Fuel Level mini-bar */}
        {vehicle.fuelLevelPct != null && (
          <div className="mt-3 rounded-2xl bg-black/20 p-2.5 backdrop-blur-sm">
            <div className="flex justify-between text-[11px] font-semibold text-emerald-100">
              <span>Fuel Tank Level</span>
              <span>{Math.round(vehicle.fuelLevelPct)}% ({Math.round((vehicle.fuelLevelPct / 100) * vehicle.fuelCapacity)} L)</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  vehicle.fuelLevelPct < 20 ? "bg-rose-400" : vehicle.fuelLevelPct < 40 ? "bg-amber-400" : "bg-emerald-300"
                )}
                style={{ width: `${Math.min(100, vehicle.fuelLevelPct)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 2. THE BIG 3 FIELD ACTION TILES (56px+ Touch Targets) */}
      <div className="grid grid-cols-3 gap-2.5">
        {/* ACTION 1: Fill Diesel */}
        <Link
          href="/my/fuel?action=fuel"
          className="flex flex-col items-center justify-center rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-center transition-transform active:scale-95 hover:bg-amber-100/70 shadow-xs"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-md shadow-amber-500/30">
            <Fuel className="h-6 w-6" />
          </div>
          <span className="mt-2 text-xs font-black text-amber-950">Fill Diesel</span>
          <span className="text-[10px] font-semibold text-amber-700">Diesel Bharna</span>
        </Link>

        {/* ACTION 2: Log Trip */}
        <button
          type="button"
          onClick={() => setTripModalOpen(true)}
          className="flex flex-col items-center justify-center rounded-3xl border border-brand-200 bg-brand-50/80 p-4 text-center transition-transform active:scale-95 hover:bg-brand-100/70 shadow-xs"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-md shadow-brand-600/30">
            <Route className="h-6 w-6" />
          </div>
          <span className="mt-2 text-xs font-black text-brand-950">Log Trip</span>
          <span className="text-[10px] font-semibold text-brand-700">Trip Shuru</span>
        </button>

        {/* ACTION 3: Report Breakdown / Emergency Help */}
        <Link
          href="/my/service"
          className="flex flex-col items-center justify-center rounded-3xl border border-rose-200 bg-rose-50/80 p-4 text-center transition-transform active:scale-95 hover:bg-rose-100/70 shadow-xs"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-md shadow-rose-500/30">
            <Wrench className="h-6 w-6" />
          </div>
          <span className="mt-2 text-xs font-black text-rose-950">Breakdown</span>
          <span className="text-[10px] font-semibold text-rose-700">Gaadi Kharab</span>
        </Link>
      </div>

      {/* 3. Fast Trip Logger Modal */}
      {tripModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl animate-fade-up ring-1 ring-black/10">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Route className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink-900">Record New Trip</h3>
                  <p className="text-xs text-slate-500">{vehicle.code} · Quick Haul Entry</p>
                </div>
              </div>
              <button
                onClick={() => setTripModalOpen(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleTripSubmit} className="space-y-3.5 p-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Origin / Loading</label>
                  <input
                    value={tripForm.origin}
                    onChange={(e) => setTripForm({ ...tripForm, origin: e.target.value })}
                    required
                    placeholder="Quarry Pit #2"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Destination / Dump</label>
                  <input
                    value={tripForm.destination}
                    onChange={(e) => setTripForm({ ...tripForm, destination: e.target.value })}
                    required
                    placeholder="Crusher Plant A"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-brand-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Material Type</label>
                  <select
                    value={tripForm.material}
                    onChange={(e) => setTripForm({ ...tripForm, material: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-brand-500"
                  >
                    <option value="Aggregate 20mm">Aggregate 20mm (Grit)</option>
                    <option value="Aggregate 10mm">Aggregate 10mm</option>
                    <option value="WMM / Base">WMM / Base Material</option>
                    <option value="Earth / Soil Excavation">Earth / Soil Excavation</option>
                    <option value="Sand (M-Sand)">Sand (M-Sand)</option>
                    <option value="Bitumen Mix">Bitumen Mix (Asphalt)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Net Weight (MT)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={tripForm.tonnage}
                    onChange={(e) => setTripForm({ ...tripForm, tonnage: e.target.value })}
                    required
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold outline-none focus:border-brand-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Lead Distance (KM)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={tripForm.distanceKm}
                    onChange={(e) => {
                      const km = parseFloat(e.target.value) || 0;
                      setTripForm({
                        ...tripForm,
                        distanceKm: e.target.value,
                        endMeter: String(vehicle.meterValue + km),
                      });
                    }}
                    required
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-600">Ending Odometer</label>
                  <input
                    type="number"
                    value={tripForm.endMeter}
                    onChange={(e) => setTripForm({ ...tripForm, endMeter: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold outline-none focus:border-brand-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setTripModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-brand-700 disabled:opacity-60"
                >
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {pending ? "Saving Trip…" : "Save Trip"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default DriverQuickHub;
