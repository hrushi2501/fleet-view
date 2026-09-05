"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, ArrowLeftRight, PackagePlus, SlidersHorizontal, Warehouse, Loader2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import { isActionError } from "@/lib/action-result";
import {
  saveInventoryItem,
  receiveStockAction,
  transferStockAction,
  adjustStockAction,
  saveWarehouse,
} from "@/app/(app)/maintenance/actions";

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-bold text-ink-900">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function InventoryItemModal({
  item,
}: {
  item?: {
    id: string;
    partNo: string;
    name: string;
    description: string | null;
    category: string;
    unitOfMeasure: string;
    minStockLevel: number;
    averageCost: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <>
      {item ? (
        <button
          onClick={() => setOpen(true)}
          className="text-xs font-semibold text-brand-700 hover:text-brand-900 hover:underline"
        >
          Edit
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-500"
        >
          <Plus className="h-4 w-4" />
          New Part SKU
        </button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={item ? `Edit Part — ${item.partNo}` : "Create New Inventory Part"}
        subtitle="Parts and consumables catalog for workshop maintenance"
      >
        <form
          action={(fd) =>
            start(async () => {
              const res = await saveInventoryItem(item ? item.id : null, fd);
              if (isActionError(res)) {
                toast.error(res.error);
                return;
              }
              toast.success(item ? "Part SKU updated" : "Part SKU added to catalog");
              setOpen(false);
              router.refresh();
            })
          }
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Part No. / SKU *</span>
              <input
                type="text"
                name="partNo"
                defaultValue={item?.partNo}
                required
                placeholder="e.g. FLT-AIR-102"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Category *</span>
              <select name="category" defaultValue={item?.category || "PART"} className={inputCls}>
                <option value="PART">Spare Part</option>
                <option value="LUBRICANT">Lubricant / Oil</option>
                <option value="CONSUMABLE">Consumable</option>
                <option value="TOOL">Tool / Hardware</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Item Name *</span>
            <input
              type="text"
              name="name"
              defaultValue={item?.name}
              required
              placeholder="e.g. Engine Air Filter CAT 320D"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Description / Spec</span>
            <textarea
              name="description"
              defaultValue={item?.description || ""}
              rows={2}
              placeholder="Technical specs, OEM cross-reference, etc."
              className={inputCls}
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">UOM *</span>
              <select name="unitOfMeasure" defaultValue={item?.unitOfMeasure || "PCS"} className={inputCls}>
                <option value="PCS">Pieces (PCS)</option>
                <option value="LITRES">Litres (L)</option>
                <option value="KG">Kilograms (KG)</option>
                <option value="BOX">Box / Pack</option>
                <option value="SET">Set</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Min Alert Stock</span>
              <input
                type="number"
                name="minStockLevel"
                defaultValue={item?.minStockLevel ?? 5}
                min={0}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Est. Unit Cost (₹)</span>
              <input
                type="number"
                name="averageCost"
                step="0.01"
                defaultValue={item?.averageCost ?? 0}
                min={0}
                className={inputCls}
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-500 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {item ? "Save Changes" : "Create SKU"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ReceiveStockModal({
  items,
  warehouses,
}: {
  items: { id: string; label: string; partNo: string; averageCost: number }[];
  warehouses: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
      >
        <PackagePlus className="h-4 w-4 text-emerald-600" />
        Receive Stock (GRN)
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Goods Receipt Note (GRN)"
        subtitle="Receive new stock into warehouse and update moving average valuation"
      >
        <form
          action={(fd) =>
            start(async () => {
              const res = await receiveStockAction(fd);
              if (isActionError(res)) {
                toast.error(res.error);
                return;
              }
              toast.success("Stock received successfully");
              setOpen(false);
              router.refresh();
            })
          }
          className="space-y-4"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Part SKU *</span>
            <select name="itemId" required className={inputCls}>
              <option value="">— Select item —</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Receiving Warehouse *</span>
            <select name="warehouseId" required className={inputCls}>
              <option value="">— Select warehouse —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Quantity *</span>
              <input type="number" name="quantity" min={1} required placeholder="e.g. 10" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Unit Cost (₹) *</span>
              <input
                type="number"
                step="0.01"
                name="unitCost"
                min={0}
                required
                placeholder="Purchase unit rate"
                className={inputCls}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">PO / Invoice / Reference Note</span>
            <input
              type="text"
              name="note"
              placeholder="e.g. PO-2026-881 / Tata Motors Authorized"
              className={inputCls}
            />
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Receive Stock
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function TransferStockModal({
  items,
  warehouses,
}: {
  items: { id: string; label: string }[];
  warehouses: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
      >
        <ArrowLeftRight className="h-4 w-4 text-sky-600" />
        Transfer Stock
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Inter-Warehouse Stock Transfer"
        subtitle="Move parts between central depot and site workshops"
      >
        <form
          action={(fd) =>
            start(async () => {
              const res = await transferStockAction(fd);
              if (isActionError(res)) {
                toast.error(res.error);
                return;
              }
              toast.success("Stock transferred successfully");
              setOpen(false);
              router.refresh();
            })
          }
          className="space-y-4"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Part SKU *</span>
            <select name="itemId" required className={inputCls}>
              <option value="">— Select item —</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">From Warehouse *</span>
              <select name="fromWarehouseId" required className={inputCls}>
                <option value="">— Select source —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">To Warehouse *</span>
              <select name="toWarehouseId" required className={inputCls}>
                <option value="">— Select target —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Quantity to Transfer *</span>
            <input type="number" name="quantity" min={1} required className={inputCls} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Transfer Reason / Dispatch Note</span>
            <input
              type="text"
              name="note"
              placeholder="e.g. Urgent requisition for breakdown at Front A"
              className={inputCls}
            />
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-sky-500 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Transfer
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function AdjustStockModal({
  items,
  warehouses,
}: {
  items: { id: string; label: string }[];
  warehouses: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
      >
        <SlidersHorizontal className="h-4 w-4 text-amber-600" />
        Stock Audit Adjustment
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Physical Stock Adjustment"
        subtitle="Reconcile inventory count variances, damages, or stocktake findings"
      >
        <form
          action={(fd) =>
            start(async () => {
              const res = await adjustStockAction(fd);
              if (isActionError(res)) {
                toast.error(res.error);
                return;
              }
              toast.success("Stock count updated");
              setOpen(false);
              router.refresh();
            })
          }
          className="space-y-4"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Part SKU *</span>
            <select name="itemId" required className={inputCls}>
              <option value="">— Select item —</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Warehouse *</span>
            <select name="warehouseId" required className={inputCls}>
              <option value="">— Select warehouse —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Actual Counted Stock *</span>
            <input
              type="number"
              name="newQuantity"
              min={0}
              required
              placeholder="Actual physical count"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Reason for Adjustment *</span>
            <input
              type="text"
              name="reason"
              required
              placeholder="e.g. Monthly stocktake variance / Damaged packaging"
              className={inputCls}
            />
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-500 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save Adjustment
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function WarehouseModal({
  projects = [],
}: {
  projects?: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
      >
        <Warehouse className="h-4 w-4 text-violet-600" />
        New Store
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add Store / Warehouse"
        subtitle="Establish a local spares and tool store at a project site"
      >
        <form
          action={(fd) =>
            start(async () => {
              const res = await saveWarehouse(null, fd);
              if (isActionError(res)) {
                toast.error(res.error);
                return;
              }
              toast.success("Warehouse store created");
              setOpen(false);
              router.refresh();
            })
          }
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Store Code *</span>
              <input type="text" name="code" required placeholder="e.g. WH-BHL-01" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Store Name *</span>
              <input type="text" name="name" required placeholder="e.g. Bhilwara Central Store" className={inputCls} />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Location / Yard Details</span>
            <input
              type="text"
              name="location"
              placeholder="e.g. Yard 2, Near Workshop Bay"
              className={inputCls}
            />
          </label>

          {projects.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Associated Project</span>
              <select name="projectId" className={inputCls}>
                <option value="">— Fleet / Company General —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-violet-500 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create Store
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
