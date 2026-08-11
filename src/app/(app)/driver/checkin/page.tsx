import React from "react";
import { DriverCheckInWizard } from "@/components/DriverCheckInWizard";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Driver Duty Check-In | FleetView ERP",
  description: "Driver touch-friendly duty check-in workflow with QR scan, GPS verification, selfie capture & safety checklist.",
};

export default function DriverCheckInPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/attendance"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Attendance Register
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Driver Duty Check-In Portal</h1>
        <p className="text-sm text-slate-500">
          Touch-friendly mobile/tablet workflow for drivers and operators to start shift duty safely.
        </p>
      </div>

      <DriverCheckInWizard />
    </div>
  );
}
