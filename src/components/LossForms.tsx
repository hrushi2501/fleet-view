"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Loader2, RadarIcon, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { runScan, seedRules, updateRule, createCase, updateCase, addNote, addEvidence, addRecovery, deleteCase } from "@/app/(app)/loss-prevention/actions";

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

const DOMAINS = [
  { value: "FUEL", label: "Fuel" }, { value: "HIRE", label: "Hire / vendor" }, { value: "MAINTENANCE", label: "Maintenance" },
  { value: "METER", label: "Meter tampering" }, { value: "COMPLIANCE", label: "Compliance" }, { value: "TRIP", label: "Trips" },
];
const SEVERITIES = [{ value: "HIGH", label: "High" }, { value: "MEDIUM", label: "Medium" }, { value: "LOW", label: "Low" }];
const STATUSES = [
  { value: "OPEN", label: "Open" },
  { value: "INVESTIGATING", label: "Investigating" },
  { value: "PENDING_APPROVAL", label: "Pending approval" },
  { value: "RECOVERED", label: "Recovered" },
  { value: "WRITTEN_OFF", label: "Written off" },
  { value: "FALSE_POSITIVE", label: "False positive" },
  { value: "CLOSED", label: "Closed" },
];

/* ---------------------------------- scan ---------------------------------- */

export function ScanButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => start(async () => {
          const r = await runScan();
          setMsg(`${r.signals} signals · ${r.created} new case${r.created === 1 ? "" : "s"} · ${r.updated} updated`);
          router.refresh();
        })}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadarIcon className="h-4 w-4" />}
        {pending ? "Scanning…" : "Run Detection Scan"}
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  );
}

export function SeedRulesButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      onClick={() => start(async () => { await seedRules(); router.refresh(); })}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Install Rule Library
    </button>
  );
}

/* ---------------------------------- rules ---------------------------------- */

export function RuleEditor({ rule }: { rule: { id: string; code: string; name: string; threshold: number; thresholdUnit: string | null; severity: string; enabled: boolean; autoCase: boolean } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Tune</button>
      <Modal open={open} onClose={() => setOpen(false)} title={rule.name} subtitle={`Rule ${rule.code} — thresholds are data, so no redeploy is needed to tune them.`}>
        <form action={(fd) => start(async () => { await updateRule(rule.id, fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Inp label={`Threshold${rule.thresholdUnit ? ` (${rule.thresholdUnit})` : ""}`} name="threshold" type="number" step="0.01" defaultValue={rule.threshold} hint="Signals below this are ignored." />
          <Sel label="Severity" name="severity" defaultValue={rule.severity} options={SEVERITIES} />
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3">
            <input type="checkbox" name="enabled" defaultChecked={rule.enabled} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" />
            <span className="text-xs font-medium text-slate-700">Rule enabled</span>
          </label>
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3">
            <input type="checkbox" name="autoCase" defaultChecked={rule.autoCase} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" />
            <span><span className="block text-xs font-medium text-slate-700">Open cases automatically</span><span className="text-[11px] text-slate-400">Off = detect and count only.</span></span>
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Rule" /></div>
        </form>
      </Modal>
    </>
  );
}

/* ---------------------------------- cases ---------------------------------- */

export function NewCaseForm({ assets, drivers }: { assets: Opt[]; drivers: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
        <Plus className="h-4 w-4" /> New Case
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Open a Case Manually" subtitle="For something a rule wouldn't catch — a tip-off, a physical check, an audit finding.">
        <form action={(fd) => start(async () => { await createCase(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Title<span className="text-rose-500"> *</span></span>
            <input name="title" required className={inputCls} placeholder="Diesel siphoning suspected at Nagaur yard" />
          </label>
          <Sel label="Domain" name="domain" required options={DOMAINS} />
          <Sel label="Severity" name="severity" required options={SEVERITIES} />
          <Inp label="Amount at Risk ₹" name="amountAtRisk" type="number" step="0.01" defaultValue={0} />
          <Inp label="Risk Score" name="score" type="number" step="1" defaultValue={50} hint="0–100" />
          <Sel label="Asset" name="assetId" options={[{ value: "", label: "— None —" }, ...assets.map((a) => ({ value: a.id, label: a.label }))]} />
          <Sel label="Driver / Operator" name="driverId" options={[{ value: "", label: "— None —" }, ...drivers.map((d) => ({ value: d.id, label: d.label }))]} />
          <Inp label="Vendor" name="vendor" placeholder="Sharma Earthmovers" />
          <Inp label="Assigned To" name="assignedTo" placeholder="Investigator" />
          <Inp label="Due Date" name="dueDate" type="date" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Summary</span>
            <textarea name="summary" rows={3} className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Open Case" /></div>
        </form>
      </Modal>
    </>
  );
}

export function CaseStatusForm({ c }: { c: { id: string; status: string; assignedTo: string | null; rootCause: string | null; disposition: string | null; dueDate: Date | null } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Update Case</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Update Case" subtitle="Status changes are written to the case timeline automatically.">
        <form action={(fd) => start(async () => { await updateCase(c.id, fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Status" name="status" required defaultValue={c.status} options={STATUSES} />
          <Inp label="Assigned To" name="assignedTo" defaultValue={c.assignedTo ?? ""} />
          <Inp label="Due Date" name="dueDate" type="date" defaultValue={c.dueDate ? new Date(c.dueDate).toISOString().slice(0, 10) : ""} />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Root Cause</span>
            <textarea name="rootCause" rows={2} defaultValue={c.rootCause ?? ""} className={inputCls} placeholder="What actually caused the loss" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Disposition</span>
            <textarea name="disposition" rows={2} defaultValue={c.disposition ?? ""} className={inputCls} placeholder="Action taken — coaching, penalty, debit note, police complaint…" />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save" /></div>
        </form>
      </Modal>
    </>
  );
}

export function NoteForm({ caseId }: { caseId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form action={(fd) => start(async () => { await addNote(caseId, fd); router.refresh(); })} className="flex gap-2">
      <input name="note" required placeholder="Add a note to the timeline…" className={inputCls} />
      <button type="submit" disabled={pending} className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
      </button>
    </form>
  );
}

export function EvidenceForm({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
        <Plus className="mr-1 inline h-3.5 w-3.5" />Add Evidence
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add Evidence" subtitle="Everything attached here forms the pack handed to whoever decides the outcome.">
        <form action={(fd) => start(async () => { await addEvidence(caseId, fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Kind" name="kind" required options={[
            { value: "NOTE", label: "Note / observation" }, { value: "PHOTO", label: "Photo" }, { value: "FUEL_TXN", label: "Fuel entry" },
            { value: "HIRE_INVOICE", label: "Hire invoice" }, { value: "WORK_ORDER", label: "Work order" }, { value: "RECON", label: "Reconciliation" },
          ]} />
          <Inp label="Label" name="label" required placeholder="Dip reading photo, 14 Jul" />
          <Inp label="Link / URL" name="url" placeholder="https://…" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Detail</span>
            <textarea name="detail" rows={3} className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Attach" /></div>
        </form>
      </Modal>
    </>
  );
}

export function RecoveryForm({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Record Recovery</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record Recovery" subtitle="Money actually clawed back. Partial recoveries from different channels each keep their own reference.">
        <form action={(fd) => start(async () => { await addRecovery(caseId, fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Inp label="Amount ₹" name="amount" type="number" step="0.01" required />
          <Sel label="Method" name="method" required options={[
            { value: "SALARY_DEDUCTION", label: "Salary deduction" },
            { value: "VENDOR_DEBIT_NOTE", label: "Vendor debit note" },
            { value: "CASH", label: "Cash / bank" },
            { value: "INSURANCE", label: "Insurance claim" },
            { value: "WRITE_OFF", label: "Write-off" },
          ]} />
          <Inp label="Reference" name="reference" placeholder="Debit note no. / voucher" />
          <Inp label="Date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Note</span>
            <input name="note" className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Record" /></div>
        </form>
      </Modal>
    </>
  );
}

export function DeleteCaseButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      onClick={() => start(async () => { await deleteCase(id); router.push("/loss-prevention"); router.refresh(); })}
      disabled={pending}
      className="rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
      aria-label="Delete case"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </button>
  );
}
