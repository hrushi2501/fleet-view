"use client";

import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  RefreshCw,
  Clock,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface FacetOption {
  label: string;
  value: string;
}

export interface TableFacet {
  id: string;
  title: string;
  options: FacetOption[];
}

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Optional faceted dropdown filters */
  facets?: TableFacet[];
  /** Search placeholder text */
  searchPlaceholder?: string;
  /** TanStack query state indicators */
  isLoading?: boolean;
  isFetching?: boolean;
  lastUpdatedAt?: Date | number;
  onRefresh?: () => void;
  /** Row click handler */
  onRowClick?: (row: TData) => void;
  /** Export filename (omit extension). If provided, enables Export CSV button */
  exportFilename?: string;
  /** Custom action buttons rendered beside the search bar */
  extraActions?: React.ReactNode;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  facets,
  searchPlaceholder = "Search records...",
  isLoading = false,
  isFetching = false,
  lastUpdatedAt,
  onRefresh,
  onRowClick,
  exportFilename,
  extraActions,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [pageSize, setPageSize] = useState(25);

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      columnVisibility,
      pagination: {
        pageIndex: 0,
        pageSize,
      },
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // Export current filtered rows to CSV
  const handleExportCSV = () => {
    const rows = table.getFilteredRowModel().rows;
    if (rows.length === 0) return;

    const visibleCols = table.getVisibleLeafColumns();
    const headers = visibleCols.map((c) => (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id));

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        visibleCols
          .map((col) => {
            const val = row.getValue(col.id);
            const str = val === null || val === undefined ? "" : String(val);
            return `"${str.replace(/"/g, '""')}"`;
          })
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportFilename ?? "export"}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeFilterCount = (globalFilter ? 1 : 0) + columnFilters.length;

  const selClass =
    "rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-100 hover:border-slate-300";

  return (
    <div className="space-y-3.5">
      {/* Table Toolbar Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-70">
          {/* Global Search */}
          <div className="relative flex-1 min-w-50 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={globalFilter ?? ""}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-8 text-xs text-ink-900 placeholder:text-slate-400 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-100 hover:border-slate-300"
            />
            {globalFilter && (
              <button
                onClick={() => setGlobalFilter("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Faceted Dropdowns */}
          {facets?.map((facet) => {
            const currentVal = (table.getColumn(facet.id)?.getFilterValue() as string) ?? "ALL";
            return (
              <select
                key={facet.id}
                value={currentVal}
                onChange={(e) => {
                  const val = e.target.value;
                  table.getColumn(facet.id)?.setFilterValue(val === "ALL" ? undefined : val);
                }}
                className={selClass}
              >
                <option value="ALL">All {facet.title}</option>
                {facet.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            );
          })}

          {/* Reset Filters */}
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setGlobalFilter("");
                setColumnFilters([]);
              }}
              className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Reset ({activeFilterCount})
            </button>
          )}
        </div>

        {/* Action Controls: Refresh, Export, Extra */}
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-ink-900 transition-all active:scale-95 disabled:opacity-50"
              title="Refresh table query data"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin text-brand-600")} />
              <span className="hidden sm:inline">Sync</span>
            </button>
          )}

          {exportFilename && (
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-ink-900 transition-all active:scale-95"
              title="Export filtered records to CSV"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
          )}

          {extraActions}

          {/* Live / Stale query status pill */}
          {lastUpdatedAt && (
            <span className="hidden lg:inline-flex items-center gap-1 text-[11px] text-slate-400 font-mono">
              <Clock className="h-3 w-3" />
              {isFetching ? "Syncing..." : "Cached"}
            </span>
          )}
        </div>
      </div>

      {/* Main Table Card */}
      <div className="card overflow-hidden p-0 border border-slate-200/80 shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/90 text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200/80">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sortDirection = header.column.getIsSorted();

                    return (
                      <th
                        key={header.id}
                        colSpan={header.colSpan}
                        className={cn(
                          "px-4 py-3 font-semibold select-none",
                          canSort && "cursor-pointer hover:bg-slate-100/70 transition-colors",
                        )}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {header.isPlaceholder ? null : (
                          <div className="flex items-center gap-1.5">
                            <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                            {canSort && (
                              <span className="text-slate-400">
                                {sortDirection === "asc" ? (
                                  <ArrowUp className="h-3.5 w-3.5 text-brand-600" />
                                ) : sortDirection === "desc" ? (
                                  <ArrowDown className="h-3.5 w-3.5 text-brand-600" />
                                ) : (
                                  <ArrowUpDown className="h-3 w-3 text-slate-300 opacity-60 hover:opacity-100" />
                                )}
                              </span>
                            )}
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                // Shimmer Skeleton Loading
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {columns.map((_, colIdx) => (
                      <td key={colIdx} className="px-4 py-3.5">
                        <div className="h-4 w-3/4 rounded-md bg-slate-100" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onRowClick?.(row.original)}
                    className={cn(
                      "transition-colors hover:bg-brand-50/40",
                      onRowClick && "cursor-pointer active:bg-brand-50/70",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 text-ink-900">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                    <div className="mx-auto flex flex-col items-center justify-center max-w-sm">
                      <Sparkles className="h-8 w-8 text-slate-300 mb-2" />
                      <p className="font-semibold text-slate-700 text-sm">No matching records found</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Try adjusting your search query or clearing active filters.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination & Summary Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span>
              Showing{" "}
              <strong className="text-ink-900">
                {table.getFilteredRowModel().rows.length > 0
                  ? table.getState().pagination.pageIndex * pageSize + 1
                  : 0}
              </strong>{" "}
              to{" "}
              <strong className="text-ink-900">
                {Math.min(
                  (table.getState().pagination.pageIndex + 1) * pageSize,
                  table.getFilteredRowModel().rows.length,
                )}
              </strong>{" "}
              of <strong className="text-ink-900">{table.getFilteredRowModel().rows.length}</strong> entries
            </span>
            {table.getFilteredRowModel().rows.length !== data.length && (
              <span className="text-slate-400">(filtered from {data.length} total)</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Page Size Selector */}
            <div className="flex items-center gap-1.5">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  const sz = Number(e.target.value);
                  setPageSize(sz);
                  table.setPageSize(sz);
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 outline-none"
              >
                {[10, 25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                aria-label="First page"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>

              <span className="px-2 font-medium text-slate-700">
                Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
              </span>

              <button
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                aria-label="Last page"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
