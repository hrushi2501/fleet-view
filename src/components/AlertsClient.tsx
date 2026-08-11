"use client";

import { useState, useTransition, ReactNode } from "react";
import { Badge } from "@/components/ui";
import { SEVERITY_COLOR, timeAgo, cn } from "@/lib/utils";
import { updateAlert, escalateAlert, assignAlert } from "@/app/(app)/alerts/actions";
import { Check, Eye, Fuel, Wrench, ShieldAlert, MapPin, User, Clock, ArrowUpRight, UserPlus, X } from "lucide-react";

type Alert = {
  id: string;
  category: string;
  severity: string;
  title: string;
  message: string;
  status: string;
  createdAt: string;
  assetCode?: string | null;
  escalatedAt?: string | null;
  assignedTo?: string | null;
  actionUrl?: string | null;
};

const CAT_ICON: Record<string, React.ElementType> = {
  Fuel: Fuel,
  Maintenance: Wrench,
  Compliance: ShieldAlert,
  Geofence: MapPin,
  Driver: User,
  Idle: Clock,
  Operations: MapPin,
  Loss: ShieldAlert,
};

function AssignModal({ open, onClose, onAssign, pending }: { open: boolean; onClose: () => void; onAssign: (name: string) => void; pending: boolean }) {
  const [name, setName] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div>
            <h3 className="text-lg font-bold text-ink-900">Assign to Supervisor</h3>
            <p className="mt-0.5 text-xs text-slate-500">Route this alert to a specific supervisor for action</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Supervisor Name <span className="text-rose-500">*</span></span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rajesh Sharma"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
            <button
              onClick={() => { if (name.trim()) onAssign(name.trim()); }}
              disabled={pending || !name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
              Assign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AlertsClient({ alerts }: { alerts: Alert[] }) {
  const [cat, setCat] = useState("ALL");
  const [sev, setSev] = useState("ALL");
  const [status, setStatus] = useState("Open");
  const [pending, startTransition] = useTransition();
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const categories = [...new Set(alerts.map((a) => a.category))];
  const filtered = alerts.filter(
    (a) =>
      (cat === "ALL" || a.category === cat) &&
      (sev === "ALL" || a.severity === sev) &&
      (status === "ALL" || a.status === status)
  );

  const chip = (active: boolean) =>
    cn("rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors",
      active ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50");

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-1">Category</span>
          <button onClick={() => setCat("ALL")} className={chip(cat === "ALL")}>All</button>
          {categories.map((c) => (<button key={c} onClick={() => setCat(c)} className={chip(cat === c)}>{c}</button>))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-1">Severity</span>
          {["ALL", "Critical", "Warning", "Info"].map((s) => (<button key={s} onClick={() => setSev(s)} className={chip(sev === s)}>{s === "ALL" ? "All" : s}</button>))}
          <div className="ml-auto flex gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-1 self-center">Status</span>
            {["Open", "Acknowledged", "Resolved", "ALL"].map((s) => (<button key={s} onClick={() => setStatus(s)} className={chip(status === s)}>{s === "ALL" ? "All" : s}</button>))}
          </div>
        </div>
      </div>

      {/* Alert list */}
      <div className="space-y-2.5">
        {filtered.map((a) => {
          const Icon = CAT_ICON[a.category] ?? ShieldAlert;
          return (
            <div key={a.id} className={cn("card flex items-start gap-4 p-4 transition-opacity", pending && "opacity-60")}>
              <div className={cn("rounded-xl p-2.5", a.severity === "Critical" ? "bg-rose-50 text-rose-600" : a.severity === "Warning" ? "bg-amber-50 text-amber-600" : "bg-sky-50 text-sky-600")}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink-900">{a.title}</p>
                  <Badge color={SEVERITY_COLOR[a.severity]}>{a.severity}</Badge>
                  <Badge>{a.category}</Badge>
                  {a.status !== "Open" && <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">{a.status}</Badge>}
                  {a.escalatedAt && <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">Escalated</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-slate-600">{a.message}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {timeAgo(a.createdAt)}
                  {a.assetCode ? ` · ${a.assetCode}` : ""}
                  {a.assignedTo ? ` · → ${a.assignedTo}` : ""}
                </p>
              </div>
              {a.status === "Open" && (
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    onClick={() => startTransition(() => updateAlert(a.id, "Acknowledged"))}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    title="Acknowledge"
                  >
                    <Eye className="h-3.5 w-3.5" /> Ack
                  </button>
                  <button
                    onClick={() => startTransition(() => escalateAlert(a.id))}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                    title="Escalate"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" /> Escalate
                  </button>
                  <button
                    onClick={() => setAssigningId(a.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
                    title="Assign to Supervisor"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Assign
                  </button>
                  <button
                    onClick={() => startTransition(() => updateAlert(a.id, "Resolved"))}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                    title="Resolve"
                  >
                    <Check className="h-3.5 w-3.5" /> Resolve
                  </button>
                </div>
              )}
              {a.status === "Acknowledged" && (
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => startTransition(() => escalateAlert(a.id))}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" /> Escalate
                  </button>
                  <button
                    onClick={() => startTransition(() => updateAlert(a.id, "Resolved"))}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                  >
                    <Check className="h-3.5 w-3.5" /> Resolve
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="card p-10 text-center text-slate-400">No alerts match these filters.</div>}
      </div>

      {/* Assign modal */}
      <AssignModal
        open={!!assigningId}
        onClose={() => setAssigningId(null)}
        pending={pending}
        onAssign={(name) => {
          if (assigningId) {
            startTransition(async () => {
              await assignAlert(assigningId, name);
              setAssigningId(null);
            });
          }
        }}
      />
    </div>
  );
}
