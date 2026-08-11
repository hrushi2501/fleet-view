"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gauge, ShieldAlert, Scale, Sparkles, FileText, Droplets } from "lucide-react";

const NAV_ITEMS = [
  { href: "/fuel", label: "Dashboard", icon: Gauge },
  { href: "/fuel/tanks", label: "Site Fuel Tanks", icon: Droplets },
  { href: "/fuel/intelligence", label: "Fuel Intelligence", icon: Sparkles },
  { href: "/fuel/summary", label: "Executive Summary", icon: FileText },
  { href: "/fuel/reconciliation", label: "Reconciliation", icon: Scale },
  { href: "/fuel/anomalies", label: "Anomaly Queue", icon: ShieldAlert },
];

export function FuelSubNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-slate-100 p-1 text-sm font-medium">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 transition-all ${
              isActive
                ? "bg-white text-ink-900 shadow-sm font-bold"
                : "text-slate-600 hover:bg-white/60 hover:text-ink-900"
            }`}
          >
            <Icon className={`h-4 w-4 ${isActive ? "text-brand-600" : "text-slate-400"}`} />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
