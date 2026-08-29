"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Loader2, Play, Trash2, Fuel, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn, inr, num } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { isActionError } from "@/lib/action-result";
import {
  saveTank, saveReceipt, saveDip, runReconciliation,
  updateAnomaly, saveNorm, deleteReceipt, deleteDip
} from "@/app/(app)/fuel/actions";

type Opt = { id: string; label: string };

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function Inp({
  label, name, type = "text", defaultValue, value, onChange, required, step, placeholder, hint
}: {
  label: string; name: string; type?: string; defaultValue?: string | number; value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; required?: boolean; step?: string; placeholder?: string; hint?: string;
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
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        className={inputCls}
      />
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

function Sel({ label, name, options, defaultValue, value, onChange, required }: {
  label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string; value?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <select name={name} defaultValue={defaultValue} value={value} onChange={onChange} required={required} className={inputCls}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function Modal({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 animate-fade-up">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div>
            <h3 className="text-lg font-bold text-ink-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function SubmitBar({ pending, onCancel, label = "Save" }: { pending: boolean; onCancel: () => void; label?: string }) {
  return (
    <div className="mt-5 flex justify-end gap-2.5">
      <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
      <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 shadow-sm">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {label}
      </button>
    </div>
  );
}

function TriggerBtn({ onClick, children, tone = "brand" }: { onClick: () => void; children: ReactNode; tone?: "brand" | "ghost" }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors shadow-xs",
        tone === "brand" ? "bg-brand-600 text-white hover:bg-brand-700" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------- tank master ------------------------------- */

export function TankForm({ projects, tank }: { projects: Opt[]; tank?: { id: string; name: string; location: string; capacity: number; minLevel: number; openingLevel: number; projectId: string | null; code: string | null } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <>
      <TriggerBtn onClick={() => setOpen(true)} tone={tank ? "ghost" : "brand"}>
        {!tank && <Plus className="h-4 w-4" />}
        {tank ? "Edit" : "Add Tank"}
      </TriggerBtn>
      <Modal open={open} onClose={() => setOpen(false)} title={tank ? "Edit Site Tank" : "Add Site Diesel Tank"} subtitle="Every litre entering or leaving this tank is tracked and reconciled against physical dips.">
        <form
          action={(fd) => start(async () => {
            try {
              await saveTank(tank?.id ?? null, fd);
              setOpen(false);
              toast.success(tank ? `✓ Tank ${tank.name} updated` : "✓ Site diesel tank created");
              router.refresh();
            } catch (err) {
              toast.error("Failed to save tank", err instanceof Error ? err.message : "Error");
            }
          })}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Inp label="Tank Name" name="name" defaultValue={tank?.name} required placeholder="Site Tank A" />
          <Inp label="Tank Code" name="code" defaultValue={tank?.code ?? ""} placeholder="TNK-01" />
          <Inp label="Location" name="location" defaultValue={tank?.location} required placeholder="Nagaur Site Yard" />
          <Sel label="Project / Site" name="projectId" defaultValue={tank?.projectId ?? ""} options={[{ value: "", label: "— Unassigned —" }, ...projects.map((p) => ({ value: p.id, label: p.label }))]} />
          <Inp label="Capacity (L)" name="capacity" type="number" step="1" defaultValue={tank?.capacity} required />
          <Inp label="Reorder Level (L)" name="minLevel" type="number" step="1" defaultValue={tank?.minLevel ?? 0} hint="Alert when the tank drops below this." />
          <Inp label="Opening Level (L)" name="openingLevel" type="number" step="1" defaultValue={tank?.openingLevel ?? 0} hint="Physical stock when you start using FleetView." />
          <Sel label="Status" name="status" options={[{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }]} />
          <div className="sm:col-span-2">
            <SubmitBar pending={pending} onCancel={() => setOpen(false)} label={tank ? "Save Tank" : "Add Tank"} />
          </div>
        </form>
      </Modal>
    </>
  );
}

/* --------------------------------- receipt with live calculation --------------------------------- */

export function ReceiptForm({ tanks, defaultRate }: { tanks: Opt[]; defaultRate: number }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  // Live calculation state
  const [invoiced, setInvoiced] = useState("");
  const [received, setReceived] = useState("");
  const [rate, setRate] = useState(String(defaultRate));

  const router = useRouter();
  const toast = useToast();

  const invVal = parseFloat(invoiced) || 0;
  const recVal = parseFloat(received) || 0;
  const rVal = parseFloat(rate) || 0;

  const shortfallL = invVal > 0 && recVal > 0 ? invVal - recVal : 0;
  const totalAmount = invVal * rVal;
  const shortfallAmount = shortfallL > 0 ? shortfallL * rVal : 0;

  function resetForm() {
    setInvoiced("");
    setReceived("");
    setRate(String(defaultRate));
  }

  return (
    <>
      <TriggerBtn onClick={() => { resetForm(); setOpen(true); }}>
        <Plus className="h-4 w-4" /> Record Delivery
      </TriggerBtn>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record Diesel Delivery (GRN)"
        subtitle="Enter what the supplier invoiced AND what actually went into the tank. The difference is flagged automatically."
      >
        <form
          action={(fd) => start(async () => {
            try {
              await saveReceipt(fd);
              setOpen(false);
              toast.success("✓ Diesel delivery recorded", `${num(recVal || invVal)} L into tank`);
              router.refresh();
            } catch (err) {
              toast.error("Failed to record delivery", err instanceof Error ? err.message : "Error");
            }
          })}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Sel label="Into Tank" name="tankId" required options={tanks.map((t) => ({ value: t.id, label: t.label }))} />
          <Inp label="Date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
          <Inp label="Supplier" name="supplier" required placeholder="HPCL / IOCL Nagaur" />
          <Inp label="Invoice No." name="invoiceNo" placeholder="INV-2026-001" />
          
          <Inp
            label="Litres Invoiced (Bill)"
            name="qtyInvoiced"
            type="number"
            step="0.01"
            required
            value={invoiced}
            onChange={(e) => setInvoiced(e.target.value)}
            placeholder="e.g. 5000"
            hint="As per supplier bill"
          />
          <Inp
            label="Litres Received (Actual Dip)"
            name="qtyReceived"
            type="number"
            step="0.01"
            required
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            placeholder="e.g. 4960"
            hint="Measured by dip / flow meter"
          />

          <Inp
            label="Rate ₹/L"
            name="rate"
            type="number"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <Inp label="Tanker Vehicle No." name="tankerNo" placeholder="RJ21 GA 1234" />
          <Inp label="Flow Meter Start" name="flowMeterStart" type="number" step="0.01" />
          <Inp label="Flow Meter End" name="flowMeterEnd" type="number" step="0.01" />
          <Inp label="Weighbridge Net (kg)" name="weighbridgeNet" type="number" step="0.01" hint="Optional — if tanker was weighed" />
          <Inp label="Received By" name="receivedBy" placeholder="Storekeeper name" />

          {/* Live Delivery Match Banner */}
          {invVal > 0 && recVal > 0 && (
            <div className="sm:col-span-2 rounded-2xl p-4 ring-1 animate-fade-up border border-slate-100 bg-slate-50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {shortfallL === 0 ? (
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                  ) : shortfallL > 0 ? (
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500 text-white">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500 text-white">
                      <Fuel className="h-5 w-5" />
                    </div>
                  )}

                  <div>
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Delivery Comparison</span>
                    <p className="text-sm font-bold text-ink-900">
                      {shortfallL === 0 ? (
                        <span className="text-emerald-700">✓ Exact Match (0 L difference)</span>
                      ) : shortfallL > 0 ? (
                        <span className="text-rose-700">⚠️ Shortfall: {num(shortfallL)} Litres</span>
                      ) : (
                        <span className="text-sky-700">ℹ️ Surplus: +{num(Math.abs(shortfallL))} Litres</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Invoiced Total</span>
                  <p className="text-sm font-extrabold text-ink-900">{inr(totalAmount)}</p>
                  {shortfallAmount > 0 && (
                    <span className="text-[11px] font-semibold text-rose-600">Risk: {inr(shortfallAmount)}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Invoice / Challan Photo</span>
            <input name="invoicePhoto" type="file" accept="image/*" className={inputCls} />
          </label>
          <div className="sm:col-span-2">
            <SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Record Delivery" />
          </div>
        </form>
      </Modal>
    </>
  );
}

/* ----------------------------------- dip ----------------------------------- */

export function DipForm({ tanks }: { tanks: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <>
      <TriggerBtn onClick={() => setOpen(true)} tone="ghost">
        <Plus className="h-4 w-4" /> Record Dip
      </TriggerBtn>
      <Modal open={open} onClose={() => setOpen(false)} title="Record Physical Dip" subtitle="The dipstick reading is the ground truth. Reconciliation measures the book against this.">
        <form action={(fd) => start(async () => {
          try {
            await saveDip(fd);
            setOpen(false);
            toast.success("✓ Physical tank dip recorded successfully");
            router.refresh();
          } catch (err) {
            toast.error("Failed to save dip reading", err instanceof Error ? err.message : "Error");
          }
        })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Tank" name="tankId" required options={tanks.map((t) => ({ value: t.id, label: t.label }))} />
          <Inp label="Date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
          <Inp label="Measured Level (L)" name="level" type="number" step="0.01" required placeholder="e.g. 8450" />
          <Inp label="Read By" name="readBy" placeholder="Storekeeper name" />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Dip / Gauge Photo</span>
            <input name="photo" type="file" accept="image/*" className={inputCls} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Note</span>
            <input name="note" className={inputCls} placeholder="e.g. measured before night shift" />
          </label>
          <div className="sm:col-span-2">
            <SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Dip" />
          </div>
        </form>
      </Modal>
    </>
  );
}

/* ----------------------------- run reconciliation ----------------------------- */

export function RunReconButton({ tankId, tankName }: { tankId: string; tankName: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() =>
          start(async () => {
            const res = await runReconciliation(tankId);
            if (isActionError(res)) { setMsg(res.error); return; }
            if (res.ok) {
              toast.success(`✓ ${tankName} reconciled`, `Variance: ${res.varianceL.toFixed(0)} L`);
              setMsg(`Reconciled — variance ${res.varianceL.toFixed(0)} L`);
            } else {
              toast.error("Reconciliation failed", res.message ?? "Cannot reconcile");
              setMsg(res.message ?? "Cannot reconcile");
            }
            router.refresh();
          })
        }
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition-colors shadow-xs"
        title={`Reconcile ${tankName}`}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        Reconcile
      </button>
      {msg && <span className="text-xs text-slate-500 font-medium">{msg}</span>}
    </div>
  );
}

/* ------------------------------ anomaly triage ------------------------------ */

export function AnomalyTriage({ anomaly }: { anomaly: { id: string; status: string; resolution: string | null; recovered: number; assignedTo: string | null } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
        Triage
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Investigate Anomaly" subtitle="Record the outcome and any amount recovered. Recovered value rolls up to the loss-prevention scorecard.">
        <form action={(fd) => start(async () => {
          try {
            await updateAnomaly(anomaly.id, fd);
            setOpen(false);
            toast.success("✓ Anomaly investigation outcome saved");
            router.refresh();
          } catch (_err) {
            toast.error("Failed to update outcome");
          }
        })} className="grid gap-4 sm:grid-cols-2">
          <Sel
            label="Status"
            name="status"
            defaultValue={anomaly.status}
            required
            options={[
              { value: "OPEN", label: "Open" },
              { value: "INVESTIGATING", label: "Investigating" },
              { value: "RECOVERED", label: "Recovered" },
              { value: "FALSE_POSITIVE", label: "False positive" },
              { value: "CLOSED", label: "Closed — no recovery" },
            ]}
          />
          <Inp label="Assigned To" name="assignedTo" defaultValue={anomaly.assignedTo ?? ""} placeholder="Investigator name" />
          <Inp label="Amount Recovered (₹)" name="recovered" type="number" step="0.01" defaultValue={anomaly.recovered} />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Resolution / Findings</span>
            <textarea name="resolution" defaultValue={anomaly.resolution ?? ""} rows={4} className={inputCls} placeholder="What was found, who was responsible, action taken…" />
          </label>
          <div className="sm:col-span-2">
            <SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Outcome" />
          </div>
        </form>
      </Modal>
    </>
  );
}

/* ------------------------------- norms editor ------------------------------- */

export function NormForm({ classes }: { classes: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <>
      <TriggerBtn onClick={() => setOpen(true)} tone="ghost">
        <Plus className="h-4 w-4" /> Set Norm
      </TriggerBtn>
      <Modal open={open} onClose={() => setOpen(false)} title="Consumption Norm" subtitle="Expected fuel burn for an asset class. Issues outside the tolerance band raise an anomaly.">
        <form action={(fd) => start(async () => {
          try {
            await saveNorm(fd);
            setOpen(false);
            toast.success("✓ Consumption norm configured successfully");
            router.refresh();
          } catch (_err) {
            toast.error("Failed to save norm");
          }
        })} className="grid gap-4 sm:grid-cols-2">
          <Sel label="Asset Class" name="assetClass" required options={classes} />
          <Sel label="Unit" name="unit" required options={[{ value: "KMPL", label: "km per litre (road vehicles)" }, { value: "LPH", label: "litres per engine-hour (equipment)" }]} />
          <Inp label="Norm Low" name="normLow" type="number" step="0.01" required />
          <Inp label="Norm High" name="normHigh" type="number" step="0.01" required />
          <Inp label="Tolerance %" name="tolerancePct" type="number" step="1" defaultValue={15} hint="Variance beyond this raises an anomaly." />
          <div className="sm:col-span-2">
            <SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Norm" />
          </div>
        </form>
      </Modal>
    </>
  );
}

/* ------------------------------ row delete with ConfirmDialog ------------------------------ */

export function DeleteRow({ id, kind }: { id: string; kind: "receipt" | "dip" }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function handleDelete() {
    if (kind === "receipt") await deleteReceipt(id);
    else await deleteDip(id);
    toast.success(`✓ ${kind === "receipt" ? "Delivery receipt" : "Physical dip"} deleted`);
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
        title={`Delete ${kind === "receipt" ? "Delivery Receipt" : "Dip Reading"}?`}
        description="Are you sure you want to delete this record? This cannot be undone."
        confirmLabel="Confirm Delete"
        tone="danger"
      />
    </>
  );
}
