import React from "react";

export default function ProductionLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 animate-pulse p-4 md:p-6">
      {/* Title skeleton */}
      <div className="h-8 w-64 rounded-xl bg-slate-200" />
      <div className="h-4 w-96 rounded-lg bg-slate-100" />

      {/* KPI Cards skeleton */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-slate-200/80" />
        ))}
      </div>

      {/* Chart grid skeleton */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="h-72 rounded-2xl bg-slate-200/80" />
        <div className="h-72 rounded-2xl bg-slate-200/80" />
      </div>

      {/* Table skeleton */}
      <div className="h-96 rounded-2xl bg-slate-200/80" />
    </div>
  );
}
