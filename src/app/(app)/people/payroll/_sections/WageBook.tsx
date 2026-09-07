"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, SectionTitle, Badge } from "@/components/ui";
import { inr, fmtDate } from "@/lib/utils";
import { setWage } from "../actions";
import { useToast } from "@/components/Toast";
import { Plus, X } from "lucide-react";
import { Txt } from "@/components/Txt";

type Rate = {
  id: string;
  kind: string;
  amount: number;
  otHourly: number;
  effectiveFrom: Date;
  note: string | null;
};

type Person = {
  id: string;
  name: string;
  empCode: string;
  type: string;
  employmentType: string;
  wageRates: Rate[];
};

/**
 * Each person's wage, and its history.
 *
 * A wage is never edited in place — setting a new one records a fresh agreement
 * from a date. That is why the old rates stay visible: last month's pay sheet
 * was worked out from one of them, and being able to see which is the whole
 * point of keeping them.
 */
export function WageBook({ people, canEdit }: { people: Person[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<Person | null>(null);
  const missing = people.filter((p) => p.wageRates.length === 0);

  return (
    <div className="space-y-4">
      {missing.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            <b>{missing.length}</b>{" "}
            {missing.length === 1 ? "person has" : "people have"} no wage set, so they will show
            zero on the pay sheet: {missing.slice(0, 6).map((p) => p.name).join(", ")}
            {missing.length > 6 ? ` and ${missing.length - 6} more` : ""}.
          </p>
        </Card>
      )}

      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionTitle
            title="Wages"
            subtitle="A new wage starts from a date — the old one stays, so past pay sheets still add up"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium"><Txt text="Person" /></th>
                <th className="px-4 py-3 font-medium"><Txt text="Works as" /></th>
                <th className="px-4 py-3 font-medium"><Txt text="Current wage" /></th>
                <th className="px-4 py-3 font-medium"><Txt text="Overtime" /></th>
                <th className="px-4 py-3 font-medium"><Txt text="Since" /></th>
                <th className="px-4 py-3 font-medium"><Txt text="Earlier wages" /></th>
                {canEdit && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const current = p.wageRates[0];
                return (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink-900">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.empCode}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {p.type === "OPERATOR" ? "Operator" : "Driver"}
                      {p.employmentType === "CONTRACTOR" && (
                        <span className="ml-1 text-xs text-slate-400">(contractor)</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {current ? (
                        <span className="font-semibold text-ink-900">
                          {inr(current.amount)}
                          <span className="text-xs font-normal text-slate-400">
                            {current.kind === "MONTHLY" ? " /month" : " /day"}
                          </span>
                        </span>
                      ) : (
                        <Badge color="bg-amber-100 text-amber-800 ring-amber-600/20">Not set</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {current?.otHourly ? `${inr(current.otHourly)} /hour` : "Not paid"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {current ? fmtDate(current.effectiveFrom) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {p.wageRates.length > 1
                        ? p.wageRates
                            .slice(1)
                            .map((r) => `${inr(r.amount)} from ${fmtDate(r.effectiveFrom)}`)
                            .join(" · ")
                        : "—"}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setEditing(p)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          <Plus className="h-3 w-3" /> {current ? "New wage" : "Set wage"}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && <WageDialog person={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function WageDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const current = person.wageRates[0];

  const [kind, setKind] = useState(current?.kind ?? "DAILY");
  const [amount, setAmount] = useState(current ? String(current.amount) : "");
  const [otHourly, setOtHourly] = useState(current ? String(current.otHourly) : "0");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  function save() {
    start(async () => {
      const res = (await setWage({
        driverId: person.id,
        kind,
        amount: Number(amount),
        otHourly: Number(otHourly) || 0,
        effectiveFrom: from,
        note,
      })) as { error?: string; message?: string };
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.message ?? "Wage saved");
        onClose();
        router.refresh();
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-md p-5">
        <div className="flex items-start justify-between gap-3">
          <SectionTitle title={`Wage — ${person.name}`} subtitle={person.empCode} />
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600">How is this person paid?</label>
            <div className="mt-1 flex gap-2">
              {[
                { v: "DAILY", label: "Per day" },
                { v: "MONTHLY", label: "Per month" },
              ].map((o) => (
                <button
                  key={o.v}
                  onClick={() => setKind(o.v)}
                  className={
                    "flex-1 rounded-lg border px-3 py-2 text-sm font-medium " +
                    (kind === o.v
                      ? "border-brand-600 bg-brand-50 text-brand-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50")
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {kind === "DAILY"
                ? "Paid only for days worked. Rest days and leave are not paid."
                : "A fixed monthly salary. Rest days and leave are paid; absent days are deducted."}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">
              Wage {kind === "MONTHLY" ? "per month" : "per day"} (₹)
            </label>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={kind === "MONTHLY" ? "26000" : "600"}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">Overtime per hour (₹)</label>
            <input
              inputMode="decimal"
              value={otHourly}
              onChange={(e) => setOtHourly(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
            />
            <p className="mt-1 text-xs text-slate-500">Leave as 0 if overtime is not paid.</p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">This wage starts from</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">
              Pay sheets before this date keep the old wage.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">Reason (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. yearly increase"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium">
            Cancel
          </button>
          <button
            disabled={pending || !amount}
            onClick={save}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:bg-slate-300"
          >
            Save wage
          </button>
        </div>
      </Card>
    </div>
  );
}
