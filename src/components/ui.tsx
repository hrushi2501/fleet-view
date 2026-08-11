import { cn } from "@/lib/utils";
import * as React from "react";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("card p-5", className)}>{children}</div>;
}

export function Badge({
  children,
  className,
  color,
}: {
  children: React.ReactNode;
  className?: string;
  color?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        color ?? "bg-slate-100 text-slate-600 ring-slate-500/20",
        className
      )}
    >
      {children}
    </span>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = "brand",
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  accent?: "brand" | "emerald" | "rose" | "amber" | "violet";
  trend?: { dir: "up" | "down"; value: string; good?: boolean };
}) {
  const accents: Record<string, string> = {
    brand: "from-brand-500/10 to-brand-500/0 text-brand-600",
    emerald: "from-emerald-500/10 to-emerald-500/0 text-emerald-600",
    rose: "from-rose-500/10 to-rose-500/0 text-rose-600",
    amber: "from-amber-500/10 to-amber-500/0 text-amber-600",
    violet: "from-violet-500/10 to-violet-500/0 text-violet-600",
  };
  return (
    <div className="card relative overflow-hidden p-5 animate-fade-up">
      <div className={cn("absolute inset-x-0 top-0 h-20 bg-gradient-to-b", accents[accent])} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ink-900">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
        {icon && (
          <div className={cn("rounded-xl bg-white/70 p-2 shadow-sm ring-1 ring-black/5", accents[accent])}>
            {icon}
          </div>
        )}
      </div>
      {trend && (
        <p
          className={cn(
            "relative mt-3 inline-flex items-center gap-1 text-xs font-medium",
            trend.good ? "text-emerald-600" : "text-rose-600"
          )}
        >
          {trend.dir === "up" ? "▲" : "▼"} {trend.value}
        </p>
      )}
    </div>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  const color = value >= 75 ? "bg-emerald-500" : value >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-slate-100", className)}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}
