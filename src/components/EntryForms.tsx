"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Pencil, Trash2, Loader2, Camera } from "lucide-react";
import { cn, ASSET_CLASS_LABEL } from "@/lib/utils";
import {
  saveAsset, deleteAsset, saveDriver, deleteDriver, saveFuel,
  saveWorkOrder, updateWorkOrderStatus, saveCompliance, saveProject,
  updateProject, deleteProject,
  saveUser, deleteUser, updateFuel, deleteFuel, setDieselRate,
} from "@/app/(app)/entry-actions";

type Opt = { id: string; label: string };

/* ----------------------------- primitives ----------------------------- */
const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function Inp({ label, name, type = "text", defaultValue, required, step, placeholder }: { label: string; name: string; type?: string; defaultValue?: string | number; required?: boolean; step?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}{required && <span className="text-rose-500"> *</span>}</span>
      <input name={name} type={type} step={step} defaultValue={defaultValue} required={required} placeholder={placeholder} className={inputCls} />
    </label>
  );
}

function Sel({ label, name, options, defaultValue, required }: { label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}{required && <span className="text-rose-500"> *</span>}</span>
      <select name={name} defaultValue={defaultValue} required={required} className={inputCls}>
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
function Modal({ triggerLabel, triggerIcon, triggerClass, title, action, children, onDone }: {
  triggerLabel: ReactNode; triggerIcon?: ReactNode; triggerClass?: string; title: string;
  action: (fd: FormData) => Promise<void>; children: ReactNode; onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const router = useRouter();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr("");
    start(async () => {
      try {
        await action(fd);
        setOpen(false);
        router.refresh();
        onDone?.();
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Could not save. Check the values and try again.");
      }
    });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className={triggerClass ?? "inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-600"}>
        {triggerIcon}{triggerLabel}
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl animate-fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
              <h3 className="text-base font-semibold text-ink-900">{title}</h3>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={submit} className="p-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
              {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                <button disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
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
    >
      <Inp label="Asset Code" name="code" defaultValue={asset?.code} required placeholder="EXC-012" />
      <Inp label="Name / Make-Model" name="name" defaultValue={asset?.name} required placeholder="Caterpillar 320D2" />
      <Sel label="Class" name="assetClass" options={classOpts} defaultValue={asset?.assetClass ?? "DUMPER"} required />
      <Sel label="Category" name="category" options={catOpts} defaultValue={asset?.category ?? "VEHICLE"} />
      <Sel label="Ownership" name="ownershipType" options={ownOpts} defaultValue={asset?.ownershipType ?? "OWNED"} required />
      <Sel label="Status" name="status" options={statusOpts} defaultValue={asset?.status ?? "Active"} />
      <Inp label="Make" name="make" defaultValue={asset?.make} placeholder="Caterpillar" />
      <Inp label="Model" name="model" defaultValue={asset?.model} placeholder="320D2" />
      <Inp label="Year" name="yearMfg" type="number" defaultValue={asset?.yearMfg} />
      <Inp label="Registration No." name="registrationNo" defaultValue={asset?.registrationNo ?? ""} placeholder="MH12 AB 1234" />
      <Sel label="Primary Meter" name="primaryMeter" options={meterOpts} defaultValue={asset?.primaryMeter ?? "ODOMETER"} />
      <Inp label="Meter Reading" name="meterValue" type="number" defaultValue={asset?.meterValue} />
      <Inp label="Fuel Capacity (L)" name="fuelCapacity" type="number" defaultValue={asset?.fuelCapacity} />
      <Inp label="Acquisition Cost (₹)" name="acquisitionCost" type="number" defaultValue={asset?.acquisitionCost} />
      <Inp label="Health Score (0-100)" name="healthScore" type="number" defaultValue={asset?.healthScore ?? 90} />
      <Inp label="Utilization (%)" name="utilization" type="number" defaultValue={asset?.utilization ?? 0} />
      <Inp label="Last Service Date" name="lastServiceDate" type="date" defaultValue={asset?.lastServiceDate?.slice(0, 10)} />
      <Inp label="Next Service Due" name="serviceDueDate" type="date" defaultValue={asset?.serviceDueDate?.slice(0, 10)} />
      <Sel label="Project" name="projectId" options={projOpts} defaultValue={asset?.projectId ?? ""} />
      <LocationField lat={asset?.lat} lng={asset?.lng} />
    </Modal>
  );
}

export function DeleteButton({ kind, id, label }: { kind: "asset" | "driver" | "user"; id: string; label: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  function go() {
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    start(async () => {
      if (kind === "asset") await deleteAsset(id);
      else if (kind === "driver") await deleteDriver(id);
      else await deleteUser(id);
      router.refresh();
      if (kind === "asset") router.push("/fleet");
    });
  }
  return (
    <button onClick={go} disabled={pending} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
    </button>
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
          {file && <p className="mt-1 text-[10px] text-emerald-600">✓ photo selected</p>}
        </div>
      </div>
    </label>
  );
}

export function DieselRateSetter({ current }: { current: number }) {
  const [pending, start] = useTransition();
  const [val, setVal] = useState(String(current));
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  function save() {
    const fd = new FormData(); fd.set("rate", val);
    start(async () => {
      try { await setDieselRate(fd); setSaved(true); router.refresh(); setTimeout(() => setSaved(false), 2500); }
      catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    });
  }
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
      <span className="text-xs font-medium text-slate-500">Diesel rate ₹/L</span>
      <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm font-semibold outline-none focus:border-brand-400" />
      <button onClick={save} disabled={pending} className="rounded-lg bg-brand-500 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-60">Save</button>
      {saved && <span className="text-xs font-medium text-emerald-600">✓</span>}
    </div>
  );
}

export function FuelEntry({ assets, projects, defaultRate = 92.5 }: { assets: Opt[]; projects: Opt[]; defaultRate?: number }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [odo, setOdo] = useState<File | null>(null);
  const [pump, setPump] = useState<File | null>(null);
  const router = useRouter();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr("");
    start(async () => {
      try {
        if (odo) fd.set("odometerPhoto", await compressImage(odo));
        if (pump) fd.set("pumpPhoto", await compressImage(pump));
        await saveFuel(fd);
        setOpen(false); setOdo(null); setPump(null); router.refresh();
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Could not save. Try again.");
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl animate-fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
              <h3 className="text-base font-semibold text-ink-900">Record Fuel Entry</h3>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={submit} className="p-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Type <span className="text-rose-500">*</span></span>
                  <select name="type" defaultValue="ISSUE" required className={sel}><option value="ISSUE">Fuel Issue (to vehicle)</option><option value="RECEIPT">Receipt (into tank)</option></select></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Vehicle <span className="text-rose-500">*</span></span>
                  <select name="assetId" required className={sel}><option value="">— Select your vehicle —</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Project / Site</span>
                  <select name="projectId" className={sel}><option value="">— Select —</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Diesel Quantity (Litres) <span className="text-rose-500">*</span></span>
                  <input name="quantity" type="number" step="0.1" required className={sel} placeholder="e.g. 120" /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Odometer / Hour-meter Reading</span>
                  <input name="meterValue" type="number" className={sel} placeholder="reading shown on dashboard" /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Rate (₹/L)</span>
                  <input name="rate" type="number" step="0.01" defaultValue={defaultRate} className={sel} /></label>
                <PhotoField label="📷 Odometer photo" name="odometerPhoto" file={odo} setFile={setOdo} />
                <PhotoField label="📷 Fuel-pump meter photo" name="pumpPhoto" file={pump} setFile={setPump} />
              </div>
              {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                <button disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />} {pending ? "Uploading…" : "Save Entry"}
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
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const router = useRouter();
  const cls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr("");
    start(async () => {
      try { await updateFuel(txn.id, fd); setOpen(false); router.refresh(); }
      catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); }
    });
  }
  function remove() {
    if (!confirm("Delete this fuel entry? This cannot be undone.")) return;
    start(async () => { await deleteFuel(txn.id); setOpen(false); router.refresh(); });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
        <Pencil className="h-3.5 w-3.5" /> Edit
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl animate-fade-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="text-base font-semibold text-ink-900">Edit Fuel Entry — {txn.label}</h3>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={submit} className="p-6">
              <div className="grid grid-cols-2 gap-4">
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Diesel (Litres)</span><input name="quantity" type="number" step="0.1" defaultValue={txn.quantity} required className={cls} /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Meter Reading</span><input name="meterValue" type="number" defaultValue={txn.meterValue} className={cls} /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Rate (₹/L)</span><input name="rate" type="number" step="0.01" defaultValue={txn.rate} className={cls} /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Date</span><input name="date" type="date" defaultValue={txn.date.slice(0, 10)} className={cls} /></label>
              </div>
              {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}
              <div className="mt-6 flex items-center justify-between">
                <button type="button" onClick={remove} disabled={pending} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50">
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
                    {pending && <Loader2 className="h-4 w-4 animate-spin" />} Save
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* ----------------------------- WORK ORDER ----------------------------- */
export function WorkOrderEntry({ assets }: { assets: Opt[] }) {
  const assetOpts = [{ value: "", label: "— Select asset —" }, ...assets.map((a) => ({ value: a.id, label: a.label }))];
  return (
    <Modal title="Create Work Order" triggerLabel="New Work Order" triggerIcon={<Plus className="h-4 w-4" />} action={saveWorkOrder}>
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
  return (
    <select defaultValue={status} disabled={pending}
      onChange={(e) => start(async () => { await updateWorkOrderStatus(id, e.target.value); router.refresh(); })}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-brand-400">
      {["Open", "In-Progress", "Completed", "Closed"].map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

/* ----------------------------- COMPLIANCE ----------------------------- */
export function ComplianceEntry({ assets }: { assets: Opt[] }) {
  const assetOpts = [{ value: "", label: "— Select asset —" }, ...assets.map((a) => ({ value: a.id, label: a.label }))];
  return (
    <Modal title="Add Compliance Document" triggerLabel="Add Document" triggerIcon={<Plus className="h-4 w-4" />} action={saveCompliance}>
      <Sel label="Asset" name="assetId" options={assetOpts} required />
      <Sel label="Document Type" name="docType" options={["RC", "Insurance", "Fitness", "Permit", "PUC", "RoadTax"].map((v) => ({ value: v, label: v }))} defaultValue="Insurance" required />
      <Inp label="Document Number" name="number" required placeholder="INS-123456" />
      <Inp label="Issue Date" name="issueDate" type="date" />
      <Inp label="Expiry Date" name="expiryDate" type="date" required />
    </Modal>
  );
}

/* ----------------------------- USER / ACCESS ----------------------------- */
export function UserEntry() {
  return (
    <Modal title="Add User Login" triggerLabel="Add User" triggerIcon={<Plus className="h-4 w-4" />} action={saveUser}>
      <Inp label="Full Name" name="name" required placeholder="Driver name" />
      <Inp label="Email (login)" name="email" type="email" required placeholder="driver@mahadev.com" />
      <Sel label="Role" name="role" options={[{ value: "Driver", label: "Truck Driver (fuel entry only)" }, { value: "Admin", label: "Administrator (full access)" }]} defaultValue="Driver" required />
      <Inp label="Password" name="password" required placeholder="set a password" />
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
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const router = useRouter();

  if (!confirm) {
    return (
      <button
        onClick={() => setConfirm(true)}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-xs text-rose-600">Delete {code}?</span>
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            await deleteProject(id);
            setConfirm(false);
            router.refresh();
          })
        }
        className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-3 w-3 animate-spin" />} Confirm
      </button>
      <button onClick={() => setConfirm(false)} className="rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100">
        Cancel
      </button>
    </div>
  );
}

