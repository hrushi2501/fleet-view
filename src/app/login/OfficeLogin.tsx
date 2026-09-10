"use client";

/**
 * The sign-in screen, to Mahadev Constructions' own artwork.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE CONTROLS IN THE DESIGN HAVE NO BACKEND, AND ARE HANDLED HONESTLY
 *
 * A sign-in screen is the first thing a client sees, so a control that looks
 * real and does nothing costs more trust here than anywhere else in the product.
 *
 *   "Email or Mobile Number"  The sign-in action matches on email only; `User`
 *                             holds no phone number. The field says Email.
 *   Remember me               A real one would lengthen the session, which is a
 *                             security decision for the client to take, not a
 *                             styling detail — and a long session on a shared
 *                             site laptop is exactly the wrong default. This
 *                             remembers the address instead, so the next person
 *                             at that desk types a password and not an email.
 *   Forgot password?          There is no reset route and no mail service behind
 *                             one. Rather than link to a 404, it says who can
 *                             actually reset it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Loader2, Mail, Lock, Eye, EyeOff, MapPin, ArrowRight, Truck } from "lucide-react";
import { login } from "./actions";
import { MahadevMark, MahadevLogo } from "./MahadevMark";

type LoginState = { error?: string } | null;

/** Where the remembered address is kept. Per browser, never sent anywhere. */
const REMEMBERED_EMAIL = "mahadev:last-email";

export default function OfficeLogin({ onDriverLogin }: { onDriverLogin: () => void }) {
  const [state, formAction, pending] = useActionState(login, null as LoginState);
  const [showPassword, setShowPassword] = useState(false);
  const [askedAboutReset, setAskedAboutReset] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const rememberRef = useRef<HTMLInputElement>(null);

  // The remembered address is filled straight into the inputs rather than held
  // in state. The server renders this form with an empty field and only the
  // browser knows what was saved, so putting it in state would either mismatch
  // hydration or need an effect that sets state — this writes the DOM once and
  // avoids both.
  //
  // Wrapped because a private window, cleared site data, or a browser set to
  // block storage all throw on access, and none of them is a reason to fail to
  // render a sign-in form.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBERED_EMAIL);
      if (!saved) return;
      if (emailRef.current) emailRef.current.value = saved;
      if (rememberRef.current) rememberRef.current.checked = true;
    } catch {
      /* storage unavailable — the form simply starts empty */
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
      /* nothing to do; the sign-in itself is unaffected */
    }
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-ink-900">
      {/* ── The site photograph ──────────────────────────────────────────────
          Fixed and behind everything, so on a phone the card floats over the
          same picture instead of pushing it off the top of the screen. */}
      <div className="absolute inset-0">
        <Image
          src="/brand/login-hero.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        {/* Left-weighted wash: enough contrast for white type over a bright sky,
            without flattening the photograph into a grey rectangle. */}
        <div className="absolute inset-0 bg-gradient-to-r from-ink-900/85 via-ink-900/55 to-ink-900/25" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900/70 via-transparent to-ink-900/40" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-8 px-5 py-8 sm:px-8 lg:flex-row lg:items-center lg:gap-12 lg:px-14 lg:py-12">
        {/* ── Brand side ──────────────────────────────────────────────────── */}
        <section className="flex flex-1 flex-col justify-center text-white lg:min-h-[80vh]">
          <MahadevLogo className="text-white" markClass="h-11 w-11 sm:h-14 sm:w-14" />

          <p className="mt-6 text-[10px] font-medium uppercase tracking-[0.3em] text-white/70 sm:mt-8 sm:text-xs sm:tracking-[0.42em]">
            People <span className="mx-1.5 text-gold-400">|</span> Machines
            <span className="mx-1.5 text-gold-400">|</span> Projects
          </p>

          <h1 className="mt-5 text-3xl font-bold uppercase leading-[1.08] tracking-tight sm:mt-7 sm:text-5xl lg:text-[3.4rem]">
            Building
            <br />
            <span className="text-gold-400">A Stronger</span>
            <br />
            Tomorrow
          </h1>

          <span className="mt-6 block h-px w-16 bg-gold-400/80 sm:mt-8" />

          <p className="mt-5 max-w-sm text-[11px] font-medium uppercase leading-relaxed tracking-[0.22em] text-white/75 sm:text-sm sm:tracking-[0.28em]">
            Infrastructure for a brighter India
          </p>

          <p className="mt-8 flex items-center gap-2 text-xs text-white/65 sm:mt-auto sm:pt-12">
            <MapPin className="h-3.5 w-3.5 text-gold-400" aria-hidden />
            Udaipur, Rajasthan
          </p>
        </section>

        {/* ── Sign-in card ────────────────────────────────────────────────── */}
        <section className="w-full lg:w-[27rem] lg:shrink-0">
          <div className="rounded-3xl bg-white/95 p-6 shadow-2xl shadow-ink-900/40 ring-1 ring-white/40 backdrop-blur-sm sm:p-8">
            <MahadevLogo align="center" markClass="h-11 w-11" className="text-ink-900" />

            <h2 className="mt-7 text-2xl font-bold tracking-tight text-ink-900">Welcome Back</h2>
            <p className="mt-1 text-sm text-slate-500">Sign in to your account</p>

            <form
              action={formAction}
              onSubmit={persistEmailChoice}
              className="mt-6 space-y-3.5"
            >
              <div>
                <label htmlFor="email" className="sr-only">
                  Email
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
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
                    placeholder="Email"
                    className="min-h-13 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-ink-900 outline-none transition-colors placeholder:text-slate-400 focus:border-gold-400 focus:ring-4 focus:ring-gold-100"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="sr-only">
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    placeholder="Password"
                    className="min-h-13 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-12 text-sm text-ink-900 outline-none transition-colors placeholder:text-slate-400 focus:border-gold-400 focus:ring-4 focus:ring-gold-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    ref={rememberRef}
                    defaultChecked={false}
                    className="h-4 w-4 rounded border-slate-300 accent-gold-500"
                  />
                  Remember my email
                </label>
                <button
                  type="button"
                  onClick={() => setAskedAboutReset(true)}
                  className="text-xs font-semibold text-gold-600 underline-offset-2 hover:underline"
                >
                  Forgot password?
                </button>
              </div>

              {askedAboutReset && (
                <p className="rounded-xl bg-gold-50 px-3.5 py-2.5 text-xs leading-relaxed text-gold-800 ring-1 ring-gold-200">
                  Passwords are reset by an administrator from{" "}
                  <b>Users</b> inside the app — there is no self-service reset. Ask
                  whoever set up your account.
                </p>
              )}

              {state?.error && (
                <p
                  role="alert"
                  className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700 ring-1 ring-rose-200"
                >
                  {state.error}
                </p>
              )}

              <button
                disabled={pending}
                className="flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-gold-500 text-sm font-bold text-white shadow-lg shadow-gold-500/30 transition-colors hover:bg-gold-600 disabled:opacity-60"
              >
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Signing in…
                  </>
                ) : (
                  <>
                    Login
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-slate-400">
                Same ground, a brighter tomorrow
              </span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            {/* The driver flow is a different screen, not a different password.
                It stays reachable from here because a driver handed a phone has
                nowhere else to start. */}
            <button
              type="button"
              onClick={onDriverLogin}
              className="mt-5 flex min-h-13 w-full items-center justify-between rounded-xl border border-gold-200 bg-gold-50/70 px-4 text-left text-gold-800 transition-colors hover:bg-gold-100"
            >
              <span className="flex items-center gap-3">
                <Truck className="h-5 w-5" aria-hidden />
                <span>
                  <span className="block text-sm font-bold">Driver sign in</span>
                  <span className="block text-xs font-medium text-gold-600">ड्राइवर लॉग इन</span>
                </span>
              </span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>

            <Link
              href="/install"
              className="mt-3 flex min-h-11 items-center justify-center rounded-xl text-xs font-semibold text-slate-500 transition-colors hover:text-gold-700"
            >
              📲 Install this app on your phone
            </Link>
          </div>

          <p className="mt-5 text-center text-[9px] font-medium uppercase tracking-[0.28em] text-white/55">
            Infrastructure <span className="mx-1 text-gold-400">|</span> Trust
            <span className="mx-1 text-gold-400">|</span> Progress
          </p>
        </section>
      </div>

      {/* Marks the page as Mahadev's without competing with the card on a phone. */}
      <MahadevMark className="pointer-events-none absolute -bottom-8 -right-6 hidden h-56 w-56 text-white/[0.04] lg:block" />
    </main>
  );
}
