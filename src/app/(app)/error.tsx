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
import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw, ArrowLeft } from "lucide-react";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Goes to the platform log with the digest, which is the only thread
    // connecting what the user saw to what actually happened.
    console.error("[page-error]", error.digest ?? "(no digest)", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 ring-1 ring-amber-200">
          <AlertTriangle className="h-6 w-6 text-amber-600" />
        </div>

        <h1 className="mt-5 text-lg font-bold text-ink-900">This screen could not load</h1>
        <p className="mt-2 text-sm text-slate-500">
          Nothing you entered has been lost, and you are still signed in. Try loading it again — if
          it keeps happening, send the reference below to your administrator.
        </p>

        {error.digest && (
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500 ring-1 ring-slate-200">
            Reference: {error.digest}
          </p>
        )}

        <div className="mt-6 flex justify-center gap-2.5">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <button
            onClick={() => unstable_retry()}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
          >
            <RotateCw className="h-4 w-4" /> Try again
          </button>
        </div>
      </div>
    </div>
  );
}
