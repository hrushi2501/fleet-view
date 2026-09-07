"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Loader2, Truck } from "lucide-react";
import { login } from "./actions";

type Language = "hi" | "en";
type LoginState = { error?: string } | null;
type FormAction = (payload: FormData) => void;

const DRIVER_COPY = {
  hi: {
    app: "ड्राइवर ऐप", welcome: "स्वागत है", instruction: "काम शुरू करने के लिए लॉग इन करें",
    email: "ईमेल", password: "पासवर्ड", signIn: "लॉग इन करें", signingIn: "लॉग इन हो रहा है…",
    install: "फोन में ऐप जोड़ें", help: "काम कैसे करें", back: "ऑफिस लॉग इन",
    steps: ["लॉग इन करें", "कैबिन का QR स्कैन करें", "अपना काम चुनें"],
    support: "लॉग इन की जानकारी सुपरवाइज़र से लें।",
  },
  en: {
    app: "Driver app", welcome: "Welcome", instruction: "Sign in to start work",
    email: "Email", password: "Password", signIn: "Sign in", signingIn: "Signing in…",
    install: "Add app to phone", help: "How it works", back: "Office sign in",
    steps: ["Sign in", "Scan the cabin QR", "Choose your task"],
    support: "Ask your supervisor for login details.",
  },
} as const;

export default function LoginPage() {
  const [showDriverLogin, setShowDriverLogin] = useState(false);
  const [state, formAction, pending] = useActionState(login, null as LoginState);

  if (showDriverLogin) {
    return <DriverLogin state={state} formAction={formAction} pending={pending} onBack={() => setShowDriverLogin(false)} />;
  }

  return (
    <main className="flex min-h-screen">
      {/* Fleet manager sign-in remains the default product entry point. */}
      <section className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-ink-900 p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-brand-700/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500 shadow-lg shadow-brand-500/40"><Truck className="h-6 w-6" aria-hidden /></span>
          <div><p className="text-lg font-bold">FleetView ERP</p><p className="text-xs uppercase tracking-widest text-slate-400">Mahadev Constructions</p></div>
        </div>
        <div className="relative space-y-6">
          <h1 className="text-4xl font-bold leading-tight">Make every asset <span className="text-brand-400">accountable.</span></h1>
          <p className="max-w-md text-slate-400">Telematics-native fleet &amp; equipment ERP for road construction — live tracking, leak-proof fuel, predictive maintenance, compliance, and asset-level P&amp;L.</p>
          <div className="grid max-w-md grid-cols-3 gap-3 pt-4">
            {[
              ["Live", "Vehicle telemetry, straight from the OEM"],
              ["Tank-level", "Fuel measured, not just recorded"],
              ["Per-asset", "Cost and utilisation on every machine"],
            ].map(([value, label]) => (
              <div key={value} className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10"><p className="text-sm font-bold text-brand-400">{value}</p><p className="mt-1 text-[11px] leading-snug text-slate-400">{label}</p></div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-slate-500">Mahadev Constructions · authorised users only</p>
      </section>

      <section className="flex w-full items-center justify-center bg-[var(--background)] p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><div className="flex items-center gap-2"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-white"><Truck className="h-5 w-5" aria-hidden /></span><p className="text-lg font-bold">FleetView ERP</p></div></div>
          <h1 className="text-2xl font-bold text-ink-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your fleet command center.</p>
          <OfficeLoginForm state={state} formAction={formAction} pending={pending} />
          <button type="button" onClick={() => setShowDriverLogin(true)} className="mt-4 flex min-h-14 w-full items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-4 text-left text-brand-800 hover:bg-brand-100">
            <span className="flex items-center gap-3"><Truck className="h-5 w-5" aria-hidden /><span><span className="block text-sm font-bold">Driver sign in</span><span className="block text-xs font-medium text-brand-600">ड्राइवर लॉग इन</span></span></span>
            <span aria-hidden>→</span>
          </button>
          <Link href="/install" className="mt-4 flex min-h-12 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-4 text-sm font-semibold text-brand-700 hover:bg-brand-100">📲 Install this app on your phone</Link>
          <p className="mt-4 text-center text-xs text-slate-400">Use the credentials provided by your administrator.</p>
        </div>
      </section>
    </main>
  );
}

function OfficeLoginForm({ state, formAction, pending }: { state: LoginState; formAction: FormAction; pending: boolean }) {
  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div><label htmlFor="office-email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label><input id="office-email" name="email" type="email" autoComplete="username" placeholder="you@mahadev.com" required className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
      <div><label htmlFor="office-password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label><input id="office-password" name="password" type="password" autoComplete="current-password" placeholder="••••••••" required className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
      {state?.error && <p role="alert" className="text-sm text-rose-600">{state.error}</p>}
      <button disabled={pending} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 transition-colors hover:bg-brand-600 disabled:opacity-60">{pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Sign in</button>
    </form>
  );
}

function DriverLogin({ state, formAction, pending, onBack }: { state: LoginState; formAction: FormAction; pending: boolean; onBack: () => void }) {
  const [language, setLanguage] = useState<Language>("hi");
  const copy = DRIVER_COPY[language];
  return (
    <main lang={language} className="min-h-screen bg-slate-50 px-4 py-6 sm:flex sm:items-center sm:justify-center sm:p-6">
      <section className="mx-auto w-full max-w-sm" aria-labelledby="driver-login-title">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm"><Truck className="h-6 w-6" aria-hidden /></span><div><p className="text-lg font-bold text-ink-900">FleetView</p><p className="text-sm text-slate-500">{copy.app}</p></div></div>
          <div className="flex rounded-xl bg-slate-200 p-1 text-xs font-bold" aria-label="Language"><button type="button" onClick={() => setLanguage("hi")} aria-pressed={language === "hi"} className={`min-h-9 rounded-lg px-3 ${language === "hi" ? "bg-white text-ink-900 shadow-sm" : "text-slate-600"}`}>हिंदी</button><button type="button" onClick={() => setLanguage("en")} aria-pressed={language === "en"} className={`min-h-9 rounded-lg px-3 ${language === "en" ? "bg-white text-ink-900 shadow-sm" : "text-slate-600"}`}>English</button></div>
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <h1 id="driver-login-title" className="text-2xl font-bold tracking-tight text-ink-900">{copy.welcome}</h1><p className="mt-1 text-sm text-slate-600">{copy.instruction}</p>
          <form action={formAction} className="mt-6 space-y-4">
            <div><label htmlFor="driver-email" className="mb-1.5 block text-sm font-semibold text-slate-700">{copy.email}</label><input id="driver-email" name="email" type="email" autoComplete="username" inputMode="email" placeholder="you@example.com" required className="min-h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-ink-900 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /></div>
            <div><label htmlFor="driver-password" className="mb-1.5 block text-sm font-semibold text-slate-700">{copy.password}</label><input id="driver-password" name="password" type="password" autoComplete="current-password" required className="min-h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /></div>
            {state?.error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{state.error}</p>}
            <button disabled={pending} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-base font-bold text-white shadow-sm disabled:opacity-60">{pending && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}{pending ? copy.signingIn : copy.signIn}</button>
          </form>
          <Link href="/install" className="mt-4 flex min-h-12 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 px-4 text-sm font-bold text-brand-700">{copy.install}</Link>
        </div>
        <section className="mt-4 rounded-2xl bg-white px-5 py-4 ring-1 ring-slate-200" aria-labelledby="how-it-works"><h2 id="how-it-works" className="text-sm font-bold text-ink-900">{copy.help}</h2><ol className="mt-2 grid grid-cols-3 gap-2 text-center text-xs font-medium text-slate-600">{copy.steps.map((step, index) => <li key={step} className="rounded-xl bg-slate-50 px-2 py-2.5"><span className="mb-1 block text-sm font-bold text-brand-700">{index + 1}</span>{step}</li>)}</ol></section>
        <button type="button" onClick={onBack} className="mt-4 min-h-11 text-sm font-semibold text-brand-700">← {copy.back}</button>
        <p className="mt-3 text-center text-xs text-slate-500">{copy.support}</p>
      </section>
    </main>
  );
}
