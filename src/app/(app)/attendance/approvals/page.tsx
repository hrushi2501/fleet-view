import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SupervisorAttendanceApproval } from "@/components/SupervisorAttendanceApproval";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Supervisor Attendance Approvals | FleetView ERP",
  description: "Supervisor verification queue for driver check-ins, GPS proofs, selfies, safety checklists & working hours.",
};

export default async function SupervisorApprovalsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Role Gate: Only supervisors, site managers and administrators can access approval queue
  if (session.role === "DRIVER") {
    redirect("/driver/checkin");
  }

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
          Verify driver check-in selfies, GPS location proofs, safety checklist passes, overtime hours &amp; approve shift logs.
        </p>
      </div>

      <SupervisorAttendanceApproval />
    </div>
  );
}
