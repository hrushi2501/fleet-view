import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SupervisorAttendanceApproval } from "@/components/SupervisorAttendanceApproval";
import { loadAttendanceView } from "../data";
import { requirePage } from "@/lib/access";

/**
 * The review queue for shifts nobody marked. Was `/attendance/approvals`.
 *
 * It reads the same loader as the register, which is exactly why the two
 * belong on one screen — as separate routes they could show a supervisor a
 * different set of outstanding shifts depending on which link they clicked.
 */
export async function Approvals() {
  await requirePage("people.view");
  const session = await getSession();
  if (!session) redirect("/login");

  // Same loader as the register tab, so the standalone approvals route and the
  // tabbed one can never disagree about which shifts are outstanding.
  const view = await loadAttendanceView();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-ink-900">Approvals</h2>
        <p className="text-sm text-slate-500">
          Shifts that ran without a register entry, shifts still open, and the check-in evidence recorded against each.
        </p>
      </div>

      <SupervisorAttendanceApproval view={view} />
    </div>
  );
}
