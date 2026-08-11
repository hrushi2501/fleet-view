import React from "react";

export default function AttendanceLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 animate-pulse p-4 md:p-6">
      {/* Title skeleton */}
      <div className="h-8 w-64 rounded-xl bg-slate-200" />
      <div className="h-4 w-96 rounded-lg bg-slate-100" />

      {/* KPI Cards skeleton */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-slate-200/80" />
        ))}
      </div>

      {/* Filter bar skeleton */}
      <div className="h-16 rounded-2xl bg-slate-200/80" />

      {/* Table skeleton */}
      <div className="h-96 rounded-2xl bg-slate-200/80" />
    </div>
  );
}
