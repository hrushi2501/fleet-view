"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Clock, Check, Wrench, Loader2, ShieldCheck } from "lucide-react";
import { snoozeAlert, acknowledgeAlert, resolveAlert, createWoFromReminder } from "@/app/(app)/notifications/actions";

const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function Modal({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-lg rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
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

export function SnoozeModal({ alertId, alertTitle }: { alertId: string; alertTitle: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md transition-colors">
        <Clock className="h-3.5 w-3.5" /> Snooze
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Snooze Service Reminder" subtitle={`Defer reminder: ${alertTitle}`}>
        <form action={(fd) => start(async () => { await snoozeAlert(fd); setOpen(false); router.refresh(); })} className="space-y-4">
          <input type="hidden" name="alertId" value={alertId} />
          
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Defer Period *</span>
            <select name="snoozeDays" defaultValue={7} className={inputCls}>
              <option value={3}>3 Days (Urgent Hold)</option>
              <option value={7}>7 Days (1 Week)</option>
              <option value={14}>14 Days (2 Weeks)</option>
              <option value={30}>30 Days (1 Month)</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Mandatory Justification / Reason *</span>
            <textarea name="reason" required placeholder="e.g. Concrete pour active; machine scheduled for service on Sunday" rows={3} className={inputCls} />
            <span className="mt-1 block text-[11px] text-slate-400">Recorded in compliance audit trail.</span>
          </label>

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />} Confirm Deferral
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function AlertActionButtons({ alertId }: { alertId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="flex items-center gap-2">
      <button onClick={() => start(async () => { await acknowledgeAlert(alertId); router.refresh(); })} disabled={pending} className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 px-2.5 py-1 rounded-md transition-colors disabled:opacity-60">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Ack
      </button>

      <button onClick={() => start(async () => { await resolveAlert(alertId); router.refresh(); })} disabled={pending} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-md transition-colors disabled:opacity-60">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Resolve
      </button>
    </div>
  );
}

export function RaiseWoFromReminderButton({ scheduleId }: { scheduleId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <button onClick={() => start(async () => { await createWoFromReminder(scheduleId); router.push("/maintenance?tab=workorders"); })} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />} Raise PM WO
    </button>
  );
}
