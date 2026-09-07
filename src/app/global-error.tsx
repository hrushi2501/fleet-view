"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RotateCw, Copy, Check } from "lucide-react";
import "./globals.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [refCode] = useState(() => error.digest || "ERR-" + Math.random().toString(36).slice(2, 8).toUpperCase());

  useEffect(() => {
    console.error("[root-global-error]", refCode, error);
  }, [error, refCode]);

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(refCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { setCopied(false); }
  };

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-slate-50 p-6 font-sans text-slate-900 antialiased">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl ring-1 ring-black/5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-200">
            <AlertTriangle className="h-7 w-7 text-rose-600" />
          </div>

          <h1 className="mt-5 text-xl font-bold text-slate-900">Application Encountered a Problem</h1>
          <p className="mt-2 text-sm text-slate-500">
            An unexpected error occurred while loading the application. Please try reloading the page.
            If the problem persists, share the support reference below with the technical team.
          </p>

          <div className="mt-5 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5 ring-1 ring-slate-200">
            <div className="text-left">
              <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Support Reference
              </span>
              <span className="font-mono text-xs font-semibold text-slate-900">{refCode}</span>
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

          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => retry()}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 transition"
            >
              <RotateCw className="h-4 w-4" /> Reload Application
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
