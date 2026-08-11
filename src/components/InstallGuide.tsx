"use client";

import { useEffect, useState } from "react";
import { Share, SquarePlus, CheckCircle2, Download, Truck, TriangleAlert, ChevronUp } from "lucide-react";

type BIPEvent = Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> };
type Platform = "loading" | "ios" | "ios-not-safari" | "android" | "desktop" | "installed";

function InstallStep({ n, icon, hindi, eng }: { n: number; icon: React.ReactNode; hindi: string; eng: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-900 text-sm font-bold text-white">{n}</div>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700">{icon}</div>
      <div><p className="font-bold text-ink-900">{hindi}</p><p className="text-xs text-slate-500">{eng}</p></div>
    </div>
  );
}

export function InstallGuide() {
  const [platform, setPlatform] = useState<Platform>("loading");
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
    if (standalone) { queueMicrotask(() => setPlatform("installed")); return; }
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) {
      const notSafari = /crios|fxios|edgios|opios/i.test(ua);
      queueMicrotask(() => setPlatform(notSafari ? "ios-not-safari" : "ios"));
      return;
    }
    queueMicrotask(() => setPlatform(/android/i.test(ua) ? "android" : "desktop"));
    const h = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent); };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => setPlatform("installed"));
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  if (platform === "loading") return null;

  if (platform === "installed")
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 p-4 text-emerald-700">
        <CheckCircle2 className="h-6 w-6" /> <span className="font-bold">App already installed ✓</span>
      </div>
    );

  // ---------- iPhone / iPad ----------
  if (platform === "ios" || platform === "ios-not-safari") {
    return (
      <div className="rounded-3xl border-2 border-brand-200 bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-2xl"></span>
          <h2 className="text-lg font-bold text-ink-900">iPhone पर इंस्टॉल करें · Install on iPhone</h2>
        </div>

        {platform === "ios-not-safari" && (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <p><b>Safari</b> में यह पेज खोलें। (Chrome/अन्य ब्राउज़र में iPhone पर इंस्टॉल नहीं होता।)<br /><span className="text-xs">Open this page in <b>Safari</b> — install doesn’t work in other iPhone browsers.</span></p>
          </div>
        )}

        <div className="space-y-2.5">
          <InstallStep n={1} icon={<Share className="h-6 w-6" />} hindi="नीचे Share बटन दबाएं" eng="Tap the Share button (the square with ↑)" />
          <InstallStep n={2} icon={<SquarePlus className="h-6 w-6" />} hindi="“Add to Home Screen” चुनें" eng="Scroll and tap “Add to Home Screen”" />
          <InstallStep n={3} icon={<Truck className="h-6 w-6" />} hindi="FleetView खोलें और लॉगिन करें" eng="Open FleetView from home screen & log in" />
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-ink-900 py-3 text-sm font-semibold text-white">
          <ChevronUp className="h-5 w-5 animate-bounce" /> Share बटन Safari में नीचे है · the Share button is in Safari’s bottom bar
        </div>
      </div>
    );
  }

  // ---------- Android / Desktop ----------
  return (
    <div className="rounded-3xl border-2 border-brand-200 bg-white p-5 text-center">
      <h2 className="mb-3 text-lg font-bold text-ink-900">Install the App</h2>
      {deferred ? (
        <button onClick={async () => { deferred.prompt(); await deferred.userChoice; setDeferred(null); }}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-brand-500/30 hover:bg-brand-600">
          <Download className="h-5 w-5" /> Install App · ऐप इंस्टॉल करें
        </button>
      ) : (
        <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Open the browser menu <b>(⋮)</b> and tap <b>“Add to Home screen”</b> / <b>“Install app”</b>.</p>
      )}
    </div>
  );
}
