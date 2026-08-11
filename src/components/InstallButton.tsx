"use client";

import { useEffect, useState } from "react";
import { Download, CheckCircle2, Share } from "lucide-react";

type BIPEvent = Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> };

export function InstallButton({ className }: { className?: string }) {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
    if (standalone) { queueMicrotask(() => setInstalled(true)); return; }
    if (/iphone|ipad|ipod/i.test(ua)) queueMicrotask(() => setIos(true));
    const h = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent); };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);


  if (installed)
    return <span className={className ?? "inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700"}><CheckCircle2 className="h-4 w-4" /> App installed</span>;

  if (ios)
    return (
      <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
        <p className="flex items-center gap-1.5 font-semibold text-ink-900"><Share className="h-4 w-4" /> iPhone install</p>
        <p className="mt-1">Tap the <b>Share</b> button, then <b>“Add to Home Screen”</b>.</p>
      </div>
    );

  if (!deferred)
    return (
      <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
        <p>To install: open your browser menu (⋮) and tap <b>“Add to Home screen”</b> / <b>“Install app”</b>.</p>
      </div>
    );

  return (
    <button onClick={async () => { deferred.prompt(); await deferred.userChoice; setDeferred(null); }}
      className={className ?? "inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-3 text-base font-bold text-white shadow-lg shadow-brand-500/30 hover:bg-brand-600"}>
      <Download className="h-5 w-5" /> Install App
    </button>
  );
}
