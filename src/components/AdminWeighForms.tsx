"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { seedRoles, saveRole, deleteRole, assignRole, linkUserToDriver } from "@/app/(app)/admin/actions";
import { saveTicket, deleteTicket } from "@/app/(app)/weighbridge/actions";
import { permissionsByModule, PERMISSIONS } from "@/lib/rbac";
import { MATERIALS } from "@/lib/weighbridge";

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

function Modal({ open, onClose, title, subtitle, wide, children }: { open: boolean; onClose: () => void; title: string; subtitle?: string; wide?: boolean; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className={cn("my-8 w-full rounded-2xl bg-white shadow-xl ring-1 ring-slate-200", wide ? "max-w-4xl" : "max-w-2xl")}>
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

/* ================================ M0 ================================ */

export function SeedRolesButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => start(async () => { const r = await seedRoles(); setMsg(`${r.roles} roles · ${r.linked} users linked`); router.refresh(); })} disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Install Role Set
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  );
}

export function RoleForm({ role }: { role?: { id: string; name: string; label: string; description: string | null; permissions: string[]; approvalLimit: number; isSystem: boolean } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const held = new Set(role?.permissions ?? []);
  const all = held.has("*");
  const groups = permissionsByModule();

  return (
    <>
      {role ? (
        <button onClick={() => setOpen(true)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">Permissions</button>
      ) : (
        <Trigger onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New Role</Trigger>
      )}
      <Modal open={open} onClose={() => setOpen(false)} wide title={role ? `Permissions — ${role.label}` : "Create Role"} subtitle="Tick exactly what this role may do. Sensitive permissions are marked.">
        <form action={(fd) => start(async () => { await saveRole(role?.id ?? null, fd); setOpen(false); router.refresh(); })}>
          <div className="grid gap-4 sm:grid-cols-2">
            {!role && <Inp label="Role Key" name="name" required placeholder="SiteSupervisor" hint="No spaces — used internally" />}
            <Inp label="Display Name" name="label" required defaultValue={role?.label} placeholder="Site Supervisor" />
            <Inp label="Approval Limit ₹" name="approvalLimit" type="number" step="0.01" defaultValue={role?.approvalLimit ?? 0} hint="0 = cannot approve anything" />
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">Description</span>
              <input name="description" defaultValue={role?.description ?? ""} className={inputCls} />
            </label>
          </div>

          {all && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This role holds full access (<code>*</code>). Ticking boxes below will replace that with an explicit list.
            </p>
          )}

          <div className="mt-4 max-h-80 space-y-4 overflow-y-auto rounded-lg ring-1 ring-slate-100 p-4">
            {groups.map((g) => (
              <div key={g.module}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">{g.module}</p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {g.items.map((p) => (
                    <label key={p.code} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="permissions" value={p.code} defaultChecked={all || held.has(p.code)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" />
                      <span>
                        <span className="text-slate-700">{p.label}</span>
                        {p.sensitive && <span className="ml-1 rounded bg-rose-50 px-1 text-[10px] font-semibold text-rose-600">sensitive</span>}
                        <span className="block font-mono text-[10px] text-slate-400">{p.code}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <SubmitBar pending={pending} onCancel={() => setOpen(false)} label={role ? "Save Permissions" : "Create Role"} />
        </form>
      </Modal>
    </>
  );
}

export function AssignRoleSelect({ userId, roleId, roles }: { userId: string; roleId: string | null; roles: Opt[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <select
      defaultValue={roleId ?? ""}
      disabled={pending}
      onChange={(e) => start(async () => { await assignRole(userId, e.target.value); router.refresh(); })}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-brand-400"
    >
      <option value="">— No role —</option>
      {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
    </select>
  );
}

export function LinkDriverSelect({ userId, driverId, drivers }: { userId: string; driverId: string | null; drivers: Opt[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <select
      defaultValue={driverId ?? ""}
      disabled={pending}
      onChange={(e) => start(async () => { await linkUserToDriver(userId, e.target.value); router.refresh(); })}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-brand-400"
    >
      <option value="">— Not linked —</option>
      {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
    </select>
  );
}

export function DeleteRoleButton({ id, isSystem }: { id: string; isSystem: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  if (isSystem) return <span className="text-xs text-slate-300">system</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={() => start(async () => { try { await deleteRole(id); router.refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } })}
        disabled={pending} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50" aria-label="Delete role">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </span>
  );
}

/* ================================ M24 ================================ */

export function TicketForm({ assets, drivers, projects, dispatchNos }: { assets: Opt[]; drivers: Opt[]; projects: Opt[]; dispatchNos: string[] }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("DISPATCH");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Trigger onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Record Ticket</Trigger>
      <Modal open={open} onClose={() => setOpen(false)} title="Record Weighbridge Ticket" subtitle="Enter the slip exactly as printed. Receipts are matched to their dispatch ticket to expose transit loss.">
        <form action={(fd) => start(async () => { await saveTicket(fd); setOpen(false); router.refresh(); })} className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Kind<span className="text-rose-500"> *</span></span>
            <select name="kind" required value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
              <option value="DISPATCH">Dispatch — material leaving</option>
              <option value="RECEIPT">Receipt — material arriving</option>
            </select>
          </label>
          <Inp label="Ticket No." name="ticketNo" required placeholder="WB-2026-01423" />
          {kind === "RECEIPT" && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">Answers Dispatch Ticket</span>
              <input name="pairedTicketNo" list="dispatch-nos" className={inputCls} placeholder="WB-2026-01423" />
              <datalist id="dispatch-nos">{dispatchNos.map((d) => <option key={d} value={d} />)}</datalist>
              <span className="mt-1 block text-[11px] text-slate-400">Without this link the dispatch shows as never received.</span>
            </label>
          )}
          <Inp label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Sel label="Material" name="material" required options={MATERIALS.map((m) => ({ value: m, label: m }))} />
          <Sel label="Vehicle" name="assetId" options={[{ value: "", label: "— None —" }, ...assets.map((a) => ({ value: a.id, label: a.label }))]} />
          <Sel label="Driver" name="driverId" options={[{ value: "", label: "— None —" }, ...drivers.map((d) => ({ value: d.id, label: d.label }))]} />
          <Sel label="Project" name="projectId" options={[{ value: "", label: "— None —" }, ...projects.map((p) => ({ value: p.id, label: p.label }))]} />
          <Inp label="Gross (kg)" name="grossKg" type="number" step="1" />
          <Inp label="Tare (kg)" name="tareKg" type="number" step="1" />
          <Inp label="Net (kg)" name="netKg" type="number" step="1" hint="Blank derives gross − tare" />
          <Inp label="From" name="fromLocation" placeholder="Quarry / plant" />
          <Inp label="To" name="toLocation" placeholder="Site chainage" />
          <Inp label="Vendor" name="vendor" />
          <Inp label="Rate ₹/tonne" name="rate" type="number" step="0.01" />
          {kind === "RECEIPT" && <Inp label="Billed (kg)" name="billedKg" type="number" step="1" hint="What the supplier invoiced — flags paying for material that never arrived" />}
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Slip Photo</span>
            <input name="photo" type="file" accept="image/*" className={inputCls} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
            <input name="notes" className={inputCls} />
          </label>
          <div className="sm:col-span-2"><SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Ticket" /></div>
        </form>
      </Modal>
    </>
  );
}

export function DeleteTicketButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button onClick={() => start(async () => { await deleteTicket(id); router.refresh(); })} disabled={pending}
      className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50" aria-label="Delete">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </button>
  );
}
