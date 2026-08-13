import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AttendanceClientTabs } from "@/components/AttendanceClientTabs";
import { loadAttendanceView } from "../data";
import { requirePage } from "@/lib/access";

/**
 * The daily register. Was `/attendance`.
 */
export async function Register() {
  await requirePage("people.view");
  const session = await getSession();
  if (!session) redirect("/login");

  // Every row, KPI and chart point is resolved here from Attendance and
  // TripSession. There is no mock fallback: an empty database renders an empty
  // state, because a payroll screen that invents rows when it has none is worse
  // than one that shows nothing.
  const view = await loadAttendanceView();

  return <AttendanceClientTabs view={view} />;
}
