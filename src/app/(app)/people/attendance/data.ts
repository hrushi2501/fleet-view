import { db } from "@/lib/db";
import {
  BUSINESS_TIMEZONE,
  businessDay,
  businessDayShort,
  startOfBusinessDayAgo,
  todayBusinessDay,
} from "@/lib/business-time";
import type { AttendanceRow, AttendanceView } from "@/components/AttendanceDashboard";

/**
 * The attendance register, assembled from the database and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * The register and the approvals screen used to build their rows in the browser
 * by looping over `mock-data.json` — inventing check-in times, 9.5/8.0/4.5 hour
 * totals, supervisor names, geofence passes and selfie URLs. Attendance is a
 * payroll input: a fabricated row is a wage paid for a shift nobody can prove
 * happened, and an auditor cannot tell the invented rows from the real ones
 * because they render identically. All of that generation is gone.
 *
 * Both attendance pages now read through this one loader so the register tab and
 * the approvals tab can never disagree about what actually happened, and so the
 * joining/aggregation stays on the server as the components asked for.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * TWO REAL SOURCES, DELIBERATELY KEPT DISTINGUISHABLE:
 *
 *   `Attendance`  — the marked register. This is what payroll pays against:
 *                   status, shift, hours, project, who marked it.
 *   `TripSession` — the driver↔machine binding. This is what actually happened:
 *                   when the shift started, whether it has ended, on which asset.
 *
 * A driver-day can have either, both, or neither. Where both exist the session
 * supplies the clock times the register does not store, and the register keeps
 * ownership of the payable hours. Where only a session exists the row is
 * surfaced as NOT_MARKED rather than being quietly assumed present — an
 * unmarked shift is a payroll gap somebody has to close, not a detail to hide.
 */

/** How far back both tabs look. One month covers a payroll cycle. */
export const ATTENDANCE_WINDOW_DAYS = 30;

/**
 * Clock times are formatted here, on the server, with the timezone named.
 * `date.toLocaleTimeString()` uses the *runtime's* zone — IST on a developer's
 * laptop, UTC on Vercel — so the same check-in rendered as "07:30 AM" locally
 * and "02:00 AM" in production. The date half of every row goes through
 * `businessDay()` for the same reason.
 */
const CLOCK = new Intl.DateTimeFormat("en-IN", {
  timeZone: BUSINESS_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

/** What the trip sessions of a single driver-day add up to. */
type SessionDay = {
  firstStart: Date;
  lastEnd: Date | null;
  /** At least one session on this day has not been checked out. */
  running: boolean;
  /** Milliseconds from *ended* sessions only. A live session contributes none. */
  completedMs: number;
  assetCode: string | null;
  assetName: string | null;
  projectName: string | null;
  trackingSource: string | null;
  scanMethod: string | null;
  lat: number | null;
  lng: number | null;
};

/** Trim a value that exists in the schema but may be blank to `null`. */
function orNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

function hours(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

export async function loadAttendanceView(): Promise<AttendanceView> {
  const since = startOfBusinessDayAgo(ATTENDANCE_WINDOW_DAYS);

  const [register, sessions] = await Promise.all([
    db.attendance.findMany({
      where: { date: { gte: since } },
      include: { driver: true, project: true },
      orderBy: { date: "desc" },
    }),
    db.tripSession.findMany({
      where: { startedAt: { gte: since } },
      include: { driver: true, asset: true, project: true },
      orderBy: { startedAt: "asc" },
    }),
  ]);

  // Fold every session of a driver-day into one entry. A driver who is rebound
  // to a second machine mid-day must not appear twice on the register, and the
  // day's worked total is the sum of the finished bindings, not the last one.
  const byDriverDay = new Map<string, SessionDay>();
  for (const s of sessions) {
    const key = `${s.driverId}|${businessDay(s.startedAt)}`;
    const running = s.endedAt == null && s.status === "ACTIVE";
    const prev = byDriverDay.get(key);
    if (!prev) {
      byDriverDay.set(key, {
        firstStart: s.startedAt,
        lastEnd: s.endedAt,
        running,
        completedMs: s.endedAt ? s.endedAt.getTime() - s.startedAt.getTime() : 0,
        assetCode: orNull(s.asset?.code),
        assetName: orNull(s.asset?.name),
        projectName: orNull(s.project?.name),
        trackingSource: orNull(s.trackingSource),
        scanMethod: orNull(s.scanMethod),
        lat: s.startLat ?? null,
        lng: s.startLng ?? null,
      });
      continue;
    }
    if (s.startedAt < prev.firstStart) prev.firstStart = s.startedAt;
    if (s.endedAt && (!prev.lastEnd || s.endedAt > prev.lastEnd)) prev.lastEnd = s.endedAt;
    prev.running = prev.running || running;
    if (s.endedAt) prev.completedMs += s.endedAt.getTime() - s.startedAt.getTime();
    // Keep the first machine of the day rather than overwriting; a later
    // rebinding does not retro-actively change which asset the shift started on.
    prev.assetCode ??= orNull(s.asset?.code);
    prev.assetName ??= orNull(s.asset?.name);
    prev.projectName ??= orNull(s.project?.name);
  }

  const rows: AttendanceRow[] = [];
  const claimed = new Set<string>();

  for (const a of register) {
    const day = businessDay(a.date);
    const key = `${a.driverId}|${day}`;
    const sd = byDriverDay.get(key);
    claimed.add(key);

    rows.push({
      id: a.id,
      source: "REGISTER",
      driverId: a.driverId,
      driverName: a.driver.name,
      driverEmpCode: orNull(a.driver.empCode),
      vehicleCode: sd?.assetCode ?? null,
      vehicleName: sd?.assetName ?? null,
      // The register's own project wins; the session's is the fallback for a
      // row marked without one.
      projectName: orNull(a.project?.name) ?? sd?.projectName ?? null,
      shift: orNull(a.shift),
      date: day,
      checkIn: sd ? CLOCK.format(sd.firstStart) : null,
      checkOut: sd?.lastEnd ? CLOCK.format(sd.lastEnd) : null,
      // `hours` is the marked, payable figure — the one payroll owes against.
      workingHours: a.hours,
      running: sd?.running ?? false,
      status: orNull(a.status) ?? "PRESENT",
      // The nearest thing the schema records to a supervisor: whoever entered
      // the row. There is no reporting-line field on Driver to read a real
      // supervisor from, so this is labelled for what it is.
      markedBy: orNull(a.markedBy),
      trackingSource: sd?.trackingSource ?? null,
      scanMethod: sd?.scanMethod ?? null,
      lat: sd?.lat ?? null,
      lng: sd?.lng ?? null,
      note: orNull(a.note),
    });
  }

  // Sessions whose driver-day was never marked in the register. Payroll has
  // nothing to pay against these yet, which is exactly why they are shown.
  for (const s of sessions) {
    const day = businessDay(s.startedAt);
    const key = `${s.driverId}|${day}`;
    if (claimed.has(key)) continue;
    claimed.add(key);
    const sd = byDriverDay.get(key)!;

    rows.push({
      id: `session:${key}`,
      source: "SESSION",
      driverId: s.driverId,
      driverName: s.driver.name,
      driverEmpCode: orNull(s.driver.empCode),
      vehicleCode: sd.assetCode,
      vehicleName: sd.assetName,
      projectName: sd.projectName,
      // TripSession records no shift. Inventing DAY here is what put a made-up
      // "☀️ Day" against every row on the old screen.
      shift: null,
      date: day,
      checkIn: CLOCK.format(sd.firstStart),
      checkOut: sd.lastEnd ? CLOCK.format(sd.lastEnd) : null,
      // A live binding has no total yet. `null` renders as "Running", not 4.5.
      workingHours: sd.running && sd.completedMs === 0 ? null : hours(sd.completedMs),
      running: sd.running,
      status: sd.running ? "RUNNING" : "NOT_MARKED",
      markedBy: null,
      trackingSource: sd.trackingSource,
      scanMethod: sd.scanMethod,
      lat: sd.lat,
      lng: sd.lng,
      note: null,
    });
  }

  rows.sort((a, b) => (a.date === b.date ? a.driverName.localeCompare(b.driverName) : b.date.localeCompare(a.date)));

  const today = todayBusinessDay();
  const todayRows = rows.filter((r) => r.date === today);
  const count = (s: string) => todayRows.filter((r) => r.status === s).length;

  // Seven business days ending today, oldest first, so the axis reads left to
  // right. Only marked register rows count — a chart of inferred attendance is
  // the same lie in a different shape.
  const trend = Array.from({ length: 7 }, (_, i) => {
    const at = startOfBusinessDayAgo(6 - i);
    const day = businessDay(at);
    const dayRows = rows.filter((r) => r.date === day && r.source === "REGISTER");
    return {
      label: businessDayShort(at),
      Present: dayRows.filter((r) => r.status === "PRESENT").length,
      Absent: dayRows.filter((r) => r.status === "ABSENT").length,
      Leave: dayRows.filter((r) => r.status === "LEAVE").length,
    };
  });

  const STATUS_COLOR: Record<string, string> = {
    PRESENT: "#10b981",
    RUNNING: "#3b82f6",
    HALF_DAY: "#f59e0b",
    ABSENT: "#f43f5e",
    LEAVE: "#8b5cf6",
    REST: "#94a3b8",
    NOT_MARKED: "#64748b",
  };
  const breakdown = [...new Set(todayRows.map((r) => r.status))]
    .map((name) => ({ name, value: count(name), color: STATUS_COLOR[name] }))
    .filter((s) => s.value > 0);

  return {
    rows,
    today,
    windowDays: ATTENDANCE_WINDOW_DAYS,
    kpis: {
      present: count("PRESENT"),
      running: todayRows.filter((r) => r.running).length,
      absent: count("ABSENT"),
      leave: count("LEAVE"),
      unmarked: count("NOT_MARKED"),
    },
    // Offer only the statuses the data actually contains. A dropdown listing
    // "Late" implied the ERP tracks lateness; no column in the schema does.
    statusOptions: [...new Set(rows.map((r) => r.status))].sort(),
    trend,
    breakdown,
  };
}
