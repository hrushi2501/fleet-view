"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Loader2, Radar } from "lucide-react";
import { seedAlertRules, updateAlertRule, runAlertSweep } from "@/app/(app)/alerts/actions";
import { isActionError } from "@/lib/action-result";
import { useToast } from "@/components/Toast";

const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function Modal({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-x-auto overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
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

export function SweepButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => start(async () => {
          const r = await runAlertSweep();
          if (isActionError(r)) { setMsg(r.error); return; }
          setMsg(`${r.found} conditions · ${r.created} new · ${r.updated} refreshed${r.escalated ? ` · ${r.escalated} escalated` : ""}`);
          router.refresh();
        })}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
        {pending ? "Sweeping…" : "Run Alert Sweep"}
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  );
}

export function SeedAlertRulesButton() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button onClick={() => start(async () => { const result = await seedAlertRules(); if (isActionError(result)) { toast.error(result.error); return; } router.refresh(); })} disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Install Alert Rules
    </button>
  );
}

export function AlertRuleEditor({ rule }: { rule: { id: string; code: string; name: string; threshold: number; thresholdUnit: string | null; severity: string; enabled: boolean; escalateAfterHours: number; channels: string } }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const chans = rule.channels.split(",").filter(Boolean);
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Tune</button>
      <Modal open={open} onClose={() => setOpen(false)} title={rule.name} subtitle={`Rule ${rule.code} — an alert nobody can turn down is an alert everybody ignores.`}>
        <form action={(fd) => start(async () => { const result = await updateAlertRule(rule.id, fd); if (isActionError(result)) { toast.error(result.error); return; } setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Threshold{rule.thresholdUnit ? ` (${rule.thresholdUnit})` : ""}</span>
            <input name="threshold" type="number" step="0.1" defaultValue={rule.threshold} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Severity</span>
            <select name="severity" defaultValue={rule.severity} className={inputCls}>
              <option value="Info">Info</option><option value="Warning">Warning</option><option value="Critical">Critical</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Escalate after (hours)</span>
            <input name="escalateAfterHours" type="number" step="1" defaultValue={rule.escalateAfterHours} className={inputCls} />
            <span className="mt-1 block text-[11px] text-slate-400">Unacknowledged alerts are flagged for chasing after this.</span>
          </label>
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">Channels</span>
            <div className="space-y-1.5">
              {["IN_APP", "PUSH", "EMAIL"].map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="channels" value={c} defaultChecked={chans.includes(c)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                  <span className="text-slate-700">{c.replace("_", "-").toLowerCase()}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 sm:col-span-2">
            <input type="checkbox" name="enabled" defaultChecked={rule.enabled} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" />
            <span className="text-xs font-medium text-slate-700">Rule enabled</span>
          </label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}Save Rule
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
