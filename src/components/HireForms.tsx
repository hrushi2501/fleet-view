"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveContract, saveLog, deleteLog, deleteContract, saveHireInspection, saveContractAmendment, saveHirePayment, deleteInspection, deleteAmendment, deletePayment, approveHireLog } from "@/app/(app)/hire/actions";

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

function Chk({ label, name, defaultChecked, hint }: { label: string; name: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" />
      <span>
        <span className="block text-xs font-medium text-slate-700">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
      </span>
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

function Trigger({ onClick, children, tone = "brand", size = "md" }: { onClick: () => void; children: ReactNode; tone?: "brand" | "ghost" | "outline"; size?: "sm" | "md" }) {
  const sizeClasses = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const toneClasses = tone === "brand" ? "bg-brand-600 text-white hover:bg-brand-700 border border-transparent" :
                      tone === "outline" ? "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900 shadow-sm" :
                      "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50";
                      
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors", sizeClasses, toneClasses)}>
      {children}
    </button>
  );
}

const RATE_TYPES = [
  { value: "PER_DAY", label: "Per day" },
  { value: "PER_HOUR", label: "Per engine-hour" },
  { value: "PER_KM", label: "Per km" },
  { value: "PER_TRIP", label: "Per trip" },
  { value: "MONTHLY", label: "Monthly lump sum" },
];

/* -------------------------------- contract -------------------------------- */

export function ContractForm({ assets, contract }: {
  assets: Opt[];
  contract?: { id: string; assetId: string; vendor: string; contractNo: string | null; rateType: string; rate: number; overtimeRate: number; minGuarantee: number; guaranteeUnit: string | null; fuelBorneBy: string; breakdownBillable: boolean; idleBillable: boolean; startDate: Date; endDate: Date | null; status: string; notes: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const iso = (d?: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone={contract ? "ghost" : "brand"}>
        {!contract && <Plus className="h-4 w-4" />}{contract ? "Edit" : "Add Contract"}
      </Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title={contract ? "Edit Hire Contract" : "New Hire Contract"} subtitle="These terms drive invoice validation — nothing is approved that the contract and the logs don't both support.">
        <form action={(fd) => start(async () => { await saveContract(contract?.id ?? null, fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Hired Asset" name="assetId" required defaultValue={contract?.assetId} options={assets.map((a) => ({ value: a.id, label: a.label }))} />
          <Inp label="Vendor" name="vendor" required defaultValue={contract?.vendor} placeholder="Sharma Earthmovers" />
          <Inp label="Contract No." name="contractNo" defaultValue={contract?.contractNo ?? ""} />
          <Sel label="Rate Basis" name="rateType" required defaultValue={contract?.rateType ?? "PER_DAY"} options={RATE_TYPES} />
          <Inp label="Rate ₹" name="rate" type="number" step="0.01" required defaultValue={contract?.rate} />
          <Inp label="Overtime Rate ₹" name="overtimeRate" type="number" step="0.01" defaultValue={contract?.overtimeRate ?? 0} />
          <Inp label="Minimum Guarantee" name="minGuarantee" type="number" step="0.01" defaultValue={contract?.minGuarantee ?? 0} hint="Paid regardless of work done" />
          <Sel label="Guarantee Unit" name="guaranteeUnit" defaultValue={contract?.guaranteeUnit ?? ""} options={[{ value: "", label: "— None —" }, { value: "HOURS_PER_DAY", label: "Hours per day" }, { value: "DAYS_PER_MONTH", label: "Days per month" }]} />
          <Sel label="Diesel Borne By" name="fuelBorneBy" required defaultValue={contract?.fuelBorneBy ?? "HIRER"} options={[{ value: "HIRER", label: "Us (the hirer)" }, { value: "VENDOR", label: "Vendor — recover from their bill" }]} hint="If vendor, diesel we issue is auto-deducted from their invoice." />
          <Inp label="Start Date" name="startDate" type="date" required defaultValue={iso(contract?.startDate) || new Date().toISOString().slice(0, 10)} />
          <Inp label="End Date" name="endDate" type="date" defaultValue={iso(contract?.endDate)} />
          <Sel label="Status" name="status" defaultValue={contract?.status ?? "Active"} options={[{ value: "Active", label: "Active" }, { value: "Expired", label: "Expired" }, { value: "Terminated", label: "Terminated" }]} />
          <Chk label="Idle time is billable" name="idleBillable" defaultChecked={contract ? contract.idleBillable : true} hint="Many hire contracts pay for availability, not utilisation." />
          <Chk label="Breakdown time is billable" name="breakdownBillable" defaultChecked={contract?.breakdownBillable ?? false} hint="Usually off — a machine that is down shouldn't be paid for." />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
            <textarea name="notes" rows={2} defaultValue={contract?.notes ?? ""} className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label={contract ? "Save Contract" : "Create Contract"} /></div>
        </form>
      </Modal>
    </>
  );
}

/* ----------------------------------- log ----------------------------------- */

export function LogForm({ contracts }: { contracts: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone="ghost"><Plus className="h-4 w-4" /> Log Day</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Log a Working Day" subtitle="This is the evidence vendor invoices are checked against. Re-entering a date corrects it rather than duplicating.">
        <form action={(fd) => start(async () => { await saveLog(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Contract" name="contractId" required options={contracts.map((c) => ({ value: c.id, label: c.label }))} />
          <Inp label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Sel label="Machine Present?" name="present" required options={[{ value: "true", label: "Yes — on site" }, { value: "false", label: "No — absent" }]} />
          <Sel label="Evidence Source" name="source" required options={[{ value: "MANUAL", label: "Manual site entry" }, { value: "GPS", label: "GPS / telematics" }, { value: "OPERATOR", label: "Operator app" }]} />
          <Inp label="Worked Hours" name="workedHours" type="number" step="0.1" defaultValue={0} />
          <Inp label="Idle Hours" name="idleHours" type="number" step="0.1" defaultValue={0} />
          <Inp label="Breakdown Hours" name="breakdownHours" type="number" step="0.1" defaultValue={0} hint="Excluded from billing unless the contract says otherwise." />
          <Inp label="Kilometres" name="km" type="number" step="0.1" defaultValue={0} />
          <Inp label="Trips" name="trips" type="number" step="1" defaultValue={0} />
          <Inp label="Verified By" name="verifiedBy" placeholder="Site supervisor" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Note</span>
            <input name="note" className={inputCls} placeholder="e.g. half day — rain stoppage" />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Log" /></div>
        </form>
      </Modal>
    </>
  );
}

/* --------------------------------- deletes --------------------------------- */

import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export function DeleteHire({ id, kind }: { id: string; kind: "log" | "contract" | "inspection" | "amendment" | "payment" }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const labels = {
    log: "Contractor Day Log",
    contract: "Hiring Contract",
    inspection: "Hire Condition Inspection",
    amendment: "Contract Amendment",
    payment: "Payment Voucher",
  };

  async function handleDelete() {
    if (kind === "log") await deleteLog(id);
    else if (kind === "contract") await deleteContract(id);
    else if (kind === "inspection") await deleteInspection(id);
    else if (kind === "amendment") await deleteAmendment(id);
    else await deletePayment(id);

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
        description="Are you sure you want to delete this contractor record? This cannot be undone."
        confirmLabel="Confirm Delete"
        tone="danger"
      />
    </>
  );
}

/* --------------------------------- new features --------------------------------- */

export function HireInspectionForm({ contractId }: { contractId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone="outline" size="sm"><Plus className="h-3.5 w-3.5" /> Inspection</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Record Inspection" subtitle="Log machine intake or release conditions.">
        <form action={(fd) => start(async () => { await saveHireInspection(contractId, fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Type" name="type" required options={[{ value: "ON_HIRE", label: "On-Hire (Intake)" }, { value: "OFF_HIRE", label: "Off-Hire (Release)" }]} />
          <Inp label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Inp label="Meter Value" name="meterValue" type="number" step="0.1" required defaultValue={0} />
          <Inp label="Fuel Level %" name="fuelLevelPct" type="number" step="1" />
          <Sel label="Condition" name="condition" required options={[{ value: "GOOD", label: "Good" }, { value: "FAIR", label: "Fair" }, { value: "POOR", label: "Poor" }]} />
          <Inp label="Inspector" name="inspector" placeholder="Site engineer name" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Damages / Remarks</span>
            <textarea name="damages" rows={2} className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Inspection" /></div>
        </form>
      </Modal>
    </>
  );
}

export function AmendmentForm({ contractId, currentRate }: { contractId: string, currentRate: number }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone="outline" size="sm"><Plus className="h-3.5 w-3.5" /> Revise Rate</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Revise Hire Rate" subtitle="Record a rate amendment over time so past invoices remain valid under the old rate.">
        <form action={(fd) => start(async () => { await saveContractAmendment(contractId, fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <Inp label="Effective Date" name="effectiveDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Inp label="Previous Rate ₹" name="previousRate" type="number" step="0.01" required defaultValue={currentRate} />
          <Inp label="New Rate ₹" name="newRate" type="number" step="0.01" required />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Reason</span>
            <input name="reason" className={inputCls} placeholder="e.g. Fuel price escalation" required />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Apply Revision" /></div>
        </form>
      </Modal>
    </>
  );
}

export function PaymentForm({ contractId, vendor }: { contractId?: string, vendor: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <>
      <Trigger onClick={() => setOpen(true)} tone="outline" size="sm"><Plus className="h-3.5 w-3.5" /> Advance / Payment</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Record Vendor Payment / Advance" subtitle="Track mobilization advances and payments to calculate outstanding balances.">
        <form action={(fd) => start(async () => { await saveHirePayment(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="contractId" value={contractId ?? ""} />
          <input type="hidden" name="vendor" value={vendor} />
          <Inp label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Sel label="Type" name="type" required options={[{ value: "ADVANCE", label: "Mobilization Advance" }, { value: "INVOICE_PAYMENT", label: "Invoice Payment" }, { value: "DEDUCTION", label: "Other Deduction" }]} />
          <Inp label="Amount ₹" name="amount" type="number" step="0.01" required />
          <Inp label="Reference No." name="referenceNo" placeholder="Cheque / UTR" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
            <input name="notes" className={inputCls} placeholder="e.g. Transport advance" />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Payment" /></div>
        </form>
      </Modal>
    </>
  );
}

export function ApproveButton({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  
  if (status === "APPROVED") {
    return <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600 ring-1 ring-inset ring-emerald-600/20">Approved</span>;
  }
  
  return (
    <button
      onClick={() => start(async () => {
        await approveHireLog(id, "APPROVED");
        router.refresh();
      })}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 disabled:opacity-60"
    >
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Approve
    </button>
  );
}
