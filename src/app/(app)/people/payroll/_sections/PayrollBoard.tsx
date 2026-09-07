"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionTitle, Badge, EmptyState } from "@/components/ui";
import { inr } from "@/lib/utils";
import { buildRun, adjustLine, finaliseRun } from "../actions";
import { useToast } from "@/components/Toast";
import { RefreshCw, Lock, FileDown, Sheet, Pencil, X } from "lucide-react";
import { Txt } from "@/components/Txt";

type Line = {
  id: string;
  empCode: string;
  name: string;
  wageKind: string;
  wageAmount: number;
  daysPresent: number;
  daysHalf: number;
  daysLeave: number;
  daysRest: number;
  daysAbsent: number;
  daysPaid: number;
  otHours: number;
  basic: number;
  overtime: number;
  bonus: number;
  advance: number;
  deduction: number;
  net: number;
  adjustedNote: string | null;
};

type Run = {
  id: string;
  status: string;
  standardDays: number;
  standardHours: number;
  finalisedAt: string | null;
  finalisedBy: string | null;
};

/**
 * The month's sheet: prepare it, adjust it, sign it off, download it.
 *
 * A finalised run renders read-only rather than hiding its controls, so it is
 * obvious the month is closed rather than merely looking odd.
 */
export function PayrollBoard({
  period,
  run,
  lines,
  recent,
  canEdit,
  canApprove,
}: {
  period: string;
  run: Run | null;
  lines: Line[];
  recent: { period: string; status: string; people: number }[];
  canEdit: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Line | null>(null);

  const finalised = run?.status === "FINALISED";
  const totalNet = lines.reduce((s, l) => s + l.net, 0);

  function act(fn: () => Promise<unknown>) {
    start(async () => {
      const res = (await fn()) as { error?: string; message?: string };
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.message ?? "Saved");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
          <SectionTitle
            title={`Pay Sheet — ${period}`}
            subtitle={
              finalised
                ? `Finalised${run?.finalisedBy ? ` by ${run.finalisedBy}` : ""} — this month is closed`
                : "Draft — you can rebuild it after fixing attendance"
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={period}
              onChange={(e) => router.push(`/people/payroll?period=${e.target.value}`)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
              aria-label="Choose month"
            >
              {monthChoices(period, recent.map((r) => r.period)).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            {canEdit && !finalised && (
              <button
                onClick={() => act(() => buildRun(period))}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:bg-slate-300"
              >
                <RefreshCw className={"h-4 w-4" + (pending ? " animate-spin" : "")} />
                {lines.length ? "Rebuild from attendance" : "Prepare this month"}
              </button>
            )}

            {lines.length > 0 && (
              <>
                <a
                  href={`/api/payroll/${period}?format=xlsx`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Sheet className="h-4 w-4" /> Excel
                </a>
                <a
                  href={`/api/payroll/${period}?format=pdf`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <FileDown className="h-4 w-4" /> PDF
                </a>
              </>
            )}

            {canApprove && !finalised && lines.length > 0 && (
              <button
                onClick={() => act(() => finaliseRun(run!.id))}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
              >
                <Lock className="h-4 w-4" /> Finalise
              </button>
            )}
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="This month has not been prepared"
              description={
                canEdit
                  ? "Press “Prepare this month”. It reads the attendance register and works out each person's pay."
                  : "Ask an administrator to prepare this month's payroll."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium"><Txt text="Person" /></th>
                  <th className="px-4 py-3 font-medium"><Txt text="Wage" /></th>
                  <th className="px-4 py-3 text-right font-medium"><Txt text="Present" /></th>
                  <th className="px-4 py-3 text-right font-medium"><Txt text="Half" /></th>
                  <th className="px-4 py-3 text-right font-medium"><Txt text="Absent" /></th>
                  <th className="px-4 py-3 text-right font-medium"><Txt text="Days Paid" /></th>
                  <th className="px-4 py-3 text-right font-medium"><Txt text="OT" /></th>
                  <th className="px-4 py-3 text-right font-medium"><Txt text="Basic" /></th>
                  <th className="px-4 py-3 text-right font-medium"><Txt text="Advance" /></th>
                  <th className="px-4 py-3 text-right font-medium"><Txt text="Net" /></th>
                  {canEdit && !finalised && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink-900">{l.name}</div>
                      <div className="text-xs text-slate-500">{l.empCode}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {l.wageAmount > 0 ? (
                        <>
                          {inr(l.wageAmount)}
                          <span className="text-xs text-slate-400">
                            {l.wageKind === "MONTHLY" ? " /month" : " /day"}
                          </span>
                        </>
                      ) : (
                        <Badge color="bg-amber-100 text-amber-800 ring-amber-600/20">No wage set</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{l.daysPresent}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{l.daysHalf}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{l.daysAbsent}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink-900">{l.daysPaid}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{l.otHours || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{inr(l.basic)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {l.advance ? inr(l.advance) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-ink-900">{inr(l.net)}</td>
                    {canEdit && !finalised && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setEditing(l)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          <Pencil className="h-3 w-3" /> Adjust
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                  <td className="px-4 py-3 text-ink-900" colSpan={9}>
                    Total — {lines.length} people
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-900">{inr(totalNet)}</td>
                  {canEdit && !finalised && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <AdjustDialog
          line={editing}
          onClose={() => setEditing(null)}
          onSave={(v) =>
            act(async () => {
              const res = await adjustLine({ lineId: editing.id, ...v });
              setEditing(null);
              return res;
            })
          }
          pending={pending}
        />
      )}
    </div>
  );
}

/** Advance, deduction and bonus for one person's month. */
function AdjustDialog({
  line,
  onClose,
  onSave,
  pending,
}: {
  line: Line;
  onClose: () => void;
  onSave: (v: { bonus: number; advance: number; deduction: number; note: string }) => void;
  pending: boolean;
}) {
  const [bonus, setBonus] = useState(String(line.bonus));
  const [advance, setAdvance] = useState(String(line.advance));
  const [deduction, setDeduction] = useState(String(line.deduction));
  const [note, setNote] = useState(line.adjustedNote ?? "");

  const gross = line.basic + line.overtime;
  const preview = Math.max(0, gross + n(bonus) - n(advance) - n(deduction));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-md p-5">
        <div className="flex items-start justify-between gap-3">
          <SectionTitle title={`Adjust — ${line.name}`} subtitle={line.empCode} />
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <Field label="Advance already given" value={advance} onChange={setAdvance} />
          <Field label="Other deduction" value={deduction} onChange={setDeduction} />
          <Field label="Bonus" value={bonus} onChange={setBonus} />
          <div>
            <label className="text-xs font-medium text-slate-600">Reason (kept in the record)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. advance taken on 12th for medical"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-600">
            Earned {inr(gross)} — will be paid
          </span>
          <span className="font-bold text-ink-900">{inr(preview)}</span>
        </div>
        {gross + n(bonus) - n(advance) - n(deduction) < 0 && (
          <p className="mt-2 text-xs text-amber-700">
            The advance is more than this month&apos;s earnings, so the payslip shows zero. Carry the
            rest to next month.
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium">
            Cancel
          </button>
          <button
            disabled={pending}
            onClick={() => onSave({ bonus: n(bonus), advance: n(advance), deduction: n(deduction), note })}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:bg-slate-300"
          >
            Save
          </button>
        </div>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
      />
    </div>
  );
}

function n(v: string): number {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/** The current month, the eleven before it, and anything already run. */
function monthChoices(current: string, existing: string[]): string[] {
  const out = new Set<string>(existing);
  out.add(current);
  const [y, m] = current.split("-").map(Number);
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(y!, m! - 1 - i, 1));
    out.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return [...out].sort().reverse();
}
