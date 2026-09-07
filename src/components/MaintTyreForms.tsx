"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Loader2, Trash2, Wrench, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { isActionError } from "@/lib/action-result";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateMaintenanceQueries, invalidateFleetQueries } from "@/lib/query-invalidation";
import {
  saveSchedule,
  deleteSchedule,
  seedPmSchedules,
  raiseWoFromSchedule,
  completeWorkOrder,
  addWoLine,
  deleteWoLine,
  addChecklistItem,
  toggleChecklistItem,
  submitPreOpChecklist,
} from "@/app/(app)/maintenance/actions";
import {
  saveTyre,
  deleteTyre,
  fitTyre,
  removeTyre,
  inspectTyre,
  retreadTyre,
  saveComponent,
  deleteComponent,
  transferTyre,
  transferComponent,
} from "@/app/(app)/tyres/actions";
import { TYRE_POSITIONS, COMPONENT_TYPES } from "@/lib/tyres";
import { FAILURE_CODES, SERVICE_TIERS } from "@/lib/maintenance";

type Opt = { id: string; label: string };

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function Inp({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  step,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number;
  required?: boolean;
  step?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <input
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
        className={inputCls}
      />
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

function Sel({
  label,
  name,
  options,
  defaultValue,
  value,
  required,
  hint,
  onChange,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  value?: string;
  required?: boolean;
  hint?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        value={value}
        required={required}
        onChange={onChange}
        className={inputCls}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-x-auto overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div>
            <h3 className="text-lg font-bold text-ink-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function SubmitBar({
  pending,
  onCancel,
  label = "Save",
}: {
  pending: boolean;
  onCancel: () => void;
  label?: string;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {label}
      </button>
    </div>
  );
}

function Trigger({
  onClick,
  children,
  tone = "brand",
}: {
  onClick: () => void;
  children: ReactNode;
  tone?: "brand" | "ghost";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold",
        tone === "brand"
          ? "bg-brand-600 text-white hover:bg-brand-700"
          : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
      )}
    >
      {children}
    </button>
  );
}

/* ---------------------------------- PM ---------------------------------- */

export function ScheduleForm({
  assets,
  schedule,
}: {
  assets: Opt[];
  classes?: { value: string; label: string }[];
  schedule?: {
    id: string;
    assetId: string | null;
    taskName: string;
    intervalKm: number;
    intervalHours: number;
    intervalDays: number;
    lastDoneMeter: number;
    lastDoneDate: Date | null;
    estimatedCost: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const tierOpts = Object.values(SERVICE_TIERS).map((t) => ({ value: t.tier, label: t.name }));

  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone={schedule ? "ghost" : "brand"}>
        {!schedule && <Plus className="h-4 w-4" />}
        {schedule ? "Edit" : "Add PM Task"}
      </Trigger>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={schedule ? "Edit PM Task" : "New Preventive Task"}
        subtitle="Whichever interval trips first decides when it's due — km, engine-hours or days."
      >
        <form
          action={(fd) =>
            start(async () => {
              const result = await saveSchedule(schedule?.id ?? null, fd);
              if (isActionError(result)) { toast.error(result.error); return; }
              setOpen(false);
              await invalidateMaintenanceQueries(queryClient);
              router.refresh();
            })
          }
          className="grid gap-4 sm:grid-cols-2"
        >
          <Sel
            label="Machine"
            name="assetId"
            required
            defaultValue={schedule?.assetId ?? ""}
            options={assets.map((a) => ({ value: a.id, label: a.label }))}
          />
          <Inp
            label="Task Name"
            name="taskName"
            required
            defaultValue={schedule?.taskName}
            placeholder="Engine oil & filter change"
          />
          <Sel
            label="Service Tier"
            name="serviceTier"
            options={[{ value: "", label: "— Select Tier —" }, ...tierOpts]}
            defaultValue="SERVICE_A"
            hint="Determines PM parts kit auto-population"
          />
          <Inp
            label="Interval (km)"
            name="intervalKm"
            type="number"
            step="1"
            defaultValue={schedule?.intervalKm ?? 0}
            hint="0 = not km-based"
          />
          <Inp
            label="Interval (engine-hours)"
            name="intervalHours"
            type="number"
            step="1"
            defaultValue={schedule?.intervalHours ?? 0}
            hint="0 = not hour-based"
          />
          <Inp
            label="Interval (days)"
            name="intervalDays"
            type="number"
            step="1"
            defaultValue={schedule?.intervalDays ?? 0}
            hint="0 = not calendar-based"
          />
          <Inp
            label="Estimated Cost ₹"
            name="estimatedCost"
            type="number"
            step="0.01"
            defaultValue={schedule?.estimatedCost ?? 0}
          />
          <Inp
            label="Last Done — Meter"
            name="lastDoneMeter"
            type="number"
            step="1"
            defaultValue={schedule?.lastDoneMeter ?? 0}
          />
          <Inp
            label="Last Done — Date"
            name="lastDoneDate"
            type="date"
            defaultValue={
              schedule?.lastDoneDate ? new Date(schedule.lastDoneDate).toISOString().slice(0, 10) : ""
            }
          />
          <div className="sm:col-span-2">
            <SubmitBar
              pending={pending}
              onCancel={() => setOpen(false)}
              label={schedule ? "Save Task" : "Add Task"}
            />
          </div>
        </form>
      </Modal>
    </>
  );
}

export function SeedPmButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() =>
          start(async () => {
            const r = await seedPmSchedules();
            if (isActionError(r)) {
              setMsg(r.error);
              return;
            }
            setMsg(`${r.created} task${r.created === 1 ? "" : "s"} created`);
            await invalidateMaintenanceQueries(queryClient);
            router.refresh();
          })
        }
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Install PM
        Templates
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  );
}

export function RaiseWoButton({ scheduleId }: { scheduleId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  return (
    <button
      onClick={() =>
        start(async () => {
          const result = await raiseWoFromSchedule(scheduleId);
          if (isActionError(result)) { toast.error(result.error); return; }
          await invalidateMaintenanceQueries(queryClient);
          router.refresh();
        })
      }
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />} Raise
      WO (with Parts Kit)
    </button>
  );
}

export function CompleteWoForm({
  wo,
}: {
  wo: {
    id: string;
    woNo: string;
    laborCost: number;
    partsCost: number;
    downtimeHrs: number;
    meterAtService: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const failureOpts = [
    { value: "", label: "— Select Failure Code (if breakdown) —" },
    ...FAILURE_CODES.map((f) => ({ value: f.code, label: `${f.label} (${f.category})` })),
  ];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
      >
        Complete
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Complete ${wo.woNo}`}
        subtitle="Closing a PM job rolls its schedule forward automatically."
      >
        <form
          action={(fd) =>
            start(async () => {
              const result = await completeWorkOrder(wo.id, fd);
              if (isActionError(result)) { toast.error(result.error); return; }
              setOpen(false);
              await invalidateMaintenanceQueries(queryClient);
              await invalidateFleetQueries(queryClient);
              router.refresh();
            })
          }
          className="grid gap-4 sm:grid-cols-2"
        >
          <Inp
            label="Labour Cost ₹"
            name="laborCost"
            type="number"
            step="0.01"
            defaultValue={wo.laborCost}
          />
          <Inp
            label="Parts Cost ₹"
            name="partsCost"
            type="number"
            step="0.01"
            defaultValue={wo.partsCost}
          />
          <Inp
            label="Downtime (hours)"
            name="downtimeHrs"
            type="number"
            step="0.1"
            defaultValue={wo.downtimeHrs}
          />
          <Inp
            label="Meter at Service"
            name="meterAtService"
            type="number"
            step="1"
            defaultValue={wo.meterAtService}
            hint="Blank uses the machine's current meter."
          />
          <Inp label="Technician" name="technician" placeholder="Mechanic name" />
          <Sel
            label="Failure Reason Code"
            name="failureCode"
            options={failureOpts}
            hint="Categorizes the defect for Root Cause Analysis"
          />
          <div className="sm:col-span-2">
            <Inp
              label="Root Cause Analysis (RCA) Note"
              name="rcaNote"
              placeholder="e.g. Hose burst due to hydraulic surge valve failure"
              hint="Explain why the failure occurred to prevent repeat breakdowns"
            />
          </div>
          <div className="sm:col-span-2">
            <SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Complete Job" />
          </div>
        </form>
      </Modal>
    </>
  );
}

export function PreOpChecklistForm({ assets }: { assets: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [resultMsg, setResultMsg] = useState<{ type: "success" | "warn"; text: string } | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone="ghost">
        📋 Daily Pre-Op Check
      </Trigger>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setResultMsg(null);
        }}
        title="Daily Operator Pre-Op Safety Inspection"
        subtitle="Quick 5-point check before a shift. Any fail opens an urgent repair job on its own."
      >
        <form
          action={(fd) =>
            start(async () => {
              const res = await submitPreOpChecklist(fd);
              if (isActionError(res)) {
                return;
              }
              if (res.failedCount > 0) {
                setResultMsg({
                  type: "warn",
                  text: `⚠️ Inspection complete: ${res.failedCount} safety check(s) failed. Urgent Breakdown Work Order raised automatically!`,
                });
              } else {
                setResultMsg({
                  type: "success",
                  text: "✅ Pre-Op Inspection Passed! Machine cleared for operation.",
                });
              }
              await invalidateMaintenanceQueries(queryClient);
              router.refresh();
            })
          }
          className="space-y-4"
        >
          <Sel
            label="Select Machine *"
            name="assetId"
            required
            options={[
              { value: "", label: "— Select Machine —" },
              ...assets.map((a) => ({ value: a.id, label: a.label })),
            ]}
          />

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              5-Point Safety Inspection Items
            </h4>

            <label className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 border border-slate-200">
              <span className="text-sm font-medium text-slate-800">1. Engine Oil & Fluid Levels OK</span>
              <input
                type="checkbox"
                name="check_fluids"
                defaultChecked
                className="h-5 w-5 rounded border-slate-300 text-brand-600"
              />
            </label>

            <label className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 border border-slate-200">
              <span className="text-sm font-medium text-slate-800">
                2. Hydraulic Hoses & Cylinders (No Leaks)
              </span>
              <input
                type="checkbox"
                name="check_hydraulics"
                defaultChecked
                className="h-5 w-5 rounded border-slate-300 text-brand-600"
              />
            </label>

            <label className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 border border-slate-200">
              <span className="text-sm font-medium text-slate-800">3. Fan Belts & Tension OK</span>
              <input
                type="checkbox"
                name="check_belts"
                defaultChecked
                className="h-5 w-5 rounded border-slate-300 text-brand-600"
              />
            </label>

            <label className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 border border-slate-200">
              <span className="text-sm font-medium text-slate-800">
                4. Tyres / Tracks & Undercarriage Intact
              </span>
              <input
                type="checkbox"
                name="check_undercarriage"
                defaultChecked
                className="h-5 w-5 rounded border-slate-300 text-brand-600"
              />
            </label>

            <label className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 border border-slate-200">
              <span className="text-sm font-medium text-slate-800">
                5. Brakes, Steering & Emergency Stop Responsive
              </span>
              <input
                type="checkbox"
                name="check_brakes"
                defaultChecked
                className="h-5 w-5 rounded border-slate-300 text-brand-600"
              />
            </label>
          </div>

          {resultMsg && (
            <div
              className={cn(
                "p-3 rounded-lg text-xs font-semibold",
                resultMsg.type === "warn"
                  ? "bg-amber-50 text-amber-800 border border-amber-200"
                  : "bg-emerald-50 text-emerald-800 border border-emerald-200"
              )}
            >
              {resultMsg.text}
            </div>
          )}

          <SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Submit Inspection Log" />
        </form>
      </Modal>
    </>
  );
}

export function WoLineForm({
  workOrderId,
  inventoryItems = [],
  warehouses = [],
}: {
  workOrderId: string;
  inventoryItems?: { id: string; label: string; partNo: string; averageCost: number }[];
  warehouses?: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [kind, setKind] = useState("PART");
  const [selectedItemId, setSelectedItemId] = useState("");
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  const selectedItem = inventoryItems.find((i) => i.id === selectedItemId);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
      >
        <Plus className="mr-1 inline h-3.5 w-3.5" />
        Line
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add Labour or Part"
        subtitle="Work-order totals are recalculated from these lines."
      >
        <form
          action={(fd) =>
            start(async () => {
              if (selectedItem) {
                fd.set("partNo", selectedItem.partNo);
              }
              const result = await addWoLine(workOrderId, fd);
              if (isActionError(result)) { toast.error(result.error); return; }
              setOpen(false);
              await invalidateMaintenanceQueries(queryClient);
              router.refresh();
            })
          }
          className="grid gap-4 sm:grid-cols-2"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Kind *</span>
            <select
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              required
              className={inputCls}
            >
              <option value="PART">Part</option>
              <option value="LABOUR">Labour</option>
              <option value="OUTSIDE">Outside work</option>
            </select>
          </label>

          {kind === "PART" && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Inventory SKU</span>
                <select
                  name="inventoryItemId"
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">— Uncataloged / Outside Part —</option>
                  {inventoryItems.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </select>
              </label>

              {selectedItemId && (
                <Sel
                  label="Source Warehouse"
                  name="warehouseId"
                  required
                  options={[
                    { value: "", label: "— Select warehouse —" },
                    ...warehouses.map((w) => ({ value: w.id, label: w.label })),
                  ]}
                />
              )}
            </>
          )}

          <Inp
            label="Description"
            name="description"
            required
            defaultValue={selectedItem ? selectedItem.label.split(" — ")[1] : ""}
            placeholder="Engine oil 15W-40"
          />
          <Inp
            label="Part No."
            name="partNo"
            defaultValue={selectedItem ? selectedItem.partNo : ""}
            hint={selectedItem ? "SKU part number is prefilled" : undefined}
          />
          <Inp label="Vendor" name="vendor" />
          <Inp label="Qty" name="qty" type="number" step="0.01" defaultValue={1} required />
          <Inp
            label="Rate ₹"
            name="rate"
            type="number"
            step="0.01"
            defaultValue={selectedItem ? selectedItem.averageCost : 0}
            hint={selectedItem ? `Average cost: ₹${selectedItem.averageCost}` : "Enter unit rate"}
            required
          />
          <div className="sm:col-span-2">
            <SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Add Line" />
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ChecklistToggle({ id, done }: { id: string; done: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  return (
    <button
      onClick={() =>
        start(async () => {
          const result = await toggleChecklistItem(id, !done);
          if (isActionError(result)) { toast.error(result.error); return; }
          await invalidateMaintenanceQueries(queryClient);
          router.refresh();
        })
      }
      disabled={pending}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded border",
        done
          ? "border-emerald-600 bg-emerald-600 text-white"
          : "border-slate-300 bg-white hover:border-brand-400"
      )}
      aria-label={done ? "Mark not done" : "Mark done"}
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : done ? <Check className="h-3.5 w-3.5" /> : null}
    </button>
  );
}

export function ChecklistForm({ workOrderId }: { workOrderId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  return (
    <form
      action={(fd) =>
        start(async () => {
          const result = await addChecklistItem(workOrderId, fd);
          if (isActionError(result)) { toast.error(result.error); return; }
          await invalidateMaintenanceQueries(queryClient);
          router.refresh();
        })
      }
      className="flex items-center gap-2"
    >
      <input name="task" required placeholder="Add checklist item…" className={inputCls} />
      <label className="flex shrink-0 items-center gap-1 text-xs text-slate-600">
        <input type="checkbox" name="critical" className="h-3.5 w-3.5 rounded border-slate-300 text-rose-600" />{" "}
        critical
      </label>
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
      </button>
    </form>
  );
}

/* =============================== M17 =============================== */

export function TyreForm({
  tyre,
  warehouses = [],
}: {
  tyre?: {
    id: string;
    serialNo: string;
    make: string;
    pattern: string | null;
    size: string;
    cost: number;
    treadNewMm: number;
    currentTreadMm: number;
    expectedLifeKm: number;
    purchaseDate: Date | null;
    status?: string;
    warehouseId?: string | null;
  };
  warehouses?: Opt[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(tyre?.status ?? "IN_STOCK");
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone={tyre ? "ghost" : "brand"}>
        {!tyre && <Plus className="h-4 w-4" />}
        {tyre ? "Edit" : "Add Tyre"}
      </Trigger>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={tyre ? "Edit Tyre" : "Add Tyre to Register"}
        subtitle="Every tyre is tracked by its serial number, so a swap between machines shows up."
      >
        <form
          action={(fd) =>
            start(async () => {
              const result = await saveTyre(tyre?.id ?? null, fd);
              if (isActionError(result)) { toast.error(result.error); return; }
              setOpen(false);
              await invalidateMaintenanceQueries(queryClient);
              router.refresh();
            })
          }
          className="grid gap-4 sm:grid-cols-2"
        >
          <Inp label="Serial No." name="serialNo" required defaultValue={tyre?.serialNo} placeholder="MRF2026-04412" />
          <Inp label="Make" name="make" required defaultValue={tyre?.make} placeholder="MRF" />
          <Inp label="Pattern" name="pattern" defaultValue={tyre?.pattern ?? ""} placeholder="Super Lug" />
          <Inp label="Size" name="size" required defaultValue={tyre?.size} placeholder="10.00-20" />
          <Inp label="Cost ₹" name="cost" type="number" step="0.01" defaultValue={tyre?.cost ?? 0} />
          <Inp
            label="Purchase Date"
            name="purchaseDate"
            type="date"
            defaultValue={tyre?.purchaseDate ? new Date(tyre.purchaseDate).toISOString().slice(0, 10) : ""}
          />
          <Inp label="New Tread (mm)" name="treadNewMm" type="number" step="0.1" defaultValue={tyre?.treadNewMm ?? 20} />
          <Inp
            label="Current Tread (mm)"
            name="currentTreadMm"
            type="number"
            step="0.1"
            defaultValue={tyre?.currentTreadMm ?? 20}
          />
          <Inp
            label="Expected Life (km)"
            name="expectedLifeKm"
            type="number"
            step="100"
            defaultValue={tyre?.expectedLifeKm ?? 60000}
          />

          {tyre ? (
            tyre.status === "IN_USE" ? (
              <div className="sm:col-span-2 text-xs font-semibold text-slate-500 bg-slate-50 p-2.5 rounded border">
                Status: In Use (Tyre is currently fitted to a machine)
                <input type="hidden" name="status" value="IN_USE" />
              </div>
            ) : (
              <Sel
                label="Status"
                name="status"
                required
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={[
                  { value: "IN_STOCK", label: "In Stock" },
                  { value: "REMOVED", label: "Removed / Standby" },
                  { value: "SCRAPPED", label: "Scrapped" },
                ]}
              />
            )
          ) : (
            <input type="hidden" name="status" value="IN_STOCK" />
          )}

          {status !== "IN_USE" && status !== "SCRAPPED" && (
            <Sel
              label="Store / Warehouse"
              name="warehouseId"
              required={status === "IN_STOCK"}
              defaultValue={tyre?.warehouseId ?? ""}
              options={[
                { value: "", label: "— Select Warehouse —" },
                ...warehouses.map((w) => ({ value: w.id, label: w.label })),
              ]}
            />
          )}

          <div className="sm:col-span-2">
            <SubmitBar pending={pending} onCancel={() => setOpen(false)} label={tyre ? "Save Tyre" : "Add Tyre"} />
          </div>
        </form>
      </Modal>
    </>
  );
}

export function TyreActionForm({
  kind,
  tyres,
  assets,
  warehouses = [],
}: {
  kind: "FIT" | "REMOVE" | "INSPECT" | "RETREAD" | "TRANSFER";
  tyres: Opt[];
  assets: Opt[];
  warehouses?: Opt[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  const meta = {
    FIT: {
      title: "Fit Tyre",
      sub: "Records the fitment meter so kilometres run can be measured.",
      label: "Fit",
      fn: fitTyre,
    },
    REMOVE: { title: "Remove Tyre", sub: "Banks the kilometres this fitment delivered.", label: "Remove", fn: removeTyre },
    INSPECT: {
      title: "Inspect Tyre",
      sub: "Log a tread reading. Tread that rises without a retread is flagged.",
      label: "Save Reading",
      fn: inspectTyre,
    },
    RETREAD: { title: "Retread Tyre", sub: "Returns the casing to stock with fresh tread.", label: "Retread", fn: retreadTyre },
    TRANSFER: {
      title: "Transfer Tyre",
      sub: "Transfer a tyre from one store/warehouse to another.",
      label: "Transfer",
      fn: transferTyre,
    },
  }[kind];

  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone="ghost">
        <Plus className="h-4 w-4" /> {meta.title}
      </Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title={meta.title} subtitle={meta.sub}>
        <form
          action={(fd) =>
            start(async () => {
              const result = await meta.fn(fd);
              if (isActionError(result)) { toast.error(result.error); return; }
              setOpen(false);
              await invalidateMaintenanceQueries(queryClient);
              await invalidateFleetQueries(queryClient);
              router.refresh();
            })
          }
          className="grid gap-4 sm:grid-cols-2"
        >
          <Sel label="Tyre" name="tyreId" required options={tyres.map((t) => ({ value: t.id, label: t.label }))} />
          {kind !== "TRANSFER" && (
            <Inp label="Date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
          )}
          {kind === "FIT" && (
            <Sel label="Machine" name="assetId" required options={assets.map((a) => ({ value: a.id, label: a.label }))} />
          )}
          {kind === "FIT" && (
            <Sel label="Position" name="position" options={TYRE_POSITIONS.map((p) => ({ value: p, label: p }))} />
          )}
          {kind !== "RETREAD" && kind !== "TRANSFER" && (
            <Inp
              label="Meter Reading"
              name="meterValue"
              type="number"
              step="1"
              hint="Blank uses the machine's current meter."
            />
          )}
          {kind !== "TRANSFER" && (
            <Inp label="Tread (mm)" name="treadMm" type="number" step="0.1" required={kind === "INSPECT"} />
          )}
          {kind === "REMOVE" && (
            <Sel
              label="Reason"
              name="reason"
              required
              options={[
                { value: "WEAR", label: "Normal wear" },
                { value: "PUNCTURE", label: "Puncture" },
                { value: "BURST", label: "Burst — scrap" },
                { value: "CUT", label: "Cut — scrap" },
                { value: "ROTATION", label: "Rotation" },
                { value: "THEFT", label: "Missing / theft" },
              ]}
            />
          )}
          {kind === "REMOVE" && (
            <Sel
              label="Store / Warehouse (if not scrapped)"
              name="warehouseId"
              options={[
                { value: "", label: "— Select Warehouse —" },
                ...warehouses.map((w) => ({ value: w.id, label: w.label })),
              ]}
            />
          )}
          {kind === "RETREAD" && <Inp label="Retread Cost ₹" name="cost" type="number" step="0.01" />}
          {(kind === "TRANSFER" || kind === "RETREAD") && (
            <Sel
              label="Store / Warehouse"
              name="warehouseId"
              required
              options={[
                { value: "", label: "— Select Warehouse —" },
                ...warehouses.map((w) => ({ value: w.id, label: w.label })),
              ]}
            />
          )}
          {kind !== "TRANSFER" && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">Note</span>
              <input name="note" className={inputCls} />
            </label>
          )}
          <div className="sm:col-span-2">
            <SubmitBar pending={pending} onCancel={() => setOpen(false)} label={meta.label} />
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ComponentForm({
  assets,
  component,
  warehouses = [],
}: {
  assets: Opt[];
  component?: {
    id: string;
    serialNo: string;
    type: string;
    make: string | null;
    assetId: string | null;
    status: string;
    cost: number;
    expectedLifeHours: number;
    hoursUsed: number;
    fittedMeter: number;
    fittedDate: Date | null;
    warehouseId?: string | null;
  };
  warehouses?: Opt[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(component?.status ?? "IN_STOCK");
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone={component ? "ghost" : "brand"}>
        {!component && <Plus className="h-4 w-4" />}
        {component ? "Edit" : "Add Component"}
      </Trigger>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={component ? "Edit Component" : "Add Major Component"}
        subtitle="Buckets, undercarriage, engines — tracked by serial number, just like tyres."
      >
        <form
          action={(fd) =>
            start(async () => {
              const result = await saveComponent(component?.id ?? null, fd);
              if (isActionError(result)) { toast.error(result.error); return; }
              setOpen(false);
              await invalidateMaintenanceQueries(queryClient);
              router.refresh();
            })
          }
          className="grid gap-4 sm:grid-cols-2"
        >
          <Inp label="Serial No." name="serialNo" required defaultValue={component?.serialNo} />
          <Sel
            label="Type"
            name="type"
            required
            defaultValue={component?.type}
            options={COMPONENT_TYPES.map((t) => ({
              value: t,
              label: t.charAt(0) + t.slice(1).toLowerCase(),
            }))}
          />
          <Inp label="Make" name="make" defaultValue={component?.make ?? ""} />
          <Sel
            label="Status"
            name="status"
            required
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
            }}
            options={[
              { value: "IN_STOCK", label: "In stock" },
              { value: "IN_USE", label: "In use" },
              { value: "REMOVED", label: "Removed" },
              { value: "REBUILT", label: "Rebuilt" },
              { value: "SCRAPPED", label: "Scrapped" },
            ]}
          />

          {status === "IN_USE" ? (
            <>
              <Sel
                label="Fitted To"
                name="assetId"
                required
                defaultValue={component?.assetId ?? ""}
                options={assets.map((a) => ({ value: a.id, label: a.label }))}
              />
              <Inp
                label="Fitted at Meter"
                name="fittedMeter"
                type="number"
                step="1"
                defaultValue={component?.fittedMeter ?? 0}
              />
              <Inp
                label="Fitted Date"
                name="fittedDate"
                type="date"
                defaultValue={
                  component?.fittedDate ? new Date(component.fittedDate).toISOString().slice(0, 10) : ""
                }
              />
            </>
          ) : (
            status !== "SCRAPPED" && (
              <Sel
                label="Store / Warehouse"
                name="warehouseId"
                required={status === "IN_STOCK"}
                defaultValue={component?.warehouseId ?? ""}
                options={[
                  { value: "", label: "— Select Warehouse —" },
                  ...warehouses.map((w) => ({ value: w.id, label: w.label })),
                ]}
              />
            )
          )}

          <Inp label="Cost ₹" name="cost" type="number" step="0.01" defaultValue={component?.cost ?? 0} />
          <Inp
            label="Expected Life (hours)"
            name="expectedLifeHours"
            type="number"
            step="100"
            defaultValue={component?.expectedLifeHours ?? 8000}
          />
          <Inp
            label="Hours Already Used"
            name="hoursUsed"
            type="number"
            step="1"
            defaultValue={component?.hoursUsed ?? 0}
          />
          <div className="sm:col-span-2">
            <SubmitBar
              pending={pending}
              onCancel={() => setOpen(false)}
              label={component ? "Save" : "Add Component"}
            />
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ComponentActionForm({
  components,
  warehouses,
}: {
  components: Opt[];
  warehouses: Opt[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone="ghost">
        <Plus className="h-4 w-4" /> Transfer Component
      </Trigger>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Transfer Component"
        subtitle="Transfer a major component to another store/warehouse."
      >
        <form
          action={(fd) =>
            start(async () => {
              const result = await transferComponent(fd);
              if (isActionError(result)) { toast.error(result.error); return; }
              setOpen(false);
              await invalidateMaintenanceQueries(queryClient);
              router.refresh();
            })
          }
          className="grid gap-4 sm:grid-cols-2"
        >
          <Sel
            label="Component"
            name="componentId"
            required
            options={components.map((c) => ({ value: c.id, label: c.label }))}
          />
          <Sel
            label="Destination Warehouse"
            name="warehouseId"
            required
            options={[
              { value: "", label: "— Select Warehouse —" },
              ...warehouses.map((w) => ({ value: w.id, label: w.label })),
            ]}
          />
          <div className="sm:col-span-2">
            <SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Transfer" />
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DeleteRow({
  id,
  kind,
}: {
  id: string;
  kind: "schedule" | "woline" | "tyre" | "component";
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const labels = {
    schedule: "PM Schedule",
    woline: "Work Order Line",
    tyre: "Tyre Serial Record",
    component: "Component Record",
  };

  async function handleDelete() {
    const result = kind === "schedule" ? await deleteSchedule(id)
      : kind === "woline" ? await deleteWoLine(id)
      : kind === "tyre" ? await deleteTyre(id)
      : await deleteComponent(id);
    if (isActionError(result)) { toast.error(`Could not delete ${labels[kind]}`, result.error); return; }

    toast.success(`✓ ${labels[kind]} deleted successfully`);
    await invalidateMaintenanceQueries(queryClient);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600 transition-colors"
        aria-label="Delete"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <ConfirmDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfirm={handleDelete}
        title={`Delete ${labels[kind]}?`}
        description="Are you sure you want to delete this record? This action cannot be undone."
        confirmLabel="Confirm Delete"
        tone="danger"
      />
    </>
  );
}
