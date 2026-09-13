/**
 * Dates in the business's own timezone, not the server's.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Two different wrong answers were in the codebase, and they disagreed with
 * each other:
 *
 *   1. `date.toISOString().slice(0, 10)` groups by *UTC* day. India is UTC+5:30,
 *      so everything logged between midnight and 05:30 IST falls into the
 *      previous UTC day. A fuel issue at 02:00 on the 1st is booked to the last
 *      day of the previous month — which moves spend between accounting periods
 *      and moves attendance between payroll days.
 *
 *   2. `date.getFullYear()/getMonth()/getDate()` groups by *server local* time.
 *      That is IST on a developer's laptop and UTC on Vercel, so the same rows
 *      render as different days depending on where the code runs. `vercel.json`
 *      pins the region to `bom1`, but region is not timezone — Vercel functions
 *      run with TZ=UTC everywhere.
 *
 * Neither is a timezone the business operates in. Every day, month and period
 * boundary in the ERP now resolves through here instead.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The timezone the client actually works in. Override with BUSINESS_TIMEZONE if
 * the ERP is ever deployed for a business in another zone; the default is the
 * one Mahadev Constructions operates in.
 */
export const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "Asia/Kolkata";

/**
 * Splits an instant into its calendar parts in the business timezone.
 *
 * Uses Intl rather than a fixed +5:30 offset so the arithmetic stays correct if
 * the zone is ever changed to one that observes daylight saving.
 */
function parts(d: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) if (p.type !== "literal") out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    // Intl renders midnight as "24" in some runtimes; normalise it.
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
  };
}

/** `YYYY-MM-DD` in the business timezone. The key to group a day by. */
export function businessDay(d: Date): string {
  const p = parts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** `YYYY-MM` in the business timezone. The key to group an accounting period by. */
export function businessMonth(d: Date): string {
  const p = parts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** `MM-DD` in the business timezone, for compact chart axes. */
export function businessDayShort(d: Date): string {
  return businessDay(d).slice(5);
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * `DD Mon YYYY, H:MM AM/PM` formatted in the business timezone.
 *
 * Deterministic and engine-independent: avoids Node vs browser ICU mismatches
 * (e.g. Node producing "Sept" and "7:40 pm" while browsers produce "Sep" and "7:40 PM"
 * under `en-IN`, which causes React hydration failures).
 */
export function businessClock(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  const p = parts(date);
  const day = String(p.day).padStart(2, "0");
  const month = SHORT_MONTHS[p.month - 1] ?? String(p.month).padStart(2, "0");
  const hour12 = p.hour % 12 || 12;
  const minute = String(p.minute).padStart(2, "0");
  const ampm = p.hour >= 12 ? "PM" : "AM";
  return `${day} ${month} ${p.year}, ${hour12}:${minute} ${ampm}`;
}

/**
 * The instant that a business day starts, as a UTC Date.
 *
 * Use this for `where: { date: { gte: startOfBusinessDay(x) } }` — a query
 * anchored on a UTC midnight silently includes or excludes the 00:00–05:30 IST
 * band depending on which side of the boundary it lands.
 */
export function startOfBusinessDay(d: Date): Date {
  const p = parts(d);
  const guess = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0, 0);
  // Correct the guess by the zone's offset at that moment.
  return new Date(guess - offsetMs(new Date(guess)));
}

/** Start of the business day `n` days before the one containing `d`. */
export function startOfBusinessDayAgo(days: number, from: Date = new Date()): Date {
  return startOfBusinessDay(new Date(from.getTime() - days * 86_400_000));
}

/** Offset of the business timezone from UTC at a given instant, in ms. */
function offsetMs(at: Date): number {
  const p = parts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, at.getUTCSeconds(), at.getUTCMilliseconds());
  return asUtc - at.getTime();
}

/**
 * Today's date as `YYYY-MM-DD` in the business timezone — the correct default
 * for a `<input type="date">`, which a user reads as their own calendar day.
 */
export function todayBusinessDay(): string {
  return businessDay(new Date());
}

/**
 * Parses a `YYYY-MM-DD` from a form as *that* calendar day in the business
 * timezone. `new Date("2026-08-12")` parses as UTC midnight, which is
 * 05:30 IST — so a date typed as the 12th could be stored as an instant that
 * other code reads back as the 11th.
 */
export function parseBusinessDay(value: string | null | undefined, fallback: Date = new Date()): Date {
  if (!value) return fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) {
    const loose = new Date(value);
    return Number.isNaN(loose.getTime()) ? fallback : loose;
  }
  const [, y, mo, dd] = m;
  // Midday in the business zone: far from either boundary, so no rounding or
  // DST edge can push the stored instant into an adjacent day.
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(dd), 12, 0, 0, 0);
  return new Date(guess - offsetMs(new Date(guess)));
}
