"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Loader2,
  CheckCheck,
  ShieldCheck,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { batchSaveAttendance } from "@/app/(app)/master/actions";
import { cn } from "@/lib/utils";

export interface AttendanceDriverItem {
  id: string;
  name: string;
  empCode: string;
  phone?: string | null;
  type: string;
  assignedAsset?: string | null;
  currentStatus?: string;
}

const STATUS_OPTS = [
  { key: "PRESENT", label: "P", full: "Present", color: "bg-emerald-500 text-white shadow-emerald-500/30" },
  { key: "ABSENT", label: "A", full: "Absent", color: "bg-rose-500 text-white shadow-rose-500/30" },
  { key: "HALF_DAY", label: "HD", full: "Half Day", color: "bg-amber-500 text-white shadow-amber-500/30" },
  { key: "LEAVE", label: "L", full: "Leave", color: "bg-violet-500 text-white shadow-violet-500/30" },
];

export function AttendanceBatchMatrix({
  drivers,
  today,
  projects = [],
}: {
  drivers: AttendanceDriverItem[];
  today: string;
  projects?: Array<{ id: string; name: string }>;
}) {
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState("DAY");
  const [projectId, setProjectId] = useState("");
  const [statuses, setStatuses] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const d of drivers) {
      initial[d.id] = d.currentStatus || "PRESENT";
    }
    return initial;
  });

  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const counts = {
    present: Object.values(statuses).filter((s) => s === "PRESENT").length,
    absent: Object.values(statuses).filter((s) => s === "ABSENT").length,
    halfDay: Object.values(statuses).filter((s) => s === "HALF_DAY").length,
    leave: Object.values(statuses).filter((s) => s === "LEAVE").length,
  };

  const setAllStatus = (target: string) => {
    const next: Record<string, string> = {};
    for (const d of drivers) {
      next[d.id] = target;
    }
    setStatuses(next);
    toast.info(`Marked all drivers as ${target}`);
  };

  const handleSave = () => {
    startTransition(async () => {
      try {
        const items = drivers.map((d) => ({
          driverId: d.id,
          status: statuses[d.id] || "PRESENT",
          date,
          shift,
          projectId: projectId || null,
        }));

        await batchSaveAttendance(items);
        toast.success(
          `✓ Shift attendance signed off (${counts.present} Present, ${counts.absent} Absent)`
        );
        router.refresh();
      } catch (err) {
        toast.error(
          "Failed to save attendance",
          err instanceof Error ? err.message : "Network error"
        );
      }
    });
  };

  return (
    <div className="space-y-5">
      {/* Controls & Quick Batch Toolbar */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Shift Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Shift Type</label>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
            >
              <option value="DAY">☀️ Day Shift</option>
              <option value="NIGHT">🌙 Night Shift</option>
            </select>
          </div>

          {projects.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Site / Project</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
              >
                <option value="">— All Sites —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Quick Batch Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 lg:border-t-0 lg:pt-0">
          <button
            onClick={() => setAllStatus("PRESENT")}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 active:scale-95"
          >
            <CheckCheck className="h-4 w-4" />
            <span>Mark All Present</span>
          </button>
          <button
            onClick={() => setAllStatus("ABSENT")}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 active:scale-95"
          >
            <X className="h-4 w-4 text-slate-400" />
            <span>Mark All Absent</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Pills */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white font-bold shadow-xs">
            {counts.present}
          </div>
          <div>
            <p className="text-xs font-bold text-emerald-900">Present</p>
            <p className="text-[11px] text-emerald-700 font-medium">Ready for duty</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-rose-100 bg-rose-50/50 p-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500 text-white font-bold shadow-xs">
            {counts.absent}
          </div>
          <div>
            <p className="text-xs font-bold text-rose-900">Absent</p>
            <p className="text-[11px] text-rose-700 font-medium">Unexcused off</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-amber-100 bg-amber-50/50 p-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white font-bold shadow-xs">
            {counts.halfDay}
          </div>
          <div>
            <p className="text-xs font-bold text-amber-900">Half Day</p>
            <p className="text-[11px] text-amber-700 font-medium">Partial shift</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-violet-100 bg-violet-50/50 p-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500 text-white font-bold shadow-xs">
            {counts.leave}
          </div>
          <div>
            <p className="text-xs font-bold text-violet-900">On Leave</p>
            <p className="text-[11px] text-violet-700 font-medium">Approved rest</p>
          </div>
        </div>
      </div>

      {/* Driver List with 1-Tap Toggle Matrix */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
        <div className="divide-y divide-slate-100">
          {drivers.map((driver) => {
            const current = statuses[driver.id] || "PRESENT";
            return (
              <div
                key={driver.id}
                className="flex flex-col gap-3 p-3.5 transition-colors hover:bg-brand-50/30 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 font-mono text-xs font-bold text-slate-700">
                    {driver.empCode.replace(/^DRV-|^EMP-/, "")}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-ink-900 truncate">{driver.name}</p>
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                        {driver.empCode}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {driver.assignedAsset ? `Assigned: ${driver.assignedAsset}` : driver.type}
                      {driver.phone ? ` · ${driver.phone}` : ""}
                    </p>
                  </div>
                </div>

                {/* Fast 1-Tap Toggle Buttons */}
                <div className="flex items-center gap-1.5 self-end sm:self-center">
                  {STATUS_OPTS.map((opt) => {
                    const isSelected = current === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() =>
                          setStatuses((prev) => ({ ...prev, [driver.id]: opt.key }))
                        }
                        className={cn(
                          "flex h-9 min-w-10 items-center justify-center rounded-xl px-2.5 text-xs font-bold transition-all active:scale-90",
                          isSelected
                            ? cn(opt.color, "shadow-sm")
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                        )}
                        title={opt.full}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {drivers.length === 0 && (
            <div className="py-12 text-center text-sm text-slate-400">
              No active drivers found in database.
            </div>
          )}
        </div>
      </div>

      {/* Submission Sticky Bar */}
      <div className="sticky bottom-4 z-20 flex items-center justify-between gap-4 rounded-2xl border border-brand-200 bg-white/95 p-4 shadow-xl backdrop-blur-md">
        <div className="text-xs text-slate-600">
          <span className="font-bold text-ink-900">{counts.present}</span> Present ·{" "}
          <span className="font-bold text-ink-900">{counts.absent}</span> Absent ·{" "}
          <span className="font-bold text-ink-900">{counts.halfDay + counts.leave}</span> Other
        </div>

        <button
          onClick={handleSave}
          disabled={pending || drivers.length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/30 transition-all hover:bg-brand-700 active:scale-95 disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Saving Shift Sign-Off…</span>
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4" />
              <span>Sign Off Shift ({drivers.length} marked)</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default AttendanceBatchMatrix;
