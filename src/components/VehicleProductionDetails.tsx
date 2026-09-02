"use client";

import React, { useState, useMemo } from "react";
import { Card, StatCard, Badge, SectionTitle } from "@/components/ui";
import { LineChart, BarChart } from "@/components/charts";
import {
  Truck,
  Wrench,
  Fuel,
  Clock,
  Zap,
  Activity,
  Layers,
  ArrowLeft,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { ASSET_CLASS_LABEL, fmtDate, num } from "@/lib/utils";

export interface VehicleProdAsset {
  id: string;
  code: string;
  name: string;
  registrationNo: string | null;
  assetClass: string;
  category: string;
  fuelCapacity: number;
  meterValue: number;
  hourMeterValue: number;
  status: string;
  project?: { code: string; name: string } | null;
  driver?: { name: string } | null;
}

export interface VehicleProdLog {
  id: string;
  date: string;
  shift: string;
  trips: number;
  tonnage: number;
  volumeM3: number;
  cycles: number;
  workedHours: number;
  idleHours: number;
  distanceKm: number;
  leadKm: number;
  material: string | null;
  source: string;
  note?: string | null;
}

export interface VehicleProdFuel {
  id: string;
  date: string;
  quantity: number;
  amount: number;
  rate: number;
}

export interface VehicleProdNorm {
  targetLow: number;
  targetHigh: number;
  unit: string;
}

export function VehicleProductionDetails({
  asset,
  logs = [],
  fuelTxns = [],
  norm = null,
}: {
  asset: VehicleProdAsset;
  logs?: VehicleProdLog[];
  fuelTxns?: VehicleProdFuel[];
  norm?: VehicleProdNorm | null;
}) {
  const [timeRange, setTimeRange] = useState<"7D" | "30D" | "90D">("30D");

  // Filter logs & fuel by selected time range
  const { filteredLogs, filteredFuel } = useMemo(() => {
    const days = timeRange === "7D" ? 7 : timeRange === "30D" ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const fLogs = logs.filter((l) => l.date >= cutoffStr);
    const fFuel = fuelTxns.filter((f) => f.date >= cutoffStr);
    return { filteredLogs: fLogs, filteredFuel: fFuel };
  }, [logs, fuelTxns, timeRange]);

  // Aggregated KPI values
  const totalTrips = filteredLogs.reduce((s, l) => s + l.trips, 0);
  const totalTonnage = filteredLogs.reduce((s, l) => s + l.tonnage, 0);
  const totalVolumeM3 = filteredLogs.reduce((s, l) => s + l.volumeM3, 0);
  const totalCycles = filteredLogs.reduce((s, l) => s + l.cycles, 0);
  const totalWorkedHrs = filteredLogs.reduce((s, l) => s + l.workedHours, 0);
  const totalIdleHrs = filteredLogs.reduce((s, l) => s + l.idleHours, 0);
  const totalDistanceKm = filteredLogs.reduce((s, l) => s + l.distanceKm, 0);
  const totalFuelL = filteredFuel.reduce((s, f) => s + f.quantity, 0);

  const avgKmPerL = totalFuelL > 0 && totalDistanceKm > 0 ? (totalDistanceKm / totalFuelL).toFixed(1) : "—";
  const burnRateLph = totalWorkedHrs > 0 && totalFuelL > 0 ? (totalFuelL / totalWorkedHrs).toFixed(1) : "—";
  const idlePct = totalWorkedHrs + totalIdleHrs > 0 ? Math.round((totalIdleHrs / (totalWorkedHrs + totalIdleHrs)) * 100) : 0;

  // Determine machine category type
  const isTruckCategory = ["TIPPER", "DUMPER", "TRUCK", "TRANSIT_MIXER"].includes(asset.assetClass);
  const isExcavatorCategory = ["EXCAVATOR", "BACKHOE"].includes(asset.assetClass);
  const isCrusherCategory = ["CRUSHER", "PLANT"].includes(asset.assetClass);
  const isRollerCategory = ["ROLLER", "GRADER", "CRANE", "WATER_TANKER"].includes(asset.assetClass);

  // Daily Trend Chart Data (Last 7 distinct days in range)
  const chartData = useMemo(() => {
    const dailyMap = new Map<string, { output: number; workedHrs: number; fuel: number }>();

    for (const l of filteredLogs) {
      const dayKey = l.date.slice(5); // MM-DD
      const existing = dailyMap.get(dayKey) ?? { output: 0, workedHrs: 0, fuel: 0 };
      const outputVal = isTruckCategory ? l.trips : isExcavatorCategory ? l.volumeM3 || l.cycles : isCrusherCategory ? l.tonnage : l.workedHours;
      existing.output += outputVal;
      existing.workedHrs += l.workedHours;
      dailyMap.set(dayKey, existing);
    }

    for (const f of filteredFuel) {
      const dayKey = f.date.slice(5);
      const existing = dailyMap.get(dayKey) ?? { output: 0, workedHrs: 0, fuel: 0 };
      existing.fuel += f.quantity;
      dailyMap.set(dayKey, existing);
    }

    const targetNorm = norm?.targetHigh ?? (isTruckCategory ? 15 : isExcavatorCategory ? 300 : isCrusherCategory ? 400 : 8);

    const sortedDays = Array.from(dailyMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
    if (sortedDays.length === 0) {
      return [
        { label: "Day 1", Output: 0, Target: targetNorm, Hours: 0, Fuel: 0 },
        { label: "Day 2", Output: 0, Target: targetNorm, Hours: 0, Fuel: 0 },
        { label: "Day 3", Output: 0, Target: targetNorm, Hours: 0, Fuel: 0 },
      ];
    }

    return sortedDays.map(([label, d]) => ({
      label,
      Output: Math.round(d.output * 10) / 10,
      Target: targetNorm,
      Hours: Math.round(d.workedHrs * 10) / 10,
      Fuel: Math.round(d.fuel),
    }));
  }, [filteredLogs, filteredFuel, isTruckCategory, isExcavatorCategory, isCrusherCategory, norm]);

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/sites/work"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Production Overview
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">{asset.name}</h1>
            <Badge color="bg-brand-100 text-brand-700 ring-brand-600/20">{asset.code}</Badge>
            <Badge color="bg-slate-100 text-slate-700 ring-slate-200">{asset.status}</Badge>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Registration: {asset.registrationNo ?? "—"} · Class: {ASSET_CLASS_LABEL[asset.assetClass] ?? asset.assetClass}
            {asset.project ? ` · Project: ${asset.project.code} — ${asset.project.name}` : ""}
            {asset.driver ? ` · Assigned Operator: ${asset.driver.name}` : ""}
          </p>
        </div>

        {/* Time Range Filter */}
        <div className="flex items-center gap-1.5 rounded-xl bg-slate-100 p-1 border border-slate-200">
          {(["7D", "30D", "90D"] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                timeRange === range ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {range === "7D" ? "Last 7 Days" : range === "30D" ? "Last 30 Days" : "90 Days"}
            </button>
          ))}
        </div>
      </div>

      {/* Dynamic KPI Grid */}
      {isTruckCategory && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard
            label="Total Trips"
            value={`${num(totalTrips)} Trips`}
            sub={`${filteredLogs.length} shifts logged`}
            icon={<Truck className="h-5 w-5 text-brand-600" />}
            accent="brand"
          />
          <StatCard
            label="Distance Covered"
            value={`${num(totalDistanceKm)} km`}
            sub="Haulage distance"
            icon={<Activity className="h-5 w-5 text-emerald-600" />}
            accent="emerald"
          />
          <StatCard
            label="Material Hauled"
            value={`${num(totalTonnage)} Tonnes`}
            sub="Weighbridge tonnage"
            icon={<Layers className="h-5 w-5 text-violet-600" />}
            accent="violet"
          />
          <StatCard
            label="Worked Hours"
            value={`${num(totalWorkedHrs)} hrs`}
            sub={`${idlePct}% idle time`}
            icon={<Clock className="h-5 w-5 text-amber-600" />}
            accent={idlePct > 30 ? "amber" : "emerald"}
          />
          <StatCard
            label="Diesel Consumed"
            value={`${num(totalFuelL)} Litres`}
            sub={`${avgKmPerL} km/L economy`}
            icon={<Fuel className="h-5 w-5 text-rose-600" />}
            accent="rose"
          />
        </div>
      )}

      {isExcavatorCategory && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Digging / Worked"
            value={`${num(totalWorkedHrs)} hrs`}
            sub={`${filteredLogs.length} shifts logged`}
            icon={<Wrench className="h-5 w-5 text-brand-600" />}
            accent="brand"
          />
          <StatCard
            label="Excavation Volume"
            value={`${num(totalVolumeM3)} m³`}
            sub={`${num(totalCycles)} bucket cycles`}
            icon={<Layers className="h-5 w-5 text-emerald-600" />}
            accent="emerald"
          />
          <StatCard
            label="Idle Hours"
            value={`${num(totalIdleHrs)} hrs`}
            sub={`${idlePct}% idle ratio`}
            icon={<Clock className="h-5 w-5 text-amber-600" />}
            accent={idlePct > 30 ? "rose" : "amber"}
          />
          <StatCard
            label="Diesel Consumed"
            value={`${num(totalFuelL)} Litres`}
            sub={`${burnRateLph} L / hr burn`}
            icon={<Fuel className="h-5 w-5 text-rose-600" />}
            accent="rose"
          />
        </div>
      )}

      {isCrusherCategory && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Crushed Output"
            value={`${num(totalTonnage)} Tonnes`}
            sub="Aggregates produced"
            icon={<Layers className="h-5 w-5 text-emerald-600" />}
            accent="emerald"
          />
          <StatCard
            label="Running Hours"
            value={`${num(totalWorkedHrs)} hrs`}
            sub="Plant running time"
            icon={<Clock className="h-5 w-5 text-brand-600" />}
            accent="brand"
          />
          <StatCard
            label="Diesel Consumed"
            value={`${num(totalFuelL)} Litres`}
            sub="Power generator fuel"
            icon={<Fuel className="h-5 w-5 text-rose-600" />}
            accent="rose"
          />
          <StatCard
            label="Productivity Rate"
            value={totalWorkedHrs > 0 ? `${(totalTonnage / totalWorkedHrs).toFixed(1)} t/hr` : "—"}
            sub="Output per plant hour"
            icon={<Zap className="h-5 w-5 text-violet-600" />}
            accent="violet"
          />
        </div>
      )}

      {isRollerCategory && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Compacted Cycles"
            value={`${num(totalCycles)} Cycles`}
            sub={`${num(totalVolumeM3)} m³ area`}
            icon={<Layers className="h-5 w-5 text-brand-600" />}
            accent="brand"
          />
          <StatCard
            label="Working Hours"
            value={`${num(totalWorkedHrs)} hrs`}
            sub="Rolling time"
            icon={<Clock className="h-5 w-5 text-emerald-600" />}
            accent="emerald"
          />
          <StatCard
            label="Idle Hours"
            value={`${num(totalIdleHrs)} hrs`}
            sub={`${idlePct}% idle`}
            icon={<Clock className="h-5 w-5 text-amber-600" />}
            accent="amber"
          />
          <StatCard
            label="Diesel Consumed"
            value={`${num(totalFuelL)} Litres`}
            sub={`${burnRateLph} L / hr burn`}
            icon={<Fuel className="h-5 w-5 text-rose-600" />}
            accent="rose"
          />
        </div>
      )}

      {/* Production & Efficiency Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle
            title="Daily Production Output Trend"
            subtitle={`Output for ${asset.code} over ${timeRange}`}
          />
          <LineChart
            data={chartData}
            lines={[
              { key: "Output", color: "#3366ff", name: "Actual Output" },
              { key: "Target", color: "#94a3b8", name: "Target Norm" },
            ]}
          />
        </Card>

        <Card className="p-5">
          <SectionTitle
            title="Fuel Consumed vs Working Hours"
            subtitle="Efficiency breakdown per day"
          />
          <BarChart
            data={chartData}
            bars={[
              { key: "Hours", color: "#10b981", name: "Working Hours (hrs)" },
              { key: "Fuel", color: "#f43f5e", name: "Fuel Burnt (L)" },
            ]}
          />
        </Card>
      </div>

      {/* Recent Production Shift Logs Table */}
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3 border-b border-slate-100">
          <SectionTitle
            title="Recent Production Shift Records"
            subtitle={`${filteredLogs.length} shift logs in selected time window`}
          />
          <Link
            href="/sites/work"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> Log Shift
          </Link>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No production logs recorded for this machine during the selected period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Date &amp; Shift</th>
                  <th className="px-5 py-3 font-medium">Material</th>
                  <th className="px-5 py-3 text-right font-medium">Trips</th>
                  <th className="px-5 py-3 text-right font-medium">Tonnage</th>
                  <th className="px-5 py-3 text-right font-medium">Volume (m³)</th>
                  <th className="px-5 py-3 text-right font-medium">Worked Hrs</th>
                  <th className="px-5 py-3 text-right font-medium">Idle Hrs</th>
                  <th className="px-5 py-3 text-right font-medium">Distance (km)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/50">
                    <td className="px-5 py-3 font-medium text-slate-800">
                      {fmtDate(new Date(l.date))}
                      <Badge color="ml-2 bg-slate-100 text-slate-600 ring-slate-200">{l.shift}</Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{l.material ?? "—"}</td>
                    <td className="px-5 py-3 text-right font-mono font-medium text-slate-800">{l.trips || "—"}</td>
                    <td className="px-5 py-3 text-right font-mono font-medium text-slate-800">{l.tonnage ? `${num(l.tonnage)} t` : "—"}</td>
                    <td className="px-5 py-3 text-right font-mono font-medium text-slate-800">{l.volumeM3 ? `${num(l.volumeM3)} m³` : "—"}</td>
                    <td className="px-5 py-3 text-right font-mono font-medium text-emerald-600">{l.workedHours ? `${l.workedHours}h` : "—"}</td>
                    <td className="px-5 py-3 text-right font-mono font-medium text-amber-600">{l.idleHours ? `${l.idleHours}h` : "—"}</td>
                    <td className="px-5 py-3 text-right font-mono font-medium text-slate-800">{l.distanceKm ? `${l.distanceKm} km` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
