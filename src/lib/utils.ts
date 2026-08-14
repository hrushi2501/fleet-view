import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { BUSINESS_TIMEZONE, businessDay } from "./business-time";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Whole calendar days from today to `target`, counted in the business timezone.
 *
 * The obvious `Math.floor((target - now) / 86400000)` is wrong twice over. It
 * measures elapsed *time*, not calendar days, so an insurance policy that
 * expires at any point later today comes back as −1 — "expired 1 day ago" — and
 * the machine gets stood down on a day it is perfectly legal to run. And it
 * measures those days against the server's clock, which is UTC on Vercel while
 * the RTO, the insurer and the site all work to IST.
 *
 * Positive is in the future, 0 is today, negative is in the past. A document is
 * valid *through* its expiry date, so only a negative result means expired.
 */
export function calendarDaysUntil(target: Date, now: Date = new Date()): number {
  const midnightUtc = (d: Date) => {
    const [y, m, day] = businessDay(d).split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((midnightUtc(target) - midnightUtc(now)) / 86400000);
}

/** Indian currency formatting with lakh/crore abbreviation */
export function inr(n: number, opts: { compact?: boolean } = {}): string {
  // A division that produced NaN or Infinity is a failed calculation, not a
  // rupee value. "₹NaN" at least looks broken; "₹∞" has been mistaken for a
  // real figure before. Render neither as money.
  if (!Number.isFinite(n)) return "—";
  if (opts.compact) {
    if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
    if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
    if (Math.abs(n) >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`;
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function num(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN").format(Math.round(n));
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export function fmtDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  // Without an explicit zone this renders in the server's timezone — UTC on
  // Vercel — so anything logged between midnight and 05:30 IST prints as the
  // previous day. Fuel issued at 01:00 on the 1st would show as the 31st.
  return d.toLocaleDateString("en-IN", {
    timeZone: BUSINESS_TIMEZONE,
    day: "2-digit", month: "short", year: "numeric",
  });
}

export const ASSET_CLASS_LABEL: Record<string, string> = {
  DUMPER: "Dumper",
  TIPPER: "Tipper",
  EXCAVATOR: "Excavator",
  BACKHOE: "Backhoe Loader",
  GRADER: "Motor Grader",
  ROLLER: "Roller",
  CRANE: "Crane",
  TRANSIT_MIXER: "Transit Mixer",
  WATER_TANKER: "Water Tanker",
  TRUCK: "Truck",
  PICKUP: "Pickup",
  CAR: "Car / Staff Vehicle",
  BIKE: "Bike / Two-Wheeler",
  TRACTOR: "Tractor",
  PLANT: "Plant / Asphalt Equipment",
  CRUSHER: "Crusher",
  MINES: "Mines / Lease",
};

export const STATUS_COLOR: Record<string, string> = {
  Active: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  Idle: "bg-amber-100 text-amber-700 ring-amber-600/20",
  "Under-Maintenance": "bg-blue-100 text-blue-700 ring-blue-600/20",
  "In-Transit": "bg-violet-100 text-violet-700 ring-violet-600/20",
  Breakdown: "bg-rose-100 text-rose-700 ring-rose-600/20",
  "Off-hired": "bg-slate-100 text-slate-600 ring-slate-500/20",
  Valid: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  Expiring: "bg-amber-100 text-amber-700 ring-amber-600/20",
  Expired: "bg-rose-100 text-rose-700 ring-rose-600/20",
  Open: "bg-rose-100 text-rose-700 ring-rose-600/20",
  "In-Progress": "bg-blue-100 text-blue-700 ring-blue-600/20",
  Completed: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  Closed: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export const SEVERITY_COLOR: Record<string, string> = {
  Critical: "bg-rose-100 text-rose-700 ring-rose-600/20",
  Warning: "bg-amber-100 text-amber-700 ring-amber-600/20",
  Info: "bg-sky-100 text-sky-700 ring-sky-600/20",
};

/** Haversine distance in km between two lat/lng points. */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function healthColor(score: number): string {
  if (score >= 75) return "text-emerald-600";
  if (score >= 55) return "text-amber-600";
  return "text-rose-600";
}

export const ROLE_LABEL: Record<string, string> = {
  Admin: "Administrator",
  Driver: "Truck Driver",
  FleetManager: "Fleet Manager",
  Finance: "Finance Controller",
  SiteManager: "Site Manager",
  Workshop: "Workshop Manager",
};
