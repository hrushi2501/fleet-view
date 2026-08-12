import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AttendanceClientTabs } from "@/components/AttendanceClientTabs";
import { loadAttendanceView } from "./data";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Driver Attendance | FleetView ERP",
  description: "Management dashboard for daily attendance registers, shift logs & supervisor approvals.",
};

export default async function DriverAttendancePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Role Gate: Drivers cannot access administrator/supervisor attendance management
  if (session.role === "DRIVER") {
    redirect("/driver/checkin");
  }

  // Every row, KPI and chart point is resolved here from Attendance and
  // TripSession. There is no mock fallback: an empty database renders an empty
  // state, because a payroll screen that invents rows when it has none is worse
  // than one that shows nothing.
  const view = await loadAttendanceView();

  return <AttendanceClientTabs view={view} />;
}
