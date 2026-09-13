"use client";

/**
 * Minimal, modern sign-in screen for FleetView ERP at Mahadev Constructions.
 *
 * Preserves all functionality:
 * - Credentials sign-in with server-side validation and lockout protection
 * - Hydration-safe localStorage persistence for remembered email
 * - Password visibility toggle
 * - Admin password reset guidance note
 * - Seamless toggle to Driver login flow
 * - Phone app installation link (/install)
 * - Required company attribution for Mahadev Constructions and Pitbull Corporations
 */

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Loader2,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Truck,
  Info,
  Smartphone,
} from "lucide-react";
import { login } from "./actions";
import { MahadevMark } from "./MahadevMark";

type LoginState = { error?: string } | null;

/** LocalStorage key for remembered address (per-browser, never transmitted). */
const REMEMBERED_EMAIL = "mahadev:last-email";

export default function OfficeLogin({ onDriverLogin }: { onDriverLogin: () => void }) {
  const [state, formAction, pending] = useActionState(login, null as LoginState);
  const [showPassword, setShowPassword] = useState(false);
  const [askedAboutReset, setAskedAboutReset] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const rememberRef = useRef<HTMLInputElement>(null);

  // Restore remembered email on mount without hydration mismatch.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBERED_EMAIL);
      if (!saved) return;
      if (emailRef.current) emailRef.current.value = saved;
      if (rememberRef.current) rememberRef.current.checked = true;
    } catch {
      /* storage unavailable in private browsing or restricted settings */
    }
  }, []);

  function persistEmailChoice() {
    try {
      const address = emailRef.current?.value.trim() ?? "";
      if (rememberRef.current?.checked && address) {
        window.localStorage.setItem(REMEMBERED_EMAIL, address);
      } else {
        window.localStorage.removeItem(REMEMBERED_EMAIL);
      }
    } catch {
      /* storage write failure does not affect sign-in */
    }
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-ink-900 text-white">
      {/* ── Mahadev Fleet Truck Screen Backdrop ──────────────────────────── */}
      <div className="absolute inset-0">
        <Image
          src="/brand/login-hero.jpg"
          alt="Mahadev Constructions Fleet"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center lg:object-left"
        />
        {/* Blue-shaded cinematic gradient grading - no yellow, no muddy wash */}
        <div className="absolute inset-0 bg-linear-to-r from-ink-900/95 via-ink-900/65 to-ink-900/90 lg:from-ink-900/80 lg:via-ink-900/35 lg:to-ink-900/95" />
        <div className="absolute inset-0 bg-linear-to-t from-ink-900 via-transparent to-ink-900/75" />
        <div className="pointer-events-none absolute inset-0 bg-brand-950/20 mix-blend-multiply" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-between px-5 py-6 sm:px-8 lg:px-12 lg:py-8">
        {/* Header with Mahadev Brand Mark */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-500/30 ring-1 ring-white/10">
              <MahadevMark className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-base font-bold tracking-tight text-white">FleetView ERP</p>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-300">
                Mahadev Constructions
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3.5 py-1 backdrop-blur-md text-[11px] text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-pulse" />
            Heavy Fleet &amp; Logistics
          </div>
        </header>

        {/* Center section: Left side clean fleet info, Right side sign-in card */}
        <div className="my-auto flex flex-col gap-8 py-8 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
          {/* Left side: minimal, clean typography letting the trucks be seen */}
          <div className="hidden flex-1 flex-col justify-center text-white lg:flex max-w-lg">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-brand-400/30 bg-brand-500/10 px-3.5 py-1 text-xs font-semibold text-brand-300 backdrop-blur-md">
              <Truck className="h-3.5 w-3.5" />
              Telematics-Native Fleet Operations
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-white lg:text-4xl">
              Connected machines. Clear operations.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              Live vehicle telemetry, tank-level fuel tracking, predictive maintenance, and site logistics across Rajasthan.
            </p>

            <div className="mt-6 flex items-center gap-3 text-xs font-medium text-slate-300">
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 backdrop-blur-sm">
                <span className="h-2 w-2 rounded-full bg-brand-400" />
                Live Telemetry
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 backdrop-blur-sm">
                <span className="h-2 w-2 rounded-full bg-brand-400" />
                Fuel Security
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 backdrop-blur-sm">
                <span className="h-2 w-2 rounded-full bg-brand-400" />
                Asset Utilisation
              </div>
            </div>
          </div>

          {/* Right side: Modern glass sign-in card */}
          <div className="w-full lg:w-98 lg:shrink-0 mx-auto lg:mx-0">
            <div className="rounded-2xl border border-white/15 bg-ink-900/85 p-6 shadow-2xl shadow-black/70 backdrop-blur-xl sm:p-7">
              <div className="mb-6">
                <h2 className="text-xl font-bold tracking-tight text-white">Sign in</h2>
                <p className="mt-1 text-xs text-slate-400">Access your fleet command center</p>
              </div>

              <form
                action={formAction}
                onSubmit={persistEmailChoice}
                className="space-y-4"
              >
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-slate-300">
                    Email
                  </label>
                  <div className="relative">
                    <Mail
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden
                    />
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="username"
                      inputMode="email"
                      required
                      ref={emailRef}
                      defaultValue=""
                      placeholder="name@mahadev.com"
                      className="min-h-11 w-full rounded-xl border border-white/15 bg-white/5 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 outline-none transition-colors focus:border-brand-400 focus:bg-white/10 focus:ring-2 focus:ring-brand-500/25"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="password" className="block text-xs font-semibold text-slate-300">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setAskedAboutReset((prev) => !prev)}
                      className="text-xs font-medium text-brand-400 transition-colors hover:text-brand-300 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden
                    />
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      placeholder="••••••••"
                      className="min-h-11 w-full rounded-xl border border-white/15 bg-white/5 pl-10 pr-11 text-sm text-white placeholder:text-slate-500 outline-none transition-colors focus:border-brand-400 focus:bg-white/10 focus:ring-2 focus:ring-brand-500/25"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-white"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {askedAboutReset && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-brand-500/30 bg-brand-950/70 p-3 text-xs leading-relaxed text-brand-200 animate-fade-up">
                    <Info className="h-4 w-4 shrink-0 text-brand-400 mt-0.5" aria-hidden />
                    <div>
                      <p className="font-semibold text-white">Need a password reset?</p>
                      <p className="mt-0.5 text-slate-300">
                        Passwords are reset by an administrator in <b>Users</b>. Please contact your supervisor or account administrator.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-0.5">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-300 select-none">
                    <input
                      type="checkbox"
                      ref={rememberRef}
                      defaultChecked={false}
                      className="h-4 w-4 rounded border-slate-600 accent-brand-500 bg-white/5"
                    />
                    Remember my email
                  </label>
                </div>

                {state?.error && (
                  <p
                    role="alert"
                    className="rounded-xl border border-rose-500/30 bg-rose-950/60 px-3.5 py-2.5 text-xs font-medium text-rose-300 animate-fade-up"
                  >
                    {state.error}
                  </p>
                )}

                <button
                  disabled={pending}
                  type="submit"
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white shadow-lg shadow-brand-600/30 transition-all hover:bg-brand-500 active:scale-[0.99] disabled:opacity-60"
                >
                  {pending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </>
                  )}
                </button>
              </form>

              {/* Driver sign in switch & App install */}
              <div className="mt-5 space-y-2.5 border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={onDriverLogin}
                  className="group flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 p-2.5 text-left transition-all hover:border-brand-400/40 hover:bg-brand-500/10"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand-400/20 bg-brand-500/20 text-brand-300 transition-colors group-hover:bg-brand-500 group-hover:text-white">
                      <Truck className="h-4 w-4" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-xs font-bold text-white">Driver sign in</span>
                      <span className="block text-[10px] font-medium text-brand-300">ड्राइवर लॉग इन</span>
                    </span>
                  </span>
                  <ArrowRight
                    className="h-4 w-4 text-slate-400 transition-all group-hover:translate-x-0.5 group-hover:text-brand-300"
                    aria-hidden
                  />
                </button>

                <Link
                  href="/install"
                  className="flex items-center justify-center gap-1.5 py-1 text-xs font-medium text-slate-400 transition-colors hover:text-brand-300"
                >
                  <Smartphone className="h-3.5 w-3.5" aria-hidden />
                  Install app on phone
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Minimal Footer Credits */}
        <footer className="flex flex-col gap-1 border-t border-white/10 pt-4 text-[11px] text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {new Date().getFullYear()} All rights reserved to{" "}
            <span className="font-semibold text-slate-200">Mahadev Constructions</span>
          </p>
          <p>
            Made by <span className="font-semibold text-brand-400">Pitbull Corporations</span>
          </p>
        </footer>
      </div>
    </main>
  );
}

