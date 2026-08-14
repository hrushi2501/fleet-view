"use client";

import { useState, useMemo } from "react";
import { Badge, Progress } from "@/components/ui";
import { AssetGlass } from "@/components/AssetGlass";
import { ASSET_CLASS_LABEL, STATUS_COLOR, healthColor, num, inr, cn } from "@/lib/utils";
import { Search } from "lucide-react";

type Row = {
  id: string;
  code: string;
  name: string;
  assetClass: string;
  ownershipType: string;
  status: string;
  healthScore: number;
  utilization: number;
  meterValue: number;
  primaryMeter: string;
  registrationNo: string | null;
  project: string;
};

const OWN_COLOR: Record<string, string> = {
  OWNED: "bg-brand-50 text-brand-700 ring-brand-600/20",
  LEASED: "bg-violet-50 text-violet-700 ring-violet-600/20",
  HIRED: "bg-amber-50 text-amber-700 ring-amber-600/20",
  CONTRACTOR: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export function FleetTable({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [own, setOwn] = useState("ALL");
  const [selId, setSelId] = useState<string | null>(null);

  const classes = useMemo(() => [...new Set(rows.map((r) => r.assetClass))], [rows]);
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))], [rows]);

  const filtered = rows.filter((r) => {
    if (cls !== "ALL" && r.assetClass !== cls) return false;
    if (status !== "ALL" && r.status !== status) return false;
    if (own !== "ALL" && r.ownershipType !== own) return false;
    if (q) {
      const t = `${r.code} ${r.name} ${r.registrationNo ?? ""} ${r.project}`.toLowerCase();
      if (!t.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const sel = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, name, reg. no…" className={cn(sel, "w-full pl-9")} />
        </div>
        <select value={cls} onChange={(e) => setCls(e.target.value)} className={sel}>
          <option value="ALL">All Classes</option>
          {classes.map((c) => (<option key={c} value={c}>{ASSET_CLASS_LABEL[c] ?? c}</option>))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
          <option value="ALL">All Status</option>
          {statuses.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <select value={own} onChange={(e) => setOwn(e.target.value)} className={sel}>
          <option value="ALL">All Ownership</option>
          {["OWNED", "LEASED", "HIRED", "CONTRACTOR"].map((o) => (<option key={o} value={o}>{o}</option>))}
        </select>
        <span className="ml-auto text-sm text-slate-500">{filtered.length} of {rows.length}</span>
      </div>

      {/* Desktop Table View */}
      <div className="card hidden overflow-hidden p-0 md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Asset</th>
                <th className="px-4 py-3 font-medium">Class</th>
                <th className="px-4 py-3 font-medium">Ownership</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Meter</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Util.</th>
                <th className="px-4 py-3 font-medium">Health</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => setSelId(r.id)} className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3">
                    <button className="font-semibold text-brand-700 hover:underline">{r.code}</button>
                    <p className="text-xs text-slate-400">{r.name}{r.registrationNo ? ` · ${r.registrationNo}` : ""}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{ASSET_CLASS_LABEL[r.assetClass] ?? r.assetClass}</td>
                  <td className="px-4 py-3"><Badge color={OWN_COLOR[r.ownershipType]}>{r.ownershipType}</Badge></td>
                  <td className="px-4 py-3 text-slate-600">{r.project}</td>
                  <td className="px-4 py-3 text-slate-600">{num(r.meterValue)} {r.primaryMeter === "SMU" ? "hrs" : "km"}</td>
                  <td className="px-4 py-3"><Badge color={STATUS_COLOR[r.status]}>{r.status}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2"><Progress value={r.utilization} className="w-16" /><span className="text-xs text-slate-500">{r.utilization}%</span></div>
                  </td>
                  <td className="px-4 py-3"><span className={`font-bold ${healthColor(r.healthScore)}`}>{r.healthScore}</span></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No assets match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Adaptive Cards View (< 768px) */}
      <div className="space-y-3 md:hidden">
        {filtered.map((r) => (
          <div
            key={r.id}
            onClick={() => setSelId(r.id)}
            role="button"
            tabIndex={0}
            className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition-all active:scale-[0.99] active:bg-slate-50"
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base text-brand-700">{r.code}</span>
                  <Badge color={OWN_COLOR[r.ownershipType]}>{r.ownershipType}</Badge>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {r.name} {r.registrationNo ? `· ${r.registrationNo}` : ""}
                </p>
              </div>
              <Badge color={STATUS_COLOR[r.status]}>{r.status}</Badge>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-400">Class:</span>
                <p className="font-medium text-slate-700 truncate">{ASSET_CLASS_LABEL[r.assetClass] ?? r.assetClass}</p>
              </div>
              <div>
                <span className="text-slate-400">Site / Project:</span>
                <p className="font-medium text-slate-700 truncate">{r.project || "Unassigned"}</p>
              </div>
              <div>
                <span className="text-slate-400">Meter:</span>
                <p className="font-medium text-slate-700">{num(r.meterValue)} {r.primaryMeter === "SMU" ? "hrs" : "km"}</p>
              </div>
              <div>
                <span className="text-slate-400">Health:</span>
                <p className={cn("font-bold text-sm", healthColor(r.healthScore))}>{r.healthScore}/100</p>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
              <div className="flex items-center gap-2 flex-1 mr-4">
                <span>Util: {r.utilization}%</span>
                <Progress value={r.utilization} className="flex-1" />
              </div>
              <span className="font-semibold text-brand-600">View details →</span>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
            No assets match your filters.
          </div>
        )}
      </div>

      {selId && <AssetGlass assetId={selId} onClose={() => setSelId(null)} />}
    </div>
  );
}
