"use client";

import { useState, useEffect } from "react";
import { ROLE_LABEL } from "@/lib/utils";
import { LogOut, Search, Bell } from "lucide-react";
import Link from "next/link";
import { CommandPalette } from "@/components/CommandPalette";
import { QuickActionMenu } from "@/components/QuickActionMenu";

/**
 * The header adapts to who is looking at it and provides global search.
 */
export function Topbar({
  user,
  notifCount = 0,
  isDriver = false,
}: {
  user: { name: string; role: string };
  notifCount?: number;
  isDriver?: boolean;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");

  // Global Ctrl+K and Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-slate-200 bg-white/80 px-5 backdrop-blur-md lg:px-8">
        <div className="ml-10 flex flex-1 items-center gap-3 lg:ml-0">
          {!isDriver && (
            <button
              onClick={() => setSearchOpen(true)}
              className="group relative hidden w-full max-w-sm items-center justify-between rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-left text-sm text-slate-400 transition-colors hover:border-brand-300 hover:bg-white hover:text-slate-600 sm:flex"
            >
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-hover:text-brand-500" />
              <span>Search vehicles, people, work…</span>
              <kbd className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500 shadow-xs">
                <span className="text-xs">⌘</span>K
              </kbd>
            </button>
          )}
          <QuickActionMenu isDriver={isDriver} />
        </div>
        <div className="flex items-center gap-3">
          {!isDriver && (
            <button
              onClick={() => setSearchOpen(true)}
              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-600 sm:hidden"
              title="Search"
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
            </button>
          )}
          {!isDriver && (
            <Link
              href="/maintenance/reminders"
              className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-600"
              title="Service due & reminders"
            >
              <Bell className="h-5 w-5" />
              {notifCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {notifCount > 99 ? "99+" : notifCount}
                </span>
              )}
            </Link>
          )}
          <Link href="/account" className="flex items-center gap-3 rounded-lg p-1 hover:bg-slate-100" title="My account & password">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-ink-900">{user.name}</p>
              <p className="text-xs text-slate-500">{ROLE_LABEL[user.role] ?? user.role}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white">
              {initials}
            </div>
          </Link>
          <a
            href="/api/auth/logout"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-rose-600"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </a>
        </div>
      </header>

      {/* Global Command Palette */}
      <CommandPalette isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
