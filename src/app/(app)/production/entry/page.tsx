import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProductionEntryForm } from "@/components/ProductionEntryForm";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Production Daily Entry | FleetView ERP",
  description: "Supervisor portal for recording daily site production output, machine hours & fuel usage.",
};

export default async function ProductionEntryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Role Gate: Drivers cannot log daily site production
  if (session.role === "DRIVER") {
    redirect("/driver/checkin");
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/production"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Production Overview
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Production &amp; Output Entry</h1>
        <p className="text-sm text-slate-500">
          Record site daily excavation, haulage trips, aggregate output, machine hours and fuel consumption.
        </p>
      </div>

      <ProductionEntryForm />
    </div>
  );
}
