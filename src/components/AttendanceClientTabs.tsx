"use client";

import React, { useState } from "react";
import { AttendanceDashboard, type AttendanceView } from "@/components/AttendanceDashboard";
import { SupervisorAttendanceApproval } from "@/components/SupervisorAttendanceApproval";
import { ShieldCheck, ClipboardList } from "lucide-react";

/**
 * Both tabs render the one `AttendanceView` the page resolved from the database.
 * They previously took a loosely-typed `dbSessions?: any[]` and each fell back to
 * its own mock generator when it was empty or absent, so the register and the
 * approvals queue could show different — and equally invented — versions of the
 * same day. A single required prop makes that impossible.
 */
export function AttendanceClientTabs({ view }: { view: AttendanceView }) {
  const [activeTab, setActiveTab] = useState<"REGISTER" | "APPROVALS">("REGISTER");

  return (
    <div className="space-y-6">
      {/* Page Header & Integrated Management Tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Driver &amp; Operator Attendance Management</h1>
          <p className="text-sm text-slate-500">
            Management dashboard for daily attendance registers, shift logs &amp; supervisor approvals.
          </p>
        </div>

        {/* Tab Navigation Controls */}
        <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
          <button
            onClick={() => setActiveTab("REGISTER")}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
              activeTab === "REGISTER"
                ? "bg-white text-brand-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ClipboardList className="h-4 w-4" /> Attendance Register
          </button>
          <button
            onClick={() => setActiveTab("APPROVALS")}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
              activeTab === "APPROVALS"
                ? "bg-white text-emerald-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ShieldCheck className="h-4 w-4" /> Supervisor Approvals
          </button>
        </div>
      </div>

      {/* Render Selected View */}
      {activeTab === "REGISTER" && <AttendanceDashboard view={view} />}
      {activeTab === "APPROVALS" && <SupervisorAttendanceApproval view={view} />}
    </div>
  );
}
