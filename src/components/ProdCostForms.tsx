"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveProduction, deleteProduction, saveProdNorm, seedProdNorms } from "@/app/(app)/production/actions";
import { saveCost, deleteCost, saveRevenue, deleteRevenue, saveDepreciation } from "@/app/(app)/costs/actions";

type Opt = { id: string; label: string };

const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function Inp({ label, name, type = "text", defaultValue, required, step, placeholder, hint }: { label: string; name: string; type?: string; defaultValue?: string | number; required?: boolean; step?: string; placeholder?: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}{required && <span className="text-rose-500"> *</span>}</span>
      <input name={name} type={type} step={step} defaultValue={defaultValue} required={required} placeholder={placeholder} className={inputCls} />
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

function Sel({ label, name, options, defaultValue, required, hint }: { label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string; required?: boolean; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}{required && <span className="text-rose-500"> *</span>}</span>
      <select name={name} defaultValue={defaultValue} required={required} className={inputCls}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

function Modal({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div>
            <h3 className="text-lg font-bold text-ink-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function SubmitBar({ pending, onCancel, label = "Save" }: { pending: boolean; onCancel: () => void; label?: string }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
      <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}{label}
      </button>
    </div>
  );
}

function Trigger({ onClick, children, tone = "brand" }: { onClick: () => void; children: ReactNode; tone?: "brand" | "ghost" }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold", tone === "brand" ? "bg-brand-600 text-white hover:bg-brand-700" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50")}>
      {children}
    </button>
  );
}

const MATERIALS = ["Earth", "GSB", "WMM", "Aggregate", "Sand", "Bitumen", "Debris", "Concrete", "Other"];

/* ------------------------------- production ------------------------------- */

export function ProductionForm({ assets, projects, drivers }: { assets: Opt[]; projects: Opt[]; drivers: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Trigger onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Log Production</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Log a Shift's Output" subtitle="Fill in whichever units apply to the machine — trips for tippers, m³ for excavators, tonnes for crushers.">
        <form action={(fd) => start(async () => { await saveProduction(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Machine" name="assetId" required options={assets.map((a) => ({ value: a.id, label: a.label }))} />
          <Inp label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Sel label="Shift" name="shift" required options={[{ value: "DAY", label: "Day" }, { value: "NIGHT", label: "Night" }]} />
          <Sel label="Project / Site" name="projectId" options={[{ value: "", label: "— Unassigned —" }, ...projects.map((p) => ({ value: p.id, label: p.label }))]} />
          <Sel label="Operator / Driver" name="driverId" options={[{ value: "", label: "— None —" }, ...drivers.map((d) => ({ value: d.id, label: d.label }))]} />
          <Sel label="Material" name="material" options={[{ value: "", label: "— None —" }, ...MATERIALS.map((m) => ({ value: m, label: m }))]} />
          <Inp label="Trips" name="trips" type="number" step="1" defaultValue={0} hint="Tippers, dumpers, mixers" />
          <Inp label="Tonnage (t)" name="tonnage" type="number" step="0.01" defaultValue={0} hint="Weighbridge figure if available" />
          <Inp label="Volume (m³ / BCM)" name="volumeM3" type="number" step="0.01" defaultValue={0} hint="Excavators, graders" />
          <Inp label="Cycles" name="cycles" type="number" step="1" defaultValue={0} hint="Rollers, cranes" />
          <Inp label="Worked Hours" name="workedHours" type="number" step="0.1" defaultValue={0} />
          <Inp label="Idle Hours" name="idleHours" type="number" step="0.1" defaultValue={0} hint="Burns diesel with no output" />
          <Inp label="Distance (km)" name="distanceKm" type="number" step="0.1" defaultValue={0} />
          <Inp label="Lead (km one-way)" name="leadKm" type="number" step="0.1" defaultValue={0} hint="Haul distance — drives expected trips/day" />
          <Sel label="Evidence Source" name="source" required options={[
            { value: "MANUAL", label: "Manual site entry" }, { value: "WEIGHBRIDGE", label: "Weighbridge" },
            { value: "GPS", label: "GPS / telematics" }, { value: "OPERATOR", label: "Operator app" },
          ]} />
          <Inp label="Verified By" name="verifiedBy" placeholder="Site engineer" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Note</span>
            <input name="note" className={inputCls} placeholder="e.g. rain stoppage after 2pm" />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Production" /></div>
        </form>
      </Modal>
    </>
  );
}

export function ProdNormForm({ classes }: { classes: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone="ghost"><Plus className="h-4 w-4" /> Set Target</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Production Target" subtitle="The band a machine class is expected to deliver. Output below the band is flagged.">
        <form action={(fd) => start(async () => { await saveProdNorm(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Asset Class" name="assetClass" required options={classes} />
          <Sel label="Unit" name="unit" required options={[
            { value: "TRIPS_PER_DAY", label: "Trips per day" }, { value: "M3_PER_HOUR", label: "m³ per hour" },
            { value: "TONNES_PER_DAY", label: "Tonnes per day" }, { value: "CYCLES_PER_HOUR", label: "Cycles per hour" },
          ]} />
          <Inp label="Target Low" name="targetLow" type="number" step="0.01" required />
          <Inp label="Target High" name="targetHigh" type="number" step="0.01" required />
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Target" /></div>
        </form>
      </Modal>
    </>
  );
}

export function SeedProdNormsButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button onClick={() => start(async () => { await seedProdNorms(); router.refresh(); })} disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Install Default Targets
    </button>
  );
}

/* ---------------------------------- costs ---------------------------------- */

export function CostForm({ assets, projects }: { assets: Opt[]; projects: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone="ghost"><Plus className="h-4 w-4" /> Add Cost</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a Cost Line" subtitle="For costs not already captured automatically. Fuel, maintenance and hire flow in from their own modules — don't double-enter them.">
        <form action={(fd) => start(async () => { await saveCost(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Cost Head" name="costHead" required options={[
            { value: "TYRE", label: "Tyres" }, { value: "OPERATOR", label: "Operator wages" }, { value: "INSURANCE", label: "Insurance" },
            { value: "EMI", label: "EMI / lease" }, { value: "TOLL", label: "Tolls & permits" }, { value: "OTHER", label: "Other" },
          ]} />
          <Inp label="Amount ₹" name="amount" type="number" step="0.01" required />
          <Sel label="Asset" name="assetId" options={[{ value: "", label: "— Fleet-wide —" }, ...assets.map((a) => ({ value: a.id, label: a.label }))]} />
          <Sel label="Project" name="projectId" options={[{ value: "", label: "— None —" }, ...projects.map((p) => ({ value: p.id, label: p.label }))]} />
          <Inp label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Add Cost" /></div>
        </form>
      </Modal>
    </>
  );
}

export function RevenueForm({ projects }: { projects: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Trigger onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add Revenue</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Record Project Revenue" subtitle="RA bills and advances, so profitability is revenue minus true cost rather than cost alone.">
        <form action={(fd) => start(async () => { await saveRevenue(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Project" name="projectId" required options={projects.map((p) => ({ value: p.id, label: p.label }))} />
          <Sel label="Type" name="billType" required options={[
            { value: "RA_BILL", label: "RA bill" }, { value: "ADVANCE", label: "Advance" },
            { value: "RETENTION_RELEASE", label: "Retention released" }, { value: "OTHER", label: "Other" },
          ]} />
          <Inp label="Amount ₹" name="amount" type="number" step="0.01" required />
          <Inp label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Description<span className="text-rose-500"> *</span></span>
            <input name="description" required className={inputCls} placeholder="RA Bill 04 — earthwork Ch. 12+000 to 18+500" />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Add Revenue" /></div>
        </form>
      </Modal>
    </>
  );
}

export function DepreciationForm({ asset }: { asset: { id: string; code: string; acquisitionCost: number; salvageValue: number; usefulLifeYears: number; depMethod: string; inServiceDate: Date | null } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Set Basis</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Depreciation Basis — ${asset.code}`} subtitle="Drives book value, TCO and the replace-vs-repair call.">
        <form action={(fd) => start(async () => { await saveDepreciation(asset.id, fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Inp label="Acquisition Cost ₹" name="acquisitionCost" type="number" step="0.01" required defaultValue={asset.acquisitionCost} />
          <Inp label="Salvage / Residual Value ₹" name="salvageValue" type="number" step="0.01" defaultValue={asset.salvageValue} />
          <Inp label="Useful Life (years)" name="usefulLifeYears" type="number" step="1" required defaultValue={asset.usefulLifeYears} />
          <Sel label="Method" name="depMethod" required defaultValue={asset.depMethod} options={[
            { value: "SLM", label: "Straight line (SLM)" }, { value: "WDV", label: "Written down value (WDV)" },
          ]} />
          <Inp label="In-Service Date" name="inServiceDate" type="date" defaultValue={asset.inServiceDate ? new Date(asset.inServiceDate).toISOString().slice(0, 10) : ""} hint="Defaults to year of manufacture if blank." />
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Basis" /></div>
        </form>
      </Modal>
    </>
  );
}

import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export function DeleteRow({ id, kind }: { id: string; kind: "production" | "cost" | "revenue" }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const labels = {
    production: "Production Log",
    cost: "Cost Ledger Entry",
    revenue: "Revenue Entry",
  };

  async function handleDelete() {
    if (kind === "production") await deleteProduction(id);
    else if (kind === "cost") await deleteCost(id);
    else await deleteRevenue(id);

    toast.success(`✓ ${labels[kind]} deleted successfully`);
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
