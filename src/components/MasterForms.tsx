"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveReading, deleteReading, saveAssetMaster, saveLifecycleEvent, saveAttendance, deleteAttendance, savePersonDoc, deletePersonDoc, savePersonMaster } from "@/app/(app)/master/actions";
import { PERSON_DOC_LABEL } from "@/lib/master";

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

/* ================================ M1 ================================ */

export function ReadingForm({ assets }: { assets: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [warn, setWarn] = useState<string | null>(null);
  const router = useRouter();
  return (
    <>
      <Trigger onClick={() => { setWarn(null); setOpen(true); }}><Plus className="h-4 w-4" /> Record Reading</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Record Meter Reading" subtitle="A rollback or impossible jump is saved and flagged, not refused — refusing outright just teaches people to fudge the number.">
        <form
          action={(fd) => start(async () => {
            const r = await saveReading(fd);
            if (isActionError(r)) {  return; }
            router.refresh();
            if (r.ok) { setOpen(false); setWarn(null); } else setWarn(r.message ?? "Reading flagged.");
          })}
          className="grid gap-4 sm:grid-cols-2"
        >
          {warn && (
            <div className="sm:col-span-2 flex items-start gap-2 rounded-lg bg-amber-50 p-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-800">{warn} <span className="block mt-1 text-amber-700">Saved and flagged for review.</span></p>
            </div>
          )}
          <Sel label="Asset" name="assetId" required options={assets.map((a) => ({ value: a.id, label: a.label }))} />
          <Sel label="Meter" name="meterType" required options={[{ value: "ODOMETER", label: "Odometer (km)" }, { value: "HOURS", label: "Hour-meter (engine hours)" }]} hint="A backhoe has both — record each separately." />
          <Inp label="Reading" name="value" type="number" step="0.1" required />
          <Inp label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Sel label="Source" name="source" required options={[
            { value: "MANUAL", label: "Manual entry" }, { value: "SERVICE", label: "Workshop / service" },
            { value: "FUEL", label: "Fuel entry" }, { value: "GPS", label: "GPS / telematics" }, { value: "PRODUCTION", label: "Production log" },
          ]} />
          <Inp label="Recorded By" name="recordedBy" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Note</span>
            <input name="note" className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Reading" /></div>
        </form>
      </Modal>
    </>
  );
}

export function AssetMasterForm({ asset }: { asset: { id: string; code: string; chassisNo: string | null; engineNo: string | null; insuredValue: number; hourMeterValue: number; commissionedOn: Date | null } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Complete</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Master Data — ${asset.code}`} subtitle="Fields the original asset form never captured. Every downstream number is only as good as this record.">
        <form action={(fd) => start(async () => { await saveAssetMaster(asset.id, fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Inp label="Chassis Number" name="chassisNo" defaultValue={asset.chassisNo ?? ""} hint="The identity that survives a re-registration" />
          <Inp label="Engine Number" name="engineNo" defaultValue={asset.engineNo ?? ""} />
          <Inp label="Insured Value ₹" name="insuredValue" type="number" step="0.01" defaultValue={asset.insuredValue} />
          <Inp label="Hour-Meter Reading" name="hourMeterValue" type="number" step="0.1" defaultValue={asset.hourMeterValue} hint="For machines that carry both meters" />
          <Inp label="Commissioned On" name="commissionedOn" type="date" defaultValue={asset.commissionedOn ? new Date(asset.commissionedOn).toISOString().slice(0, 10) : ""} />
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Master Data" /></div>
        </form>
      </Modal>
    </>
  );
}

export function LifecycleForm({ assets }: { assets: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone="ghost"><Plus className="h-4 w-4" /> Lifecycle Event</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Record Lifecycle Event" subtitle="Commissioning, transfers and disposal — the asset's own history. Decommissioning also updates its status.">
        <form action={(fd) => start(async () => { await saveLifecycleEvent(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Asset" name="assetId" required options={assets.map((a) => ({ value: a.id, label: a.label }))} />
          <Sel label="Event" name="kind" required options={[
            { value: "COMMISSIONED", label: "Commissioned" }, { value: "TRANSFERRED", label: "Transferred" },
            { value: "STATUS_CHANGE", label: "Status change" }, { value: "OFF_HIRED", label: "Off-hired" },
            { value: "DECOMMISSIONED", label: "Decommissioned" }, { value: "DISPOSED", label: "Disposed / sold" },
          ]} />
          <Inp label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Inp label="Amount ₹" name="amount" type="number" step="0.01" hint="Disposal proceeds or transfer cost" />
          <Inp label="From" name="fromValue" placeholder="Previous site / status" />
          <Inp label="To" name="toValue" placeholder="New site / status" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Note</span>
            <input name="note" className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Record Event" /></div>
        </form>
      </Modal>
    </>
  );
}

/* ================================ M2 ================================ */

export function AttendanceForm({ drivers, projects }: { drivers: Opt[]; projects: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Trigger onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Mark Attendance</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Mark Attendance" subtitle="Re-entering a date and shift corrects it rather than duplicating.">
        <form action={(fd) => start(async () => { await saveAttendance(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Person" name="driverId" required options={drivers.map((d) => ({ value: d.id, label: d.label }))} />
          <Inp label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Sel label="Status" name="status" required options={[
            { value: "PRESENT", label: "Present" }, { value: "HALF_DAY", label: "Half day" }, { value: "ABSENT", label: "Absent" },
            { value: "LEAVE", label: "Leave" }, { value: "REST", label: "Rest day — not counted" },
          ]} />
          <Sel label="Shift" name="shift" required options={[{ value: "DAY", label: "Day" }, { value: "NIGHT", label: "Night" }]} />
          <Inp label="Hours" name="hours" type="number" step="0.5" defaultValue={8} />
          <Sel label="Project" name="projectId" options={[{ value: "", label: "— None —" }, ...projects.map((p) => ({ value: p.id, label: p.label }))]} />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Note</span>
            <input name="note" className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save" /></div>
        </form>
      </Modal>
    </>
  );
}

export function PersonDocForm({ drivers }: { drivers: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone="ghost"><Plus className="h-4 w-4" /> Add Document</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Add Personal Document" subtitle="Licence, Aadhaar and medical fitness are expected for everyone — missing ones are reported.">
        <form action={(fd) => start(async () => { await savePersonDoc(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Person" name="driverId" required options={drivers.map((d) => ({ value: d.id, label: d.label }))} />
          <Sel label="Document" name="docType" required options={Object.entries(PERSON_DOC_LABEL).map(([value, label]) => ({ value, label }))} />
          <Inp label="Number" name="number" />
          <Inp label="Issue Date" name="issueDate" type="date" />
          <Inp label="Expiry Date" name="expiryDate" type="date" hint="Blank for documents that don't expire" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Scan / PDF</span>
            <input name="document" type="file" accept="image/*,application/pdf" className={inputCls} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
            <input name="notes" className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Add Document" /></div>
        </form>
      </Modal>
    </>
  );
}

export function PersonMasterForm({ person }: { person: { id: string; name: string; employmentType: string; contractorName: string | null; joinDate: Date | null; bloodGroup: string | null; emergencyContact: string | null } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Complete</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Master Data — ${person.name}`} subtitle="Employment and emergency details.">
        <form action={(fd) => start(async () => { await savePersonMaster(person.id, fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Employment Type" name="employmentType" required defaultValue={person.employmentType} options={[
            { value: "OWN", label: "Own employee" }, { value: "CONTRACTOR", label: "Contractor supplied" },
          ]} />
          <Inp label="Contractor Name" name="contractorName" defaultValue={person.contractorName ?? ""} hint="If contractor-supplied" />
          <Inp label="Join Date" name="joinDate" type="date" defaultValue={person.joinDate ? new Date(person.joinDate).toISOString().slice(0, 10) : ""} />
          <Inp label="Blood Group" name="bloodGroup" defaultValue={person.bloodGroup ?? ""} placeholder="O+" />
          <Inp label="Emergency Contact" name="emergencyContact" defaultValue={person.emergencyContact ?? ""} placeholder="Name and phone" />
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save" /></div>
        </form>
      </Modal>
    </>
  );
}

import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { isActionError } from "@/lib/action-result";

export function DeleteRow({ id, kind }: { id: string; kind: "reading" | "attendance" | "persondoc" }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const labels = {
    reading: "Meter Reading Log",
    attendance: "Daily Attendance Mark",
    persondoc: "Person Document Record",
  };

  async function handleDelete() {
    if (kind === "reading") await deleteReading(id);
    else if (kind === "attendance") await deleteAttendance(id);
    else await deletePersonDoc(id);

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
        description="Are you sure you want to delete this master record? This action cannot be undone."
        confirmLabel="Confirm Delete"
        tone="danger"
      />
    </>
  );
}
