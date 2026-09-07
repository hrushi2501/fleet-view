"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ROLE_LABEL } from "@/lib/utils";
import { LogOut, Search, Bell, BellRing, CircleAlert, Fuel, ShieldAlert, Wrench, FileWarning, Truck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CommandPalette } from "@/components/CommandPalette";
import { QuickActionMenu } from "@/components/QuickActionMenu";
import type { QuickAction } from "@/lib/quick-actions";
import type { NotificationFeed, NotificationItem } from "@/lib/notification-types";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/**
 * The header adapts to who is looking at it and provides global search.
 */
export function Topbar({
  user,
  notifCount = 0,
  isDriver = false,
  initialNotifications = [],
  notificationLogHref = null,
  quickActions = [],
}: {
  user: { name: string; role: string };
  notifCount?: number;
  isDriver?: boolean;
  initialNotifications?: NotificationItem[];
  notificationLogHref?: string | null;
  quickActions?: QuickAction[];
}) {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationFeed, setNotificationFeed] = useState<NotificationFeed>({
    items: initialNotifications,
    attentionCount: notifCount,
  });
  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }, [router]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");

  const refreshNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const response = await fetch("/api/notifications?take=8", { cache: "no-store" });
      if (!response.ok) return;
      const next = await response.json() as NotificationFeed;
      setNotificationFeed(next);
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  const openNotifications = useCallback(() => {
    setNotificationsOpen(true);
    void refreshNotifications();
  }, [refreshNotifications]);

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

  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!bellRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);

  return (
    <>
      <header className={`sticky top-0 z-20 flex items-center gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md lg:px-8 ${isDriver ? "h-14" : "h-16"}`}>
        <div className={isDriver ? "flex flex-1 items-center" : "ml-10 flex flex-1 items-center gap-3 lg:ml-0"}>
          {isDriver ? (
            <Link href="/my" className="flex min-h-11 items-center gap-2.5 rounded-xl pr-3" aria-label="FleetView driver home">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white"><Truck className="h-5 w-5" aria-hidden /></span>
              <span><span className="block text-sm font-bold text-ink-900">FleetView</span><span className="block text-[11px] font-medium text-slate-500">ड्राइवर ऐप / Driver</span></span>
            </Link>
          ) : (
            <>
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
            <QuickActionMenu actions={quickActions} />
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Reachable from every screen, and on a phone too: somebody who
              cannot read the English is exactly the person who must not have to
              navigate through English menus to find this. */}
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>
          <div className="sm:hidden">
            <LanguageSwitcher compact />
          </div>
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
          <div ref={bellRef} className="relative">
            <button
              onClick={() => notificationsOpen ? setNotificationsOpen(false) : openNotifications()}
              className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-600"
              title="Notifications"
              aria-label="Notifications"
              aria-expanded={notificationsOpen}
            >
              {notificationsOpen ? <BellRing className="h-5 w-5 text-brand-600" /> : <Bell className="h-5 w-5" />}
              {notificationFeed.attentionCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {notificationFeed.attentionCount > 99 ? "99+" : notificationFeed.attentionCount}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <NotificationDrawer
                feed={notificationFeed}
                loading={notificationsLoading}
                onClose={() => setNotificationsOpen(false)}
                onRefresh={() => void refreshNotifications()}
                notificationLogHref={notificationLogHref}
              />
            )}
          </div>
          {!isDriver && <Link href="/account" className="flex items-center gap-3 rounded-lg p-1 hover:bg-slate-100" title="My account & password">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-ink-900">{user.name}</p>
              <p className="text-xs text-slate-500">{ROLE_LABEL[user.role] ?? user.role}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white">
              {initials}
            </div>
          </Link>}
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-rose-600"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Global Command Palette */}
      {!isDriver && <CommandPalette isOpen={searchOpen} onClose={() => setSearchOpen(false)} quickActions={quickActions} />}
    </>
  );
}

const CATEGORY_ICON = {
  Fuel,
  Maintenance: Wrench,
  Compliance: FileWarning,
  Driver: ShieldAlert,
} as const;

function severityClass(severity: string): string {
  if (severity === "Critical") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (severity === "Warning") return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-sky-50 text-sky-700 ring-sky-200";
}

function NotificationDrawer({
  feed,
  loading,
  onClose,
  onRefresh,
  notificationLogHref,
}: {
  feed: NotificationFeed;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  notificationLogHref: string | null;
}) {
  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-ink-900">Notifications</p>
          <p className="text-[11px] text-slate-500">
            {feed.attentionCount ? `${feed.attentionCount} need attention` : "No urgent items"}
          </p>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close notifications">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-[min(30rem,calc(100vh-8rem))] overflow-x-auto overflow-y-auto">
        {feed.items.map((item) => {
          const Icon = CATEGORY_ICON[item.category as keyof typeof CATEGORY_ICON] ?? CircleAlert;
          const content = (
            <div className="flex gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50">
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ${severityClass(item.severity)}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-1 text-xs font-semibold text-ink-900">{item.title}</p>
                  <span className="shrink-0 text-[10px] text-slate-400">{item.createdAt.slice(0, 10)}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-600">{item.message}</p>
                <p className="mt-1 text-[10px] font-medium text-slate-400">
                  {item.category}{item.assetCode ? ` · ${item.assetCode}` : ""}{item.driverName ? ` · ${item.driverName}` : ""}
                </p>
              </div>
            </div>
          );
          return item.actionUrl ? (
            <Link key={item.id} href={item.actionUrl} onClick={onClose} className="block border-b border-slate-100 last:border-b-0">
              {content}
            </Link>
          ) : (
            <div key={item.id} className="border-b border-slate-100 last:border-b-0">{content}</div>
          );
        })}

        {!loading && feed.items.length === 0 && (
          <div className="px-6 py-10 text-center text-sm text-slate-400">No notifications for your role.</div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-4 py-2.5">
        <button onClick={onRefresh} className="text-xs font-semibold text-slate-500 hover:text-brand-600">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        {notificationLogHref && (
          <Link href={notificationLogHref} onClick={onClose} className="text-xs font-bold text-brand-700 hover:underline">
            View master log
          </Link>
        )}
      </div>
    </div>
  );
}