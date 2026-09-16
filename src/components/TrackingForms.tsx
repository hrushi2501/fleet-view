"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Loader2, QrCode, Radar, Check, Plus } from "lucide-react";
import { issueQrTokens, seedProviders, saveAssetTelematics, verifyGaugeReading, releaseSession, closeStaleSessions, scanFuelEvents } from "@/app/(app)/tracking/actions";
import { isActionError } from "@/lib/action-result";

const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function Modal({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-x-auto overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div><h3 className="text-lg font-bold text-ink-900">{title}</h3>{subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}</div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function IssueQrButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => start(async () => { const r = await issueQrTokens();
 if (isActionError(r)) { setMsg(r.error); return; } setMsg(r.issued ? `${r.issued} issued` : "all vehicles already have codes"); router.refresh(); })}
        disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />} Issue QR Codes
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  );
}

export function SeedProvidersButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button onClick={() => start(async () => { await seedProviders(); router.refresh(); })} disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Install Providers
    </button>
  );
}

export function TelematicsForm({ asset, providers }: { asset: { id: string; code: string; deviceId: string | null; telematicsProviderId: string | null; hasFuelSensor: boolean }; providers: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Configure</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Telematics — ${asset.code}`} subtitle="A vehicle with no fuel sensor falls back to the driver's gauge photo.">
        <form action={(fd) => start(async () => { await saveAssetTelematics(asset.id, fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">GPS Provider</span>
            <select name="telematicsProviderId" defaultValue={asset.telematicsProviderId ?? ""} className={inputCls}>
              <option value="">— None (no tracker fitted) —</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Device / Vehicle ID at provider</span>
            <input name="deviceId" defaultValue={asset.deviceId ?? ""} className={inputCls} placeholder="IMEI or provider vehicle id" />
          </label>
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 sm:col-span-2">
            <input type="checkbox" name="hasFuelSensor" defaultChecked={asset.hasFuelSensor} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" />
            <span>
              <span className="block text-xs font-medium text-slate-700">This vehicle has a fuel-level sensor</span>
              <span className="text-[11px] text-slate-400">Leave unticked and the driver app asks for a gauge photo instead.</span>
            </span>
          </label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}Save
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function VerifyGaugeForm({ reading }: { reading: { id: string; levelPct: number | null; confidence: number; assetCode: string } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">Review</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Verify gauge reading — ${reading.assetCode}`} subtitle="Accept the reading, fix it, or reject the photo. Only a checked number is saved.">
        <form action={(fd) => start(async () => { await verifyGaugeReading(reading.id, fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Verdict</span>
            <select name="verdict" required defaultValue="VERIFIED" className={inputCls}>
              <option value="VERIFIED">Accept — {reading.levelPct ?? "?"}% is correct</option>
              <option value="CORRECTED">Correct it — enter the true level</option>
              <option value="REJECTED">Reject — photo unusable</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Corrected level %</span>
            <input name="correctedPct" type="number" step="1" min="0" max="100" defaultValue={reading.levelPct ?? ""} className={inputCls} />
            <span className="mt-1 block text-[11px] text-slate-400">Used only when correcting.</span>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Note</span>
            <input name="note" className={inputCls} />
          </label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Save Verdict
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ReleaseSessionButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button onClick={() => start(async () => { await releaseSession(id); router.refresh(); })} disabled={pending}
      className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-60">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Force release"}
    </button>
  );
}

export function CloseStaleButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => start(async () => { const r = await closeStaleSessions();
 if (isActionError(r)) { setMsg(r.error); return; } setMsg(`${r.closed} closed`); router.refresh(); })} disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Close Forgotten Sessions
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  );
}

export function ScanFuelButton({ assetId }: { assetId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={() => start(async () => { const r = await scanFuelEvents(assetId);
 if (isActionError(r)) { setMsg(r.error); return; }
 setMsg(r.notAssessed.length ? `Not assessed: ${r.notAssessed.join("; ")}` : `${r.raised} raised, ${r.duplicates} already recorded`);
 router.refresh(); })}
        disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />} Scan fuel
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </span>
  );
}
