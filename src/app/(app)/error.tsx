"use client";

/**
 * The error boundary for every office screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The app had no `error.tsx` anywhere, so an uncaught exception on any page
 * fell through to the framework's own fallback. For a site supervisor that is
 * an unstyled screen with a hex digest on it — indistinguishable from the app
 * being broken for good, and there is nothing on it to click.
 *
 * Next redacts the real message in production builds on purpose, so there is
 * genuinely nothing useful to show the user about *what* failed. What we can do
 * is make the screen calm, keep them signed in, give them a way back, and
 * surface the digest so a support call can be tied to a server log.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw, ArrowLeft, Copy, Check } from "lucide-react";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [refCode] = useState(() => error.digest || "ERR-" + Math.random().toString(36).slice(2, 8).toUpperCase());

  useEffect(() => {
    console.error("[page-error]", refCode, error);
  }, [error, refCode]);

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(refCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { setCopied(false); }
  };

  return (
    <div className="flex min-h-[65vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-lg ring-1 ring-black/5">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 ring-1 ring-amber-200">
          <AlertTriangle className="h-7 w-7 text-amber-600" />
        </div>

        <h1 className="mt-5 text-xl font-bold text-ink-900">We couldn&apos;t load this page</h1>
        <p className="mt-2 text-sm text-slate-500">
          Please try refreshing. If your session has ended, sign in again.
          If this continues, copy the reference code below and share it with the technical team.
        </p>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5 ring-1 ring-slate-200">
          <div className="text-left">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Support Reference
            </span>
            <span className="font-mono text-xs font-semibold text-ink-900">{refCode}</span>
          </div>
          <button
            type="button"
            onClick={copyRef}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 transition"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-emerald-700 font-semibold">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-slate-400" />
                <span>Copy Code</span>
              </>
            )}
          </button>
        </div>

        <div className="mt-6 flex justify-center gap-2.5">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <button
            onClick={() => retry()}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-500 transition"
          >
            <RotateCw className="h-4 w-4" /> Try again
          </button>
        </div>
      </div>
    </div>
  );
}
