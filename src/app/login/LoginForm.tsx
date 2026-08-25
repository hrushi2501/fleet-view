"use client";

import { useActionState } from "react";
import { login } from "./actions";
import { Truck, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null as { error?: string } | null);

  return (
    <div className="flex min-h-screen">
      {/* Left brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-ink-900 p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-brand-700/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500 shadow-lg shadow-brand-500/40">
            <Truck className="h-6 w-6" />
          </div>
          <div>
            <p className="text-lg font-bold">FleetView ERP</p>
            <p className="text-xs uppercase tracking-widest text-slate-400">Mahadev Constructions</p>
          </div>
        </div>
        <div className="relative space-y-6">
          <h1 className="text-4xl font-bold leading-tight">
            Make every asset <span className="text-brand-400">accountable.</span>
          </h1>
          <p className="max-w-md text-slate-400">
            Telematics-native fleet & equipment ERP for road construction — live tracking, leak-proof
            fuel, predictive maintenance, compliance, and asset-level P&amp;L.
          </p>
          {/* These were three invented figures — "−32% Fuel loss", "+14%
              Utilization", "₹0 Penalties" — sitting in the exact place a real
              result would sit, on the front door of a system holding a real
              fleet's records. Nobody can be signed in on this page, so they
              could never have been this fleet's numbers; and a made-up number
              beside a real one teaches the reader to trust neither. What the
              product does is a claim it can actually stand behind. */}
          <div className="grid max-w-md grid-cols-3 gap-3 pt-4">
            {[
              ["Live", "Vehicle telemetry, straight from the OEM"],
              ["Tank-level", "Fuel measured, not just recorded"],
              ["Per-asset", "Cost and utilisation on every machine"],
            ].map(([v, l]) => (
              <div key={v} className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                <p className="text-sm font-bold text-brand-400">{v}</p>
                <p className="mt-1 text-[11px] leading-snug text-slate-400">{l}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-slate-500">Mahadev Constructions · authorised users only</p>
      </div>

      {/* Right login form */}
      <div className="flex w-full items-center justify-center bg-[var(--background)] p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-white">
                <Truck className="h-5 w-5" />
              </div>
              <p className="text-lg font-bold">FleetView ERP</p>
            </div>
          </div>
          <h2 className="text-2xl font-bold text-ink-900">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-500">Sign in to your fleet command center.</p>

          <form action={formAction} className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <input
                name="email"
                type="email"
                placeholder="you@mahadev.com"
                required
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
              <input
                name="password"
                type="password"
                placeholder="••••••••"
                required
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
            </div>
            {state?.error && <p className="text-sm text-rose-600">{state.error}</p>}
            <button
              disabled={pending}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 transition-colors hover:bg-brand-600 disabled:opacity-60"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </button>
          </form>

          <a href="/install" className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-brand-200 bg-brand-50 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-100">
            📲 Install this app on your phone
          </a>

          <p className="mt-4 text-center text-xs text-slate-400">
            Use the credentials provided by your administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
