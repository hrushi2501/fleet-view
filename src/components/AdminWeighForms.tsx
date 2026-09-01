"use client";

import { useState, useTransition, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Loader2, Trash2, Scale, AlertTriangle } from "lucide-react";
import { cn, inr, num } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAllQueries, invalidateProductionQueries } from "@/lib/query-invalidation";
import { seedRoles, saveRole, deleteRole, assignRole, linkUserToDriver } from "@/app/(app)/admin/actions";
import { saveTicket, deleteTicket } from "@/app/(app)/weighbridge/actions";
import { permissionsByModule } from "@/lib/rbac";
import { MATERIALS } from "@/lib/weighbridge";
import { isActionError } from "@/lib/action-result";

type Opt = { id: string; label: string };

const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function Inp({
  label, name, type = "text", defaultValue, value, onChange, required, step, placeholder, hint
}: {
  label: string; name: string; type?: string; defaultValue?: string | number; value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; required?: boolean; step?: string; placeholder?: string; hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}{required && <span className="text-rose-500"> *</span>}</span>
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
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}{required && <span className="text-rose-500"> *</span>}</span>
      <select name={name} defaultValue={defaultValue} value={value} onChange={onChange} required={required} className={inputCls}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Modal({ open, onClose, title, subtitle, wide, children }: { open: boolean; onClose: () => void; title: string; subtitle?: string; wide?: boolean; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className={cn("my-8 w-full rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 animate-fade-up", wide ? "max-w-4xl" : "max-w-2xl")}>
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div>
            <h3 className="text-lg font-bold text-ink-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function SubmitBar({ pending, onCancel, label = "Save" }: { pending: boolean; onCancel: () => void; label?: string }) {
  return (
    <div className="mt-5 flex justify-end gap-2.5">
      <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
      <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 shadow-sm">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}{label}
      </button>
    </div>
  );
}

function Trigger({ onClick, children, tone = "brand" }: { onClick: () => void; children: ReactNode; tone?: "brand" | "ghost" }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors shadow-xs", tone === "brand" ? "bg-brand-600 text-white hover:bg-brand-700" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50")}>
      {children}
    </button>
  );
}

/* ================================ M0 ================================ */

export function SeedRolesButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => start(async () => {
          try {
            const r = await seedRoles();
            if (isActionError(r)) { setMsg(r.error); return; }
            setMsg(`${r.roles} roles · ${r.linked} users linked`);
            toast.success("✓ Installed standard roles successfully", `${r.roles} roles configured`);
            router.refresh();
          } catch (_err) {
            toast.error("Role installation failed");
          }
        })}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60"
      >
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
  const toast = useToast();
  const queryClient = useQueryClient();
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
        <form action={(fd) => start(async () => {
          try {
            const result = await saveRole(role?.id ?? null, fd);
            if (isActionError(result)) { toast.error("Failed to save role", result.error); return; }
            setOpen(false);
            toast.success(role ? `✓ Permissions updated for ${role.label}` : "✓ Role created successfully");
            await invalidateAllQueries(queryClient);
            router.refresh();
          } catch (e) {
            toast.error("Failed to save role", e instanceof Error ? e.message : "Error");
          }
        })}>
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

          <div className="mt-4 max-h-80 space-y-4 overflow-y-auto rounded-xl ring-1 ring-slate-200 bg-slate-50/50 p-4">
            {groups.map((g) => (
              <div key={g.module}>
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">{g.module}</p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {g.items.map((p) => (
                    <label key={p.code} className="flex items-start gap-2 text-sm bg-white p-2 rounded-lg ring-1 ring-slate-100">
                      <input type="checkbox" name="permissions" value={p.code} defaultChecked={all || held.has(p.code)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" />
                      <span>
                        <span className="text-slate-700 font-medium">{p.label}</span>
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
  const toast = useToast();
  const queryClient = useQueryClient();

  return (
    <select
      defaultValue={roleId ?? ""}
      disabled={pending}
      onChange={(e) => start(async () => {
        const result = await assignRole(userId, e.target.value);
        if (isActionError(result)) { toast.error("Role assignment failed", result.error); return; }
        toast.success("✓ Role assignment updated");
        await invalidateAllQueries(queryClient);
        router.refresh();
      })}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium outline-none focus:border-brand-400 shadow-2xs"
    >
      <option value="">— No role —</option>
      {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
    </select>
  );
}

export function LinkDriverSelect({ userId, driverId, drivers }: { userId: string; driverId: string | null; drivers: Opt[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  return (
    <select
      defaultValue={driverId ?? ""}
      disabled={pending}
      onChange={(e) => start(async () => {
        const result = await linkUserToDriver(userId, e.target.value);
        if (isActionError(result)) { toast.error("Driver assignment failed", result.error); return; }
        toast.success("✓ Driver assigned to login");
        await invalidateAllQueries(queryClient);
        router.refresh();
      })}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium outline-none focus:border-brand-400 shadow-2xs"
    >
      <option value="">— No driver assigned —</option>
      {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
    </select>
  );
}

export function DeleteRoleButton({ id, isSystem }: { id: string; isSystem: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  if (isSystem) return <span className="text-xs text-slate-300">system</span>;

  async function handleDelete() {
    const result = await deleteRole(id);
    if (isActionError(result)) { toast.error("Could not delete role", result.error); return; }
    toast.success("✓ Role deleted successfully");
    await invalidateAllQueries(queryClient);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600 transition-colors"
        aria-label="Delete role"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <ConfirmDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfirm={handleDelete}
        title="Delete Role?"
        description="Are you sure you want to delete this custom role? Users assigned to this role will lose their custom permissions."
        confirmLabel="Delete Role"
        tone="danger"
      />
    </>
  );
}

/* ================================ WEIGHBRIDGE TICKET WITH LIVE CALC ================================ */

export function TicketForm({ assets, drivers, projects, dispatchNos }: { assets: Opt[]; drivers: Opt[]; projects: Opt[]; dispatchNos: string[] }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("DISPATCH");
  const [pending, start] = useTransition();

  // Live calculation state
  const [gross, setGross] = useState("");
  const [tare, setTare] = useState("");
  const [netInput, setNetInput] = useState("");
  const [rate, setRate] = useState("");
  const [billed, setBilled] = useState("");

  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const gVal = parseFloat(gross) || 0;
  const tVal = parseFloat(tare) || 0;
  const autoNetKg = gVal > 0 && tVal > 0 ? Math.max(0, gVal - tVal) : 0;
  const activeNetKg = netInput !== "" ? parseFloat(netInput) || 0 : autoNetKg;
  const netTonnes = activeNetKg / 1000;
  const rVal = parseFloat(rate) || 0;
  const totalAmount = netTonnes * rVal;

  const billedVal = parseFloat(billed) || 0;
  const billedShortfall = billedVal > 0 && activeNetKg > 0 ? billedVal - activeNetKg : 0;

  function resetForm() {
    setGross("");
    setTare("");
    setNetInput("");
    setRate("");
    setBilled("");
  }

  return (
    <>
      <Trigger onClick={() => { resetForm(); setOpen(true); }}><Plus className="h-4 w-4" /> Record Ticket</Trigger>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record Weighbridge Ticket"
        subtitle="Enter the slip exactly as printed. Gross & Tare automatically derive Net weight and total value."
      >
        <form
          action={(fd) => start(async () => {
            try {
              const result = await saveTicket(fd);
              if (isActionError(result)) { toast.error("Failed to save ticket", result.error); return; }
              setOpen(false);
              toast.success(`✓ Weighbridge ${kind.toLowerCase()} ticket saved`, `Net: ${num(activeNetKg)} kg (${netTonnes.toFixed(2)} t)`);
              await invalidateProductionQueries(queryClient);
              await invalidateAllQueries(queryClient);
              router.refresh();
            } catch (err) {
              toast.error("Failed to save ticket", err instanceof Error ? err.message : "Error");
            }
          })}
          className="grid gap-4 sm:grid-cols-2"
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Kind<span className="text-rose-500"> *</span></span>
            <select name="kind" required value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
              <option value="DISPATCH">Dispatch — material leaving quarry</option>
              <option value="RECEIPT">Receipt — material arriving at site</option>
            </select>
          </label>
          <Inp label="Ticket No." name="ticketNo" required placeholder="WB-2026-01423" />
          
          {kind === "RECEIPT" && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">Answers Dispatch Ticket (Matching)</span>
              <input name="pairedTicketNo" list="dispatch-nos" className={inputCls} placeholder="WB-2026-01423" />
              <datalist id="dispatch-nos">{dispatchNos.map((d) => <option key={d} value={d} />)}</datalist>
              <span className="mt-1 block text-[11px] text-slate-400">Links arriving load with source dispatch to track transit loss.</span>
            </label>
          )}

          <Inp label="Date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          <Sel label="Material" name="material" required options={MATERIALS.map((m) => ({ value: m, label: m }))} />
          <Sel label="Vehicle" name="assetId" options={[{ value: "", label: "— Select Vehicle —" }, ...assets.map((a) => ({ value: a.id, label: a.label }))]} />
          <Sel label="Driver" name="driverId" options={[{ value: "", label: "— Select Driver —" }, ...drivers.map((d) => ({ value: d.id, label: d.label }))]} />
          <Sel label="Project" name="projectId" options={[{ value: "", label: "— Select Project —" }, ...projects.map((p) => ({ value: p.id, label: p.label }))]} />
          
          <Inp
            label="Gross Weight (kg)"
            name="grossKg"
            type="number"
            step="1"
            value={gross}
            onChange={(e) => setGross(e.target.value)}
            placeholder="e.g. 28450"
          />
          <Inp
            label="Tare Weight (kg)"
            name="tareKg"
            type="number"
            step="1"
            value={tare}
            onChange={(e) => setTare(e.target.value)}
            placeholder="e.g. 10200"
          />

          <Inp
            label="Net Weight (kg)"
            name="netKg"
            type="number"
            step="1"
            value={netInput !== "" ? netInput : (autoNetKg > 0 ? String(autoNetKg) : "")}
            onChange={(e) => setNetInput(e.target.value)}
            placeholder={autoNetKg > 0 ? String(autoNetKg) : "Auto-computed"}
            hint={autoNetKg > 0 && netInput === "" ? `✓ Derived: ${num(autoNetKg)} kg (${netTonnes.toFixed(2)} t)` : "Leave blank to auto-calculate"}
          />

          <Inp
            label="Rate (₹/tonne)"
            name="rate"
            type="number"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="e.g. 450"
          />

          {kind === "RECEIPT" && (
            <Inp
              label="Billed Weight (kg)"
              name="billedKg"
              type="number"
              step="1"
              value={billed}
              onChange={(e) => setBilled(e.target.value)}
              placeholder="Invoiced weight by vendor"
              hint="Flags transit weight difference"
            />
          )}

          <Inp label="From (Source)" name="fromLocation" placeholder="Jaipur Quarry / Plant" />
          <Inp label="To (Destination)" name="toLocation" placeholder="NH-48 Chainage 42+200" />
          <Inp label="Vendor / Transporter" name="vendor" placeholder="Supplier name" />

          {/* Live Calculation Banner */}
          {activeNetKg > 0 && (
            <div className="sm:col-span-2 rounded-2xl bg-brand-50 p-4 ring-1 ring-brand-200 animate-fade-up">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white shadow-xs">
                    <Scale className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-brand-950 uppercase tracking-wide">Live Derived Net Weight</span>
                    <p className="text-base font-extrabold text-brand-900">
                      {num(activeNetKg)} kg <span className="text-sm font-semibold text-brand-700">({netTonnes.toFixed(2)} tonnes)</span>
                    </p>
                  </div>
                </div>

                {rVal > 0 && (
                  <div className="text-right">
                    <span className="text-xs font-semibold text-brand-600 uppercase tracking-wide">Calculated Value</span>
                    <p className="text-base font-extrabold text-brand-900">{inr(totalAmount)}</p>
                  </div>
                )}
              </div>

              {kind === "RECEIPT" && billedShortfall > 0 && (
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-rose-100/70 px-3 py-2 text-xs font-semibold text-rose-800 ring-1 ring-rose-300/50">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>Transit Shortfall: {num(billedShortfall)} kg billed but not received!</span>
                </div>
              )}
            </div>
          )}

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Slip Photo</span>
            <input name="photo" type="file" accept="image/*" className={inputCls} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
            <input name="notes" className={inputCls} placeholder="Optional driver remarks" />
          </label>

          <div className="sm:col-span-2">
            <SubmitBar pending={pending} onCancel={() => setOpen(false)} label="Save Ticket" />
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DeleteTicketButton({ id, ticketNo }: { id: string; ticketNo?: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  async function handleDelete() {
    const result = await deleteTicket(id);
    if (isActionError(result)) { toast.error("Could not delete ticket", result.error); return; }
    toast.success(`✓ Ticket ${ticketNo || ""} deleted successfully`);
    await invalidateProductionQueries(queryClient);
    await invalidateAllQueries(queryClient);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600 transition-colors"
        aria-label="Delete ticket"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <ConfirmDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfirm={handleDelete}
        title={`Delete Ticket ${ticketNo || ""}?`}
        description="Are you sure you want to delete this weighbridge slip? This cannot be undone."
        confirmLabel="Delete Ticket"
        tone="danger"
      />
    </>
  );
}
