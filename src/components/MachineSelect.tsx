"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { Search, AlertTriangle, Check, ChevronDown, Wrench } from "lucide-react";

export type MachineSelectProps = {
  assets: (MachineOption | { id: string; label: string })[];
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (assetId: string) => void;
  label?: string;
  required?: boolean;
  showDuplicateWarning?: boolean;
  placeholder?: string;
};

export {
  normalizeAssets,
  filterMachines,
  type ActiveWorkOrder,
  type MachineOption,
  type NormalizedMachine,
} from "@/lib/machine-select-helpers";

import {
  normalizeAssets,
  filterMachines,
  type MachineOption,
  type NormalizedMachine,
} from "@/lib/machine-select-helpers";

export function MachineSelect({
  assets = [],
  name = "assetId",
  defaultValue = "",
  value: controlledValue,
  onChange,
  label = "Select Machine",
  required = false,
  showDuplicateWarning = true,
  placeholder = "Search by code, model or registration...",
}: MachineSelectProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<string>(defaultValue);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedId = controlledValue !== undefined ? controlledValue : internalSelectedId;

  const normalized = useMemo(() => normalizeAssets(assets), [assets]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    normalized.forEach((m) => {
      if (m.category) set.add(m.category);
    });
    return ["All", ...Array.from(set).sort()];
  }, [normalized]);

  const filtered = useMemo(
    () => filterMachines(normalized, category, search),
    [normalized, category, search]
  );

  const selectedMachine = useMemo(
    () => normalized.find((m) => m.id === selectedId),
    [normalized, selectedId]
  );

  const activeWos = selectedMachine?.activeWorkOrders || [];
  const hasActiveWo = activeWos.length > 0;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (m: NormalizedMachine) => {
    setInternalSelectedId(m.id);
    onChange?.(m.id);
    setIsOpen(false);
  };

  return (
    <div className="space-y-1.5" ref={containerRef}>
      {label && (
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}

      {/* Hidden input for form submission */}
      <input type="hidden" name={name} value={selectedId} required={required} />

      {/* Trigger Button */}
      <div
        id={`machine-select-${name}`}
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
        className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg border bg-white dark:bg-slate-900 cursor-pointer transition-colors shadow-sm ${
          isOpen
            ? "border-blue-500 ring-2 ring-blue-500/20"
            : "border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600"
        }`}
      >
        {selectedMachine ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono font-semibold text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
              {selectedMachine.code}
            </span>
            <span className="truncate text-slate-900 dark:text-slate-100 font-medium">
              {selectedMachine.name}
            </span>
            {selectedMachine.category && (
              <span className="text-[10px] text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 px-1.5 py-0.5 rounded">
                {selectedMachine.category}
              </span>
            )}
            {hasActiveWo && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800/40">
                <Wrench className="w-2.5 h-2.5" />
                WO Open
              </span>
            )}
          </div>
        ) : (
          <span className="text-slate-600 dark:text-slate-400 text-sm">
            {placeholder}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-slate-600 dark:text-slate-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full max-w-lg bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          {/* Search Header */}
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-600 dark:text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code, model, registration..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
                autoFocus
              />
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1 scrollbar-none">
              {categories.map((cat) => {
                const count =
                  cat === "All"
                    ? normalized.length
                    : normalized.filter(
                        (m) => m.category.toLowerCase() === cat.toLowerCase()
                      ).length;
                const isCurrent = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap transition-colors flex items-center gap-1 ${
                      isCurrent
                        ? "bg-blue-600 text-white shadow-xs"
                        : "bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-300/70 dark:hover:bg-slate-700"
                    }`}
                  >
                    <span>{cat}</span>
                    <span
                      className={`text-[9px] px-1 rounded-full ${
                        isCurrent
                          ? "bg-blue-700 text-blue-100"
                          : "bg-slate-300/70 dark:bg-slate-700 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Machine List */}
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 p-1">
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-600 dark:text-slate-400">
                No machines found matching &ldquo;{search}&rdquo;
              </div>
            ) : (
              filtered.map((m) => {
                const isSelected = m.id === selectedId;
                const woCount = m.activeWorkOrders?.length || 0;
                return (
                  <div
                    key={m.id}
                    onClick={() => handleSelect(m)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
                      isSelected
                        ? "bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 font-medium"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200"
                    }`}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          {m.code}
                        </span>
                        {m.regNo && (
                          <span className="text-[10px] text-slate-600 dark:text-slate-400 font-mono">
                            • {m.regNo}
                          </span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          {m.category}
                        </span>
                      </div>
                      <span className="truncate text-slate-600 dark:text-slate-400">
                        {m.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {woCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800/50">
                          <Wrench className="w-2.5 h-2.5" />
                          {woCount} WO{woCount > 1 ? "s" : ""}
                        </span>
                      )}
                      {isSelected && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Duplicate Work Order Warning Notice */}
      {showDuplicateWarning && hasActiveWo && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50/90 dark:bg-amber-950/30 p-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2 shadow-xs">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="font-medium">
              Active Work Order Notice: Machine already has {activeWos.length} open work order{activeWos.length > 1 ? "s" : ""}:
            </p>
            <ul className="space-y-0.5 text-[11px] text-amber-800 dark:text-amber-300">
              {activeWos.map((wo) => (
                <li key={wo.id} className="flex items-center gap-1.5">
                  <span className="font-mono font-semibold">{wo.woNo}</span>
                  <span>— {wo.description}</span>
                  <span className="px-1 py-0.2 rounded bg-amber-200/60 dark:bg-amber-900/60 text-[10px]">
                    {wo.status}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-amber-700 dark:text-amber-400 italic pt-0.5">
              Duplicate work orders are allowed (e.g. concurrent repairs or follow-ups). Proceed if this new work order is intentional.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
