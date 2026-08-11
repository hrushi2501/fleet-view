"use client";
// Updated navigation structure

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Truck,
  MapPin,
  Fuel,
  Droplets,
  Wrench,
  Users,
  ShieldCheck,
  Bell,
  Wallet,
  BarChart3,
  Boxes,
  UserCog,
  BellRing,
  Smile,
  Scale,
  ShieldAlert,
  Handshake,
  Radar,
  CircleDot,
  FileWarning,
  KeyRound,
  ScrollText,
  Database,
  UserCheck,
  Radio,
  Camera,
} from "lucide-react";
import { useState } from "react";

const NAV = [
  {
    group: "Overview",
    items: [
      { href: "/simple", label: "Owner View (Simple)", icon: Smile },
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    group: "Fleet",
    items: [
      { href: "/fleet", label: "Assets & Equipment", icon: Truck },
      { href: "/master/assets", label: "Asset Master Data", icon: Database },
      { href: "/tracking", label: "Live Tracking", icon: MapPin },
      { href: "/tracking/sessions", label: "Trips & Telematics", icon: Radio },
      { href: "/tracking/fuel-verification", label: "Fuel Verification", icon: Camera },
      { href: "/sites", label: "Sites & Projects", icon: MapPin },
    ],
  },
  {
    group: "Operations",
    items: [
      { href: "/fuel", label: "Fuel Management", icon: Fuel },
      { href: "/fuel/tanks", label: "Site Fuel Tanks", icon: Droplets },
      { href: "/attendance", label: "Driver Attendance", icon: UserCheck },
      { href: "/production", label: "Production & Output", icon: Boxes },
      { href: "/hire", label: "Hire & Contractors", icon: Handshake },
      { href: "/maintenance", label: "Maintenance", icon: Wrench },
      { href: "/tyres", label: "Tyres & Components", icon: CircleDot },
      { href: "/drivers", label: "Drivers & Operators", icon: Users },
      { href: "/master/people", label: "Personnel Master", icon: UserCheck },
      { href: "/compliance", label: "Compliance", icon: ShieldCheck },
      { href: "/compliance/audit", label: "Compliance Audit", icon: FileWarning },
      { href: "/notifications", label: "Service Reminders", icon: BellRing },
    ],
  },
  {
    group: "Insight",
    items: [
      { href: "/costs", label: "Cost, TCO & Profit", icon: Wallet },
      { href: "/reports", label: "Reports & KPIs", icon: BarChart3 },
      { href: "/reports/executive", label: "Executive Dashboard", icon: LayoutDashboard },
      { href: "/loss-prevention", label: "Loss Prevention", icon: Radar },
      { href: "/alerts", label: "Alerts", icon: Bell },
    ],
  },
  {
    group: "Admin",
    items: [
      { href: "/users", label: "Users & Access", icon: UserCog },
      { href: "/admin/roles", label: "Roles & Permissions", icon: KeyRound },
      { href: "/admin/audit", label: "Audit Log", icon: ScrollText },
    ],
  },
];

export function Sidebar({ alertCount }: { alertCount: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="fixed left-4 top-3.5 z-50 rounded-lg bg-ink-900 p-2 text-white shadow-lg lg:hidden"
        aria-label="Menu"
      >
        <Boxes className="h-5 w-5" />
      </button>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-ink-900 text-slate-300 transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white shadow-lg shadow-brand-500/30">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight text-white">FleetView</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Mahadev Constructions</p>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {NAV.map((sec) => (
            <div key={sec.group}>
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                {sec.group}
              </p>
              <div className="space-y-0.5">
                {sec.items.map((item) => {
                  const active =
                    item.href === "/fuel"
                      ? pathname === "/fuel" || (pathname.startsWith("/fuel/") && !pathname.startsWith("/fuel/tanks"))
                      : pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-brand-500 text-white shadow-lg shadow-brand-500/20"
                          : "text-slate-400 hover:bg-white/5 hover:text-white"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.href === "/alerts" && alertCount > 0 && (
                        <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {alertCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/5 p-4">
          <div className="rounded-xl bg-gradient-to-br from-brand-500/20 to-transparent p-3 ring-1 ring-white/5">
            <p className="text-xs font-semibold text-white">Mahadev Constructions</p>
            <p className="mt-0.5 text-[11px] text-slate-400">Live · {new Date().getFullYear()} · v1.0</p>
          </div>
        </div>
      </aside>
    </>
  );
}
