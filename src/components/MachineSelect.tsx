"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { Search, ChevronDown, Check, X, AlertTriangle, Truck } from "lucide-react";
import { cn } from "@/lib/utils";

export type MachineOption = {
  id: string;
  code?: string;
  name?: string;
  registrationNo?: string | null;
  assetClass?: string | null;
  category?: string | null;
  status?: string | null;
  label?: string;
  activeWorkOrders?: { id: string; woNo: string; description: string; status: string }[];
};

export interface MachineSelectProps {
  assets: (MachineOption | { id: string; label: string })[];
  name?: string;
  label?: string;
  required?: boolean;
  defaultValue?: string;
  value?: string;
  onChange?: (id: string, machine?: MachineOption) => void;
  showDuplicateWarning?: boolean;
  placeholder?: string;
  hint?: string;
}

type NormalizedMachine = MachineOption & {
  code: string;
  name: string;
  category: string;
  activeWorkOrders: { id: string; woNo: string; description: string; status: string }[];
};

export function MachineSelect({
  assets = [],
  name = "assetId",
  label = "Select Machine",
  required = false,
  defaultValue,
  value: controlledValue,
  onChange,
  showDuplicateWarning = true,
  placeholder = "— Select Machine (or search by code / category) —",
  hint,
}: MachineSelectProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<string>(defaultValue ?? "");
  const selectedId = controlledValue !== undefined ? controlledValue : internalSelectedId;

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Click outside listener to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Auto-focus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Normalize assets so both rich MachineOption and basic { id, label } work seamlessly
  const normalizedAssets: NormalizedMachine[] = useMemo(() => {
    return assets.map((a) => {
      const opt = a as MachineOption;
      let code = opt.code;
      let name = opt.name;
      const category = opt.category || opt.assetClass;

      if (!code && opt.label) {
        const parts = opt.label.split("—").map((p) => p.trim());
        if (parts.length > 1) {
          code = parts[0];
          name = parts.slice(1).join(" — ");
        } else {
          code = opt.label;
          name = opt.label;
        }
      }
      return {
        ...opt,
        id: opt.id,
        code: code || opt.id,
        name: name || opt.label || opt.id,
        category: category || "General Fleet",
        activeWorkOrders: opt.activeWorkOrders || [],
      };
    });
  }, [assets]);

  // Find currently selected machine
  const selectedMachine = useMemo(
    () => normalizedAssets.find((a) => a.id === selectedId),
    [normalizedAssets, selectedId]
  );

  // Derive unique categories with counts
  const categories = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of normalizedAssets) {
      const cat = a.category;
      counts[cat] = (counts[cat] || 0) + 1;
    }
    const list = Object.entries(counts).map(([name, count]) => ({ name, count }));
    list.sort((a, b) => b.count - a.count);
    return list;
  }, [normalizedAssets]);

  // Filter machines by active category and search query
  const filteredMachines = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return normalizedAssets.filter((a) => {
      if (selectedCategory !== "ALL" && a.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      const code = a.code.toLowerCase();
      const name = a.name.toLowerCase();
      const reg = (a.registrationNo || "").toLowerCase();
      const catName = a.category.toLowerCase();
      return (
        code.includes(q) ||
        name.includes(q) ||
        reg.includes(q) ||
        catName.includes(q)
      );
    });
  }, [normalizedAssets, selectedCategory, searchQuery]);

  // Group filtered machines by category for arranged display
  const groupedMachines = useMemo(() => {
    const map = new Map<string, NormalizedMachine[]>();
    for (const m of filteredMachines) {
      const cat = m.category;
      const list = map.get(cat) ?? [];
      list.push(m);
      map.set(cat, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredMachines]);

  const handleSelect = (machine: NormalizedMachine) => {
    if (controlledValue === undefined) {
      setInternalSelectedId(machine.id);
    }
    onChange?.(machine.id, machine);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (controlledValue === undefined) {
      setInternalSelectedId("");
    }
    onChange?.("");
  };

  const activeWos = selectedMachine?.activeWorkOrders ?? [];

  return (
    <div className="relative block space-y-1.5" ref={containerRef}>
      {/* Label */}
      {label && (
        <span className="block text-xs font-semibold tracking-wide text-slate-700">
          {label}
          {required && !label.includes("*") && <span className="text-rose-500 font-bold"> *</span>}
        </span>
      )}

      {/* Hidden input for standard form submission */}
      <input type="hidden" name={name} value={selectedId} required={required} />

      {/* Selector Trigger Box */}
      <div
        onClick={() => setIsOpen((prev) => !prev)}
        tabIndex={0}
        role="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={cn(
          "flex min-h-10 w-full cursor-pointer items-center justify-between rounded-lg border bg-white px-3 py-2 text-sm shadow-2xs transition-all outline-none",
          isOpen
            ? "border-brand-500 ring-2 ring-brand-100"
            : "border-slate-200 hover:border-slate-300",
          !selectedMachine && "text-slate-400"
        )}
      >
        <div className="flex flex-wrap items-center gap-2 overflow-hidden">
          {selectedMachine ? (
            <>
              <span className="inline-flex items-center rounded-md bg-brand-50 px-2 py-0.5 font-mono text-xs font-bold text-brand-700 ring-1 ring-inset ring-brand-200">
                {selectedMachine.code}
              </span>
              <span className="truncate font-medium text-slate-800">
                {selectedMachine.name || selectedMachine.registrationNo || selectedMachine.code}
              </span>
              {selectedMachine.registrationNo && selectedMachine.name && selectedMachine.registrationNo !== selectedMachine.name && (
                <span className="text-xs text-slate-400">
                  ({selectedMachine.registrationNo})
                </span>
              )}
              {selectedMachine.category && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {selectedMachine.category}
                </span>
              )}
            </>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 pl-2 text-slate-400">
          {selectedMachine && (
            <button
              type="button"
              onClick={handleClear}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform duration-200",
              isOpen && "rotate-180 text-brand-600"
            )}
          />
        </div>
      </div>

      {/* Duplicate Work Order Warning Callout */}
      {showDuplicateWarning && selectedMachine && activeWos.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/90 p-3 text-xs text-amber-900 shadow-2xs space-y-1.5 animate-in fade-in duration-200">
          <div className="flex items-center gap-1.5 font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              Duplicate Notice: Machine currently has {activeWos.length} active work order{activeWos.length > 1 ? "s" : ""}:
            </span>
          </div>
          <div className="space-y-1 pl-5">
            {activeWos.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center gap-1.5 text-amber-800">
                <span className="font-mono font-bold text-amber-950">{w.woNo}:</span>
                <span>{w.description}</span>
                <span className="inline-flex rounded bg-amber-200/80 px-1.5 py-0.2 text-[10px] font-semibold text-amber-900">
                  {w.status}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-amber-700 italic pt-0.5">
            Duplicate work orders are allowed if required, but please ensure this is intentional before proceeding.
          </p>
        </div>
      )}

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-3 shadow-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150 max-w-full sm:min-w-105">
          {/* Search bar */}
          <div className="relative mb-2.5">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search code, reg number, model (e.g. RJ21, Tipper)..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-8 py-2 text-xs font-medium text-slate-800 placeholder-slate-400 outline-none focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="mb-2.5">
            <div className="flex flex-wrap items-center gap-1 max-h-24 overflow-y-auto pb-1 text-[11px]">
              <button
                type="button"
                onClick={() => setSelectedCategory("ALL")}
                className={cn(
                  "rounded-full px-2.5 py-0.5 font-medium transition-colors",
                  selectedCategory === "ALL"
                    ? "bg-brand-600 text-white shadow-2xs font-semibold"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                All ({normalizedAssets.length})
              </button>
              {categories.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setSelectedCategory(c.name)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 font-medium transition-colors whitespace-nowrap",
                    selectedCategory === c.name
                      ? "bg-brand-600 text-white shadow-2xs font-semibold"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {c.name} ({c.count})
                </button>
              ))}
            </div>
          </div>

          {/* Result Count */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <span>Arranged by Category</span>
            <span>
              {filteredMachines.length} machine{filteredMachines.length === 1 ? "" : "s"} found
            </span>
          </div>

          {/* Grouped Machine List */}
          <div className="max-h-64 overflow-y-auto pt-1 space-y-3">
            {groupedMachines.map(([category, machines]) => (
              <div key={category} className="space-y-1">
                <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-white/95 backdrop-blur-xs py-1 px-1 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <Truck className="h-3 w-3 text-slate-400" />
                  <span>{category}</span>
                  <span className="text-slate-400 font-normal">({machines.length})</span>
                </div>

                <div className="space-y-0.5">
                  {machines.map((m) => {
                    const isSelected = m.id === selectedId;
                    const wos = m.activeWorkOrders ?? [];
                    return (
                      <div
                        key={m.id}
                        onClick={() => handleSelect(m)}
                        className={cn(
                          "flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors",
                          isSelected
                            ? "bg-brand-50 text-brand-900 font-semibold"
                            : "hover:bg-slate-50 text-slate-700"
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-bold text-slate-900">
                              {m.code}
                            </span>
                            {m.registrationNo && m.registrationNo !== m.code && (
                              <span className="text-[11px] text-slate-500">
                                · {m.registrationNo}
                              </span>
                            )}
                            {m.name && m.name !== m.code && (
                              <span className="truncate text-slate-600 text-[11px]">
                                ({m.name})
                              </span>
                            )}
                          </div>

                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                            {m.status && (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded px-1.5 py-0.2 font-medium",
                                  m.status === "Active"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : m.status === "Breakdown"
                                    ? "bg-rose-50 text-rose-700"
                                    : "bg-slate-100 text-slate-600"
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    m.status === "Active"
                                      ? "bg-emerald-500"
                                      : m.status === "Breakdown"
                                      ? "bg-rose-500"
                                      : "bg-slate-400"
                                  )}
                                />
                                {m.status}
                              </span>
                            )}

                            {wos.length > 0 && (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.2 font-semibold text-amber-800">
                                <AlertTriangle className="h-2.5 w-2.5 text-amber-600" />
                                {wos.length} Open WO{wos.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </div>

                        {isSelected && (
                          <Check className="h-4 w-4 shrink-0 text-brand-600" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {groupedMachines.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-400">
                <Truck className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                <p>No vehicles found matching &ldquo;{searchQuery}&rdquo;</p>
                {selectedCategory !== "ALL" && (
                  <button
                    type="button"
                    onClick={() => setSelectedCategory("ALL")}
                    className="mt-1.5 text-[11px] font-semibold text-brand-600 hover:underline"
                  >
                    Clear category filter &ldquo;{selectedCategory}&rdquo;
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}
