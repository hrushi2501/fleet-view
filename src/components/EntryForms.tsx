"use client";

import { useState, useTransition, ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Pencil, Trash2, Loader2, Camera, Calculator, RotateCcw } from "lucide-react";
import { cn, ASSET_CLASS_LABEL, inr } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  saveAsset, deleteAsset, saveDriver, deleteDriver, saveFuel,
  saveWorkOrder, updateWorkOrderStatus, saveCompliance, renewComplianceDoc, saveProject,
  updateProject, deleteProject,
  saveUser, deleteUser, updateFuel, deleteFuel, setDieselRate,
} from "@/app/(app)/entry-actions";

type Opt = { id: string; label: string };

/* ----------------------------- primitives ----------------------------- */
const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function Inp({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  step,
  placeholder,
  onChange,
  value,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number;
  required?: boolean;
  step?: string;
  placeholder?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  value?: string | number;
}) {
  const [error, setError] = useState<string | null>(null);

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const val = e.target.value.trim();
    if (!val && required) {
      setError("This field is required.");
      return;
    }
    if (!val) {
      setError(null);
      return;
    }

    if (name === "phone") {
      if (!/^(?:\+91|91|0)?[6-9]\d{9}$/.test(val)) {
        setError("Must be a valid 10-digit Indian mobile number.");
        return;
      }
    } else if (type === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        setError("Must be a valid email address.");
        return;
      }
    } else if (name === "licenseNo") {
      if (!/^[A-Za-z]{2}\d{2}\s?\d{11}$/.test(val)) {
        setError("Format: State (2) + RTO (2) + Year (4) + Serial (7), e.g. RJ14 20241234567.");
        return;
      }
    }
    setError(null);
  };

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
        value={value}
        onChange={onChange}
        onBlur={handleBlur}
        required={required}
        placeholder={placeholder}
        className={cn(
          inputCls,
          error ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : ""
        )}
      />
      {error && <p className="mt-1 text-[11px] font-medium text-rose-600 animate-fade-in">{error}</p>}
    </label>
  );
}

function Sel({ label, name, options, defaultValue, required, onChange, value }: {
  label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string; required?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void; value?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}{required && <span className="text-rose-500"> *</span>}</span>
      <select name={name} defaultValue={defaultValue} value={value} onChange={onChange} required={required} className={inputCls}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function LocationField({ lat, lng }: { lat?: number | null; lng?: number | null }) {
  const [la, setLa] = useState(lat != null && lat !== 0 ? String(lat) : "");
  const [ln, setLn] = useState(lng != null && lng !== 0 ? String(lng) : "");
  const [busy, setBusy] = useState(false);
  function useCurrent() {
    if (!navigator.geolocation) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLa(p.coords.latitude.toFixed(5)); setLn(p.coords.longitude.toFixed(5)); setBusy(false); },
      () => setBusy(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }
  return (
    <div className="sm:col-span-2">
      <span className="mb-1 block text-xs font-medium text-slate-600">GPS Location (for live map)</span>
      <div className="flex gap-2">
        <input name="lat" value={la} onChange={(e) => setLa(e.target.value)} placeholder="Latitude" className={inputCls} />
        <input name="lng" value={ln} onChange={(e) => setLn(e.target.value)} placeholder="Longitude" className={inputCls} />
        <button type="button" onClick={useCurrent} className="shrink-0 rounded-lg bg-brand-50 px-3 text-xs font-semibold text-brand-700 hover:bg-brand-100">
          {busy ? "…" : "📍 Use current"}
        </button>
      </div>
    </div>
  );
}

function Check({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 pt-5 text-sm text-slate-600">
      <input name={name} type="checkbox" defaultChecked={defaultChecked} className="h-4 w-4 rounded border-slate-300" /> {label}
    </label>
  );
}

/* ----------------------------- modal shell ----------------------------- */
function Modal({ triggerLabel, triggerIcon, triggerClass, title, action, successMessage, children, onDone }: {
  triggerLabel: ReactNode; triggerIcon?: ReactNode; triggerClass?: string; title: string;
  action: (fd: FormData) => Promise<void>; successMessage?: string; children: ReactNode; onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const router = useRouter();
  const toast = useToast();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr("");
    start(async () => {
      try {
        await action(fd);
        setOpen(false);
        toast.success(successMessage || `${title} saved successfully`);
        router.refresh();
        onDone?.();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not save. Check the values and try again.";
        setErr(msg);
        toast.error("Save failed", msg);
      }
    });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className={triggerClass ?? "inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600"}>
        {triggerIcon}{triggerLabel}
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl animate-fade-up ring-1 ring-black/5" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur-sm">
              <h3 className="text-base font-bold text-ink-900">{title}</h3>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={submit} className="p-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
              {err && <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-sm font-medium text-rose-600 border border-rose-200">{err}</p>}
              <div className="mt-6 flex justify-end gap-2.5">
                <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                <button disabled={pending} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 shadow-sm">
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />} Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

const classOpts = Object.entries(ASSET_CLASS_LABEL).map(([value, label]) => ({ value, label }));
const ownOpts = ["OWNED", "LEASED", "HIRED", "CONTRACTOR"].map((v) => ({ value: v, label: v }));
const statusOpts = ["Active", "Idle", "Under-Maintenance", "In-Transit", "Breakdown", "Off-hired"].map((v) => ({ value: v, label: v }));
const meterOpts = [{ value: "ODOMETER", label: "Odometer (km)" }, { value: "SMU", label: "Engine Hours (SMU)" }];
const catOpts = [{ value: "VEHICLE", label: "Vehicle" }, { value: "EQUIPMENT", label: "Equipment" }];

/* ----------------------------- ASSET ----------------------------- */
type AssetData = { id: string; code: string; name: string; assetClass: string; category: string; ownershipType: string; make: string; model: string; yearMfg: number; primaryMeter: string; meterValue: number; fuelCapacity: number; status: string; registrationNo: string | null; acquisitionCost: number; healthScore: number; utilization: number; projectId: string | null; serviceDueDate?: string | null; lastServiceDate?: string | null; lat?: number | null; lng?: number | null };

export function AssetEntry({ projects, asset }: { projects: Opt[]; asset?: AssetData }) {
  const projOpts = [{ value: "", label: "— None —" }, ...projects.map((p) => ({ value: p.id, label: p.label }))];
  const edit = !!asset;
  return (
    <Modal
      title={edit ? `Edit Asset — ${asset!.code}` : "Add New Asset"}
      triggerLabel={edit ? "Edit" : "Add Asset"}
      triggerIcon={edit ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-4 w-4" />}
      triggerClass={edit ? "inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50" : undefined}
      action={(fd) => saveAsset(asset?.id ?? null, fd)}
      successMessage={edit ? `✓ Asset ${asset!.code} updated` : "✓ New asset created successfully"}
    >
      <Inp label="Asset Code" name="code" defaultValue={asset?.code} required placeholder="EXC-012" />
      <Inp label="Name / Make-Model" name="name" defaultValue={asset?.name} required placeholder="Caterpillar 320D2" />
      <Sel label="Class" name="assetClass" options={classOpts} defaultValue={asset?.assetClass ?? "DUMPER"} required />
      <Sel label="Status" name="status" options={statusOpts} defaultValue={asset?.status ?? "Active"} />
      <Sel label="Project" name="projectId" options={projOpts} defaultValue={asset?.projectId ?? ""} />
      <Inp label="Registration No." name="registrationNo" defaultValue={asset?.registrationNo ?? ""} placeholder="MH12 AB 1234" />

      {/* Collapsible Progressive Disclosure for Specifications & Financials */}
      <details className="col-span-full mt-1 rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5 group">
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold text-brand-700 select-none">
          <span>▼ Additional Technical Details, Meter &amp; GPS (Optional)</span>
          <span className="text-[11px] font-normal text-slate-400">Click to expand</span>
        </summary>
        <div className="mt-3 grid gap-3 border-t border-slate-200/80 pt-3 sm:grid-cols-2">
          <Sel label="Ownership" name="ownershipType" options={ownOpts} defaultValue={asset?.ownershipType ?? "OWNED"} required />
          <Sel label="Category" name="category" options={catOpts} defaultValue={asset?.category ?? "VEHICLE"} />
          <Inp label="Make" name="make" defaultValue={asset?.make} placeholder="Caterpillar" />
          <Inp label="Model" name="model" defaultValue={asset?.model} placeholder="320D2" />
          <Inp label="Manufacturing Year" name="yearMfg" type="number" defaultValue={asset?.yearMfg} />
          <Sel label="Primary Meter" name="primaryMeter" options={meterOpts} defaultValue={asset?.primaryMeter ?? "ODOMETER"} />
          <Inp label="Initial Meter Reading" name="meterValue" type="number" defaultValue={asset?.meterValue} />
          <Inp label="Fuel Tank Capacity (L)" name="fuelCapacity" type="number" defaultValue={asset?.fuelCapacity} />
          <Inp label="Acquisition Cost (₹)" name="acquisitionCost" type="number" defaultValue={asset?.acquisitionCost} />
          <Inp label="Health Score (0-100)" name="healthScore" type="number" defaultValue={asset?.healthScore ?? 90} />
          <Inp label="Utilization (%)" name="utilization" type="number" defaultValue={asset?.utilization ?? 0} />
          <Inp label="Last Service Date" name="lastServiceDate" type="date" defaultValue={asset?.lastServiceDate?.slice(0, 10)} />
          <Inp label="Next Service Due" name="serviceDueDate" type="date" defaultValue={asset?.serviceDueDate?.slice(0, 10)} />
          <div className="col-span-full">
            <LocationField lat={asset?.lat} lng={asset?.lng} />
          </div>
        </div>
      </details>
    </Modal>
  );
}

export function DeleteButton({ kind, id, label }: { kind: "asset" | "driver" | "user"; id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function handleDelete() {
    if (kind === "asset") await deleteAsset(id);
    else if (kind === "driver") await deleteDriver(id);
    else await deleteUser(id);
    
    toast.success(`✓ ${label} deleted successfully`);
    router.refresh();
    if (kind === "asset") router.push("/fleet");
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>

      <ConfirmDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfirm={handleDelete}
        title={`Delete ${label}?`}
        description={
          kind === "asset"
            ? "This will remove the vehicle and its active records. Historical audit trail will be maintained."
            : `Are you sure you want to permanently delete this ${kind}? This action cannot be undone.`
        }
        confirmLabel="Confirm Delete"
        tone="danger"
        requireTextMatch={kind === "asset" ? label : undefined}
      />
    </>
  );
}

/* ----------------------------- DRIVER ----------------------------- */
type DriverData = { id: string; empCode: string; name: string; phone: string; type: string; licenseNo: string; licenseExpiry: string; certifications: string; safetyScore: number; performanceScore: number; attendance: number; status: string };

export function DriverEntry({ driver }: { driver?: DriverData }) {
  const edit = !!driver;
  return (
    <Modal
      title={edit ? `Edit — ${driver!.name}` : "Add Driver / Operator"}
      triggerLabel={edit ? "Edit" : "Add Driver / Operator"}
      triggerIcon={edit ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-4 w-4" />}
      triggerClass={edit ? "inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50" : undefined}
      action={(fd) => saveDriver(driver?.id ?? null, fd)}
      successMessage={edit ? `✓ Driver ${driver!.name} updated` : "✓ Driver added successfully"}
    >
      <Inp label="Emp Code" name="empCode" defaultValue={driver?.empCode} required placeholder="EMP-1031" />
      <Inp label="Name" name="name" defaultValue={driver?.name} required />
      <Inp label="Phone" name="phone" defaultValue={driver?.phone} placeholder="9XXXXXXXXX" />
      <Sel label="Type" name="type" options={[{ value: "DRIVER", label: "Driver" }, { value: "OPERATOR", label: "Operator" }]} defaultValue={driver?.type ?? "DRIVER"} />
      <Inp label="License No." name="licenseNo" defaultValue={driver?.licenseNo} placeholder="MH12 20191234567" />
      <Inp label="License Expiry" name="licenseExpiry" type="date" defaultValue={driver?.licenseExpiry?.slice(0, 10)} required />
      <Inp label="Certifications" name="certifications" defaultValue={driver?.certifications} placeholder="Excavator L3 / HMV" />
      <Sel label="Status" name="status" options={[{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }]} defaultValue={driver?.status ?? "Active"} />
      <Inp label="Safety Score" name="safetyScore" type="number" defaultValue={driver?.safetyScore ?? 80} />
      <Inp label="Performance Score" name="performanceScore" type="number" defaultValue={driver?.performanceScore ?? 80} />
      <Inp label="Attendance (%)" name="attendance" type="number" defaultValue={driver?.attendance ?? 95} />
      {!edit && (
        <div className="col-span-full mt-2 rounded-xl border border-brand-100 bg-brand-50/50 p-3.5 space-y-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-brand-900 cursor-pointer">
            <input
              type="checkbox"
              name="createLogin"
              value="true"
              defaultChecked={true}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span>📲 Auto-create Driver App login account</span>
          </label>
          <div className="grid gap-2 sm:grid-cols-2 text-xs">
            <Inp label="Login Email" name="loginEmail" type="email" placeholder="emp-code@mahadev.com" />
            <Inp label="Initial Password" name="loginPassword" defaultValue="driver123" />
          </div>
          <p className="text-[11px] text-slate-500">
            Automatically connects this person record to the login account so vehicle check-ins and trips work on day 1.
          </p>
        </div>
      )}
    </Modal>
  );
}

/* ----------------------------- FUEL (with photo capture) ----------------------------- */
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = document.createElement("img");
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = url; });
    const max = 1024;
    let { width, height } = img;
    if (width > max || height > max) { const r = Math.min(max / width, max / height); width = Math.round(width * r); height = Math.round(height * r); }
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.55)!);
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { return file; } finally { URL.revokeObjectURL(url); }
}

function PhotoField({ label, name, file, setFile }: { label: string; name: string; file: File | null; setFile: (f: File | null) => void }) {
  const preview = file ? URL.createObjectURL(file) : null;
  return (
    <label className="block sm:col-span-1">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50">
          {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <Camera className="h-6 w-6 text-slate-400" />}
        </div>
        <div className="flex-1">
          <input
            name={name} type="file" accept="image/*" capture="environment"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-slate-500 file:mr-2 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-700"
          />
          {file && <p className="mt-1 text-[10px] text-emerald-600 font-medium">✓ photo selected</p>}
        </div>
      </div>
    </label>
  );
}

export function DieselRateSetter({ current }: { current: number }) {
  const [pending, start] = useTransition();
  const [val, setVal] = useState(String(current));
  const router = useRouter();
  const toast = useToast();

  function save() {
    const fd = new FormData(); fd.set("rate", val);
    start(async () => {
      try {
        await setDieselRate(fd);
        toast.success(`✓ Company diesel rate updated to ₹${val}/L`);
        router.refresh();
      } catch (e) {
        toast.error("Failed to update rate", e instanceof Error ? e.message : "Error");
      }
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-xs">
      <span className="text-xs font-medium text-slate-500">Diesel rate ₹/L</span>
      <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm font-semibold outline-none focus:border-brand-400" />
      <button onClick={save} disabled={pending} className="rounded-lg bg-brand-500 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">
        {pending ? "…" : "Save"}
      </button>
    </div>
  );
}

export function FuelEntry({ assets, projects, defaultRate = 92.5 }: { assets: Opt[]; projects: Opt[]; defaultRate?: number }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [odo, setOdo] = useState<File | null>(null);
  const [pump, setPump] = useState<File | null>(null);
  
  // Live calculation state
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState(String(defaultRate));

  const router = useRouter();
  const toast = useToast();

  const totalAmount = (parseFloat(qty) || 0) * (parseFloat(rate) || 0);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr("");
    start(async () => {
      try {
        if (odo) fd.set("odometerPhoto", await compressImage(odo));
        if (pump) fd.set("pumpPhoto", await compressImage(pump));
        await saveFuel(fd);
        setOpen(false); setOdo(null); setPump(null);
        toast.success(`✓ Diesel issue of ${qty} L recorded successfully`, `Total: ${inr(totalAmount)}`);
        router.refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not save. Try again.";
        setErr(msg);
        toast.error("Fuel entry failed", msg);
      }
    });
  }

  const sel = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600">
        <Plus className="h-4 w-4" /> Add Fuel Entry
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl animate-fade-up ring-1 ring-black/5" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur-sm">
              <h3 className="text-base font-bold text-ink-900">Record Fuel Entry</h3>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={submit} className="p-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Type <span className="text-rose-500">*</span></span>
                  <select name="type" defaultValue="ISSUE" required className={sel}><option value="ISSUE">Fuel Issue (to vehicle)</option><option value="RECEIPT">Receipt (into tank)</option></select></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Vehicle <span className="text-rose-500">*</span></span>
                  <select name="assetId" required className={sel}><option value="">— Select vehicle —</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Project / Site</span>
                  <select name="projectId" className={sel}><option value="">— Select Project —</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Diesel Quantity (Litres) <span className="text-rose-500">*</span></span>
                  <input
                    name="quantity"
                    type="number"
                    step="0.1"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    required
                    className={sel}
                    placeholder="e.g. 120"
                  /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Odometer / Hour-meter Reading</span>
                  <input name="meterValue" type="number" className={sel} placeholder="e.g. 45230" /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Rate (₹/L)</span>
                  <input
                    name="rate"
                    type="number"
                    step="0.01"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    className={sel}
                  /></label>
                <PhotoField label="📷 Odometer photo" name="odometerPhoto" file={odo} setFile={setOdo} />
                <PhotoField label="📷 Fuel-pump meter photo" name="pumpPhoto" file={pump} setFile={setPump} />
              </div>

              {/* Live calculation banner */}
              {parseFloat(qty) > 0 && (
                <div className="mt-4 flex items-center justify-between rounded-xl bg-brand-50 p-3 ring-1 ring-brand-200">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-brand-600" />
                    <span className="text-xs font-semibold text-brand-900">Total Calculated Cost:</span>
                  </div>
                  <span className="text-sm font-bold text-brand-700">{inr(totalAmount)}</span>
                </div>
              )}

              {err && <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-sm font-medium text-rose-600 border border-rose-200">{err}</p>}
              <div className="mt-6 flex justify-end gap-2.5">
                <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                <button disabled={pending} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 shadow-sm">
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />} {pending ? "Saving…" : "Save Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ----------------------------- FUEL EDIT (admin) ----------------------------- */
export function FuelEdit({ txn }: { txn: { id: string; label: string; quantity: number; meterValue: number; rate: number; date: string } }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [qty, setQty] = useState(String(txn.quantity));
  const [rate, setRate] = useState(String(txn.rate));
  const router = useRouter();
  const toast = useToast();
  const cls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

  const totalAmount = (parseFloat(qty) || 0) * (parseFloat(rate) || 0);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr("");
    start(async () => {
      try {
        await updateFuel(txn.id, fd);
        setOpen(false);
        toast.success("✓ Fuel entry updated");
        router.refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not save.";
        setErr(msg);
        toast.error("Update failed", msg);
      }
    });
  }

  async function remove() {
    await deleteFuel(txn.id);
    setOpen(false);
    toast.success("✓ Fuel entry deleted");
    router.refresh();
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
        <Pencil className="h-3.5 w-3.5" /> Edit
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl animate-fade-up ring-1 ring-black/5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-base font-bold text-ink-900">Edit Fuel Entry — {txn.label}</h3>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={submit} className="p-6">
              <div className="grid grid-cols-2 gap-4">
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Diesel (Litres)</span>
                  <input name="quantity" type="number" step="0.1" value={qty} onChange={(e) => setQty(e.target.value)} required className={cls} /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Meter Reading</span>
                  <input name="meterValue" type="number" defaultValue={txn.meterValue} className={cls} /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Rate (₹/L)</span>
                  <input name="rate" type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={cls} /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Date</span>
                  <input name="date" type="date" defaultValue={txn.date.slice(0, 10)} className={cls} /></label>
              </div>

              {/* Live Calculation */}
              <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <span className="text-xs font-medium text-slate-500">Calculated Total:</span>
                <span className="text-sm font-bold text-ink-900">{inr(totalAmount)}</span>
              </div>

              {err && <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-sm font-medium text-rose-600 border border-rose-200">{err}</p>}
              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                  <button disabled={pending} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 shadow-sm">
                    {pending && <Loader2 className="h-4 w-4 animate-spin" />} Save
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Delete Fuel Entry?"
        description="Are you sure you want to delete this diesel transaction record? This cannot be undone."
        confirmLabel="Delete Transaction"
        tone="danger"
      />
    </>
  );
}

/* ----------------------------- WORK ORDER ----------------------------- */
export function WorkOrderEntry({ assets }: { assets: Opt[] }) {
  const assetOpts = [{ value: "", label: "— Select asset —" }, ...assets.map((a) => ({ value: a.id, label: a.label }))];
  return (
    <Modal
      title="Create Work Order"
      triggerLabel="New Work Order"
      triggerIcon={<Plus className="h-4 w-4" />}
      action={saveWorkOrder}
      successMessage="✓ Work order created successfully"
    >
      <Sel label="Asset" name="assetId" options={assetOpts} required />
      <Sel label="Type" name="type" options={["PM", "BREAKDOWN", "REPAIR"].map((v) => ({ value: v, label: v }))} defaultValue="PM" />
      <Sel label="Priority" name="priority" options={["Low", "Medium", "High", "Critical"].map((v) => ({ value: v, label: v }))} defaultValue="Medium" />
      <Sel label="Status" name="status" options={["Open", "In-Progress", "Completed", "Closed"].map((v) => ({ value: v, label: v }))} defaultValue="Open" />
      <Inp label="Labour Cost (₹)" name="laborCost" type="number" />
      <Inp label="Parts Cost (₹)" name="partsCost" type="number" />
      <Inp label="Downtime (hrs)" name="downtimeHrs" type="number" step="0.5" />
      <Check label="Warranty claim" name="warranty" />
      <div className="sm:col-span-2">
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Description</span>
          <input name="description" required className={inputCls} placeholder="250-hr service — oil & filters" /></label>
      </div>
    </Modal>
  );
}

export function WorkOrderStatus({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <select
      defaultValue={status}
      disabled={pending}
      onChange={(e) => {
        const newStatus = e.target.value;
        start(async () => {
          await updateWorkOrderStatus(id, newStatus);
          toast.success(`✓ Status changed to ${newStatus}`);
          router.refresh();
        });
      }}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium outline-none focus:border-brand-400 shadow-2xs"
    >
      {["Open", "In-Progress", "Completed", "Closed"].map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

/* ----------------------------- COMPLIANCE ----------------------------- */
export function ComplianceEntry({ assets }: { assets: Opt[] }) {
  const assetOpts = [{ value: "", label: "— Select asset —" }, ...assets.map((a) => ({ value: a.id, label: a.label }))];
  return (
    <Modal
      title="Add Compliance Document"
      triggerLabel="Add Document"
      triggerIcon={<Plus className="h-4 w-4" />}
      action={saveCompliance}
      successMessage="✓ Compliance document saved"
    >
      <Sel label="Asset" name="assetId" options={assetOpts} required />
      <Sel label="Document Type" name="docType" options={["RC", "Insurance", "Fitness", "Permit", "PUC", "RoadTax"].map((v) => ({ value: v, label: v }))} defaultValue="Insurance" required />
      <Inp label="Document Number" name="number" required placeholder="INS-123456" />
      <Inp label="Issue Date" name="issueDate" type="date" />
      <Inp label="Expiry Date" name="expiryDate" type="date" required />
    </Modal>
  );
}

export function DocumentRenewModal({
  doc,
}: {
  doc: {
    id: string;
    assetId: string;
    assetCode: string;
    docType: string;
    number: string;
    expiryDate: Date | string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const toast = useToast();
  const router = useRouter();

  // Compute default +1 year renewal date (or +6 months for PUC)
  const baseDate = doc.expiryDate ? new Date(doc.expiryDate) : new Date();
  const nextExpiry = new Date(baseDate);
  if (doc.docType === "PUC") {
    nextExpiry.setMonth(nextExpiry.getMonth() + 6);
  } else {
    nextExpiry.setFullYear(nextExpiry.getFullYear() + 1);
  }
  const defaultNextExpiryStr = nextExpiry.toISOString().slice(0, 10);
  const defaultIssueDateStr = new Date().toISOString().slice(0, 10);

  const [issueDate, setIssueDate] = useState(defaultIssueDateStr);
  const [expiryDate, setExpiryDate] = useState(defaultNextExpiryStr);
  const [docNumber, setDocNumber] = useState(doc.number || "");

  const handleRenew = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("assetId", doc.assetId);
    fd.set("docType", doc.docType);
    fd.set("number", docNumber);
    fd.set("issueDate", issueDate);
    fd.set("expiryDate", expiryDate);

    start(async () => {
      try {
        await saveCompliance(fd);
        setOpen(false);
        toast.success(`✓ ${doc.docType} for ${doc.assetCode} renewed until ${expiryDate}`);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Renewal failed");
        toast.error("Renewal failed", e instanceof Error ? e.message : "Error");
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100 transition-colors"
      >
        <RotateCcw className="h-3 w-3" /> Quick Renew
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white shadow-2xl animate-fade-up ring-1 ring-black/5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <RotateCcw className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink-900">
                    Renew {doc.docType} — {doc.assetCode}
                  </h3>
                  <p className="text-xs text-slate-500">1-click renewal with auto-computed dates</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleRenew} className="p-6 space-y-4">
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs text-slate-600">
                <p className="font-semibold text-ink-900">Machine: {doc.assetCode}</p>
                <p>Document: {doc.docType}</p>
                <p className="text-slate-400">Previous Ref: {doc.number}</p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  New Certificate / Policy Number *
                </label>
                <input
                  required
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  placeholder="e.g. POL-2026-98765"
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Issue Date
                  </label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    New Expiry Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Quick presets */}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[11px] font-medium text-slate-400">Presets:</span>
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date(issueDate || Date.now());
                    d.setFullYear(d.getFullYear() + 1);
                    setExpiryDate(d.toISOString().slice(0, 10));
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  +1 Year
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date(issueDate || Date.now());
                    d.setMonth(d.getMonth() + 6);
                    setExpiryDate(d.toISOString().slice(0, 10));
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  +6 Months
                </button>
              </div>

              {err && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs font-medium text-rose-600">
                  {err}
                </p>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-60"
                >
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {pending ? "Renewing…" : "Save Renewal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ----------------------------- USER / ACCESS ----------------------------- */
export function UserEntry() {
  return (
    <Modal
      title="Add User Login"
      triggerLabel="Add User"
      triggerIcon={<Plus className="h-4 w-4" />}
      action={saveUser}
      successMessage="✓ User login created successfully"
    >
      <Inp label="Full Name" name="name" required placeholder="Driver or staff name" />
      <Inp label="Email (login)" name="email" type="email" required placeholder="name@mahadev.com" />
      <Sel
        label="Role"
        name="role"
        options={[
          { value: "Driver", label: "Truck Driver (mobile portal only)" },
          { value: "Admin", label: "Administrator (full access)" },
          { value: "FleetManager", label: "Fleet Manager" },
          { value: "SiteManager", label: "Site Manager" },
          { value: "Workshop", label: "Workshop Manager" },
          { value: "Finance", label: "Finance Controller" },
        ]}
        defaultValue="Driver"
        required
      />
      <Inp label="Password" name="password" required placeholder="set a strong password" />
      <div className="col-span-full rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 text-xs">
        <p className="font-semibold text-slate-700">Driver Person Profile Linking</p>
        <p className="text-[11px] text-slate-500">
          When adding a Driver role, a matching person record will automatically be linked so vehicle assignments and trips work immediately.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Inp label="Employee Code (optional)" name="empCode" placeholder="DRV-XXXX (auto if blank)" />
          <Inp label="Mobile Phone (optional)" name="phone" placeholder="9XXXXXXXXX" />
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------- PROJECT ----------------------------- */
type ProjectData = {
  id: string; code: string; name: string; location: string; client: string;
  budget: number; spent: number; lat: number; lng: number; status: string;
};

const projectStatusOpts = [
  { value: "Active", label: "Active" },
  { value: "On-Hold", label: "On Hold" },
  { value: "Completed", label: "Completed" },
  { value: "Closed", label: "Closed" },
];

export function ProjectEntry({ project }: { project?: ProjectData } = {}) {
  const edit = !!project;
  const action = edit ? (fd: FormData) => updateProject(project!.id, fd) : saveProject;

  return (
    <Modal
      title={edit ? `Edit Project — ${project!.code}` : "Add New Project"}
      triggerLabel={edit ? "Edit" : "Add Project"}
      triggerIcon={edit ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-4 w-4" />}
      triggerClass={edit
        ? "inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
        : undefined}
      action={action}
      successMessage={edit ? `✓ Project ${project!.code} updated` : "✓ Project created successfully"}
    >
      <Inp label="Project Code" name="code" required placeholder="NH48-PUN" defaultValue={project?.code} />
      <Inp label="Name" name="name" required defaultValue={project?.name} />
      <Inp label="Location" name="location" placeholder="Pune, Maharashtra" defaultValue={project?.location} />
      <Inp label="Client" name="client" placeholder="NHAI" defaultValue={project?.client} />
      <Sel label="Status" name="status" options={projectStatusOpts} defaultValue={project?.status ?? "Active"} />
      <Inp label="Budget (₹)" name="budget" type="number" defaultValue={project?.budget} />
      <Inp label="Spent (₹)" name="spent" type="number" defaultValue={project?.spent} />
      <Inp label="Latitude" name="lat" type="number" step="0.0001" defaultValue={project?.lat ?? 20.5} />
      <Inp label="Longitude" name="lng" type="number" step="0.0001" defaultValue={project?.lng ?? 78.9} />
    </Modal>
  );
}

export function ProjectDeleteButton({ id, code }: { id: string; code: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function handleDelete() {
    await deleteProject(id);
    toast.success(`✓ Project ${code} deleted successfully`);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50 transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>

      <ConfirmDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfirm={handleDelete}
        title={`Delete Project ${code}?`}
        description="This will delete the project. Make sure all assets, sites and transactions are reassigned."
        confirmLabel="Confirm Delete"
        tone="danger"
        requireTextMatch={code}
      />
    </>
  );
}

