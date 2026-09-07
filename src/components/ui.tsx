import { cn } from "@/lib/utils";
import * as React from "react";
import { Txt } from "@/components/Txt";
import { Sparkline } from "@/components/Sparkline";
import { SERIES, STATUS } from "@/lib/viz";

/**
 * The pieces every screen is built from.
 *
 * The props here have not changed — a hundred and forty-odd stat tiles across
 * thirty-four screens call them, and the point of this pass is how they read,
 * not how they are called. What changed is the rendering.
 */

export function Card({
  className,
  children,
  as: As = "div",
}: {
  className?: string;
  children: React.ReactNode;
  as?: "div" | "section" | "article";
}) {
  return <As className={cn("card p-5", className)}>{children}</As>;
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
      {typeof children === "string" ? <Txt text={children} /> : children}
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
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink-900"><Txt text={title} /></h2>
        {subtitle && <p className="mt-0.5 text-[13px] leading-snug text-slate-500"><Txt text={subtitle} /></p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ──────────────────────────────── stat tiles ─────────────────────────────── */

type Accent = "brand" | "emerald" | "rose" | "amber" | "violet";

/**
 * The accent is a wash and an icon tint — never the colour of the number.
 *
 * Text takes the value's own weight; a light hue like amber is genuinely hard
 * to read at 13px on white, and colouring the figure would mean the reader has
 * to work hardest on exactly the tiles that are trying to raise an alarm.
 */
const ACCENT: Record<Accent, { chip: string; wash: string; spark: string }> = {
  brand: { chip: "bg-brand-50 text-brand-600 ring-brand-500/15", wash: "from-brand-500/[0.07]", spark: SERIES[0] },
  emerald: { chip: "bg-emerald-50 text-emerald-600 ring-emerald-500/15", wash: "from-emerald-500/[0.07]", spark: STATUS.good },
  rose: { chip: "bg-rose-50 text-rose-600 ring-rose-500/15", wash: "from-rose-500/[0.07]", spark: STATUS.critical },
  amber: { chip: "bg-amber-50 text-amber-600 ring-amber-500/15", wash: "from-amber-500/[0.07]", spark: STATUS.warning },
  violet: { chip: "bg-violet-50 text-violet-600 ring-violet-500/15", wash: "from-violet-500/[0.07]", spark: SERIES[6] },
};

export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = "brand",
  trend,
  spark,
  size = "md",
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  accent?: Accent;
  trend?: { dir: "up" | "down"; value: string; good?: boolean };
  /** Recent history behind the value. Nothing is drawn below two points. */
  spark?: number[];
  /** `lg` is for the one figure a screen leads with. At most one per view. */
  size?: "md" | "lg";
  className?: string;
}) {
  const a = ACCENT[accent] ?? ACCENT.brand;
  const lg = size === "lg";

  return (
    <div
      className={cn(
        "card group relative flex flex-col overflow-hidden transition-shadow hover:shadow-md",
        lg ? "p-6" : "p-5",
        className
      )}
    >
      {/* A wash rather than a band: it tints the tile without drawing an edge
          that competes with the card's own hairline. */}
      <div className={cn("pointer-events-none absolute inset-0 bg-linear-to-br to-transparent", a.wash)} />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-slate-500"><Txt text={label} /></p>
          {/* Proportional figures on purpose — tabular digits give every glyph
              the width of a zero, which makes a number like 121 look loose at
              this size. Columns get tabular; standalone values do not. */}
          <p
            className={cn(
              "mt-1 font-bold tracking-tight text-ink-900",
              lg ? "text-[2.25rem] leading-none" : "text-[1.6rem] leading-none"
            )}
          >
            {value}
          </p>
          {sub && <p className="mt-1.5 text-xs leading-snug text-slate-400"><Txt text={sub} /></p>}
        </div>

        {icon && (
          <div className={cn("shrink-0 rounded-xl p-2 ring-1 ring-inset", a.chip)}>{icon}</div>
        )}
      </div>

      {trend && (
        <p
          className={cn(
            "relative mt-3 inline-flex items-center gap-1 text-xs font-medium",
            trend.good ? "text-emerald-600" : "text-rose-600"
          )}
        >
          <span aria-hidden>{trend.dir === "up" ? "▲" : "▼"}</span>
          {trend.value}
        </p>
      )}

      {spark && spark.length > 1 && (
        // Bleeds to the tile's edges: the sparkline is the tile's floor, not a
        // chart sitting inside it.
        <div className="relative mt-auto -mx-5 -mb-5 pt-4">
          <Sparkline data={spark} color={a.spark} height={36} />
        </div>
      )}
    </div>
  );
}

/**
 * The single number a screen leads with.
 *
 * Exactly one per view — a page with three heroes has none. Everything else is
 * a `StatCard`.
 */
export function HeroStat({
  label,
  value,
  sub,
  action,
  tone = "neutral",
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  action?: React.ReactNode;
  tone?: "neutral" | "good" | "warning" | "critical";
  children?: React.ReactNode;
}) {
  const tones = {
    neutral: "text-ink-900",
    good: "text-emerald-700",
    warning: "text-amber-700",
    critical: "text-rose-700",
  };
  return (
    <div className="card flex flex-wrap items-end justify-between gap-6 p-6">
      <div className="min-w-0">
        <p className="text-[13px] font-medium uppercase tracking-wide text-slate-400"><Txt text={label} /></p>
        <p className={cn("mt-1.5 text-[3rem] font-bold leading-none tracking-tight", tones[tone])}>{value}</p>
        {sub && <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-500"><Txt text={sub} /></p>}
      </div>
      {children && <div className="min-w-45 flex-1">{children}</div>}
      {action}
    </div>
  );
}

/* ──────────────────────────────── meters ─────────────────────────────────── */

/**
 * A ratio against a limit.
 *
 * The fill carries severity and the track is a lighter step of the *same* hue,
 * so the state reads across the whole bar rather than only where the fill
 * happens to end. A grey track makes a 6%-full bar look like an empty
 * component rather than like a number near zero.
 */
export function Progress({
  value,
  className,
  /** Set when more is worse — tank level is good high, fuel loss is not. */
  invert = false,
}: {
  value: number;
  className?: string;
  invert?: boolean;
}) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const level = invert ? 100 - v : v;

  const band =
    level >= 75
      ? { fill: "bg-emerald-500", track: "bg-emerald-500/12" }
      : level >= 50
        ? { fill: "bg-amber-500", track: "bg-amber-500/12" }
        : { fill: "bg-rose-500", track: "bg-rose-500/12" };

  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full", band.track, className)}
      role="meter"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500", band.fill)} style={{ width: `${v}%` }} />
    </div>
  );
}

/** A labelled meter row — the shape used wherever a list of ratios is shown. */
export function MeterRow({
  label,
  value,
  display,
  invert = false,
}: {
  label: string;
  value: number;
  display?: string;
  invert?: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className="truncate font-medium text-slate-700">{label}</span>
        <span className="shrink-0 tabular-nums text-slate-500">{display ?? `${Math.round(value)}%`}</span>
      </div>
      <Progress value={value} invert={invert} />
    </div>
  );
}

/* ──────────────────────────────── tables ─────────────────────────────────── */

/**
 * Table parts, so every table in the product has the same rhythm.
 *
 * Numeric cells are `tabular-nums` and right-aligned — this is the one place
 * equal-width digits earn their keep, because the reader is comparing down a
 * column and a ragged decimal point defeats that.
 */
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className={cn("w-full min-w-lg text-sm", className)}>{children}</table>
    </div>
  );
}

export function Th({
  children,
  numeric,
  className,
}: {
  children?: React.ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-slate-100 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400",
        numeric ? "text-right" : "text-left",
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric,
  className,
}: {
  children?: React.ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td className={cn("py-2.5 align-middle", numeric && "text-right tabular-nums", className)}>{children}</td>
  );
}

export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <tr className={cn("border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/70", className)}>
      {children}
    </tr>
  );
}

/* ─────────────────────────────── empty state ─────────────────────────────── */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/60 p-8 text-center sm:p-12",
        className
      )}
    >
      {Icon && (
        <div className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-500/15">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h3 className="text-base font-bold text-ink-900"><Txt text={title} /></h3>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
        <Txt text={description} />
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
