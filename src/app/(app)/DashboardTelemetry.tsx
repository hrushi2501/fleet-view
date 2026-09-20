import { fleetUsage } from "@/lib/fleet-usage";
import { StatCard, SectionTitle } from "@/components/ui";
import { inr, num } from "@/lib/utils";
import { Fuel, TriangleAlert, Activity, Gauge } from "lucide-react";
import type { Prisma } from "@prisma/client";

/**
 * The telemetry roll-up reads the largest table in the product and performs
 * conservation-of-mass analysis in memory. Keep it behind Suspense so the
 * dashboard's operational sections can stream immediately.
 */
export default async function DashboardTelemetry({ assetWhere }: { assetWhere: Prisma.AssetWhereInput }) {
  const liveWindowDays = 1;
  const telemetry = await fleetUsage(liveWindowDays, assetWhere);
  if (telemetry.totals.vehiclesReporting === 0) return null;

  return (
    <section className="space-y-4">
      <SectionTitle
        title="Tata Fleet Edge — Last 24 Hours"
        subtitle={`${telemetry.totals.activeVehicles} active road vehicle${telemetry.totals.activeVehicles === 1 ? "" : "s"} with credible mileage · ${telemetry.totals.vehiclesReporting} Tata asset${telemetry.totals.vehiclesReporting === 1 ? "" : "s"} reported`}
      />
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-4">
        <StatCard label="Distance covered" value={`${num(telemetry.totals.distanceKm)} km`} sub="Odometer delta" accent="brand" icon={<Activity className="h-5 w-5" />} />
        <StatCard
          label="Diesel burned"
          value={telemetry.totals.avgKmPerL != null ? `${num(telemetry.totals.litresBurned)} L` : "—"}
          sub={telemetry.totals.avgKmPerL != null ? `${num(telemetry.totals.litresFilled)} L filled` : "Not measurable from this telemetry"}
          accent="amber"
          icon={<Fuel className="h-5 w-5" />}
        />
        <StatCard
          label="Fleet efficiency"
          value={telemetry.totals.avgKmPerL != null ? `${telemetry.totals.avgKmPerL} km/L` : "—"}
          sub={telemetry.totals.avgKmPerL != null ? `${num(telemetry.totals.distanceKm)} km ÷ ${num(telemetry.totals.litresBurned)} L · ${telemetry.totals.confidence.toLowerCase()} confidence` : "No active Tata road vehicle has usable mileage"}
          accent={telemetry.perAsset.some((a) => a.belowNorm) ? "rose" : "emerald"}
          icon={<Gauge className="h-5 w-5" />}
        />
        <StatCard
          label="Unaccounted diesel"
          value={`${num(telemetry.totals.litresUnaccounted)} L`}
          sub={telemetry.totals.litresUnaccounted > 0 ? telemetry.totals.valueUnaccounted == null ? "Fuel type or rate not configured" : `${inr(telemetry.totals.valueUnaccounted, { compact: true })} at risk` : "Nothing unexplained"}
          accent={telemetry.totals.litresUnaccounted > 0 ? "rose" : "emerald"}
          icon={<TriangleAlert className="h-5 w-5" />}
        />
      </div>
      {(telemetry.totals.vehiclesWithInsufficientData > 0 || telemetry.totals.vehiclesNotWorking > 0 || telemetry.totals.worstGapHours > 1) && (
        <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
          {telemetry.totals.vehiclesWithInsufficientData > 0 && (
            <p className="text-[11px] leading-relaxed text-slate-500">Insufficient telemetry data for reliable fuel analysis on {telemetry.totals.vehiclesWithInsufficientData} of {telemetry.totals.vehiclesReporting} reporting vehicle{telemetry.totals.vehiclesReporting === 1 ? "" : "s"} — those vehicles are excluded from the efficiency figure rather than averaged into it.</p>
          )}
          {telemetry.totals.vehiclesNotWorking > 0 && (
            <p className="text-[11px] leading-relaxed text-slate-500">{telemetry.totals.vehiclesNotWorking} Tata road vehicle{telemetry.totals.vehiclesNotWorking === 1 ? " was" : "s were"} parked or did not travel beyond the working threshold in this window, so {telemetry.totals.vehiclesNotWorking === 1 ? "it is" : "they are"} not included in fleet km/L.</p>
          )}
          {telemetry.totals.worstGapHours > 1 && (
            <p className="text-[11px] leading-relaxed text-slate-500">Longest gap between samples in this window: {telemetry.totals.worstGapHours} h. Sparse sampling cannot separate a siphon from a hard shift — treat unaccounted diesel as a prompt to look, not a finding.</p>
          )}
        </div>
      )}
    </section>
  );
}
