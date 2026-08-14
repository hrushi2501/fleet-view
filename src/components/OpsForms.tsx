"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Loader2, Trash2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  saveSite, deleteSite, saveEquipmentPlan, deleteEquipmentPlan,
  saveAllocation, updateAllocationStatus, deleteAllocation,
  saveMobilization, updateMobilization, deleteMobilization
} from "@/app/(app)/operations/actions";
import { SITE_TYPES, SITE_TYPE_LABEL, TRANSPORT_MODES, TRANSPORT_LABEL } from "@/lib/operations";

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
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 animate-fade-up">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div>
            <h3 className="text-lg font-bold text-ink-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function SubmitBar({ pending, onCancel, label = "Save", err }: { pending: boolean; onCancel: () => void; label?: string; err?: string }) {
  return (
    <div className="mt-5 space-y-3">
      {err && <p className="text-sm font-medium text-rose-600 bg-rose-50 p-2.5 rounded-lg border border-rose-200">{err}</p>}
      <div className="flex justify-end gap-2.5">
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
        <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 shadow-sm">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}{label}
        </button>
      </div>
    </div>
  );
}

function Trigger({ onClick, children, tone = "brand" }: { onClick: () => void; children: ReactNode; tone?: "brand" | "ghost" }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors shadow-xs", tone === "brand" ? "bg-brand-600 text-white hover:bg-brand-700" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50")}>
      {children}
    </button>
  );
}

function LatLng() {
  const [la, setLa] = useState("");
  const [ln, setLn] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="sm:col-span-2">
      <span className="mb-1 block text-xs font-medium text-slate-600">Geofence Centre</span>
      <div className="flex gap-2">
        <input name="lat" value={la} onChange={(e) => setLa(e.target.value)} placeholder="Latitude" className={inputCls} />
        <input name="lng" value={ln} onChange={(e) => setLn(e.target.value)} placeholder="Longitude" className={inputCls} />
        <button
          type="button"
          onClick={() => {
            if (!navigator.geolocation) return;
            setBusy(true);
            navigator.geolocation.getCurrentPosition(
              (p) => { setLa(p.coords.latitude.toFixed(5)); setLn(p.coords.longitude.toFixed(5)); setBusy(false); },
              () => setBusy(false),
              { enableHighAccuracy: true, timeout: 10000 }
            );
          }}
          className="shrink-0 rounded-lg bg-brand-50 px-3 text-xs font-semibold text-brand-700 hover:bg-brand-100"
        >
          {busy ? "…" : "📍 Use current"}
        </button>
      </div>
      <span className="mt-1 block text-[11px] text-slate-400">Stand at the site and press this — the fence is measured from here.</span>
    </div>
  );
}

/* ================================ M4 ================================ */

export function SiteForm({ projects, site }: { projects: Opt[]; site?: { id: string; projectId: string; code: string; name: string; type: string; lat: number; lng: number; radiusM: number; address: string | null } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const router = useRouter();
  const toast = useToast();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr("");
    start(async () => {
      try {
        await saveSite(site?.id ?? null, fd);
        setOpen(false);
        toast.success(site ? `✓ Site ${site.code} updated` : "✓ New site added successfully");
        router.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to save site.";
        setErr(msg);
        toast.error("Site save failed", msg);
      }
    });
  }

  return (
    <>
      <Trigger onClick={() => { setErr(""); setOpen(true); }} tone={site ? "ghost" : "brand"}>
        {!site && <Plus className="h-4 w-4" />}{site ? "Edit" : "Add Site"}
      </Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title={site ? "Edit Site" : "Add Site"} subtitle="The geofence radius is what makes “was the machine actually there?” answerable.">
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Project" name="projectId" required defaultValue={site?.projectId} options={projects.map((p) => ({ value: p.id, label: p.label }))} />
          <Sel label="Type" name="type" required defaultValue={site?.type} options={SITE_TYPES.map((t) => ({ value: t, label: SITE_TYPE_LABEL[t] }))} />
          <Inp label="Site Code" name="code" required defaultValue={site?.code} placeholder="QRY-01" />
          <Inp label="Site Name" name="name" required defaultValue={site?.name} placeholder="Nagaur Quarry" />
          {site ? (
            <>
              <Inp label="Latitude" name="lat" type="number" step="0.00001" defaultValue={site.lat} />
              <Inp label="Longitude" name="lng" type="number" step="0.00001" defaultValue={site.lng} />
            </>
          ) : <LatLng />}
          <Inp label="Fence Radius (m)" name="radiusM" type="number" step="10" defaultValue={site?.radiusM ?? 500} hint="500 m suits a work front; a quarry may need more" />
          <Inp label="Address" name="address" defaultValue={site?.address ?? ""} />
          <div className="sm:col-span-2"><SubmitBar pending={pending} err={err} onCancel={() => setOpen(false)} label={site ? "Save Site" : "Add Site"} /></div>
        </form>
      </Modal>
    </>
  );
}

export function PlanForm({ projects, classes }: { projects: Opt[]; classes: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const router = useRouter();
  const toast = useToast();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr("");
    start(async () => {
      try {
        await saveEquipmentPlan(fd);
        setOpen(false);
        toast.success("✓ Equipment plan saved");
        router.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to save equipment plan.";
        setErr(msg);
        toast.error("Plan save failed", msg);
      }
    });
  }

  return (
    <>
      <Trigger onClick={() => { setErr(""); setOpen(true); }} tone="ghost"><Plus className="h-4 w-4" /> Equipment Plan</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Plan Equipment for a Project" subtitle="What the project says it needs, so plan can be compared with what is actually standing on site.">
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Project" name="projectId" required options={projects.map((p) => ({ value: p.id, label: p.label }))} />
          <Sel label="Machine Class" name="assetClass" required options={classes} />
          <Inp label="Planned Count" name="plannedCount" type="number" step="1" required defaultValue={1} />
          <Inp label="Budget ₹/day each" name="budgetPerDay" type="number" step="0.01" />
          <Inp label="From" name="fromDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Inp label="To" name="toDate" type="date" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
            <input name="notes" className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} err={err} onCancel={() => setOpen(false)} label="Save Plan" /></div>
        </form>
      </Modal>
    </>
  );
}

/* ================================ M11 ================================ */

export function AllocationForm({ assets, projects, sites }: { assets: Opt[]; projects: Opt[]; sites: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const router = useRouter();
  const toast = useToast();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr("");
    start(async () => {
      try {
        await saveAllocation(fd);
        setOpen(false);
        toast.success("✓ Machine allocated to project");
        router.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to allocate machine.";
        setErr(msg);
        toast.error("Allocation failed", msg);
      }
    });
  }

  return (
    <>
      <Trigger onClick={() => { setErr(""); setOpen(true); }}><Plus className="h-4 w-4" /> Allocate Machine</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Allocate a Machine" subtitle="Overlapping allocations of the same machine are flagged — two projects cannot both be billed for it.">
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Machine" name="assetId" required options={assets.map((a) => ({ value: a.id, label: a.label }))} />
          <Sel label="Project" name="projectId" required options={projects.map((p) => ({ value: p.id, label: p.label }))} />
          <Sel label="Site" name="siteId" options={[{ value: "", label: "— Any site —" }, ...sites.map((x) => ({ value: x.id, label: x.label }))]} />
          <Sel label="Status" name="status" required options={[
            { value: "PLANNED", label: "Planned" }, { value: "ACTIVE", label: "Active — machine is there now" },
          ]} hint="Setting Active also moves the asset onto this project." />
          <Inp label="From" name="fromDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Inp label="To" name="toDate" type="date" hint="Blank = open-ended" />
          <Inp label="Rate ₹/day" name="ratePerDay" type="number" step="0.01" />
          <Inp label="Purpose" name="purpose" placeholder="Earthwork Ch. 12+000" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
            <input name="notes" className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} err={err} onCancel={() => setOpen(false)} label="Allocate" /></div>
        </form>
      </Modal>
    </>
  );
}

export function AllocationStatusForm({ alloc }: { alloc: { id: string; status: string; toDate: Date | null } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const router = useRouter();
  const toast = useToast();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr("");
    start(async () => {
      try {
        await updateAllocationStatus(alloc.id, fd);
        setOpen(false);
        toast.success("✓ Allocation status updated");
        router.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to update allocation.";
        setErr(msg);
        toast.error("Update failed", msg);
      }
    });
  }

  return (
    <>
      <button onClick={() => { setErr(""); setOpen(true); }} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Update</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Update Allocation" subtitle="Releasing frees the machine from the project.">
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Status" name="status" required defaultValue={alloc.status} options={[
            { value: "PLANNED", label: "Planned" }, { value: "ACTIVE", label: "Active" },
            { value: "RELEASED", label: "Released" }, { value: "CANCELLED", label: "Cancelled" },
          ]} />
          <Inp label="To Date" name="toDate" type="date" defaultValue={alloc.toDate ? new Date(alloc.toDate).toISOString().slice(0, 10) : ""} />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
            <input name="notes" className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} err={err} onCancel={() => setOpen(false)} label="Save" /></div>
        </form>
      </Modal>
    </>
  );
}

export function MobilizationForm({ assets, projects }: { assets: Opt[]; projects: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const router = useRouter();
  const toast = useToast();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr("");
    start(async () => {
      try {
        await saveMobilization(fd);
        setOpen(false);
        toast.success("✓ Mobilisation order requested");
        router.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to request mobilization.";
        setErr(msg);
        toast.error("Request failed", msg);
      }
    });
  }

  return (
    <>
      <Trigger onClick={() => { setErr(""); setOpen(true); }} tone="ghost"><Plus className="h-4 w-4" /> Mobilisation</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Request a Machine Move" subtitle="Days in transit are days nobody is producing with the machine.">
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Machine" name="assetId" required options={assets.map((a) => ({ value: a.id, label: a.label }))} />
          <Sel label="Transport" name="transportMode" required options={TRANSPORT_MODES.map((m) => ({ value: m, label: TRANSPORT_LABEL[m] }))} />
          <Sel label="From Project" name="fromProjectId" options={[{ value: "", label: "— None —" }, ...projects.map((p) => ({ value: p.id, label: p.label }))]} />
          <Sel label="To Project" name="toProjectId" options={[{ value: "", label: "— None —" }, ...projects.map((p) => ({ value: p.id, label: p.label }))]} />
          <Inp label="Requested Date" name="requestedDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Inp label="Distance (km)" name="distanceKm" type="number" step="1" />
          <Inp label="Transporter" name="transporter" />
          <Inp label="Cost ₹" name="cost" type="number" step="0.01" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
            <input name="notes" className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} err={err} onCancel={() => setOpen(false)} label="Request Move" /></div>
        </form>
      </Modal>
    </>
  );
}

export function MobStatusForm({ order }: { order: { id: string; status: string; cost: number; dispatchDate: Date | null; arrivalDate: Date | null } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const router = useRouter();
  const toast = useToast();
  const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr("");
    start(async () => {
      try {
        await updateMobilization(order.id, fd);
        setOpen(false);
        toast.success("✓ Mobilisation status updated");
        router.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to update mobilization.";
        setErr(msg);
        toast.error("Update failed", msg);
      }
    });
  }

  return (
    <>
      <button onClick={() => { setErr(""); setOpen(true); }} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Update</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Update Mobilisation" subtitle="Marking In Transit sets the machine's status; Arrived moves it onto the destination project.">
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Status" name="status" required defaultValue={order.status} options={[
            { value: "REQUESTED", label: "Requested" }, { value: "APPROVED", label: "Approved" },
            { value: "IN_TRANSIT", label: "In transit" }, { value: "ARRIVED", label: "Arrived" }, { value: "CANCELLED", label: "Cancelled" },
          ]} />
          <Inp label="Cost ₹" name="cost" type="number" step="0.01" defaultValue={order.cost} />
          <Inp label="Dispatch Date" name="dispatchDate" type="date" defaultValue={iso(order.dispatchDate)} />
          <Inp label="Arrival Date" name="arrivalDate" type="date" defaultValue={iso(order.arrivalDate)} />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
            <input name="notes" className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} err={err} onCancel={() => setOpen(false)} label="Save" /></div>
        </form>
      </Modal>
    </>
  );
}

export function DeleteRow({ id, kind }: { id: string; kind: "site" | "plan" | "allocation" | "mobilization" }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function handleDelete() {
    if (kind === "site") await deleteSite(id);
    else if (kind === "plan") await deleteEquipmentPlan(id);
    else if (kind === "allocation") await deleteAllocation(id);
    else await deleteMobilization(id);

    toast.success(`✓ ${kind.charAt(0).toUpperCase() + kind.slice(1)} record deleted`);
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
        title={`Delete ${kind.charAt(0).toUpperCase() + kind.slice(1)}?`}
        description="Are you sure you want to delete this operational record? This cannot be undone."
        confirmLabel="Confirm Delete"
        tone="danger"
      />
    </>
  );
}
