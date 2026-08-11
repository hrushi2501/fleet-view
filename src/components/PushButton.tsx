"use client";

import { useEffect, useState } from "react";
import { Bell, BellRing, Loader2, Send } from "lucide-react";

function urlB64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function PushButton({ label = "Enable alerts", className }: { label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "on" | "busy" | "unsupported">("idle");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      queueMicrotask(() => setState("unsupported"));
      return;
    }
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => { if (s) setState("on"); }).catch(() => {});
  }, []);


  async function enable() {
    try {
      setState("busy");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState("idle"); return; }
      const reg = await navigator.serviceWorker.ready;
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) { setState("idle"); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
      await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
      setState("on");
    } catch { setState("idle"); }
  }

  if (state === "unsupported") return null;
  if (state === "on")
    return (
      <span className={className ?? "inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-600/20"}>
        <BellRing className="h-4 w-4" /> Alerts on
      </span>
    );
  return (
    <button onClick={enable} disabled={state === "busy"} className={className ?? "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"}>
      {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />} {label}
    </button>
  );
}

export function SendTestPush() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function send() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/push/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "FleetView test", body: "Push notifications are working ✅" }) });
      const j = await r.json();
      setMsg(j.ok ? `Sent to ${j.sent}/${j.total} device(s)` : "Failed");
    } catch { setMsg("Failed"); } finally { setBusy(false); }
  }
  return (
    <div className="flex items-center gap-2">
      <button onClick={send} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  );
}
