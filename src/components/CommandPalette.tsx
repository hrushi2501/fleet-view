"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Truck,
  Users,
  FolderKanban,
  MapPin,
  Wrench,
  Fuel,
  Scale,
  X,
  Loader2,
  ArrowRight,
  Sparkles,
  Command,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchResultItem } from "@/app/api/search/route";

const CATEGORY_ICONS: Record<SearchResultItem["category"], React.ComponentType<{ className?: string }>> = {
  vehicle: Truck,
  driver: Users,
  project: FolderKanban,
  site: MapPin,
  workorder: Wrench,
  tank: Fuel,
  ticket: Scale,
};

const CATEGORY_LABELS: Record<SearchResultItem["category"], string> = {
  vehicle: "Vehicles & Equipment",
  driver: "People & Drivers",
  project: "Projects",
  site: "Sites & Locations",
  workorder: "Maintenance & Job Cards",
  tank: "Site Diesel Tanks",
  ticket: "Weighbridge Slips",
};

export function CommandPalette({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    setQuery("");
    setResults([]);
    setSelectedIndex(0);
    onClose();
  }, [onClose]);

  // Auto focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results || []);
          setSelectedIndex(0);
        }
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (!val.trim() || val.trim().length < 2) {
      setResults([]);
      setLoading(false);
    } else {
      setLoading(true);
    }
  };

  const handleSelect = useCallback(
    (item: SearchResultItem) => {
      handleClose();
      router.push(item.href);
    },
    [handleClose, router]
  );

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % results.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length > 0 && results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && results.length > 0) {
      const activeEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex, results.length]);

  if (!isOpen) return null;

  // Group results by category
  const groupedResults = results.reduce<Record<string, SearchResultItem[]>>((acc, item) => {
    acc[item.category] = acc[item.category] || [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const quickNav = [
    { label: "Vehicles & Equipment", hint: "Fleet register", href: "/fleet", icon: Truck },
    { label: "Live Vehicle Tracking", hint: "GPS live map", href: "/fleet/tracking", icon: MapPin },
    { label: "Fuel Management", hint: "Diesel issues & tanks", href: "/fuel", icon: Fuel },
    { label: "Preventive Service Due", hint: "Maintenance reminders", href: "/maintenance/reminders", icon: Wrench },
    { label: "Material Weighing", hint: "Weighbridge slips", href: "/sites/materials", icon: Scale },
    { label: "People & Attendance", hint: "Staff & daily sign-off", href: "/people", icon: Users },
  ];

  let flatIndex = 0;

  return (
    <div
      className="fixed inset-0 z-[9990] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm animate-fade-up sm:p-6 md:p-20"
      onClick={handleClose}
    >
      <div
        className="relative my-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-white/40 bg-white shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <Search className="h-5 w-5 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={handleQueryChange}
            placeholder="Search vehicles, registration, drivers, projects, work orders…"
            className="flex-1 bg-transparent text-base font-medium text-ink-900 outline-none placeholder:text-slate-400"
          />
          {loading ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand-500" />
          ) : query ? (
            <button
              onClick={() => {
                setQuery("");
                setResults([]);
                setLoading(false);
              }}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-500 sm:inline-block">
              ESC
            </kbd>
          )}
        </div>

        {/* Results List */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-3">
          {query.trim().length >= 2 ? (
            results.length > 0 ? (
              <div className="space-y-4">
                {Object.entries(groupedResults).map(([cat, items]) => {
                  const CategoryIcon = CATEGORY_ICONS[cat as SearchResultItem["category"]] ?? Search;
                  return (
                    <div key={cat} className="space-y-1">
                      <div className="flex items-center gap-2 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        <CategoryIcon className="h-3.5 w-3.5" />
                        <span>{CATEGORY_LABELS[cat as SearchResultItem["category"]] || cat}</span>
                      </div>
                      {items.map((item) => {
                        const itemIdx = flatIndex++;
                        const isSelected = itemIdx === selectedIndex;
                        return (
                          <div
                            key={item.id}
                            data-index={itemIdx}
                            onClick={() => handleSelect(item)}
                            className={cn(
                              "flex cursor-pointer items-center justify-between rounded-xl px-3.5 py-2.5 transition-colors",
                              isSelected
                                ? "bg-brand-50 text-brand-900 ring-1 ring-brand-200"
                                : "text-slate-700 hover:bg-slate-50"
                            )}
                          >
                            <div className="min-w-0 flex-1 pr-3">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-ink-900">{item.title}</span>
                                {item.badge && (
                                  <span
                                    className={cn(
                                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                                      item.badgeColor || "bg-slate-100 text-slate-600 ring-slate-400/20"
                                    )}
                                  >
                                    {item.badge}
                                  </span>
                                )}
                              </div>
                              <p className="truncate text-xs text-slate-500">{item.subtitle}</p>
                            </div>
                            <ArrowRight
                              className={cn(
                                "h-4 w-4 shrink-0 transition-transform",
                                isSelected ? "translate-x-0.5 text-brand-600" : "text-slate-300"
                              )}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ) : (
              !loading && (
                <div className="py-12 text-center">
                  <Search className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm font-semibold text-ink-900">No records found for &ldquo;{query}&rdquo;</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Try searching by vehicle code (e.g. TRU-053), driver name, site or ticket number.
                  </p>
                </div>
              )
            )
          ) : (
            <div className="space-y-4 py-2">
              <div className="px-3">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <Sparkles className="h-3.5 w-3.5 text-brand-500" /> Quick Navigation
                </p>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {quickNav.map((qn) => {
                  const Icon = qn.icon;
                  return (
                    <button
                      key={qn.href}
                      onClick={() => {
                        onClose();
                        router.push(qn.href);
                      }}
                      className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50/40"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
                        <Icon className="h-4 w-4 text-brand-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-ink-900">{qn.label}</p>
                        <p className="text-xs text-slate-400">{qn.hint}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer info bar */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-5 py-2.5 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold shadow-xs">↑</kbd>
              <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold shadow-xs">↓</kbd> to navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold shadow-xs">↵</kbd> to select
            </span>
          </div>
          <span className="text-[11px] text-slate-400">Mahadev Constructions ERP</span>
        </div>
      </div>
    </div>
  );
}
