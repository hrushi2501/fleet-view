import { ROLE_LABEL } from "@/lib/auth";
import { LogOut, Search, Bell } from "lucide-react";
import Link from "next/link";

export function Topbar({ user, notifCount = 0 }: { user: { name: string; role: string }; notifCount?: number }) {
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-slate-200 bg-white/80 px-5 backdrop-blur-md lg:px-8">
      <div className="ml-10 flex flex-1 items-center lg:ml-0">
        <div className="relative hidden w-full max-w-sm sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search assets, drivers, work orders…"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Link href="/notifications" className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-600" title="Service reminders">
          <Bell className="h-5 w-5" />
          {notifCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {notifCount > 99 ? "99+" : notifCount}
            </span>
          )}
        </Link>
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
  );
}
