"use client";

import React, { useState, useMemo } from "react";
import { Card, StatCard, Badge } from "@/components/ui";
import { Txt } from "@/components/Txt";
import {
  CheckCircle2,
  XCircle,
  Calendar,
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  Radio,
  ClipboardX,
  FileQuestion,
  MapPin,
} from "lucide-react";

/**
 * One driver-day of attendance, already resolved against the database by
 * `src/app/(app)/attendance/data.ts`.
 *
 * Every optional field is `null` when the database has no value for it, and
 * renders as an em dash. This screen previously filled those gaps with
 * plausible-looking constants — a supervisor called "Rajeev Saxena", a site
 * called "Jaipur Ring Road Expressway Site", an employee code of "DRV-1000" —
 * which made unknown data indistinguishable from recorded data on a screen that
 * feeds payroll. Nothing here is allowed to invent a value.
 */
export type AttendanceRow = {
  id: string;
  /** REGISTER = a marked `Attendance` row. SESSION = a trip session nobody marked. */
  source: "REGISTER" | "SESSION";
  driverId: string;
  driverName: string;
  driverEmpCode: string | null;
  vehicleCode: string | null;
  vehicleName: string | null;
  projectName: string | null;
  shift: string | null;
  /** `YYYY-MM-DD` in the business timezone, via `businessDay()`. */
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  /** `null` when no total exists yet — a running shift, or an unmarked day. */
  workingHours: number | null;
  running: boolean;
  status: string;
  /** Who entered the register row. The schema has no supervisor relation. */
  markedBy: string | null;
  /** GPS | MOBILE | NONE — how the session was tracked, as recorded. */
  trackingSource: string | null;
  /** QR | MANUAL — how the driver bound to the machine, as recorded. */
  scanMethod: string | null;
  lat: number | null;
  lng: number | null;
  note: string | null;
};

export type AttendanceKpis = {
  present: number;
  running: number;
  absent: number;
  leave: number;
  unmarked: number;
};

export type AttendanceView = {
  rows: AttendanceRow[];
  kpis: AttendanceKpis;
  /** Only the statuses present in the data, so no filter promises a field the schema lacks. */
  statusOptions: string[];
  /** Today in the business timezone, `YYYY-MM-DD`. */
  today: string;
  windowDays: number;
  trend: { label: string; Present: number; Absent: number; Leave: number }[];
  breakdown: { name: string; value: number; color?: string }[];
};

/** Anything the database does not hold reads as an em dash, never as a guess. */
export function dash(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const s = String(v).trim();
  return s.length > 0 ? s : "—";
}

const STATUS_BADGE: Record<string, string> = {
  PRESENT: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  HALF_DAY: "bg-amber-100 text-amber-700 ring-amber-600/20",
  ABSENT: "bg-rose-100 text-rose-700 ring-rose-600/20",
  LEAVE: "bg-violet-100 text-violet-700 ring-violet-600/20",
  REST: "bg-slate-100 text-slate-500 ring-slate-400/20",
  NOT_MARKED: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

/** Human label for a status the database stores as a bare string. */
export function statusLabel(status: string): string {
  if (status === "NOT_MARKED") return "Not in register";
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "RUNNING") {
    return (
      <Badge color="bg-brand-100 text-brand-700 ring-brand-600/20">
        <Radio className="h-3 w-3 animate-pulse text-brand-600" /> Shift Running
      </Badge>
    );
  }
  return <Badge color={STATUS_BADGE[status] ?? "bg-slate-100 text-slate-600 ring-slate-500/20"}>{statusLabel(status)}</Badge>;
}

/** A running shift has no total yet; an unmarked day has none at all. */
export function HoursCell({ row }: { row: AttendanceRow }) {
  if (row.workingHours === null) {
    return row.running ? <span className="font-semibold italic text-brand-600">Running</span> : <span className="text-slate-400">—</span>;
  }
  return <>{row.workingHours.toFixed(1)} hrs</>;
}

export function AttendanceDashboard({ view }: { view: AttendanceView }) {
  const { rows, kpis, statusOptions, today, windowDays } = view;

  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const [selectedRecord, setSelectedRecord] = useState<AttendanceRow | null>(null);

  const { filteredRecords, paginatedRecords, totalPages } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      const matchSearch =
        !q ||
        [r.driverName, r.driverEmpCode, r.vehicleCode, r.projectName, r.markedBy]
          .some((f) => (f ?? "").toLowerCase().includes(q));

      const matchDate = !selectedDate || r.date === selectedDate;
      const matchStatus = selectedStatus === "ALL" || r.status === selectedStatus;

      return matchSearch && matchDate && matchStatus;
    });

    const pages = Math.ceil(filtered.length / pageSize) || 1;
    const page = Math.min(currentPage, pages);
    const start = (page - 1) * pageSize;

    return { filteredRecords: filtered, paginatedRecords: filtered.slice(start, start + pageSize), totalPages: pages };
  }, [rows, search, selectedDate, selectedStatus, currentPage]);

  /** Exports exactly the rows on screen — all of them database-derived. */
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
      "Working Hours",
      "Status",
      "Marked By",
      "Source",
    ];
    const rowsOut = filteredRecords.map((r) => [
      r.date,
      `"${r.driverName}"`,
      `"${dash(r.driverEmpCode)}"`,
      `"${dash(r.vehicleCode)}"`,
      `"${dash(r.projectName)}"`,
      dash(r.shift),
      dash(r.checkIn),
      r.checkOut ?? (r.running ? "IN PROGRESS" : "—"),
      // Blank rather than a number when no total has been recorded, so a
      // spreadsheet cannot sum a shift that has not finished.
      r.workingHours === null ? "" : r.workingHours.toFixed(1),
      r.status,
      `"${dash(r.markedBy)}"`,
      r.source === "REGISTER" ? "Attendance register" : "Trip session (unmarked)",
    ]);

    const csv = [headers.join(","), ...rowsOut.map((e) => e.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI("data:text/csv;charset=utf-8," + csv));
    link.setAttribute("download", `driver_attendance_${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Attendance Summary Cards — counts of today's real rows, nothing padded */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Present Today"
          value={kpis.present.toString()}
          sub="Marked present"
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          accent="emerald"
        />
        <StatCard
          label="Running Shifts"
          value={kpis.running.toString()}
          sub="Checked in, not out"
          icon={<Radio className="h-5 w-5 text-brand-600" />}
          accent="brand"
        />
        <StatCard
          label="Not In Register"
          value={kpis.unmarked.toString()}
          sub="Shift ran, never marked"
          icon={<ClipboardX className="h-5 w-5 text-amber-600" />}
          accent="amber"
        />
        <StatCard
          label="Absent"
          value={kpis.absent.toString()}
          sub="Marked absent"
          icon={<XCircle className="h-5 w-5 text-rose-600" />}
          accent="rose"
        />
        <StatCard
          label="On Leave"
          value={kpis.leave.toString()}
          sub="Marked leave"
          icon={<Calendar className="h-5 w-5 text-violet-600" />}
          accent="violet"
        />
      </div>

      {/* Main Filter & Action Bar */}
      <Card className="p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative min-w-60 flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search driver, vehicle, project..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm text-slate-900 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            {/* Date Filter */}
            <div className="relative">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setCurrentPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
              />
            </div>

            {/* Status Filter — options come from the data, not a hardcoded list */}
            <div className="relative">
              <select
                value={selectedStatus}
                onChange={(e) => {
                  setSelectedStatus(e.target.value);
                  setCurrentPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-brand-500 focus:outline-none"
              >
                <option value="ALL">All Statuses</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Export Button */}
          <button
            onClick={handleExportCSV}
            disabled={filteredRecords.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </Card>

      {rows.length === 0 ? (
        /* Nothing is recorded. Say so — the alternative used to be 7 days of
           fabricated rows per driver, which read as a healthy register. */
        <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <FileQuestion className="h-10 w-10 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">No attendance recorded</p>
          <p className="max-w-md text-xs text-slate-500">
            Nothing has been marked in the attendance register and no trip sessions were opened in the last {windowDays} days.
            Mark attendance from Master → People, or have drivers check in from the cabin QR.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3.5 font-semibold"><Txt text="Driver" /></th>
                  <th className="px-5 py-3.5 font-semibold"><Txt text="Date" /></th>
                  <th className="px-5 py-3.5 font-semibold"><Txt text="Vehicle" /></th>
                  <th className="px-5 py-3.5 font-semibold"><Txt text="Project" /></th>
                  <th className="px-5 py-3.5 font-semibold"><Txt text="Shift" /></th>
                  <th className="px-5 py-3.5 font-semibold"><Txt text="Check In" /></th>
                  <th className="px-5 py-3.5 font-semibold"><Txt text="Check Out" /></th>
                  <th className="px-5 py-3.5 font-semibold"><Txt text="Working Hrs" /></th>
                  <th className="px-5 py-3.5 font-semibold"><Txt text="Status" /></th>
                  <th className="px-5 py-3.5 font-semibold"><Txt text="Marked By" /></th>
                  <th className="px-5 py-3.5 text-right font-semibold"><Txt text="Actions" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedRecords.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-5 py-8 text-center text-slate-400">
                      No attendance records match your filter criteria.
                    </td>
                  </tr>
                ) : (
                  paginatedRecords.map((record) => (
                    <tr key={record.id} className="transition-colors hover:bg-slate-50/80">
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-ink-900">{record.driverName}</div>
                        <div className="text-xs text-slate-400">{dash(record.driverEmpCode)}</div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-slate-600">{record.date}</td>
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-slate-800">{dash(record.vehicleCode)}</div>
                        <div className="text-xs text-slate-400">{dash(record.vehicleName)}</div>
                      </td>
                      <td className="max-w-50 px-5 py-3.5">
                        <div className="truncate font-medium text-slate-800">{dash(record.projectName)}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700">
                          {dash(record.shift)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-medium text-slate-700">{dash(record.checkIn)}</td>
                      <td className="px-5 py-3.5 font-medium text-slate-700">
                        {record.checkOut ?? (record.running ? <span className="font-semibold italic text-brand-600">In Progress</span> : "—")}
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-ink-900">
                        <HoursCell row={record} />
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={record.status} />
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-600">{dash(record.markedBy)}</td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => setSelectedRecord(record)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-brand-600"
                        >
                          <Eye className="h-3.5 w-3.5" /> View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/50 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Showing <span className="font-semibold text-slate-900">{filteredRecords.length > 0 ? (Math.min(currentPage, totalPages) - 1) * pageSize + 1 : 0}</span> to{" "}
              <span className="font-semibold text-slate-900">{Math.min(Math.min(currentPage, totalPages) * pageSize, filteredRecords.length)}</span> of{" "}
              <span className="font-semibold text-slate-900">{filteredRecords.length}</span> records
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </button>
              <span className="text-xs font-medium text-slate-600">
                Page {Math.min(currentPage, totalPages)} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Record Details Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl animate-fade-up">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-ink-900">{selectedRecord.driverName}</h3>
                <p className="text-xs text-slate-500">Employee Code: {dash(selectedRecord.driverEmpCode)}</p>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-sm text-slate-700">
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3">
                <div>
                  <span className="text-xs text-slate-400">Assigned Vehicle</span>
                  <p className="font-semibold text-slate-900">{dash(selectedRecord.vehicleCode)}</p>
                  <p className="text-xs text-slate-500">{dash(selectedRecord.vehicleName)}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Shift Status</span>
                  <div className="mt-1">
                    <StatusBadge status={selectedRecord.status} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs text-slate-400">Date</span>
                  <p className="font-medium">{selectedRecord.date}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Project</span>
                  <p className="font-medium">{dash(selectedRecord.projectName)}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Check In Time</span>
                  <p className="font-medium text-emerald-700">{dash(selectedRecord.checkIn)}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Check Out Time</span>
                  <p className="font-medium text-slate-800">
                    {selectedRecord.checkOut ?? (selectedRecord.running ? "In Progress" : "—")}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Working Hours</span>
                  <p className="font-bold text-ink-900">
                    <HoursCell row={selectedRecord} />
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Marked By</span>
                  <p className="font-medium">{dash(selectedRecord.markedBy)}</p>
                </div>
              </div>

              {/* What the trip session actually recorded. The old screen claimed a
                  "7-point safety checklist passed" and a verified selfie here;
                  neither exists anywhere in the schema, so both are gone. */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Recorded Evidence</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400">Tracking source</span>
                    <p className="font-semibold text-slate-800">{dash(selectedRecord.trackingSource)}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Check-in method</span>
                    <p className="font-semibold text-slate-800">{dash(selectedRecord.scanMethod)}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400">Check-in position</span>
                    <p className="inline-flex items-center gap-1 font-semibold text-slate-800">
                      {selectedRecord.lat !== null && selectedRecord.lng !== null ? (
                        <>
                          <MapPin className="h-3 w-3 text-brand-600" />
                          {selectedRecord.lat.toFixed(5)}, {selectedRecord.lng.toFixed(5)}
                        </>
                      ) : (
                        "—"
                      )}
                    </p>
                  </div>
                </div>
                {selectedRecord.note && (
                  <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-600">{selectedRecord.note}</p>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedRecord(null)}
                className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
