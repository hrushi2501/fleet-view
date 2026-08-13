"use client";

import React, { useState } from "react";
import { Card, StatCard, Badge, SectionTitle } from "@/components/ui";
import { LineChart, BarChart } from "@/components/charts";
import {
  Truck,
  Wrench,
  Fuel,
  Clock,
  Zap,
  TrendingUp,
  Activity,
  Layers,
  Flame,
  Gauge,
  ArrowLeft,
  Calendar,
} from "lucide-react";
import Link from "next/link";
import mockData from "@/lib/mock-data.json";

export function VehicleProductionDetails({ vehicleId }: { vehicleId: string }) {
  // Find vehicle in mock data or fallback to first
  const vehicle = mockData.vehicles.find((v) => v.id === vehicleId);
  const [timeRange, setTimeRange] = useState<"7D" | "30D" | "90D">("7D");

  if (!vehicle) {
    return (
      <Card className="p-8 text-center my-8">
        <p className="text-base font-bold text-slate-800">Vehicle Not Found</p>
        <p className="text-xs text-slate-500 mt-1">The requested vehicle ID does not exist in the fleet database.</p>
        <Link href="/sites/work" className="mt-4 inline-block text-xs font-bold text-brand-600 hover:underline">
          ← Return to Production Overview
        </Link>
      </Card>
    );
  }

  // Determine machine category type
  const isTruckCategory = ["TIPPER", "DUMPER", "TRUCK", "TRANSIT_MIXER"].includes(vehicle.assetClass);
  const isExcavatorCategory = ["EXCAVATOR", "BACKHOE"].includes(vehicle.assetClass);
  const isCrusherCategory = ["CRUSHER", "PLANT"].includes(vehicle.assetClass);
  const isRollerCategory = ["ROLLER", "GRADER", "CRANE", "WATER_TANKER"].includes(vehicle.assetClass);

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/production"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Production Overview
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">{vehicle.name}</h1>
            <Badge color="bg-brand-100 text-brand-700 ring-brand-600/20">{vehicle.code}</Badge>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Registration: {vehicle.registrationNo} · Category: {vehicle.category} · Class: {vehicle.assetClass}
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

      {/* Machine Type Specific Dynamic KPI Grid */}
      {isTruckCategory && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard
            label="Total Trips"
            value="142 Trips"
            sub="Avg 20 trips / day"
            icon={<Truck className="h-5 w-5 text-brand-600" />}
            accent="brand"
            trend={{ dir: "up", value: "12%", good: true }}
          />
          <StatCard
            label="Distance Covered"
            value="1,840 km"
            sub="Haulage distance"
            icon={<Activity className="h-5 w-5 text-emerald-600" />}
            accent="emerald"
          />
          <StatCard
            label="Material Hauled"
            value="3,550 Tonnes"
            sub="Aggregate & GSB"
            icon={<Layers className="h-5 w-5 text-violet-600" />}
            accent="violet"
          />
          <StatCard
            label="Avg Cycle Time"
            value="24.5 min"
            sub="Loading to dumping"
            icon={<Clock className="h-5 w-5 text-amber-600" />}
            accent="amber"
          />
          <StatCard
            label="Diesel Consumed"
            value="480 Litres"
            sub="3.8 km / L avg"
            icon={<Fuel className="h-5 w-5 text-rose-600" />}
            accent="rose"
          />
        </div>
      )}

      {isExcavatorCategory && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Digging Hours"
            value="56.5 hrs"
            sub="Active excavation"
            icon={<Wrench className="h-5 w-5 text-brand-600" />}
            accent="brand"
            trend={{ dir: "up", value: "8.5%", good: true }}
          />
          <StatCard
            label="Bucket Cycles"
            value="4,820 Cycles"
            sub="85 cycles / hr"
            icon={<Layers className="h-5 w-5 text-emerald-600" />}
            accent="emerald"
          />
          <StatCard
            label="Idle Hours"
            value="6.2 hrs"
            sub="Engine on idle"
            icon={<Clock className="h-5 w-5 text-amber-600" />}
            accent="amber"
            trend={{ dir: "down", value: "4%", good: true }}
          />
          <StatCard
            label="Fuel Consumed"
            value="720 Litres"
            sub="12.7 L / hr"
            icon={<Fuel className="h-5 w-5 text-rose-600" />}
            accent="rose"
          />
        </div>
      )}

      {isCrusherCategory && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Crushed Output"
            value="18,450 Tonnes"
            sub="Aggregates produced"
            icon={<Layers className="h-5 w-5 text-emerald-600" />}
            accent="emerald"
            trend={{ dir: "up", value: "15%", good: true }}
          />
          <StatCard
            label="Working Hours"
            value="64.0 hrs"
            sub="Plant running time"
            icon={<Clock className="h-5 w-5 text-brand-600" />}
            accent="brand"
          />
          <StatCard
            label="Diesel Consumed"
            value="1,240 Litres"
            sub="Power generator fuel"
            icon={<Fuel className="h-5 w-5 text-rose-600" />}
            accent="rose"
          />
          <StatCard
            label="Plant Efficiency"
            value="94.2%"
            sub="Target output achieved"
            icon={<Zap className="h-5 w-5 text-violet-600" />}
            accent="violet"
          />
        </div>
      )}

      {isRollerCategory && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Compacted Area"
            value="42,500 m²"
            sub="Sub-base & WMM compaction"
            icon={<Layers className="h-5 w-5 text-brand-600" />}
            accent="brand"
            trend={{ dir: "up", value: "10%", good: true }}
          />
          <StatCard
            label="Working Hours"
            value="48.5 hrs"
            sub="Vibration rolling time"
            icon={<Clock className="h-5 w-5 text-emerald-600" />}
            accent="emerald"
          />
          <StatCard
            label="Fuel Consumed"
            value="380 Litres"
            sub="7.8 L / hr"
            icon={<Fuel className="h-5 w-5 text-amber-600" />}
            accent="amber"
          />
          <StatCard
            label="Machine Health"
            value="96%"
            sub="Engine & hydraulic check"
            icon={<Gauge className="h-5 w-5 text-violet-600" />}
            accent="violet"
          />
        </div>
      )}

      {/* Production & Efficiency Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle
            title="Daily Production Output Trend"
            subtitle={`Output for ${vehicle.code} over ${timeRange}`}
          />
          <LineChart
            data={[
              { label: "Mon", Output: 420, Target: 400 },
              { label: "Tue", Output: 450, Target: 400 },
              { label: "Wed", Output: 390, Target: 400 },
              { label: "Thu", Output: 480, Target: 400 },
              { label: "Fri", Output: 460, Target: 400 },
              { label: "Sat", Output: 430, Target: 400 },
              { label: "Sun", Output: 310, Target: 300 },
            ]}
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
            data={[
              { label: "Mon", Hours: 8.5, Fuel: 95 },
              { label: "Tue", Hours: 9.0, Fuel: 102 },
              { label: "Wed", Hours: 7.5, Fuel: 88 },
              { label: "Thu", Hours: 9.5, Fuel: 110 },
              { label: "Fri", Hours: 9.0, Fuel: 104 },
              { label: "Sat", Hours: 8.0, Fuel: 92 },
              { label: "Sun", Hours: 6.0, Fuel: 70 },
            ]}
            bars={[
              { key: "Hours", color: "#10b981", name: "Working Hours (hrs)" },
              { key: "Fuel", color: "#f43f5e", name: "Fuel Burnt (L)" },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
