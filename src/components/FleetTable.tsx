"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Badge, Progress } from "@/components/ui";
import { AssetGlass } from "@/components/AssetGlass";
import { DataTable, type TableFacet } from "@/components/DataTable";
import { ASSET_CLASS_LABEL, STATUS_COLOR, healthColor, num, cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";

export type Row = {
  id: string;
  code: string;
  name: string;
  assetClass: string;
  ownershipType: string;
  status: string;
  healthScore: number;
  utilization: number;
  meterValue: number;
  primaryMeter: string;
  registrationNo: string | null;
  project: string;
  driverName?: string | null;
};

const OWN_COLOR: Record<string, string> = {
  OWNED: "bg-brand-50 text-brand-700 ring-brand-600/20",
  LEASED: "bg-violet-50 text-violet-700 ring-violet-600/20",
  HIRED: "bg-amber-50 text-amber-700 ring-amber-600/20",
  CONTRACTOR: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export function FleetTable({ rows }: { rows: Row[] }) {
  const [selId, setSelId] = useState<string | null>(null);

  // TanStack Query with client-side caching (staleTime: 30s, initialData from SSR)
  const {
    data = rows,
    isFetching,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: queryKeys.fleet.register(),
    queryFn: async (): Promise<Row[]> => {
      const res = await fetch("/api/assets");
      if (!res.ok) return rows;
      const json = await res.json();
      return json.assets ?? rows;
    },
    initialData: rows,
    staleTime: 30 * 1000,
  });

  // Faceted filter options extracted dynamically
  const facets: TableFacet[] = useMemo(() => {
    const classSet = Array.from(new Set(data.map((r) => r.assetClass)));
    const statusSet = Array.from(new Set(data.map((r) => r.status)));

    return [
      {
        id: "assetClass",
        title: "Classes",
        options: classSet.map((c) => ({ label: ASSET_CLASS_LABEL[c] ?? c, value: c })),
      },
      {
        id: "status",
        title: "Status",
        options: statusSet.map((s) => ({ label: s, value: s })),
      },
      {
        id: "ownershipType",
        title: "Ownership",
        options: ["OWNED", "LEASED", "HIRED", "CONTRACTOR"].map((o) => ({ label: o, value: o })),
      },
    ];
  }, [data]);

  // Typed column definitions for TanStack Table
  const columns: ColumnDef<Row>[] = useMemo(
    () => [
      {
        accessorKey: "code",
        header: "Asset",
        enableSorting: true,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelId(r.id);
                }}
                className="font-semibold text-brand-700 hover:underline text-left"
              >
                {r.code}
              </button>
              <p className="text-xs text-slate-400">
                {r.name}
                {r.registrationNo ? ` · ${r.registrationNo}` : ""}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: "assetClass",
        header: "Class",
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-slate-600">
            {ASSET_CLASS_LABEL[row.original.assetClass] ?? row.original.assetClass}
          </span>
        ),
      },
      {
        accessorKey: "ownershipType",
        header: "Ownership",
        enableSorting: true,
        cell: ({ row }) => (
          <Badge color={OWN_COLOR[row.original.ownershipType]}>
            {row.original.ownershipType}
          </Badge>
        ),
      },
      {
        accessorKey: "project",
        header: "Project",
        enableSorting: true,
        cell: ({ row }) => <span className="text-slate-600">{row.original.project}</span>,
      },
      {
        accessorKey: "driverName",
        header: "Driver",
        enableSorting: true,
        cell: ({ row }) => {
          const name = row.original.driverName;
          return name ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
              👤 {name}
            </span>
          ) : (
            <span className="text-xs text-slate-400 font-normal">No Driver Assigned</span>
          );
        },
      },
      {
        accessorKey: "meterValue",
        header: "Meter",
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-slate-600 font-mono text-xs">
            {num(row.original.meterValue)} {row.original.primaryMeter === "SMU" ? "hrs" : "km"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        enableSorting: true,
        cell: ({ row }) => (
          <Badge color={STATUS_COLOR[row.original.status]}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: "utilization",
        header: "Util.",
        enableSorting: true,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Progress value={row.original.utilization} className="w-16" />
            <span className="text-xs text-slate-500 font-mono">{row.original.utilization}%</span>
          </div>
        ),
      },
      {
        accessorKey: "healthScore",
        header: "Health",
        enableSorting: true,
        cell: ({ row }) => (
          <span className={cn("font-bold", healthColor(row.original.healthScore))}>
            {row.original.healthScore}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      {/* Desktop & Tablet: TanStack Query Table */}
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          data={data}
          facets={facets}
          searchPlaceholder="Search code, name, reg. no, project, driver..."
          isFetching={isFetching}
          lastUpdatedAt={dataUpdatedAt}
          onRefresh={() => refetch()}
          onRowClick={(row) => setSelId(row.id)}
          exportFilename="fleet_register"
        />
      </div>

      {/* Mobile Adaptive Cards View (< 768px) */}
      <div className="space-y-3 md:hidden">
        <div className="flex items-center justify-between pb-2 text-xs text-slate-500 border-b border-slate-100">
          <span>{data.length} registered vehicles</span>
          <button
            onClick={() => refetch()}
            className="font-semibold text-brand-600 hover:underline"
          >
            {isFetching ? "Syncing..." : "Refresh"}
          </button>
        </div>

        {data.map((r) => (
          <div
            key={r.id}
            onClick={() => setSelId(r.id)}
            role="button"
            tabIndex={0}
            className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition-all active:scale-[0.99] active:bg-slate-50 cursor-pointer"
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base text-brand-700">{r.code}</span>
                  <Badge color={OWN_COLOR[r.ownershipType]}>{r.ownershipType}</Badge>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {r.name} {r.registrationNo ? `· ${r.registrationNo}` : ""}
                </p>
              </div>
              <Badge color={STATUS_COLOR[r.status]}>{r.status}</Badge>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-400">Class:</span>
                <p className="font-medium text-slate-700 truncate">
                  {ASSET_CLASS_LABEL[r.assetClass] ?? r.assetClass}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Site / Project:</span>
                <p className="font-medium text-slate-700 truncate">{r.project || "Unassigned"}</p>
              </div>
              <div>
                <span className="text-slate-400">Driver:</span>
                <p className="font-medium text-slate-700 truncate">
                  {r.driverName ? `👤 ${r.driverName}` : "No Driver Assigned"}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Meter:</span>
                <p className="font-medium text-slate-700">
                  {num(r.meterValue)} {r.primaryMeter === "SMU" ? "hrs" : "km"}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Health:</span>
                <p className={cn("font-bold text-sm", healthColor(r.healthScore))}>
                  {r.healthScore}/100
                </p>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
              <div className="flex items-center gap-2 flex-1 mr-4">
                <span>Util: {r.utilization}%</span>
                <Progress value={r.utilization} className="flex-1" />
              </div>
              <span className="font-semibold text-brand-600">View details →</span>
            </div>
          </div>
        ))}
      </div>

      {selId && <AssetGlass assetId={selId} onClose={() => setSelId(null)} />}
    </div>
  );
}
