"use client";

import React, { useState } from "react";
import { ProductionEntryForm } from "@/components/ProductionEntryForm";
import { ScrollText, LayoutDashboard } from "lucide-react";

export function ProductionContainer({ children }: { children: React.ReactNode }) {
  const [activeTab, setActiveTab] = useState<"OVERVIEW" | "ENTRY">("OVERVIEW");

  return (
    <div className="space-y-6">
      {/* Top Banner & Tab Navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Production &amp; Output Management</h1>
          <p className="text-sm text-slate-500">
            Integrated portal for site output overview, diesel efficiency &amp; daily work entry logs.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
          <button
            onClick={() => setActiveTab("OVERVIEW")}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
              activeTab === "OVERVIEW"
                ? "bg-white text-brand-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <LayoutDashboard className="h-4 w-4" /> Production Overview
          </button>
          <button
            onClick={() => setActiveTab("ENTRY")}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
              activeTab === "ENTRY"
                ? "bg-white text-emerald-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ScrollText className="h-4 w-4" /> Daily Work Entry
          </button>
        </div>
      </div>

      {/* Tab Panels */}
      {activeTab === "OVERVIEW" && children}
      {activeTab === "ENTRY" && (
        <div className="py-2">
          <ProductionEntryForm />
        </div>
      )}
    </div>
  );
}
