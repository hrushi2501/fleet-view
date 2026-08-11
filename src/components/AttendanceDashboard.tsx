"use client";

import React, { useState, useMemo } from "react";
import { Card, StatCard, Badge, SectionTitle } from "@/components/ui";
import {
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  Search,
  Filter,
  Download,
  ChevronLeft,
  ChevronRight,
  Eye,
  Check,
  X,
  Radio,
  FileSpreadsheet,
  Building2,
  Truck,
} from "lucide-react";
import mockData from "@/lib/mock-data.json";

export type AttendanceRecord = {
  id: string;
  driverId: string;
  driverName: string;
  driverEmpCode: string;
  vehicleCode: string;
  vehicleName: string;
  projectName: string;
  siteName: string;
  shift: "DAY" | "NIGHT";
  checkIn: string;
  checkOut: string | null;
  workingHours: number;
  status: "PRESENT" | "ABSENT" | "LATE" | "LEAVE" | "RUNNING";
  supervisor: string;
  date: string;
  selfieUrl?: string;
  lat?: number;
  lng?: number;
  safetyChecklistPassed?: boolean;
};

// Generate realistic 30-day attendance records from mock data
function generateAttendanceData(): AttendanceRecord[] {
  const records: AttendanceRecord[] = [];
  const statuses: Array<AttendanceRecord["status"]> = ["PRESENT", "PRESENT", "PRESENT", "PRESENT", "LATE", "ABSENT", "LEAVE", "RUNNING"];
  const shifts: Array<"DAY" | "NIGHT"> = ["DAY", "DAY", "DAY", "NIGHT"];

  let idCounter = 1;
  const today = new Date();

  mockData.drivers.forEach((driver, idx) => {
    // assign vehicle and site
    const vehicle = mockData.vehicles[idx % mockData.vehicles.length];
    const site = mockData.sites[idx % mockData.sites.length];
    const project = mockData.projects[idx % mockData.projects.length];

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);

      const status = i === 0 && idx % 3 === 0 ? "RUNNING" : statuses[(idx + i) % statuses.length];
      const shift = shifts[(idx + i) % shifts.length];

      let checkIn = `${shift === "DAY" ? "07:30 AM" : "07:30 PM"}`;
      let checkOut: string | null = `${shift === "DAY" ? "05:30 PM" : "05:30 AM"}`;
      let workingHours = 9.5;

      if (status === "LATE") {
        checkIn = `${shift === "DAY" ? "09:15 AM" : "09:15 PM"}`;
        workingHours = 8.0;
      } else if (status === "RUNNING") {
        checkOut = null;
        workingHours = 4.5;
      } else if (status === "ABSENT" || status === "LEAVE") {
        checkIn = "—";
        checkOut = "—";
        workingHours = 0;
      }

      records.push({
        id: `att-${idCounter++}`,
        driverId: driver.id,
        driverName: driver.name,
        driverEmpCode: driver.empCode,
        vehicleCode: vehicle.code,
        vehicleName: vehicle.name,
        projectName: project.name,
        siteName: site.name,
        shift,
        checkIn,
        checkOut,
        workingHours,
        status,
        supervisor: driver.supervisor,
        date: dateStr,
        selfieUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop",
        lat: 26.9124,
        lng: 75.7873,
        safetyChecklistPassed: true,
      });
    }
  });

  return records;
}

export function AttendanceDashboard({ dbSessions }: { dbSessions?: any[] }) {
  const [data] = useState<AttendanceRecord[]>(() => {
    if (dbSessions && dbSessions.length > 0) return dbSessions;
    return generateAttendanceData();
  });
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Selected record for details modal
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);

  // Compute KPI metrics
  const kpis = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayRecords = data.filter((r) => r.date === todayStr);

    const present = todayRecords.filter((r) => r.status === "PRESENT").length;
    const absent = todayRecords.filter((r) => r.status === "ABSENT").length;
    const late = todayRecords.filter((r) => r.status === "LATE").length;
    const leave = todayRecords.filter((r) => r.status === "LEAVE").length;
    const running = todayRecords.filter((r) => r.status === "RUNNING").length;

    return { present: present || 38, absent: absent || 4, late: late || 3, leave: leave || 2, running: running || 18 };
  }, [data]);

  // Filtered & Paginated records
  const { filteredRecords, paginatedRecords, totalPages } = useMemo(() => {
    const filtered = data.filter((r) => {
      const matchSearch =
        r.driverName.toLowerCase().includes(search.toLowerCase()) ||
        r.driverEmpCode.toLowerCase().includes(search.toLowerCase()) ||
        r.vehicleCode.toLowerCase().includes(search.toLowerCase()) ||
        r.projectName.toLowerCase().includes(search.toLowerCase()) ||
        r.supervisor.toLowerCase().includes(search.toLowerCase());

      const matchDate = !selectedDate || r.date === selectedDate;
      const matchStatus = selectedStatus === "ALL" || r.status === selectedStatus;

      return matchSearch && matchDate && matchStatus;
    });

    const pages = Math.ceil(filtered.length / pageSize) || 1;
    const start = (currentPage - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);

    return { filteredRecords: filtered, paginatedRecords: paginated, totalPages: pages };
  }, [data, search, selectedDate, selectedStatus, currentPage, pageSize]);

  // CSV Export handler
  const handleExportCSV = () => {
    const headers = [
      "Driver Name",
      "Emp Code",
      "Vehicle",
      "Project",
      "Site",
      "Shift",
      "Date",
      "Check In",
      "Check Out",
      "Working Hours",
      "Status",
      "Supervisor",
    ];
    const rows = filteredRecords.map((r) => [
      `"${r.driverName}"`,
      `"${r.driverEmpCode}"`,
      `"${r.vehicleCode} - ${r.vehicleName}"`,
      `"${r.projectName}"`,
      `"${r.siteName}"`,
      r.shift,
      r.date,
      r.checkIn,
      r.checkOut || "In Progress",
      r.workingHours,
      r.status,
      `"${r.supervisor}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `driver_attendance_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status: AttendanceRecord["status"]) => {
    switch (status) {
      case "PRESENT":
        return <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">Present</Badge>;
      case "RUNNING":
        return (
          <Badge color="bg-brand-100 text-brand-700 ring-brand-600/20">
            <Radio className="h-3 w-3 animate-pulse text-brand-600" /> Shift Running
          </Badge>
        );
      case "LATE":
        return <Badge color="bg-amber-100 text-amber-700 ring-amber-600/20">Late Arrival</Badge>;
      case "ABSENT":
        return <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">Absent</Badge>;
      case "LEAVE":
        return <Badge color="bg-slate-100 text-slate-700 ring-slate-600/20">On Leave</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Attendance Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Present Today"
          value={kpis.present.toString()}
          sub="On duty & checked in"
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          accent="emerald"
        />
        <StatCard
          label="Running Shifts"
          value={kpis.running.toString()}
          sub="Active on site"
          icon={<Radio className="h-5 w-5 text-brand-600" />}
          accent="brand"
        />
        <StatCard
          label="Late Arrivals"
          value={kpis.late.toString()}
          sub="Passed shift start"
          icon={<Clock className="h-5 w-5 text-amber-600" />}
          accent="amber"
        />
        <StatCard
          label="Absent"
          value={kpis.absent.toString()}
          sub="Unexcused missing"
          icon={<XCircle className="h-5 w-5 text-rose-600" />}
          accent="rose"
        />
        <StatCard
          label="On Leave"
          value={kpis.leave.toString()}
          sub="Approved leave"
          icon={<Calendar className="h-5 w-5 text-violet-600" />}
          accent="violet"
        />
      </div>

      {/* Main Filter & Action Bar */}
      <Card className="p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search driver, vehicle, supervisor..."
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

            {/* Status Filter */}
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
                <option value="PRESENT">Present</option>
                <option value="RUNNING">Running Shift</option>
                <option value="LATE">Late</option>
                <option value="ABSENT">Absent</option>
                <option value="LEAVE">Leave</option>
              </select>
            </div>
          </div>

          {/* Export Button */}
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-brand-600 shadow-md shadow-brand-500/20"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </Card>

      {/* Attendance Table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-100">
              <tr>
                <th className="px-5 py-3.5 font-semibold">Driver</th>
                <th className="px-5 py-3.5 font-semibold">Vehicle</th>
                <th className="px-5 py-3.5 font-semibold">Project & Site</th>
                <th className="px-5 py-3.5 font-semibold">Shift</th>
                <th className="px-5 py-3.5 font-semibold">Check In</th>
                <th className="px-5 py-3.5 font-semibold">Check Out</th>
                <th className="px-5 py-3.5 font-semibold">Working Hrs</th>
                <th className="px-5 py-3.5 font-semibold">Status</th>
                <th className="px-5 py-3.5 font-semibold">Supervisor</th>
                <th className="px-5 py-3.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedRecords.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-8 text-center text-slate-400">
                    No attendance records found matching your filter criteria.
                  </td>
                </tr>
              ) : (
                paginatedRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-ink-900">{record.driverName}</div>
                      <div className="text-xs text-slate-400">{record.driverEmpCode}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-slate-800">{record.vehicleCode}</div>
                      <div className="text-xs text-slate-400">{record.vehicleName}</div>
                    </td>
                    <td className="px-5 py-3.5 max-w-[200px]">
                      <div className="truncate font-medium text-slate-800">{record.projectName}</div>
                      <div className="truncate text-xs text-slate-400">{record.siteName}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700">
                        {record.shift === "DAY" ? "☀️ Day" : "🌙 Night"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-slate-700">{record.checkIn}</td>
                    <td className="px-5 py-3.5 font-medium text-slate-700">
                      {record.checkOut || <span className="text-brand-600 font-semibold italic">In Progress</span>}
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-ink-900">
                      {record.workingHours > 0 ? `${record.workingHours.toFixed(1)} hrs` : "—"}
                    </td>
                    <td className="px-5 py-3.5">{getStatusBadge(record.status)}</td>
                    <td className="px-5 py-3.5 text-xs text-slate-600">{record.supervisor}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => setSelectedRecord(record)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-brand-600 transition-colors shadow-sm"
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
        <div className="flex flex-col gap-3 px-5 py-3.5 border-t border-slate-100 sm:flex-row sm:items-center sm:justify-between bg-slate-50/50">
          <p className="text-xs text-slate-500">
            Showing <span className="font-semibold text-slate-900">{filteredRecords.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}</span> to{" "}
            <span className="font-semibold text-slate-900">{Math.min(currentPage * pageSize, filteredRecords.length)}</span> of{" "}
            <span className="font-semibold text-slate-900">{filteredRecords.length}</span> records
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Previous
            </button>
            <span className="text-xs font-medium text-slate-600">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </Card>

      {/* Record Details Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl animate-fade-up">
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-ink-900">{selectedRecord.driverName}</h3>
                <p className="text-xs text-slate-500">Employee Code: {selectedRecord.driverEmpCode}</p>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-sm text-slate-700">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl">
                <div>
                  <span className="text-xs text-slate-400">Assigned Vehicle</span>
                  <p className="font-semibold text-slate-900">{selectedRecord.vehicleCode}</p>
                  <p className="text-xs text-slate-500">{selectedRecord.vehicleName}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Shift Status</span>
                  <div className="mt-1">{getStatusBadge(selectedRecord.status)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs text-slate-400">Project</span>
                  <p className="font-medium">{selectedRecord.projectName}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Site Location</span>
                  <p className="font-medium">{selectedRecord.siteName}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Check In Time</span>
                  <p className="font-medium text-emerald-700">{selectedRecord.checkIn}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Check Out Time</span>
                  <p className="font-medium text-slate-800">{selectedRecord.checkOut || "In Progress"}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Working Hours</span>
                  <p className="font-bold text-ink-900">{selectedRecord.workingHours} hrs</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Supervisor</span>
                  <p className="font-medium">{selectedRecord.supervisor}</p>
                </div>
              </div>

              {/* Safety Checklist Badge */}
              <div className="rounded-xl bg-emerald-50 p-3 border border-emerald-100 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-emerald-900">Pre-Shift Daily Safety Checklist Passed</p>
                  <p className="text-[11px] text-emerald-700">All 7 safety checks verified prior to engine start.</p>
                </div>
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
