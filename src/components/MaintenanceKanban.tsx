"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Wrench,
  Clock,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Filter,
} from "lucide-react";
import { cn, inr, timeAgo } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { updateWorkOrderStatus } from "@/app/(app)/entry-actions";

export interface KanbanWorkOrder {
  id: string;
  woNo: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  type: string;
  priority: string;
  status: string;
  description: string;
  downtimeHrs: number;
  laborCost: number;
  partsCost: number;
  totalCost: number;
  reportedAt: Date | string;
  completedAt?: Date | string | null;
}

const COLUMNS = [
  { id: "Open", label: "Open / Reported", color: "border-rose-500 bg-rose-50/50 text-rose-800", dot: "bg-rose-500" },
  { id: "In-Progress", label: "In-Progress / Under Repair", color: "border-amber-500 bg-amber-50/50 text-amber-800", dot: "bg-amber-500" },
  { id: "Completed", label: "Completed / Ready", color: "border-emerald-500 bg-emerald-50/50 text-emerald-800", dot: "bg-emerald-500" },
  { id: "Closed", label: "Closed / Signed-Off", color: "border-slate-400 bg-slate-50/50 text-slate-700", dot: "bg-slate-400" },
];

const PRIORITY_BADGE: Record<string, string> = {
  Critical: "bg-rose-100 text-rose-800 border-rose-200",
  High: "bg-amber-100 text-amber-800 border-amber-200",
  Medium: "bg-sky-100 text-sky-800 border-sky-200",
  Low: "bg-slate-100 text-slate-700 border-slate-200",
};

export function MaintenanceKanban({ workOrders }: { workOrders: KanbanWorkOrder[] }) {
  const [filterType, setFilterType] = useState<string>("ALL");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const handleStatusChange = (woId: string, nextStatus: string) => {
    setMovingId(woId);
    startTransition(async () => {
      try {
        await updateWorkOrderStatus(woId, nextStatus);
        toast.success(`✓ Work Order moved to ${nextStatus}`);
        router.refresh();
      } catch (err: unknown) {
        toast.error("Status Update Failed", err instanceof Error ? err.message : "Could not update status");
      } finally {
        setMovingId(null);
      }
    });
  };

  const filteredOrders = workOrders.filter((wo) => {
    if (filterType === "ALL") return true;
    if (filterType === "BREAKDOWN") return wo.type === "BREAKDOWN";
    if (filterType === "PM") return wo.type === "PM";
    if (filterType === "CRITICAL") return wo.priority === "Critical" || wo.priority === "High";
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xs">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-xs font-semibold text-slate-400 mr-1 flex items-center gap-1">
            <Filter className="h-3.5 w-3.5" /> Filter:
          </span>
          {[
            { id: "ALL", label: `All Jobs (${workOrders.length})` },
            { id: "BREAKDOWN", label: `Breakdowns (${workOrders.filter((w) => w.type === "BREAKDOWN").length})` },
            { id: "PM", label: `PM Service (${workOrders.filter((w) => w.type === "PM").length})` },
            { id: "CRITICAL", label: `High/Critical (${workOrders.filter((w) => w.priority === "Critical" || w.priority === "High").length})` },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterType(f.id)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-bold transition-all shrink-0",
                filterType === f.id
                  ? "bg-brand-500 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400">1-click progress triggers</p>
      </div>

      {/* 4-Column Responsive Kanban Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const columnOrders = filteredOrders.filter((wo) => wo.status === col.id);
          return (
            <div
              key={col.id}
              className="flex flex-col rounded-3xl border border-slate-200/80 bg-slate-50/70 p-3.5 shadow-xs min-h-[420px]"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-3 px-1">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 rounded-full", col.dot)} />
                  <h4 className="text-xs font-black uppercase tracking-wider text-ink-900">{col.label}</h4>
                </div>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-bold text-slate-700 shadow-2xs border border-slate-200">
                  {columnOrders.length}
                </span>
              </div>

              {/* Cards List */}
              <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-0.5">
                {columnOrders.map((wo) => {
                  const isBusy = pending && movingId === wo.id;
                  return (
                    <div
                      key={wo.id}
                      className={cn(
                        "group relative rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs transition-all hover:border-brand-300 hover:shadow-md",
                        wo.priority === "Critical" && "border-l-4 border-l-rose-500",
                        wo.priority === "High" && "border-l-4 border-l-amber-500",
                        isBusy && "opacity-60 pointer-events-none"
                      )}
                    >
                      {/* Top Bar: Code & Priority */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono text-xs font-black text-brand-700 hover:underline">
                            {wo.assetCode}
                          </span>
                          <p className="text-[11px] text-slate-500 truncate max-w-[140px]">{wo.assetName}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase", PRIORITY_BADGE[wo.priority] || PRIORITY_BADGE.Medium)}>
                            {wo.priority}
                          </span>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                            {wo.type}
                          </span>
                        </div>
                      </div>

                      {/* Description */}
                      <p className="mt-2 text-xs font-medium text-ink-900 leading-snug line-clamp-2">
                        {wo.description}
                      </p>

                      {/* Meta Metrics */}
                      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500 font-medium">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-slate-400" />
                          {wo.downtimeHrs > 0 ? `${wo.downtimeHrs}h downtime` : timeAgo(wo.reportedAt)}
                        </span>
                        {wo.totalCost > 0 && (
                          <span className="font-bold text-slate-700">
                            {inr(wo.totalCost)}
                          </span>
                        )}
                      </div>

                      {/* 1-Tap Status Progress Action Triggers */}
                      <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-slate-100 pt-2.5">
                        {wo.status === "Open" && (
                          <button
                            type="button"
                            onClick={() => handleStatusChange(wo.id, "In-Progress")}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white shadow-xs hover:bg-amber-600 active:scale-95 transition-all"
                          >
                            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                            <span>Start Repair</span>
                          </button>
                        )}

                        {wo.status === "In-Progress" && (
                          <div className="flex w-full items-center justify-between gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleStatusChange(wo.id, "Open")}
                              disabled={isBusy}
                              className="rounded-lg px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-100"
                            >
                              ← Reopen
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStatusChange(wo.id, "Completed")}
                              disabled={isBusy}
                              className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-xs hover:bg-emerald-700 active:scale-95 transition-all"
                            >
                              {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                              <span>Mark Done</span>
                            </button>
                          </div>
                        )}

                        {wo.status === "Completed" && (
                          <div className="flex w-full items-center justify-between gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleStatusChange(wo.id, "In-Progress")}
                              disabled={isBusy}
                              className="rounded-lg px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-100"
                            >
                              ← Back
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStatusChange(wo.id, "Closed")}
                              disabled={isBusy}
                              className="inline-flex items-center gap-1 rounded-xl bg-slate-700 px-3 py-1.5 text-[11px] font-bold text-white shadow-xs hover:bg-slate-800 active:scale-95 transition-all"
                            >
                              <span>Close WO</span>
                              <ChevronRight className="h-3 w-3" />
                            </button>
                          </div>
                        )}

                        {wo.status === "Closed" && (
                          <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Archived
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {columnOrders.length === 0 && (
                  <div className="flex h-32 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200/80 p-4 text-center">
                    <p className="text-xs font-semibold text-slate-400">No {col.label.toLowerCase()}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MaintenanceKanban;
