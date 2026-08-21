"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Loader2, Trash2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveCompetency, deleteCompetency, saveViolation, updateViolation, deleteViolation, saveDocument, deleteDocument, refreshDocStatuses } from "@/app/(app)/drivers/actions";

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

/* ================================ M12 ================================ */

export function CompetencyForm({ drivers, classes }: { drivers: Opt[]; classes: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone="ghost"><Plus className="h-4 w-4" /> Add Competency</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Clear an Operator for a Machine Class" subtitle="Assignment refuses machine classes a person has no recorded competency for.">
        <form action={(fd) => start(async () => { await saveCompetency(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Person" name="driverId" required options={drivers.map((d) => ({ value: d.id, label: d.label }))} />
          <Sel label="Machine Class" name="assetClass" required options={classes} />
          <Sel label="Level" name="level" required options={[
            { value: "TRAINED", label: "Trained" }, { value: "CERTIFIED", label: "Certified" }, { value: "EXPERT", label: "Expert" },
          ]} />
          <Inp label="Certificate No." name="certNo" />
          <Inp label="Certified On" name="certifiedOn" type="date" />
          <Inp label="Expires On" name="expiresOn" type="date" hint="Blank = does not expire" />
          <Inp label="Issued By" name="issuedBy" placeholder="Training institute" />
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Competency" /></div>
        </form>
      </Modal>
    </>
  );
}

export function ViolationForm({ drivers, assets }: { drivers: Opt[]; assets: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Trigger onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Record Violation</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Record a Safety or Conduct Event" subtitle="Points feed the safety score and decay over a year, so a driver can recover from a bad patch.">
        <form action={(fd) => start(async () => { await saveViolation(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Person" name="driverId" required options={drivers.map((d) => ({ value: d.id, label: d.label }))} />
          <Sel label="Machine" name="assetId" options={[{ value: "", label: "— None —" }, ...assets.map((a) => ({ value: a.id, label: a.label }))]} />
          <Sel label="Type" name="type" required options={[
            { value: "OVERSPEED", label: "Overspeeding" }, { value: "HARSH_BRAKING", label: "Harsh braking" },
            { value: "IDLING", label: "Excessive idling" }, { value: "NO_SEATBELT", label: "No seatbelt" },
            { value: "PHONE_USE", label: "Phone use while driving" }, { value: "ACCIDENT", label: "Accident" },
            { value: "FUEL_MISUSE", label: "Fuel misuse" }, { value: "DOCUMENT", label: "Document violation" }, { value: "OTHER", label: "Other" },
          ]} />
          <Sel label="Severity" name="severity" required options={[
            { value: "MINOR", label: "Minor (2 pts)" }, { value: "MAJOR", label: "Major (6 pts)" }, { value: "CRITICAL", label: "Critical (15 pts)" },
          ]} />
          <Inp label="Points" name="points" type="number" step="1" hint="Blank uses the severity default" />
          <Inp label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Inp label="Penalty ₹" name="penalty" type="number" step="0.01" defaultValue={0} />
          <Sel label="Action Taken" name="actionTaken" options={[
            { value: "", label: "— None yet —" }, { value: "COACHING", label: "Coaching" }, { value: "WARNING", label: "Written warning" },
            { value: "PENALTY", label: "Penalty" }, { value: "SUSPENSION", label: "Suspension" }, { value: "TERMINATION", label: "Termination" },
          ]} />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Description</span>
            <textarea name="description" rows={3} className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Record" /></div>
        </form>
      </Modal>
    </>
  );
}

export function ViolationAction({ v }: { v: { id: string; status: string; actionTaken: string | null; penalty: number } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Action</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Close Out Violation" subtitle="Dismissing a violation removes its points from the safety score.">
        <form action={(fd) => start(async () => { await updateViolation(v.id, fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Status" name="status" required defaultValue={v.status} options={[
            { value: "OPEN", label: "Open" }, { value: "ACTIONED", label: "Actioned" }, { value: "DISMISSED", label: "Dismissed — not counted" },
          ]} />
          <Sel label="Action Taken" name="actionTaken" defaultValue={v.actionTaken ?? ""} options={[
            { value: "", label: "— None —" }, { value: "COACHING", label: "Coaching" }, { value: "WARNING", label: "Written warning" },
            { value: "PENALTY", label: "Penalty" }, { value: "SUSPENSION", label: "Suspension" }, { value: "TERMINATION", label: "Termination" },
          ]} />
          <Inp label="Penalty ₹" name="penalty" type="number" step="0.01" defaultValue={v.penalty} />
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save" /></div>
        </form>
      </Modal>
    </>
  );
}

/* ================================ M13 ================================ */

export function DocumentForm({ assets, docTypes, preset }: { assets: Opt[]; docTypes: { value: string; label: string }[]; preset?: { assetId: string; docType: string; supersedesId?: string; label?: string } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      {preset ? (
        <button onClick={() => setOpen(true)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
          {preset.label ?? "Add"}
        </button>
      ) : (
        <Trigger onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add Document</Trigger>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={preset?.supersedesId ? "Renew Document" : "Add Compliance Document"} subtitle="Renewals chain to the old record rather than overwriting it, so history stays traceable.">
        <form action={(fd) => start(async () => { await saveDocument(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Machine" name="assetId" required defaultValue={preset?.assetId} options={assets.map((a) => ({ value: a.id, label: a.label }))} />
          <Sel label="Document Type" name="docType" required defaultValue={preset?.docType} options={docTypes} />
          <Inp label="Document Number" name="number" required />
          <Inp label="Issue Date" name="issueDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Inp label="Expiry Date" name="expiryDate" type="date" required />
          <Inp label="Reminder (days before)" name="reminderDays" type="number" step="1" defaultValue={30} />
          <Inp label="Cost ₹" name="cost" type="number" step="0.01" defaultValue={0} hint="Feeds the renewal forecast" />
          <Inp label="Vendor / Issuing Office" name="vendor" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Scan / PDF</span>
            <input name="document" type="file" accept="image/*,application/pdf" className={inputCls} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
            <input name="notes" className={inputCls} />
          </label>
          {preset?.supersedesId && <input type="hidden" name="supersedesId" value={preset.supersedesId} />}
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label={preset?.supersedesId ? "Save Renewal" : "Add Document"} /></div>
        </form>
      </Modal>
    </>
  );
}

export function RefreshStatusButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => start(async () => { const r = await refreshDocStatuses();
 if (isActionError(r)) { setMsg(r.error); return; } setMsg(`${r.changed} updated`); router.refresh(); })} disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh Statuses
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  );
}

import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { isActionError } from "@/lib/action-result";

export function DeleteRow({ id, kind }: { id: string; kind: "competency" | "violation" | "document" }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const labels = {
    competency: "Driver Competency Certification",
    violation: "Safety Violation Record",
    document: "Compliance Document",
  };

  async function handleDelete() {
    if (kind === "competency") await deleteCompetency(id);
    else if (kind === "violation") await deleteViolation(id);
    else await deleteDocument(id);

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
        description="Are you sure you want to delete this record? This cannot be undone."
        confirmLabel="Confirm Delete"
        tone="danger"
      />
    </>
  );
}
