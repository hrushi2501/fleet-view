/**
 * The driver app's visual vocabulary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SEPARATE FROM `components/ui.tsx`
 *
 * The office UI is read on a desk monitor by someone who uses software all day.
 * This one is read on a cracked phone screen, in sunlight, by someone holding a
 * steering wheel — often a person for whom this is the only business software
 * they have ever used. So the rules here are different and deliberately narrow:
 *
 *   • one idea per block, never a table,
 *   • every tappable thing at least 56px tall, well past the 44px floor,
 *   • colour carries meaning (red = stop, amber = check, green = fine) and is
 *     always backed by a word, because colour alone is no use to a driver with
 *     colour blindness or a phone in bright sun,
 *   • the words are plain English with a single Hinglish line per screen where
 *     it genuinely lands harder than the English would.
 *
 * `Card` and `StatCard` from the shared kit are reused as-is where they fit, so
 * this app still looks like the rest of the product rather than a bolt-on.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui";
import { DRIVER_MODULES } from "@/lib/navigation";
import type { Tone } from "./_data";
import {
  LayoutDashboard, Truck, Route, Fuel, Wrench, ShieldCheck,
  UserX, TruckIcon, ChevronRight, type LucideIcon,
} from "lucide-react";

/* ------------------------------------------------------------------- tones */

/**
 * One tone table, used by every block on every screen.
 *
 * Kept as data rather than inline classes so "amber means check this" cannot
 * quietly become "amber means fine" on one screen out of six.
 */
export const TONE: Record<Tone, { box: string; text: string; dot: string; chip: string }> = {
  ok: { box: "bg-emerald-50 ring-emerald-200", text: "text-emerald-800", dot: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-800" },
  warn: { box: "bg-amber-50 ring-amber-200", text: "text-amber-900", dot: "bg-amber-500", chip: "bg-amber-100 text-amber-900" },
  bad: { box: "bg-rose-50 ring-rose-200", text: "text-rose-800", dot: "bg-rose-500", chip: "bg-rose-100 text-rose-800" },
  info: { box: "bg-brand-50 ring-brand-200", text: "text-brand-700", dot: "bg-brand-500", chip: "bg-brand-100 text-brand-700" },
  muted: { box: "bg-slate-50 ring-slate-200", text: "text-slate-700", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-700" },
};

/* ------------------------------------------------------------------ header */

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Truck, Route, Fuel, Wrench, ShieldCheck,
};

/**
 * The page heading, taken from the navigation rather than retyped.
 *
 * The label and the one-line hint a driver sees in the menu are the same words
 * they should see at the top of the page they land on. Deriving both from
 * `DRIVER_MODULES` means the two can never drift apart, and the Hinglish hints
 * ("Meri gaadi", "Diesel bharna") stay editable in one file.
 */
export function MyHeader({ href, note }: { href: string; note?: string }) {
  const item = DRIVER_MODULES.find((m) => m.href === href);
  const Icon = item ? ICONS[item.icon] ?? LayoutDashboard : LayoutDashboard;
  return (
    <header className="flex items-center gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{item?.label ?? "My Work"}</h1>
        <p className="truncate text-sm text-slate-500">{note ?? item?.hint}</p>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------ empty states */

/**
 * The login is not attached to a person record.
 *
 * This is a real and fairly common situation — an account gets created for a new
 * driver before the office links it to their employee file — and the wrong
 * answer is to show the whole fleet "just until it's set up". So the screen
 * shows nothing at all, says plainly whose job it is to fix, and gives the
 * driver the one fact the office will ask for.
 */
export function NotLinked({ loginName }: { loginName: string }) {
  return (
    <Card className="text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600">
        <UserX className="h-8 w-8" />
      </div>
      <h2 className="mt-4 text-xl font-bold text-ink-900">Aapka account abhi link nahi hua</h2>
      <p className="mx-auto mt-2 max-w-sm text-base leading-relaxed text-slate-600">
        Your login is not yet connected to your driver record, so we cannot show
        your vehicle, trips or documents here.
      </p>
      <p className="mx-auto mt-3 max-w-sm text-base leading-relaxed text-slate-600">
        Please ask your supervisor or the office to connect this login
        <span className="font-semibold text-ink-900"> ({loginName}) </span>
        to your name. It takes one minute.
      </p>
      <p className="mt-4 text-sm text-slate-400">Tab tak yahan kuch nahi dikhega.</p>
    </Card>
  );
}

/** Linked to a person, but no machine handed over to them yet. */
export function NoVehicle() {
  return (
    <Card className="text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <TruckIcon className="h-8 w-8" />
      </div>
      <h2 className="mt-4 text-xl font-bold text-ink-900">No vehicle assigned</h2>
      <p className="mx-auto mt-2 max-w-sm text-base leading-relaxed text-slate-600">
        Abhi aapke naam par koi vehicle nahi hai. Your supervisor will assign one
        before your next duty.
      </p>
    </Card>
  );
}

/** Nothing to show, but nothing wrong either. */
export function Nothing({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-base text-slate-500">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ blocks */

/**
 * The one thing the screen most wants to say, said big.
 *
 * A driver glancing at a phone gets about two seconds. That budget buys one
 * word and one line, so the state goes in 3xl type with the explanation under
 * it — not a row in a table of six other numbers.
 */
export function Hero({
  tone, label, hint, meta,
}: {
  tone: Tone; label: string; hint: string; meta?: string;
}) {
  const t = TONE[tone];
  return (
    <div className={cn("rounded-2xl px-5 py-6 ring-1", t.box)}>
      <div className="flex items-center gap-3">
        <span className={cn("h-3.5 w-3.5 shrink-0 rounded-full", t.dot)} />
        <p className={cn("text-3xl font-extrabold leading-none tracking-tight", t.text)}>{label}</p>
      </div>
      <p className={cn("mt-3 text-base font-medium leading-snug", t.text)}>{hint}</p>
      {meta && <p className="mt-1 text-sm text-slate-500">{meta}</p>}
    </div>
  );
}

/** A warning worth stopping for — expired papers, an overdue service. */
export function Notice({
  tone, title, lines, href, cta,
}: {
  tone: Tone; title: string; lines?: string[]; href?: string; cta?: string;
}) {
  const t = TONE[tone];
  return (
    <div className={cn("rounded-2xl px-4 py-4 ring-1", t.box)}>
      <p className={cn("text-lg font-bold leading-snug", t.text)}>{title}</p>
      {lines && lines.length > 0 && (
        <ul className={cn("mt-2 space-y-1 text-base leading-snug", t.text)}>
          {lines.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      )}
      {href && cta && (
        <Link
          href={href}
          className="mt-3 inline-flex min-h-[48px] items-center rounded-xl bg-white px-4 text-base font-semibold text-ink-900 shadow-sm ring-1 ring-black/5 active:scale-[0.98]"
        >
          {cta}
        </Link>
      )}
    </div>
  );
}

/**
 * A fact and its value, on one line, big enough to read at arm's length.
 * Two of these side by side is the densest this app ever gets.
 */
export function Fact({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tracking-tight", tone ? TONE[tone].text : "text-ink-900")}>{value}</p>
      {sub && <p className="mt-0.5 text-sm text-slate-400">{sub}</p>}
    </div>
  );
}

/** One entry in a list — a trip, a fill, a document. Never a table row. */
export function Row({
  title, subtitle, right, rightSub, tone,
}: {
  title: string; subtitle?: string; right?: string; rightSub?: string; tone?: Tone;
}) {
  return (
    <div className="flex min-h-[64px] items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-ink-900">{title}</p>
        {subtitle && <p className="truncate text-sm text-slate-500">{subtitle}</p>}
      </div>
      {right && (
        <div className="shrink-0 text-right">
          <p className={cn("text-base font-bold", tone ? TONE[tone].text : "text-ink-900")}>{right}</p>
          {rightSub && <p className="text-sm text-slate-400">{rightSub}</p>}
        </div>
      )}
    </div>
  );
}

/** A short coloured word attached to a row — "Expired", "Overdue", "Open". */
export function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-sm font-semibold", TONE[tone].chip)}>
      {children}
    </span>
  );
}

/**
 * A big navigation tile for the home screen.
 *
 * Full width, 72px tall, whole surface tappable. A driver should never have to
 * aim at a phone while wearing work gloves.
 */
export function Tile({ href, label, hint, badge }: { href: string; label: string; hint: string; badge?: { tone: Tone; text: string } }) {
  const item = DRIVER_MODULES.find((m) => m.href === href);
  const Icon = item ? ICONS[item.icon] ?? LayoutDashboard : LayoutDashboard;
  return (
    <Link
      href={href}
      className="flex min-h-[72px] items-center gap-4 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200 active:scale-[0.99] active:bg-slate-50"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <Icon className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold text-ink-900">{label}</span>
        <span className="block truncate text-sm text-slate-500">{hint}</span>
      </span>
      {badge && <Chip tone={badge.tone}>{badge.text}</Chip>}
      <ChevronRight className="h-6 w-6 shrink-0 text-slate-300" />
    </Link>
  );
}

/** The page shell — one column, comfortable spacing, never wider than a phone. */
export function Screen({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-xl space-y-5 pb-8">{children}</div>;
}

/** A titled group of rows. */
export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-base font-semibold text-slate-600">{title}</h2>
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">{children}</div>
    </section>
  );
}
