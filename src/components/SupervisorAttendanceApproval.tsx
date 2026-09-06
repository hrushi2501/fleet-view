"use client";

import React, { useState, useMemo } from "react";
import { Card, StatCard, SectionTitle } from "@/components/ui";
import { DonutChart, LineChart } from "@/components/charts";
import {
  CheckCircle2,
  Clock,
  Search,
  Download,
  X,
  MapPin,
  ClipboardX,
  Info,
  FileQuestion,
  History,
} from "lucide-react";
import {
  dash,
  HoursCell,
  StatusBadge,
  type AttendanceRow,
  type AttendanceView,
} from "@/components/AttendanceDashboard";

/**
 * The supervisor's review queue over real shift records.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SCREEN NO LONGER CLAIMS
 *
 * It used to synthesise 15 approval rows from `mock-data.json` and decorate each
 * with a "GPS Verified" badge, a stock-photo "cabin selfie", a seven-item safety
 * checklist and a hardcoded "93.3% geofence pass rate". None of those have a
 * column anywhere in `prisma/schema.prisma`: `TripSession` records `startLat`,
 * `startLng`, `trackingSource` and `scanMethod`, and that is the whole of the
 * evidence the ERP actually captures. Presenting a checklist nobody filled in as
 * a passed verification is the worst failure mode on a payroll screen — it turns
 * a supervisor's sign-off into an endorsement of something they never saw.
 *
 * Approve/Reject buttons are also gone. They only ever mutated React state: the
 * decision vanished on refresh while the UI said "Decision Recorded". There is
 * no approval column on `Attendance` and no server action to write one, so the
 * queue is read-only until that model exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function SupervisorAttendanceApproval({ view }: { view: AttendanceView }) {
  const { rows, trend, breakdown, today, windowDays } = view;

  const [activeTab, setActiveTab] = useState<"REVIEW" | "ALL" | "ANALYTICS">("REVIEW");
  const [search, setSearch] = useState("");
  const [viewGpsRecord, setViewGpsRecord] = useState<AttendanceRow | null>(null);
  const [viewHistoryRecord, setViewHistoryRecord] = useState<AttendanceRow | null>(null);

  // A shift that ran without a register entry, or one still open, is what a
  // supervisor has to act on. Everything else is already reconciled.
  const needsReview = useMemo(() => rows.filter((r) => r.source === "SESSION" || r.running), [rows]);

  const totals = useMemo(() => {
    const recordedHours = rows.reduce((s, r) => s + (r.workingHours ?? 0), 0);
    return {
      unmarked: rows.filter((r) => r.status === "NOT_MARKED").length,
      running: rows.filter((r) => r.running).length,
      marked: rows.filter((r) => r.source === "REGISTER").length,
      recordedHours,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const base = activeTab === "REVIEW" ? needsReview : rows;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) =>
      [r.driverName, r.driverEmpCode, r.vehicleCode, r.projectName].some((f) => (f ?? "").toLowerCase().includes(q))
    );
  }, [rows, needsReview, activeTab, search]);

  /** Exports the queue as shown — every field read from the database. */
  const handleExportCSV = () => {
    const headers = [
      "Date",
      "Driver Name",
      "Emp Code",
      "Vehicle",
      "Project",
      "Shift",
      "Check In",
      "Check Out",
      "Working Hrs",
      "Status",
      "Tracking Source",
      "Check-in Method",
      "Check-in Lat",
      "Check-in Lng",
      "Marked By",
    ];
    const rowsOut = filtered.map((r) => [
      r.date,
      `"${r.driverName}"`,
      `"${dash(r.driverEmpCode)}"`,
      `"${dash(r.vehicleCode)}"`,
      `"${dash(r.projectName)}"`,
      dash(r.shift),
      dash(r.checkIn),
      r.checkOut ?? (r.running ? "IN PROGRESS" : "—"),
      r.workingHours === null ? "" : r.workingHours.toFixed(1),
      r.status,
      dash(r.trackingSource),
      dash(r.scanMethod),
      r.lat === null ? "" : r.lat.toFixed(6),
      r.lng === null ? "" : r.lng.toFixed(6),
      `"${dash(r.markedBy)}"`,
    ]);

    const csv = [headers.join(","), ...rowsOut.map((e) => e.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI("data:text/csv;charset=utf-8," + csv));
    link.setAttribute("download", `supervisor_attendance_review_${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /** A driver's own recorded days, straight out of the rows already loaded. */
  const historyRows = useMemo(
    () => (viewHistoryRecord ? rows.filter((r) => r.driverId === viewHistoryRecord.driverId) : []),
    [rows, viewHistoryRecord]
  );

  return (
    <div className="space-y-6">
      {/* Top Metrics Banner */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Shifts Not In Register"
          value={totals.unmarked.toString()}
          sub={`Ran in last ${windowDays} days`}
          icon={<ClipboardX className="h-5 w-5 text-amber-600" />}
          accent="amber"
        />
        <StatCard
          label="Running Shifts"
          value={totals.running.toString()}
          sub="Checked in, not out"
          icon={<Clock className="h-5 w-5 text-brand-600" />}
          accent="brand"
        />
        <StatCard
          label="Register Entries"
          value={totals.marked.toString()}
          sub="Marked attendance"
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          accent="emerald"
        />
        <StatCard
          label="Recorded Hours"
          value={`${totals.recordedHours.toFixed(1)} hrs`}
          sub="Completed shifts only"
          icon={<Clock className="h-5 w-5 text-violet-600" />}
          accent="violet"
        />
      </div>

      {/* Approval decisions have nowhere to be stored, so the screen says so
          rather than offering buttons that quietly discard the decision. */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-xs text-amber-900">
          <span className="font-bold">Review only.</span> The schema records no attendance approval state, so a decision made
          here cannot be persisted or audited. Close a gap by marking the day in the attendance register (Master → People);
          the row then moves out of this queue.
        </p>
      </div>

      {/* Tabs & Search */}
      <Card className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("REVIEW")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                activeTab === "REVIEW" ? "bg-brand-500 text-white shadow-md shadow-brand-500/20" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Needs Review ({needsReview.length})
            </button>
            <button
              onClick={() => setActiveTab("ALL")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                activeTab === "ALL" ? "bg-brand-500 text-white shadow-md shadow-brand-500/20" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              All Records ({rows.length})
            </button>
            <button
              onClick={() => setActiveTab("ANALYTICS")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                activeTab === "ANALYTICS" ? "bg-brand-500 text-white shadow-md shadow-brand-500/20" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Attendance Analytics
            </button>
          </div>

          {activeTab !== "ANALYTICS" && (
            <div className="flex items-center gap-3">
              <div className="relative min-w-55">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search driver, vehicle..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <button
                onClick={handleExportCSV}
                disabled={filtered.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download className="h-4 w-4" /> Export
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* Main Review Table */}
      {activeTab !== "ANALYTICS" ? (
        rows.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <FileQuestion className="h-10 w-10 text-slate-300" />
            <p className="text-sm font-semibold text-slate-700">Nothing to review</p>
            <p className="max-w-md text-xs text-slate-500">
              No attendance was marked and no trip sessions were opened in the last {windowDays} days.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3.5 font-semibold">Driver Details</th>
                    <th className="px-5 py-3.5 font-semibold">Vehicle & Project</th>
                    <th className="px-5 py-3.5 font-semibold">Shift & Hours</th>
                    <th className="px-5 py-3.5 font-semibold">Recorded Evidence</th>
                    <th className="px-5 py-3.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                        {activeTab === "REVIEW"
                          ? "Every shift in the window is marked in the register and closed."
                          : "No records match your search."}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((item) => (
                      <tr key={item.id} className="transition-colors hover:bg-slate-50/80">
                        <td className="px-5 py-4">
                          <div className="font-bold text-ink-900">{item.driverName}</div>
                          <div className="text-xs text-slate-400">{dash(item.driverEmpCode)}</div>
                          <button
                            onClick={() => setViewHistoryRecord(item)}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline"
                          >
                            <History className="h-3 w-3" /> Driver History
                          </button>
                        </td>
                        <td className="px-5 py-4">
                          <div className="font-semibold text-slate-800">{dash(item.vehicleCode)}</div>
                          <div className="max-w-45 truncate text-xs text-slate-500">{dash(item.projectName)}</div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="font-bold text-ink-900">
                            <HoursCell row={item} />
                          </div>
                          <div className="mt-0.5 text-xs text-slate-400">
                            {item.date} · {dash(item.shift)}
                          </div>
                          <div className="text-xs text-slate-400">
                            {dash(item.checkIn)} → {item.checkOut ?? (item.running ? "in progress" : "—")}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          {/* Only what the session row actually holds. No pass/fail
                              verdict is rendered because none is computed anywhere. */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                              Tracking: {dash(item.trackingSource)}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                              Check-in: {dash(item.scanMethod)}
                            </span>
                            {item.lat !== null && item.lng !== null && (
                              <button
                                onClick={() => setViewGpsRecord(item)}
                                className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100"
                              >
                                <MapPin className="h-3 w-3" /> Position
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={item.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : (
        /* Analytics View — aggregated from the same rows on the server */
        <div className="space-y-6 animate-fade-up">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <SectionTitle title="Weekly Attendance Trend" subtitle="Marked register entries per day, last 7 days" />
              {trend.some((d) => d.Present + d.Absent + d.Leave > 0) ? (
                <LineChart
                  data={trend}
                  lines={[
                    { key: "Present", color: "#10b981", name: "Present" },
                    { key: "Absent", color: "#f43f5e", name: "Absent" },
                    { key: "Leave", color: "#8b5cf6", name: "Leave" },
                  ]}
                />
              ) : (
                <p className="py-16 text-center text-xs text-slate-400">No attendance marked in the last 7 days.</p>
              )}
            </Card>

            <Card className="p-5">
              <SectionTitle title="Attendance Distribution" subtitle={`Status breakdown for ${today}`} />
              {breakdown.length > 0 ? (
                <DonutChart data={breakdown} />
              ) : (
                <p className="py-16 text-center text-xs text-slate-400">Nothing recorded for today.</p>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Check-in Position Modal — the coordinates the session stored, and
          nothing inferred from them. Sessions carry no site reference, so no
          geofence verdict can honestly be shown here. */}
      {viewGpsRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-ink-900">Check-in Position</h3>
              <button onClick={() => setViewGpsRecord(null)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl bg-slate-100 p-4 text-center">
                <MapPin className="mx-auto mb-2 h-10 w-10 text-brand-600" />
                <p className="font-bold text-slate-900">{viewGpsRecord.driverName}</p>
                <p className="text-xs text-slate-500">
                  {viewGpsRecord.lat?.toFixed(5)}, {viewGpsRecord.lng?.toFixed(5)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {viewGpsRecord.date} · {dash(viewGpsRecord.checkIn)}
                </p>
              </div>
              <p className="rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-500">
                Position as reported by <span className="font-semibold">{dash(viewGpsRecord.trackingSource)}</span> at check-in.
                No site geofence is recorded against a trip session, so this is not a pass/fail check.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Driver History Modal — this driver's own rows in the loaded window */}
      {viewHistoryRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-ink-900">{viewHistoryRecord.driverName} — Recorded Days</h3>
              <button onClick={() => setViewHistoryRecord(null)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
              {historyRows.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">No records in the last {windowDays} days.</p>
              ) : (
                historyRows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 border-b py-2.5 text-xs">
                    <span className="text-slate-600">{r.date}</span>
                    <span className="font-semibold text-slate-800">
                      <HoursCell row={r} />
                    </span>
                    <StatusBadge status={r.status} />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
