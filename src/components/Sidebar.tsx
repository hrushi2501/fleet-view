"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Truck, MapPin, Fuel, Wrench, Users, ShieldCheck,
  BarChart3, Settings, Route, Menu, X, CircleHelp,
} from "lucide-react";
import { useState } from "react";
import type { NavItem } from "@/lib/navigation";

/**
 * The navigation is rendered from data the *server* resolved, not from a list
 * held in this component.
 *
 * The previous sidebar hard-coded thirty links across five groups and showed
 * every one of them to every signed-in user. That was the visible half of a
 * real problem: the pages behind those links did not check permissions either,
 * so the menu was not merely untidy, it was an accurate map of what anybody
 * could reach. Pages now guard themselves via `requirePage`, and this menu is
 * built from the same `Access`, so the two cannot disagree — a link is only
 * drawn when the server would actually honour it.
 */

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Truck, MapPin, Fuel, Wrench, Users, ShieldCheck, BarChart3, Settings, Route, CircleHelp,
};

export function Sidebar({
  items,
  isDriver = false,
}: {
  items: NavItem[];
  isDriver?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Admin is drawn apart from the operational modules so it reads as a
  // different kind of place, rather than as one more thing on the same list.
  const operational = items.filter((i) => i.href !== "/admin");
  const admin = items.find((i) => i.href === "/admin");

  const isActive = (href: string) =>
    href === "/" || href === "/my"
      ? pathname === href
      : pathname === href || pathname.startsWith(href + "/");

  // Drivers use this on a phone. Four fixed, labelled destinations are easier
  // to operate than a slide-out menu; the remaining pages stay reachable from
  // the large tiles on My Work.
  if (isDriver) {
    const mobileItems = items.filter((item) => ["/my", "/my/fuel", "/my/service", "/my/help"].includes(item.href));
    return (
      <nav aria-label="Driver navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.08)]">
        {mobileItems.map((item) => {
          const Icon = ICONS[item.icon] ?? LayoutDashboard;
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] font-semibold", active ? "text-brand-700" : "text-slate-500")}>
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  const renderItem = (item: NavItem) => {
    const Icon = ICONS[item.icon] ?? LayoutDashboard;
    const active = isActive(item.href);
    const children = item.children?.filter((c) => c.href !== item.href) ?? [];
    // Sub-pages only unfold for the section you are actually in; showing every
    // child at once would put the thirty-link menu straight back.
    const showChildren = active && children.length > 0;

    return (
      <div key={item.href}>
        <Link
          href={item.href}
          onClick={() => setOpen(false)}
          className={cn(
            "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            active
              ? "bg-brand-500 text-white shadow-lg shadow-brand-500/20"
              : "text-slate-400 hover:bg-white/5 hover:text-white"
          )}
        >
          <Icon className="h-[18px] w-[18px] shrink-0" />
          <span className="flex-1 leading-tight">
            {item.label}
            {/* The hint is what the module answers, in the words a supervisor
                would use. It is the difference between "Fleet" meaning nothing
                and meaning "gaadi kahan hai". */}
            <span className={cn("block text-[10px] font-normal", active ? "text-white/70" : "text-slate-500")}>
              {item.hint}
            </span>
          </span>
        </Link>

        {showChildren && (
          <div className="mt-0.5 space-y-0.5 border-l border-white/10 pl-3 ml-5">
            {children.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "block rounded-md px-3 py-1.5 text-[13px] transition-colors",
                  pathname === c.href
                    ? "bg-white/10 font-medium text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                )}
              >
                {c.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        // 44px minimum: this is tapped on a phone, often outdoors, often by
        // someone wearing gloves.
        className="fixed left-3 top-3 z-50 flex h-11 w-11 items-center justify-center rounded-xl bg-ink-900 text-white shadow-lg lg:hidden"
        aria-label={open ? "Close menu" : "Open menu"}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
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
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              {isDriver ? "Driver" : "Mahadev Constructions"}
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {operational.map(renderItem)}

          {admin && (
            <div className="pt-4">
              <div className="mb-1 border-t border-white/10 pt-3">
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  System
                </p>
              </div>
              {renderItem(admin)}
            </div>
          )}
        </nav>

        <div className="border-t border-white/5 p-4">
          <div className="rounded-xl bg-gradient-to-br from-brand-500/20 to-transparent p-3 ring-1 ring-white/5">
            <p className="text-xs font-semibold text-white">Mahadev Constructions</p>
            <p className="mt-0.5 text-[11px] text-slate-400">Live · {new Date().getFullYear()}</p>
          </div>
        </div>
      </aside>
    </>
  );
}
