import React from "react";
import { db } from "@/lib/db";
import { ProductionEntryForm } from "@/components/ProductionEntryForm";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePage, projectIdScope } from "@/lib/access";
import { ASSET_CLASS_LABEL } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Production Daily Entry | FleetView ERP",
  description: "Supervisor portal for recording daily site production output, machine hours & fuel usage.",
};

export default async function ProductionEntryPage() {
  const access = await requirePage("production.edit");

  const [assets, projects, drivers] = await Promise.all([
    db.asset.findMany({
      select: { id: true, code: true, name: true, registrationNo: true, assetClass: true },
      orderBy: { code: "asc" },
    }),
    db.project.findMany({
      where: projectIdScope(access),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    db.driver.findMany({
      select: { id: true, empCode: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const assetOpts = assets.map((a) => ({
    id: a.id,
    label: `${a.code} — ${a.registrationNo ?? a.name} (${ASSET_CLASS_LABEL[a.assetClass] ?? a.assetClass})`,
  }));
  const projOpts = projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));
  const driverOpts = drivers.map((d) => ({ id: d.id, label: `${d.empCode} — ${d.name}` }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/sites/work"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Production Overview
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Production &amp; Output Entry</h1>
        <p className="text-sm text-slate-500">
          Record site daily excavation, haulage trips, aggregate output, machine hours and fuel consumption.
        </p>
      </div>

      <ProductionEntryForm assets={assetOpts} projects={projOpts} drivers={driverOpts} />
    </div>
  );
}
