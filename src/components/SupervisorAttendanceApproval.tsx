"use client";

import React, { useState, useMemo } from "react";
import { Card, StatCard, Badge, SectionTitle } from "@/components/ui";
import { BarChart, DonutChart, LineChart } from "@/components/charts";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Download,
  Eye,
  Check,
  X,
  MapPin,
  Camera,
  ShieldCheck,
  Calendar,
  User,
  FileText,
  Filter,
} from "lucide-react";
import mockData from "@/lib/mock-data.json";

export type PendingApproval = {
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
  checkOut: string;
  workingHours: number;
  overtimeHours: number;
  date: string;
  selfieUrl: string;
  lat: number;
  lng: number;
  geofencePassed: boolean;
  safetyChecklist: { name: string; status: boolean }[];
  status: "PENDING" | "APPROVED" | "REJECTED";
  supervisorNotes?: string;
};

function generatePendingApprovals(): PendingApproval[] {
  return mockData.drivers.slice(0, 15).map((driver, idx) => {
    const vehicle = mockData.vehicles[idx % mockData.vehicles.length];
    const site = mockData.sites[idx % mockData.sites.length];
    const project = mockData.projects[idx % mockData.projects.length];

    const isOvertime = idx % 2 === 0;
    const workingHours = isOvertime ? 11.5 : 8.5;
    const overtimeHours = isOvertime ? 3.0 : 0;

    return {
      id: `appr-${idx + 1}`,
      driverId: driver.id,
      driverName: driver.name,
      driverEmpCode: driver.empCode,
      vehicleCode: vehicle.code,
      vehicleName: vehicle.name,
      projectName: project.name,
      siteName: site.name,
      shift: idx % 3 === 0 ? "NIGHT" : "DAY",
      checkIn: idx % 3 === 0 ? "07:30 PM" : "07:30 AM",
      checkOut: idx % 3 === 0 ? "07:00 AM" : "05:00 PM",
      workingHours,
      overtimeHours,
      date: new Date().toISOString().slice(0, 10),
      selfieUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=300&fit=crop",
      lat: 26.9124 + (idx * 0.002),
      lng: 75.7873 + (idx * 0.002),
      geofencePassed: idx !== 4, // 1 record failed geofence for testing
      safetyChecklist: [
        { name: "Brakes & Handbrake", status: true },
        { name: "Tyres & Pressure", status: true },
        { name: "Engine Oil & Coolant", status: true },
        { name: "Headlights & Indicators", status: true },
        { name: "Horn & Reverse Alarm", status: true },
        { name: "Seatbelt & Safety Glass", status: true },
        { name: "Reverse Camera", status: idx !== 2 ? true : false },
      ],
      status: idx === 0 ? "PENDING" : idx % 4 === 0 ? "APPROVED" : "PENDING",
    };
  });
}

export function SupervisorAttendanceApproval({ dbSessions }: { dbSessions?: any[] }) {
  const [approvals, setApprovals] = useState<PendingApproval[]>(() => {
    if (dbSessions && dbSessions.length > 0) return dbSessions;
    return generatePendingApprovals();
  });
  const [activeTab, setActiveTab] = useState<"PENDING" | "ALL" | "ANALYTICS">("PENDING");
  const [search, setSearch] = useState("");

  // Modal States
  const [viewGpsRecord, setViewGpsRecord] = useState<PendingApproval | null>(null);
  const [viewSelfieRecord, setViewSelfieRecord] = useState<PendingApproval | null>(null);
  const [viewChecklistRecord, setViewChecklistRecord] = useState<PendingApproval | null>(null);
  const [viewTimelineRecord, setViewTimelineRecord] = useState<PendingApproval | null>(null);
  const [viewHistoryRecord, setViewHistoryRecord] = useState<PendingApproval | null>(null);
  const [actionRecord, setActionRecord] = useState<{ record: PendingApproval; type: "APPROVE" | "REJECT" } | null>(null);
  const [supervisorNote, setSupervisorNote] = useState("");

  // Handle Approve / Reject Submission
  const handleConfirmAction = () => {
    if (!actionRecord) return;
    setApprovals((prev) =>
      prev.map((item) =>
        item.id === actionRecord.record.id
          ? {
              ...item,
              status: actionRecord.type === "APPROVE" ? "APPROVED" : "REJECTED",
              supervisorNotes: supervisorNote,
            }
          : item
      )
    );
    setActionRecord(null);
    setSupervisorNote("");
  };

  // Filtered List
  const filteredApprovals = useMemo(() => {
    return approvals.filter((item) => {
      const matchSearch =
        item.driverName.toLowerCase().includes(search.toLowerCase()) ||
        item.driverEmpCode.toLowerCase().includes(search.toLowerCase()) ||
        item.vehicleCode.toLowerCase().includes(search.toLowerCase());

      if (activeTab === "PENDING") return matchSearch && item.status === "PENDING";
      return matchSearch;
    });
  }, [approvals, activeTab, search]);

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      "Driver Name",
      "Emp Code",
      "Vehicle",
      "Project",
      "Shift",
      "Check In",
      "Check Out",
      "Working Hrs",
      "Overtime Hrs",
      "Geofence",
      "Status",
      "Supervisor Note",
    ];
    const rows = filteredApprovals.map((item) => [
      `"${item.driverName}"`,
      `"${item.driverEmpCode}"`,
      `"${item.vehicleCode}"`,
      `"${item.projectName}"`,
      item.shift,
      item.checkIn,
      item.checkOut,
      item.workingHours,
      item.overtimeHours,
      item.geofencePassed ? "PASSED" : "FAILED",
      item.status,
      `"${item.supervisorNotes || ""}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `supervisor_attendance_approvals_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Top Metrics Banner */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Pending Approvals"
          value={approvals.filter((a) => a.status === "PENDING").length.toString()}
          sub="Requires review"
          icon={<Clock className="h-5 w-5 text-amber-600" />}
          accent="amber"
        />
        <StatCard
          label="Approved Today"
          value={approvals.filter((a) => a.status === "APPROVED").length.toString()}
          sub="Verified records"
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          accent="emerald"
        />
        <StatCard
          label="Total Overtime Hours"
          value={`${approvals.reduce((s, a) => s + a.overtimeHours, 0).toFixed(1)} hrs`}
          sub="Eligible for OT pay"
          icon={<Calendar className="h-5 w-5 text-brand-600" />}
          accent="brand"
        />
        <StatCard
          label="Geofence Pass Rate"
          value="93.3%"
          sub="Site GPS verified"
          icon={<ShieldCheck className="h-5 w-5 text-violet-600" />}
          accent="violet"
        />
      </div>

      {/* Tabs & Search */}
      <Card className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("PENDING")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                activeTab === "PENDING"
                  ? "bg-brand-500 text-white shadow-md shadow-brand-500/20"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Pending Approval ({approvals.filter((a) => a.status === "PENDING").length})
            </button>
            <button
              onClick={() => setActiveTab("ALL")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                activeTab === "ALL"
                  ? "bg-brand-500 text-white shadow-md shadow-brand-500/20"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              All Records ({approvals.length})
            </button>
            <button
              onClick={() => setActiveTab("ANALYTICS")}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                activeTab === "ANALYTICS"
                  ? "bg-brand-500 text-white shadow-md shadow-brand-500/20"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Attendance Analytics 📊
            </button>
          </div>

          {activeTab !== "ANALYTICS" && (
            <div className="flex items-center gap-3">
              <div className="relative min-w-[220px]">
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
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
              >
                <Download className="h-4 w-4" /> Export
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* Main Approvals Table View */}
      {activeTab !== "ANALYTICS" ? (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="px-5 py-3.5 font-semibold">Driver Details</th>
                  <th className="px-5 py-3.5 font-semibold">Vehicle & Project</th>
                  <th className="px-5 py-3.5 font-semibold">Shift & Hours</th>
                  <th className="px-5 py-3.5 font-semibold">Verification Proofs</th>
                  <th className="px-5 py-3.5 font-semibold">Status</th>
                  <th className="px-5 py-3.5 font-semibold text-right">Supervisor Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredApprovals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                      No pending attendance records awaiting approval.
                    </td>
                  </tr>
                ) : (
                  filteredApprovals.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-bold text-ink-900">{item.driverName}</div>
                        <div className="text-xs text-slate-400">{item.driverEmpCode}</div>
                        <button
                          onClick={() => setViewHistoryRecord(item)}
                          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline"
                        >
                          <Clock className="h-3 w-3" /> Driver History
                        </button>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-semibold text-slate-800">{item.vehicleCode}</div>
                        <div className="text-xs text-slate-500 truncate max-w-[180px]">{item.projectName}</div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-bold text-ink-900">{item.workingHours} hrs total</div>
                        {item.overtimeHours > 0 && (
                          <Badge color="bg-amber-100 text-amber-800 ring-amber-600/20">
                            +{item.overtimeHours} hrs OT
                          </Badge>
                        )}
                        <div className="text-xs text-slate-400 mt-0.5">
                          {item.checkIn} → {item.checkOut}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          {/* GPS Button */}
                          <button
                            onClick={() => setViewGpsRecord(item)}
                            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold border ${
                              item.geofencePassed
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-rose-50 text-rose-700 border-rose-200"
                            }`}
                          >
                            <MapPin className="h-3 w-3" /> {item.geofencePassed ? "GPS Verified" : "GPS Outside"}
                          </button>
                          {/* Selfie Button */}
                          <button
                            onClick={() => setViewSelfieRecord(item)}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 text-slate-700 px-2 py-1 text-xs font-semibold hover:bg-slate-200 border border-slate-200"
                          >
                            <Camera className="h-3 w-3" /> Selfie
                          </button>
                          {/* Checklist Button */}
                          <button
                            onClick={() => setViewChecklistRecord(item)}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 text-slate-700 px-2 py-1 text-xs font-semibold hover:bg-slate-200 border border-slate-200"
                          >
                            <ShieldCheck className="h-3 w-3" /> Safety
                          </button>
                          {/* Timeline Button */}
                          <button
                            onClick={() => setViewTimelineRecord(item)}
                            className="inline-flex items-center gap-1 rounded-lg bg-brand-50 text-brand-700 px-2 py-1 text-xs font-semibold hover:bg-brand-100 border border-brand-200"
                          >
                            Timeline
                          </button>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        {item.status === "PENDING" && (
                          <Badge color="bg-amber-100 text-amber-700 ring-amber-600/20">Pending Review</Badge>
                        )}
                        {item.status === "APPROVED" && (
                          <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">Approved</Badge>
                        )}
                        {item.status === "REJECTED" && (
                          <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">Rejected</Badge>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {item.status === "PENDING" ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setActionRecord({ record: item, type: "APPROVE" })}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm"
                            >
                              <Check className="h-3.5 w-3.5" /> Approve
                            </button>
                            <button
                              onClick={() => setActionRecord({ record: item, type: "REJECT" })}
                              className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 shadow-sm"
                            >
                              <X className="h-3.5 w-3.5" /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Decision Recorded</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* Analytics View */
        <div className="space-y-6 animate-fade-up">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <SectionTitle title="Weekly Attendance Trend" subtitle="Daily present count vs absent/leave" />
              <LineChart
                data={[
                  { label: "Mon", Present: 45, Absent: 3, Late: 2 },
                  { label: "Tue", Present: 47, Absent: 2, Late: 1 },
                  { label: "Wed", Present: 44, Absent: 4, Late: 2 },
                  { label: "Thu", Present: 48, Absent: 1, Late: 1 },
                  { label: "Fri", Present: 46, Absent: 2, Late: 2 },
                  { label: "Sat", Present: 42, Absent: 5, Late: 3 },
                  { label: "Sun", Present: 38, Absent: 8, Late: 4 },
                ]}
                lines={[
                  { key: "Present", color: "#10b981", name: "Present" },
                  { key: "Absent", color: "#f43f5e", name: "Absent" },
                  { key: "Late", color: "#f59e0b", name: "Late" },
                ]}
              />
            </Card>

            <Card className="p-5">
              <SectionTitle title="Attendance Distribution" subtitle="Status breakdown today" />
              <DonutChart
                data={[
                  { name: "Present", value: 38, color: "#10b981" },
                  { name: "Running Shift", value: 18, color: "#3b82f6" },
                  { name: "Late Arrival", value: 3, color: "#f59e0b" },
                  { name: "Absent", value: 4, color: "#f43f5e" },
                  { name: "On Leave", value: 2, color: "#8b5cf6" },
                ]}
              />
            </Card>
          </div>
        </div>
      )}

      {/* GPS Location Modal */}
      {viewGpsRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between pb-3 border-b">
              <h3 className="font-bold text-ink-900">GPS Location Proof</h3>
              <button onClick={() => setViewGpsRecord(null)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl bg-slate-100 p-4 text-center">
                <MapPin className="mx-auto h-10 w-10 text-brand-600 mb-2" />
                <p className="font-bold text-slate-900">{viewGpsRecord.siteName}</p>
                <p className="text-xs text-slate-500">
                  Lat: {viewGpsRecord.lat.toFixed(4)} | Lng: {viewGpsRecord.lng.toFixed(4)}
                </p>
              </div>
              <div
                className={`p-3 rounded-xl font-semibold text-xs text-center ${
                  viewGpsRecord.geofencePassed
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-rose-100 text-rose-800"
                }`}
              >
                {viewGpsRecord.geofencePassed
                  ? "✓ Verified inside project site geofence"
                  : "⚠ Alert: Check-in outside authorized geofence radius"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Selfie Modal */}
      {viewSelfieRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl text-center animate-fade-up">
            <div className="flex items-center justify-between pb-3 border-b">
              <h3 className="font-bold text-ink-900">Driver Cabin Selfie</h3>
              <button onClick={() => setViewSelfieRecord(null)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4">
              <img
                src={viewSelfieRecord.selfieUrl}
                alt="Selfie"
                className="w-full h-64 object-cover rounded-xl border border-slate-200"
              />
              <p className="mt-2 text-xs font-semibold text-slate-700">{viewSelfieRecord.driverName}</p>
              <p className="text-[11px] text-slate-400">Captured at {viewSelfieRecord.checkIn}</p>
            </div>
          </div>
        </div>
      )}

      {/* View Safety Checklist Modal */}
      {viewChecklistRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between pb-3 border-b">
              <h3 className="font-bold text-ink-900">Safety Checklist Items</h3>
              <button onClick={() => setViewChecklistRecord(null)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {viewChecklistRecord.safetyChecklist.map((item, idx) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between p-2.5 rounded-lg text-xs font-semibold ${
                    item.status ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
                  }`}
                >
                  <span>{item.name}</span>
                  <span>{item.status ? "✓ PASS" : "✕ FAIL"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Attendance Timeline Modal */}
      {viewTimelineRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between pb-3 border-b">
              <h3 className="font-bold text-ink-900">Attendance Audit Timeline</h3>
              <button onClick={() => setViewTimelineRecord(null)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-4 text-xs">
              {[
                { time: viewTimelineRecord.checkIn, title: "QR Scan & Login", desc: "Cabin QR scanned successfully" },
                { time: viewTimelineRecord.checkIn, title: "GPS & Geofence Verification", desc: "Location confirmed inside site" },
                { time: viewTimelineRecord.checkIn, title: "Selfie Capture", desc: "Photo audit captured" },
                { time: viewTimelineRecord.checkIn, title: "Safety Checklist Passed", desc: "All 7 safety items verified" },
                { time: viewTimelineRecord.checkOut, title: "Shift Completed & Checkout", desc: `${viewTimelineRecord.workingHours} hrs logged` },
              ].map((step, idx) => (
                <div key={idx} className="flex gap-3 items-start">
                  <div className="h-6 w-6 rounded-full bg-brand-500 text-white font-bold flex items-center justify-center shrink-0">
                    {idx + 1}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">{step.title}</p>
                    <p className="text-slate-500">{step.desc}</p>
                    <span className="text-[10px] text-slate-400">{step.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Driver History Modal */}
      {viewHistoryRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between pb-3 border-b">
              <h3 className="font-bold text-ink-900">{viewHistoryRecord.driverName} - Attendance History</h3>
              <button onClick={() => setViewHistoryRecord(null)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl">
                <span className="text-xs font-semibold text-slate-600">30-Day Attendance Rate</span>
                <span className="text-sm font-bold text-emerald-600">96.5%</span>
              </div>
              <div className="space-y-2">
                {["2026-08-01", "2026-07-31", "2026-07-30", "2026-07-29"].map((d, i) => (
                  <div key={i} className="flex justify-between items-center text-xs p-2.5 border-b">
                    <span>{d}</span>
                    <Badge color="bg-emerald-100 text-emerald-700">Present (9.5 hrs)</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Approve / Reject Decision Confirmation Modal */}
      {actionRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-fade-up space-y-4">
            <h3 className="text-lg font-bold text-ink-900">
              {actionRecord.type === "APPROVE" ? "Approve Attendance" : "Reject Attendance"}
            </h3>
            <p className="text-xs text-slate-500">
              Record for <span className="font-bold">{actionRecord.record.driverName}</span> ({actionRecord.record.workingHours} hrs)
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Supervisor Notes / Remarks</label>
              <textarea
                rows={3}
                placeholder="Enter approval note or reason for rejection..."
                value={supervisorNote}
                onChange={(e) => setSupervisorNote(e.target.value)}
                className="w-full rounded-xl border border-slate-300 p-3 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setActionRecord(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                className={`px-4 py-2 rounded-xl font-bold text-sm text-white ${
                  actionRecord.type === "APPROVE" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                Confirm {actionRecord.type === "APPROVE" ? "Approval" : "Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
