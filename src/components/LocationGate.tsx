"use client";

import { useEffect, useState } from "react";
import { MapPin, Loader2, TriangleAlert, Settings } from "lucide-react";

type Status = "checking" | "granted" | "prompt" | "denied" | "unsupported";

export function LocationGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      queueMicrotask(() => setStatus("unsupported"));
      return;
    }
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (perms?.query) {
      perms.query({ name: "geolocation" as PermissionName })
        .then((p) => {
          setStatus(p.state === "granted" ? "granted" : p.state === "denied" ? "denied" : "prompt");
          p.onchange = () => { if (p.state === "granted") setStatus("granted"); else if (p.state === "denied") setStatus("denied"); };
        })
    } else {
      queueMicrotask(() => setStatus("prompt"));
    }
  }, []);



  function enable() {
    setStatus("checking");
    navigator.geolocation.getCurrentPosition(
      () => setStatus("granted"),
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "prompt"),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  if (status === "granted") return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-ink-900 p-8 text-center text-white">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-500/20 ring-2 ring-brand-400/40">
        {status === "checking" ? <Loader2 className="h-12 w-12 animate-spin text-brand-300" /> : <MapPin className="h-12 w-12 text-brand-300" />}
      </div>

      {status === "checking" && <p className="text-lg font-semibold">Location check…</p>}

      {status === "prompt" && (
        <>
          <div>
            <h1 className="text-2xl font-extrabold">Location चालू करें</h1>
            <p className="mt-2 max-w-xs text-slate-300">इस ऐप को चलाने के लिए location ज़रूरी है। (Location is required to use this app.)</p>
          </div>
          <button onClick={enable} className="flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-brand-500 py-5 text-2xl font-extrabold shadow-lg active:scale-[0.98]">
            <MapPin className="h-7 w-7" /> चालू करें · Allow
          </button>
        </>
      )}

      {status === "denied" && (
        <>
          <div className="flex items-center gap-2 text-amber-300"><TriangleAlert className="h-6 w-6" /><h1 className="text-xl font-bold">Location band hai</h1></div>
          <p className="max-w-xs text-sm text-slate-300">
            Location off hai. Phone settings me allow karein:
            <br /><b>Settings → Apps → FleetView → Permissions → Location → Allow</b>
            <br /><span className="text-xs">(Or Chrome: 🔒 icon → Permissions → Location → Allow)</span>
          </p>
          <button onClick={enable} className="flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-white/10 py-4 text-lg font-bold ring-1 ring-white/20 active:scale-[0.98]">
            <Settings className="h-5 w-5" /> फिर से कोशिश करें · Try again
          </button>
        </>
      )}

      {status === "unsupported" && <p className="max-w-xs text-slate-300">This device does not support location. Please use a phone with GPS.</p>}
    </div>
  );
}
