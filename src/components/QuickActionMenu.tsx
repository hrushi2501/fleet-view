"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Fuel,
  Wrench,
  Scale,
  CalendarCheck2,
  Truck,
  Sparkles,
  X,
  ChevronRight,
  ArrowRight,
  QrCode,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickActionItem {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  color: string;
  badge?: string;
}

const QUICK_ACTIONS: QuickActionItem[] = [
  {
    id: "qr_scan",
    title: "Scan Vehicle QR",
    subtitle: "Open driver cabin camera scanner",
    icon: QrCode,
    href: "/my",
    color: "bg-brand-500 text-white shadow-brand-500/25",
    badge: "Scanner",
  },
  {
    id: "fuel",
    title: "Issue Diesel",
    subtitle: "Dispense fuel to vehicle / tank",
    icon: Fuel,
    href: "/fuel",
    color: "bg-amber-500 text-white shadow-amber-500/25",
    badge: "Daily",
  },
  {
    id: "breakdown",
    title: "Report Breakdown",
    subtitle: "Create urgent repair work order",
    icon: Wrench,
    href: "/maintenance",
    color: "bg-rose-500 text-white shadow-rose-500/25",
    badge: "Urgent",
  },
  {
    id: "weighbridge",
    title: "Weighbridge Ticket",
    subtitle: "Log gross / tare material entry",
    icon: Scale,
    href: "/weighbridge",
    color: "bg-brand-600 text-white shadow-brand-600/25",
    badge: "Active",
  },
  {
    id: "attendance",
    title: "Mark Attendance",
    subtitle: "Sign off shift & driver register",
    icon: CalendarCheck2,
    href: "/people/attendance",
    color: "bg-emerald-600 text-white shadow-emerald-600/25",
    badge: "1-Tap",
  },
  {
    id: "asset",
    title: "Add Vehicle / Machine",
    subtitle: "Register truck, tipper or plant",
    icon: Truck,
    href: "/fleet",
    color: "bg-indigo-600 text-white shadow-indigo-600/25",
  },
];

export function QuickActionMenu({ isDriver = false }: { isDriver?: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on Escape or outside click
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      window.addEventListener("keydown", handleKeyDown);
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  if (isDriver) return null;

  return (
    <div className="relative" ref={menuRef}>
      {/* Desktop Header Trigger */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="group hidden items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:from-brand-700 hover:to-brand-600 hover:shadow-lg sm:flex active:scale-95"
        aria-label="Quick Actions"
        aria-expanded={open}
      >
        <Plus className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-45")} />
        <span>+ Quick Action</span>
      </button>

      {/* Mobile Floating Action Button (FAB) */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-xl shadow-brand-600/40 ring-4 ring-white transition-transform duration-200 hover:scale-105 active:scale-90 sm:hidden"
        aria-label="Quick Actions"
      >
        <Plus className={cn("h-6 w-6 transition-transform duration-300", open && "rotate-45")} />
      </button>

      {/* Popover / Action Menu */}
      {open && (
        <>
          {/* Backdrop for Mobile */}
          <div
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs sm:hidden"
            onClick={() => setOpen(false)}
          />

          <div
            className={cn(
              "z-50 w-80 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-2xl ring-1 ring-black/5 animate-fade-up",
              "fixed bottom-24 right-6 sm:absolute sm:bottom-auto sm:right-0 sm:top-12 sm:w-88"
            )}
          >
            <div className="mb-2.5 flex items-center justify-between border-b border-slate-100 px-2 pb-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-brand-600" />
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Quick Daily Actions</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-1.5">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.id}
                    href={action.href}
                    onClick={() => setOpen(false)}
                    className="group flex items-center justify-between rounded-xl p-2.5 transition-colors hover:bg-brand-50/60 active:bg-brand-100/50"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform group-hover:scale-105",
                          action.color
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="text-left">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold text-ink-900 group-hover:text-brand-700">
                            {action.title}
                          </p>
                          {action.badge && (
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                              {action.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">{action.subtitle}</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  </Link>
                );
              })}
            </div>

            <div className="mt-2.5 border-t border-slate-100 pt-2 px-2">
              <p className="text-[11px] text-slate-400 text-center">
                Press <kbd className="font-mono text-[10px] font-bold text-slate-600">⌘K</kbd> anywhere for universal search
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default QuickActionMenu;
