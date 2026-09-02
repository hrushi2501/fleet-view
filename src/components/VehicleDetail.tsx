import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The furniture the vehicle page is built from.
 *
 * One card shell, one heading, one key/value row — so that a page carrying
 * forty-odd separate facts still reads as one document rather than as a pile of
 * unrelated boxes. The measurements are the supplied design's: 13px radius, a
 * hairline border, 20/24 padding, and the blue all-caps heading.
 */

export function Panel({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "rounded-[13px] border border-[#e9eef5] bg-white px-6 py-5 shadow-[0_2px_8px_rgba(16,24,40,.035)]",
        className
      )}
    >
      {children}
    </section>
  );
}

export function PanelTitle({
  icon: Icon,
  children,
  href,
  linkLabel,
  note,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  href?: string;
  linkLabel?: string;
  note?: string;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2.5 text-[12px] font-extrabold tracking-[.4px] text-[#155eef]">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{children}</span>
        {href && linkLabel && (
          <Link href={href} className="ml-auto shrink-0 text-[12px] font-bold text-[#155eef] hover:underline">
            {linkLabel}
          </Link>
        )}
      </div>
      {note && <p className="mt-1.5 text-xs leading-snug text-[#667085]">{note}</p>}
    </div>
  );
}

/**
 * A fact and its label.
 *
 * `value` of null is the important case and the common one: this fleet's
 * records are half-filled, and the honest rendering of an empty column is a
 * visible "Not recorded", not a blank that reads as zero or as a bug. Numeric
 * values get tabular figures so a column of them lines up.
 */
export type Row = {
  label: string;
  value: string | null;
  /** Extra context under the value — a date's relative age, a caveat. */
  hint?: string;
  numeric?: boolean;
  /** Draws the value in a warning colour. For overdue dates and the like. */
  tone?: "default" | "warn" | "bad" | "good";
  /** Renders as a link when the value is worth navigating from. */
  href?: string;
};

const TONE: Record<string, string> = {
  default: "text-[#17233b]",
  warn: "text-amber-700",
  bad: "text-rose-700",
  good: "text-emerald-700",
};

export function DetailList({ rows, cols = 2 }: { rows: Row[]; cols?: 1 | 2 | 3 }) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-4",
        cols === 1 ? "grid-cols-1" : cols === 3 ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-3" : "grid-cols-2"
      )}
    >
      {rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-[#8b93a5]">{r.label}</dt>
          <dd
            className={cn(
              "mt-1 truncate text-[13px] font-semibold",
              r.numeric && "tabular-nums",
              r.value ? TONE[r.tone ?? "default"] : "font-normal italic text-slate-400"
            )}
            title={r.value ?? undefined}
          >
            {r.value ? (
              r.href ? (
                <Link href={r.href} className="hover:text-brand-600 hover:underline">
                  {r.value}
                </Link>
              ) : (
                r.value
              )
            ) : (
              "Not recorded"
            )}
          </dd>
          {r.hint && <p className="mt-0.5 truncate text-[11px] text-[#8b93a5]">{r.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

/**
 * One thing that needs somebody, with the action attached.
 *
 * These sit directly under the hero because an administrator opening a vehicle
 * is nearly always asking "is anything wrong with this one" — and the answer
 * should not be somewhere down the page behind six cards of reference data.
 */
export function AttentionItem({
  tone,
  title,
  detail,
  href,
  action,
}: {
  tone: "bad" | "warn" | "info";
  title: string;
  detail: string;
  href?: string;
  action?: string;
}) {
  const styles = {
    bad: "border-rose-200 bg-rose-50/70 text-rose-900",
    warn: "border-amber-200 bg-amber-50/70 text-amber-900",
    info: "border-slate-200 bg-slate-50 text-slate-700",
  }[tone];
  const dot = { bad: "bg-rose-500", warn: "bg-amber-500", info: "bg-slate-400" }[tone];

  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", styles)}>
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{title}</p>
        <p className="mt-0.5 text-xs leading-snug opacity-80">{detail}</p>
      </div>
      {href && action && (
        <Link
          href={href}
          className="shrink-0 rounded-lg bg-white/80 px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ring-current/20 hover:bg-white"
        >
          {action}
        </Link>
      )}
    </div>
  );
}

/** A small labelled pill — used for sensor state, data source, ownership. */
export function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const styles = {
    neutral: "bg-slate-100 text-slate-600 ring-slate-500/20",
    good: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
    warn: "bg-amber-100 text-amber-700 ring-amber-600/20",
    bad: "bg-rose-100 text-rose-700 ring-rose-600/20",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", styles)}>
      {children}
    </span>
  );
}
