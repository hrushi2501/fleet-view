import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard } from "@/components/ui";
import { requirePage, projectScope } from "@/lib/access";
import { recordScope, isRestricted } from "@/lib/record-access";
import { inr, num, fmtDate } from "@/lib/utils";
import { isLowStock, totalStockQty } from "@/lib/inventory";
import {
  Boxes,
  AlertTriangle,
  IndianRupee,
  Warehouse as WarehouseIcon,
  Package,
  FileSpreadsheet,
} from "lucide-react";
import Link from "next/link";
import {
  InventoryItemModal,
  ReceiveStockModal,
  TransferStockModal,
  AdjustStockModal,
  WarehouseModal,
} from "@/components/InventoryForms";

export const dynamic = "force-dynamic";

const TXN_BADGE: Record<string, string> = {
  RECEIPT: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  ISSUE: "bg-rose-100 text-rose-700 ring-rose-600/20",
  TRANSFER: "bg-sky-100 text-sky-700 ring-sky-600/20",
  ADJUSTMENT: "bg-amber-100 text-amber-700 ring-amber-600/20",
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await requirePage("maintenance.view");
  const resolvedParams = await searchParams;
  const tab = resolvedParams?.tab || "catalog";

  const [items, warehouses, recentTransactions, projects] = await Promise.all([
    db.inventoryItem.findMany({
      include: {
        stocks: { where: recordScope("inventoryStock", access), include: { warehouse: true } },
      },
      orderBy: { partNo: "asc" },
    }),
    db.inventoryWarehouse.findMany({
      where: { active: true, ...recordScope("inventoryWarehouse", access) },
      include: {
        stocks: { include: { item: true } },
        project: true,
      },
      orderBy: { code: "asc" },
    }),
    db.inventoryTransaction.findMany({
      where: recordScope("inventoryTransaction", access),
      take: 60,
      include: {
        item: true,
        warehouse: true,
        toWarehouse: true,
      },
      orderBy: { date: "desc" },
    }),
    db.project.findMany({ where: projectScope(access), orderBy: { code: "asc" } }),
  ]);

  const itemOpts = items.map((i) => ({
    id: i.id,
    label: `${i.partNo} — ${i.name} (₹${i.averageCost})`,
    partNo: i.partNo,
    averageCost: i.averageCost,
  }));
  const warehouseOpts = warehouses.map((w) => ({ id: w.id, label: `${w.code} — ${w.name}` }));
  const projectOpts = projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));

  // Computations
  const lowStockItems = items.filter((i) => {
    const totalQty = totalStockQty(i.stocks);
    return isLowStock(totalQty, i.minStockLevel);
  });

  const totalValuation = items.reduce((acc, item) => {
    const totalQty = totalStockQty(item.stocks);
    return acc + totalQty * item.averageCost;
  }, 0);

  const totalStockUnits = items.reduce((acc, item) => acc + totalStockQty(item.stocks), 0);

  const tabClass = (t: string) =>
    `px-4 py-2 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
      tab === t
        ? "border-brand-600 text-brand-600"
        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
    }`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Spare Parts &amp; Inventory</h1>
          <p className="text-sm text-slate-500">
            Site store stock, moving average cost valuation, and parts consumption on work orders
          </p>
        </div>
        {access.can("maintenance.edit") && <div className="flex flex-wrap items-center gap-2">
          <WarehouseModal projects={projectOpts} />
          <ReceiveStockModal items={itemOpts} warehouses={warehouseOpts} />
          <TransferStockModal items={itemOpts} warehouses={warehouseOpts} />
          <AdjustStockModal items={itemOpts} warehouses={warehouseOpts} />
          {!isRestricted(access) && <InventoryItemModal />}
        </div>}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Catalog SKUs"
          value={num(items.length)}
          sub={`${num(totalStockUnits)} total units in store`}
          accent="brand"
          icon={<Boxes className="h-5 w-5" />}
        />
        <StatCard
          label="Low Stock Alerts"
          value={num(lowStockItems.length)}
          sub={lowStockItems.length > 0 ? "Requires re-ordering" : "Stock healthy"}
          accent={lowStockItems.length > 0 ? "rose" : "emerald"}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatCard
          label="Store Inventory Value"
          value={inr(totalValuation, { compact: true })}
          sub="moving average cost"
          accent="violet"
          icon={<IndianRupee className="h-5 w-5" />}
        />
        <StatCard
          label="Active Stores / Yards"
          value={num(warehouses.length)}
          sub={`${num(recentTransactions.length)} recent movements`}
          accent="brand"
          icon={<WarehouseIcon className="h-5 w-5" />}
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-1 overflow-x-auto">
        <Link href="/maintenance/inventory?tab=catalog" className={tabClass("catalog")}>
          📦 Part Catalog &amp; Stock
        </Link>
        <Link href="/maintenance/inventory?tab=stores" className={tabClass("stores")}>
          🏢 Store &amp; Yard Breakdown
        </Link>
        <Link href="/maintenance/inventory?tab=ledger" className={tabClass("ledger")}>
          📜 Stock Ledger &amp; Audit Trail
        </Link>
      </div>

      {/* Tab 1: Catalog */}
      {tab === "catalog" && (
        <Card className="p-0">
          <div className="p-5 pb-3 flex items-center justify-between">
            <SectionTitle
              title={`Parts Catalog (${items.length})`}
              subtitle="All cataloged spare parts, consumables, and lubricants with live inventory balance"
            />
          </div>

          {items.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <Package className="mx-auto h-12 w-12 text-slate-300 mb-2" />
              <p className="font-semibold text-ink-900">No inventory parts cataloged yet</p>
              <p className="text-sm">Click &quot;New Part SKU&quot; above to create spare parts or consumables.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Part No. / SKU</th>
                    <th className="px-5 py-3 font-medium">Name &amp; Spec</th>
                    <th className="px-5 py-3 font-medium">Category</th>
                    <th className="px-5 py-3 text-right font-medium">Total Stock</th>
                    <th className="px-5 py-3 text-right font-medium">Min Level</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 text-right font-medium">Avg Cost</th>
                    <th className="px-5 py-3 text-right font-medium">Total Value</th>
                    <th className="px-5 py-3 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => {
                    const totalQty = totalStockQty(item.stocks);
                    const isLow = isLowStock(totalQty, item.minStockLevel);
                    const value = totalQty * item.averageCost;

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/60 transition">
                        <td className="px-5 py-3 font-mono font-semibold text-ink-900">
                          {item.partNo}
                        </td>
                        <td className="px-5 py-3">
                          <p className="font-medium text-ink-900">{item.name}</p>
                          {item.description && (
                            <p className="text-xs text-slate-400 mt-0.5 max-w-sm truncate">
                              {item.description}
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          <Badge color="bg-slate-100 text-slate-600 ring-slate-400/20">
                            {item.category}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-right font-semibold text-ink-900">
                          {num(totalQty)} <span className="text-xs font-normal text-slate-400">{item.unitOfMeasure}</span>
                        </td>
                        <td className="px-5 py-3 text-right text-slate-500">
                          {num(item.minStockLevel)} {item.unitOfMeasure}
                        </td>
                        <td className="px-5 py-3">
                          {isLow ? (
                            <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">
                              Low Stock
                            </Badge>
                          ) : (
                            <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">
                              Sufficient
                            </Badge>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-slate-700">
                          {inr(item.averageCost)}
                        </td>
                        <td className="px-5 py-3 text-right font-bold text-ink-900">
                          {inr(value)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <InventoryItemModal item={item} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Tab 2: Stores */}
      {tab === "stores" && (
        <div className="space-y-6">
          <SectionTitle
            title={`Store & Yard Breakdown (${warehouses.length})`}
            subtitle="Local site stores, central workshops, and active stock distribution"
          />

          {warehouses.length === 0 ? (
            <Card>
              <div className="py-12 text-center text-slate-500">
                <WarehouseIcon className="mx-auto h-12 w-12 text-slate-300 mb-2" />
                <p className="font-semibold text-ink-900">No stores configured</p>
                <p className="text-sm">Click &quot;New Store&quot; above to create a site warehouse.</p>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {warehouses.map((w) => {
                const totalUnits = w.stocks.reduce((sum, s) => sum + s.quantity, 0);
                const warehouseValuation = w.stocks.reduce(
                  (sum, s) => sum + s.quantity * s.item.averageCost,
                  0
                );

                return (
                  <Card key={w.id} className="p-0 border border-slate-100 overflow-hidden shadow-sm">
                    <div className="bg-slate-50 px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-ink-900 flex items-center gap-1.5">
                          <WarehouseIcon className="h-4 w-4 text-brand-600" />
                          {w.name}
                        </h3>
                        <span className="font-mono text-xs text-slate-400">{w.code}</span>
                      </div>
                      <Badge color="bg-brand-50 text-brand-700 ring-brand-600/20">
                        {w.stocks.length} SKUs
                      </Badge>
                    </div>

                    <div className="p-5 space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded bg-slate-50 p-2.5">
                          <span className="text-slate-400">Total Units</span>
                          <p className="font-bold text-ink-900 text-sm">{num(totalUnits)}</p>
                        </div>
                        <div className="rounded bg-slate-50 p-2.5">
                          <span className="text-slate-400">Store Valuation</span>
                          <p className="font-bold text-emerald-700 text-sm">
                            {inr(warehouseValuation, { compact: true })}
                          </p>
                        </div>
                      </div>

                      {w.location && (
                        <p className="text-xs text-slate-500">
                          <span className="font-medium">Location:</span> {w.location}
                        </p>
                      )}
                      {w.project && (
                        <p className="text-xs text-slate-500">
                          <span className="font-medium">Project:</span> {w.project.code} — {w.project.name}
                        </p>
                      )}

                      <div className="border-t border-slate-100 pt-3">
                        <p className="text-xs font-semibold text-slate-600 mb-2">Stocked Items:</p>
                        {w.stocks.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">No parts in stock currently</p>
                        ) : (
                          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                            {w.stocks.map((stk) => (
                              <div
                                key={stk.id}
                                className="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-0"
                              >
                                <div>
                                  <span className="font-mono text-slate-600">{stk.item.partNo}</span>
                                  <p className="text-slate-500 truncate max-w-35">{stk.item.name}</p>
                                </div>
                                <span className="font-bold text-ink-900">
                                  {num(stk.quantity)} {stk.item.unitOfMeasure}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Ledger */}
      {tab === "ledger" && (
        <Card className="p-0">
          <div className="p-5 pb-3">
            <SectionTitle
              title="Stock Movement Ledger"
              subtitle="Every part received, issued, moved or counted — with who did it"
            />
          </div>

          {recentTransactions.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <FileSpreadsheet className="mx-auto h-12 w-12 text-slate-300 mb-2" />
              <p className="font-semibold text-ink-900">No inventory transactions logged yet</p>
              <p className="text-sm">Movements are recorded when receiving, issuing to work orders, or transferring parts.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Timestamp</th>
                    <th className="px-5 py-3 font-medium">Type</th>
                    <th className="px-5 py-3 font-medium">Item / SKU</th>
                    <th className="px-5 py-3 font-medium">Store</th>
                    <th className="px-5 py-3 text-right font-medium">Delta Qty</th>
                    <th className="px-5 py-3 text-right font-medium">Rate</th>
                    <th className="px-5 py-3 text-right font-medium">Total Amount</th>
                    <th className="px-5 py-3 font-medium">Note / Reference</th>
                    <th className="px-5 py-3 font-medium">Recorded By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentTransactions.map((tx) => {
                    const isPositive = tx.quantity > 0;
                    return (
                      <tr key={tx.id} className="hover:bg-slate-50/60 transition">
                        <td className="px-5 py-3 text-xs text-slate-500 whitespace-nowrap">
                          {fmtDate(tx.date)}
                        </td>
                        <td className="px-5 py-3">
                          <Badge color={TXN_BADGE[tx.type] || "bg-slate-100 text-slate-600"}>
                            {tx.type}
                          </Badge>
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-mono text-xs font-semibold text-ink-900">
                            {tx.item.partNo}
                          </span>
                          <p className="text-xs text-slate-500 truncate max-w-xs">{tx.item.name}</p>
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-600">
                          {tx.warehouse.code}
                          {tx.toWarehouse && (
                            <span className="text-slate-400"> → {tx.toWarehouse.code}</span>
                          )}
                        </td>
                        <td
                          className={`px-5 py-3 text-right font-mono font-bold ${
                            isPositive ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {isPositive ? `+${tx.quantity}` : tx.quantity} {tx.item.unitOfMeasure}
                        </td>
                        <td className="px-5 py-3 text-right text-xs text-slate-600">
                          {inr(tx.unitCost)}
                        </td>
                        <td className="px-5 py-3 text-right font-bold text-ink-900">
                          {inr(tx.totalCost)}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500 max-w-xs truncate">
                          {tx.note || "—"}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-600">{tx.by || "System"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
