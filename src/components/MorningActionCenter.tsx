"use client";

import React from "react";
import Link from "next/link";
import {
  Wrench,
  FileWarning,
  Users,
  ChevronRight,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ActionCenterData {
  breakdownsCount: number;
  criticalAlertsCount: number;
  expiringDocsCount: number;
  fuelAnomaliesCount: number;
  unmarkedDriversCount: number;
  urgentWorkOrders: Array<{
    id: string;
    woNo: string;
    assetCode: string;
    description: string;
    priority: string;
  }>;
}

export function MorningActionCenter({ data }: { data: ActionCenterData }) {
  const totalActionItems =
    data.breakdownsCount +
    data.criticalAlertsCount +
    data.expiringDocsCount +
    data.fuelAnomaliesCount;

  const isAllClear = totalActionItems === 0;

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200/90 bg-linear-to-br from-white via-slate-50/50 to-brand-50/20 p-5 shadow-sm sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-md shadow-brand-500/25">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-ink-900">
                Morning Action Center
              </h2>
              {!isAllClear ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                  {totalActionItems} Priorities
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  No open priorities
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Immediate operational bottlenecks requiring supervisor action today
            </p>
          </div>
        </div>

        <div className="text-xs font-medium text-slate-500">
          Shift Start · Live Sync
        </div>
      </div>

      {/* Action Cards Grid */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-4">
        {/* 1. Active Breakdowns */}
        <Link
          href="/maintenance"
          className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 transition-all hover:border-rose-300 hover:shadow-md hover:shadow-rose-500/5 active:scale-[0.99]"
        >
          <div className="flex items-start justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-700 transition-colors group-hover:bg-rose-600 group-hover:text-white">
              <Wrench className="h-4 w-4" />
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-bold",
                data.breakdownsCount > 0
                  ? "bg-rose-100 text-rose-700"
                  : "bg-slate-100 text-slate-500"
              )}
            >
              {data.breakdownsCount} Open
            </span>
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-500">Workshop Repairs</p>
            <p className="text-sm font-bold text-ink-900">
              {data.breakdownsCount > 0
                ? `${data.breakdownsCount} machines in breakdown`
                : "No active breakdowns"}
            </p>
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-brand-600">
            <span>Open Job Cards</span>
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>

        {/* 2. Critical Safety / Telematics Alerts */}
        <Link
          href="/alerts"
          className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 transition-all hover:border-amber-300 hover:shadow-md hover:shadow-amber-500/5 active:scale-[0.99]"
        >
          <div className="flex items-start justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700 transition-colors group-hover:bg-amber-600 group-hover:text-white">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-bold",
                data.criticalAlertsCount > 0
                  ? "bg-amber-100 text-amber-700"
                  : "bg-slate-100 text-slate-500"
              )}
            >
              {data.criticalAlertsCount} Critical
            </span>
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-500">Safety & Sensor Alerts</p>
            <p className="text-sm font-bold text-ink-900">
              {data.criticalAlertsCount > 0
                ? `${data.criticalAlertsCount} unacknowledged alarms`
                : "No critical alerts open"}
            </p>
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-brand-600">
            <span>Review Alerts</span>
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>

        {/* 3. Expiring Compliance Docs */}
        <Link
          href="/compliance"
          className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 transition-all hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-500/5 active:scale-[0.99]"
        >
          <div className="flex items-start justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 transition-colors group-hover:bg-indigo-600 group-hover:text-white">
              <FileWarning className="h-4 w-4" />
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-bold",
                data.expiringDocsCount > 0
                  ? "bg-indigo-100 text-indigo-700"
                  : "bg-slate-100 text-slate-500"
              )}
            >
              {data.expiringDocsCount} Due
            </span>
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-500">Insurance & Fitness</p>
            <p className="text-sm font-bold text-ink-900">
              {data.expiringDocsCount > 0
                ? `${data.expiringDocsCount} papers expiring soon`
                : "All documents valid"}
            </p>
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-brand-600">
            <span>Renew Papers</span>
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>

        {/* 4. Shift Attendance Sign-Off */}
        <Link
          href="/people/attendance"
          className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 transition-all hover:border-emerald-300 hover:shadow-md hover:shadow-emerald-500/5 active:scale-[0.99]"
        >
          <div className="flex items-start justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 transition-colors group-hover:bg-emerald-600 group-hover:text-white">
              <Users className="h-4 w-4" />
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-bold",
                data.unmarkedDriversCount > 0
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-100 text-slate-500"
              )}
            >
              {data.unmarkedDriversCount > 0 ? `${data.unmarkedDriversCount} Pending` : "Signed"}
            </span>
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-500">Daily Attendance</p>
            <p className="text-sm font-bold text-ink-900">
              {data.unmarkedDriversCount > 0
                ? "Sign off morning roster"
                : "All drivers accounted"}
            </p>
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
            <span>1-Tap Sign-Off</span>
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </div>
        </Link>
      </div>
    </div>
  );
}

export default MorningActionCenter;
