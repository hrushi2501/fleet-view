"use client";

import { useState } from "react";
import { runDatabaseAuditAction } from "@/app/(app)/admin/actions";
import { Database, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

export function RunDatabaseAuditButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();

  async function handleAudit() {
    setLoading(true);
    setResult(null);
    try {
      const res = await runDatabaseAuditAction();
      if ("error" in res) {
        setResult({ ok: false, message: res.error });
      } else {
        setResult({
          ok: true,
          message: `Audit completed (${res.result.status}): ${res.result.schema.matchedModels}/${res.result.schema.totalModels} models synced, latency ${res.result.health.latencyMs}ms.`,
        });
        router.refresh();
      }
    } catch (e: unknown) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Failed to run audit" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <button
        type="button"
        onClick={handleAudit}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 transition-colors"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
        {loading ? "Auditing Database..." : "Run Full Database Audit"}
      </button>

      {result && (
        <div
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
            result.ok
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-rose-50 text-rose-700 border border-rose-200"
          }`}
        >
          {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          <span>{result.message}</span>
        </div>
      )}
    </div>
  );
}
