import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SupervisorAttendanceApproval } from "@/components/SupervisorAttendanceApproval";
import { loadAttendanceView } from "../data";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Supervisor Attendance Approvals | FleetView ERP",
  description: "Supervisor review queue for unmarked and open driver shifts, with the check-in evidence on record.",
};

export default async function SupervisorApprovalsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Role Gate: Only supervisors, site managers and administrators can access approval queue
  if (session.role === "DRIVER") {
    redirect("/driver/checkin");
  }

  // Same loader as the register tab, so the standalone approvals route and the
  // tabbed one can never disagree about which shifts are outstanding.
  const view = await loadAttendanceView();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/attendance"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Attendance Register
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Supervisor Attendance Approvals</h1>
        <p className="text-sm text-slate-500">
          Shifts that ran without a register entry, shifts still open, and the check-in evidence recorded against each.
        </p>
      </div>

      <SupervisorAttendanceApproval view={view} />
    </div>
  );
}
