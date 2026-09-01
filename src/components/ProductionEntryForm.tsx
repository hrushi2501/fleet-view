"use client";

import React, { useState, useTransition } from "react";
import { Card, SectionTitle } from "@/components/ui";
import {
  Boxes,
  Truck,
  FolderKanban,
  User,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { saveProduction } from "@/app/(app)/production/actions";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateProductionQueries } from "@/lib/query-invalidation";

interface Option {
  id: string;
  label: string;
}

const MATERIALS = ["Earth", "GSB", "WMM", "Aggregate", "Sand", "Bitumen", "Debris", "Concrete", "Other"];

export function ProductionEntryForm({
  assets = [],
  projects = [],
  drivers = [],
}: {
  assets?: Option[];
  projects?: Option[];
  drivers?: Option[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();

  const [assetId, setAssetId] = useState(assets[0]?.id || "");
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [driverId, setDriverId] = useState(drivers[0]?.id || "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [shift, setShift] = useState("DAY");
  const [material, setMaterial] = useState("Aggregate");

  const [trips, setTrips] = useState<number | "">("");
  const [tonnage, setTonnage] = useState<number | "">("");
  const [volumeM3, setVolumeM3] = useState<number | "">("");
  const [cycles, setCycles] = useState<number | "">("");
  const [workedHours, setWorkedHours] = useState<number | "">("");
  const [idleHours, setIdleHours] = useState<number | "">("");
  const [distanceKm, setDistanceKm] = useState<number | "">("");
  const [leadKm, setLeadKm] = useState<number | "">("");
  const [note, setNote] = useState("");

  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setErrorMsg(null);

    if (!assetId) {
      setErrorMsg("Please select a machine.");
      return;
    }

    const fd = new FormData();
    fd.append("assetId", assetId);
    fd.append("date", date);
    fd.append("shift", shift);
    if (projectId) fd.append("projectId", projectId);
    if (driverId) fd.append("driverId", driverId);
    if (material) fd.append("material", material);
    if (trips !== "") fd.append("trips", String(trips));
    if (tonnage !== "") fd.append("tonnage", String(tonnage));
    if (volumeM3 !== "") fd.append("volumeM3", String(volumeM3));
    if (cycles !== "") fd.append("cycles", String(cycles));
    if (workedHours !== "") fd.append("workedHours", String(workedHours));
    if (idleHours !== "") fd.append("idleHours", String(idleHours));
    if (distanceKm !== "") fd.append("distanceKm", String(distanceKm));
    if (leadKm !== "") fd.append("leadKm", String(leadKm));
    if (note) fd.append("note", note);
    fd.append("source", "MANUAL");

    startTransition(async () => {
      const res = await saveProduction(fd);
      if (res && "error" in res && res.error) {
        setErrorMsg(res.error);
      } else {
        setSubmitted(true);
        await invalidateProductionQueries(queryClient, assetId);
        router.refresh();
      }
    });
  };

  const handleReset = () => {
    setSubmitted(false);
    setTrips("");
    setTonnage("");
    setVolumeM3("");
    setCycles("");
    setWorkedHours("");
    setIdleHours("");
    setDistanceKm("");
    setLeadKm("");
    setNote("");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="p-6 md:p-8 animate-fade-up">
        <SectionTitle
          title="Daily Construction Production Entry"
          subtitle="Supervisor portal to record daily site output, machine working hours & diesel consumption."
        />

        {submitted ? (
          <div className="my-8 rounded-2xl bg-emerald-50 p-6 text-center border border-emerald-200 space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h3 className="text-xl font-bold text-emerald-900">Production Log Recorded Successfully!</h3>
            <p className="text-sm text-emerald-700 max-w-md mx-auto">
              The entry has been appended to the daily productivity dashboard and site ledger.
            </p>
            <button
              onClick={handleReset}
              className="mt-2 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 shadow-md transition-all active:scale-95"
            >
              Log Another Entry
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6 mt-6">
            {errorMsg && (
              <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-4 text-sm text-rose-700 border border-rose-200">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Grid Form Fields */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Machine Selection */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Truck className="h-3.5 w-3.5 text-brand-600" /> Machine / Equipment *
                  </span>
                </label>
                <select
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="" disabled>Select Machine</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              </div>

              {/* Date & Shift */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                    Date *
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                    Shift *
                  </label>
                  <select
                    value={shift}
                    onChange={(e) => setShift(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  >
                    <option value="DAY">Day Shift</option>
                    <option value="NIGHT">Night Shift</option>
                  </select>
                </div>
              </div>

              {/* Project / Site */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <FolderKanban className="h-3.5 w-3.5 text-brand-600" /> Project / Site
                  </span>
                </label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">— Unassigned / General —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Operator / Driver */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-brand-600" /> Operator / Driver
                  </span>
                </label>
                <select
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">— None / Unassigned —</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </div>

              {/* Material */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Boxes className="h-3.5 w-3.5 text-brand-600" /> Material Moved / Handled
                  </span>
                </label>
                <select
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  {MATERIALS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Output Metric Inputs */}
            <div className="border-t border-slate-100 pt-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
                Production Output & Working Hours (Fill whichever apply)
              </h4>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Trips (Count)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    placeholder="e.g. 18"
                    value={trips}
                    onChange={(e) => setTrips(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Tonnage (Tonnes)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 450.5"
                    value={tonnage}
                    onChange={(e) => setTonnage(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Volume (m³ / BCM)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 320"
                    value={volumeM3}
                    onChange={(e) => setVolumeM3(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Cycles (Count)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    placeholder="e.g. 140"
                    value={cycles}
                    onChange={(e) => setCycles(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Worked Hours
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="24"
                    placeholder="e.g. 8.5"
                    value={workedHours}
                    onChange={(e) => setWorkedHours(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Idle Hours
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="24"
                    placeholder="e.g. 1.2"
                    value={idleHours}
                    onChange={(e) => setIdleHours(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Distance (km)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="e.g. 145"
                    value={distanceKm}
                    onChange={(e) => setDistanceKm(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Lead (km one-way)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="e.g. 6.5"
                    value={leadKm}
                    onChange={(e) => setLeadKm(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Supervisor Remarks */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Remarks / Site Notes
              </label>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Quarry blasted rock haulage, minor waiting time at crusher hopper..."
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-medium text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            {/* Submit Bar */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleReset}
                className="rounded-xl px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Clear Form
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-bold text-white shadow-md hover:bg-brand-700 transition-all disabled:opacity-60 active:scale-95"
              >
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                  </>
                ) : (
                  "Save Production Log"
                )}
              </button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
