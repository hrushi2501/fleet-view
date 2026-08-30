"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { QrCode, Loader2, Camera, MapPin, TriangleAlert, CheckCircle2, X } from "lucide-react";
import { isActionError } from "@/lib/action-result";
import { DriverTripEndScanner } from "@/components/DriverTripEndScanner";

type Vehicle = { id: string; code: string; registrationNo: string | null; assetClass: string; hasFuelSensor: boolean; tracking: string };
type Active = { sessionId: string; vehicle: Vehicle; startedAt: string; trackingSource: string } | null;

/**
 * Driver trip panel — QR check-in, live position reporting, fuel-gauge capture
 * and checkout.
 *
 * Deliberately bilingual and large-target: this is used one-handed, in sunlight,
 * by people who are not reading English comfortably.
 */
export function DriverTripPanel({ active, hasCamera }: { active: Active; hasCamera: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string; details?: string[] } | null>(null);
  const [manualToken, setManualToken] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [gaugeOpen, setGaugeOpen] = useState(false);

  const pos = useCallback(
    () => new Promise<GeolocationPosition | null>((res) => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: true, timeout: 8000 });
    }),
    []
  );

  /* --- while a trip is live, report position so a vehicle with no tracker is still followed --- */
  useEffect(() => {
    if (!active || active.trackingSource === "GPS") return;
    let stop = false;
    const send = async () => {
      const p = await pos();
      if (!p || stop) return;
      await fetch("/api/session/ping", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude, speed: p.coords.speed != null ? p.coords.speed * 3.6 : null, accuracy: p.coords.accuracy }),
      }).catch(() => {});
    };
    send();
    const t = setInterval(send, 120000); // every 2 minutes — enough for a route, kind to the battery
    return () => { stop = true; clearInterval(t); };
  }, [active, pos]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  async function submitToken(token: string) {
    if (!token.trim()) return;
    setBusy(true); setMsg(null);
    const p = await pos();
    try {
      const r = await fetch("/api/session/scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), lat: p?.coords.latitude, lng: p?.coords.longitude }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg({ kind: "err", text: d.error ?? "Check-in failed" }); return; }
      const details = [...(d.documentWarnings ?? []).map((x: string) => `Papers — ${x}`), ...(d.blockers ?? []), ...(d.cautions ?? [])];
      setMsg({ kind: details.length ? "warn" : "ok", text: `${d.vehicle.code} — ${d.message}`, details });
      stopCamera(); setManualToken(""); router.refresh();
    } catch { setMsg({ kind: "err", text: "Network problem. Try again." }); }
    finally { setBusy(false); }
  }

  async function startScan() {
    setMsg(null);
    // BarcodeDetector is supported in Chrome on Android, which is the fleet's
    // phone. Anywhere else the driver types the short code printed under the QR.
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector) { setMsg({ kind: "warn", text: "This phone cannot scan. Type the code printed under the QR sticker." }); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream; setScanning(true);
      const detector = new Detector({ formats: ["qr_code"] });
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length) { await submitToken(codes[0].rawValue); return; }
        } catch { /* frame not ready */ }
        requestAnimationFrame(tick);
      };
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().then(tick).catch(() => {}); } }, 100);
    } catch { setMsg({ kind: "err", text: "Camera permission denied." }); }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4">
      {msg && (
        <div className={`flex items-start gap-2 rounded-2xl p-4 ring-1 ${
          msg.kind === "ok" ? "bg-emerald-50 ring-emerald-200" : msg.kind === "warn" ? "bg-amber-50 ring-amber-200" : "bg-rose-50 ring-rose-200"}`}>
          {msg.kind === "ok" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <TriangleAlert className={`mt-0.5 h-5 w-5 shrink-0 ${msg.kind === "warn" ? "text-amber-600" : "text-rose-600"}`} />}
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${msg.kind === "ok" ? "text-emerald-800" : msg.kind === "warn" ? "text-amber-800" : "text-rose-800"}`}>{msg.text}</p>
            {msg.details?.length ? (
              <ul className="mt-1 list-inside list-disc text-xs text-slate-600">{msg.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
            ) : null}
          </div>
          <button onClick={() => setMsg(null)} className="shrink-0 text-slate-400"><X className="h-4 w-4" /></button>
        </div>
      )}

      {!active ? (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <p className="text-center text-lg font-bold text-ink-900">गाड़ी का QR स्कैन करें</p>
          <p className="mt-0.5 text-center text-sm text-slate-500">Scan the vehicle QR to start your trip</p>

          {scanning ? (
            <div className="mt-4">
              <video ref={videoRef} playsInline muted className="w-full rounded-xl bg-black" style={{ maxHeight: 320 }} />
              <button onClick={stopCamera} className="mt-2 w-full rounded-xl bg-slate-100 py-3 font-semibold text-slate-700">बंद करें · Cancel</button>
            </div>
          ) : (
            <button onClick={startScan} disabled={busy || !hasCamera}
              className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl bg-brand-600 py-6 text-lg font-bold text-white shadow-lg active:scale-[0.99] disabled:opacity-50">
              <QrCode className="h-7 w-7" /> स्कैन करें · SCAN
            </button>
          )}

          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="mb-1.5 text-xs font-medium text-slate-500">या कोड टाइप करें · Or type the code under the sticker</p>
            <div className="flex gap-2">
              <input value={manualToken} onChange={(e) => setManualToken(e.target.value.toUpperCase())} placeholder="FV-XXXXXXXXXX"
                className="w-full rounded-xl border border-slate-200 px-3 py-3 font-mono text-sm uppercase outline-none focus:border-brand-400" />
              <button onClick={() => submitToken(manualToken)} disabled={busy || !manualToken.trim()}
                className="shrink-0 rounded-xl bg-brand-600 px-5 font-semibold text-white disabled:opacity-50">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "OK"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">ट्रिप चालू है · Trip running</p>
                <p className="mt-0.5 text-xl font-bold text-ink-900">{active.vehicle.code}</p>
                <p className="text-sm text-slate-600">{active.vehicle.registrationNo ?? active.vehicle.assetClass}</p>
              </div>
              <div className="shrink-0 text-right">
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                  <MapPin className="h-3 w-3" />
                  {active.trackingSource === "GPS" ? "GPS" : active.trackingSource === "MOBILE" ? "फ़ोन · Phone" : "बिना GPS"}
                </span>
                <p className="mt-1 text-[11px] text-slate-500">
                  {new Date(active.startedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} से
                </p>
              </div>
            </div>
          </div>

          {!active.vehicle.hasFuelSensor && (
            <button onClick={() => setGaugeOpen(true)}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-5 text-base font-bold text-ink-900 shadow-sm ring-1 ring-slate-200 active:scale-[0.99]">
              <Camera className="h-6 w-6 text-brand-600" /> फ्यूल गेज फोटो · Fuel gauge photo
            </button>
          )}

          <div className="rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
            <p className="mb-3 text-xs font-semibold text-rose-900">To prevent an accidental checkout, scan this vehicle&apos;s cabin QR to end the trip.</p>
            <DriverTripEndScanner vehicleCode={active.vehicle.code} />
          </div>

          {gaugeOpen && active && (
            <GaugeCapture assetId={active.vehicle.id} onClose={() => setGaugeOpen(false)} onDone={(m) => { setMsg(m); setGaugeOpen(false); router.refresh(); }} />
          )}
        </>
      )}
    </div>
  );
}

/** Fuel-gauge photo → AI read → stored with its confidence. */
function GaugeCapture({ assetId, onClose, onDone }: { assetId: string; onClose: () => void; onDone: (m: { kind: "ok" | "warn" | "err"; text: string; details?: string[] }) => void }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [read, setRead] = useState<{ levelPct: number | null; confidence: number; gaugeType: string | null; reasoning: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  async function onPick(f: File) {
    setFile(f); setPreview(URL.createObjectURL(f)); setBusy(true); setRead(null);
    const fd = new FormData(); fd.append("image", f); fd.append("kind", "gauge");
    try {
      const r = await fetch("/api/ocr", { method: "POST", body: fd });
      setRead(await r.json());
    } catch { setRead({ levelPct: null, confidence: 0, gaugeType: null, reasoning: "Could not reach the reader." }); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!file) return;
    setBusy(true);
    const p = await new Promise<GeolocationPosition | null>((res) => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(res, () => res(null), { timeout: 6000 });
    });
    const fd = new FormData();
    fd.append("assetId", assetId); fd.append("image", file);
    fd.append("levelPct", read?.levelPct != null ? String(read.levelPct) : "");
    fd.append("confidence", String(read?.confidence ?? 0));
    fd.append("gaugeType", read?.gaugeType ?? ""); fd.append("reasoning", read?.reasoning ?? "");
    if (p) { fd.append("lat", String(p.coords.latitude)); fd.append("lng", String(p.coords.longitude)); }

    const { saveGaugeReading } = await import("@/app/(app)/tracking/actions");
    const res = await saveGaugeReading(fd);
    if (isActionError(res)) {
      setBusy(false);
      onDone({ kind: "err", text: res.error });
      return;
    }
    onDone(res.status === "VERIFIED"
      ? { kind: "ok", text: `फ्यूल दर्ज · Fuel recorded at ${res.levelPct}%` }
      : { kind: "warn", text: "फोटो भेज दी · Sent for checking", details: res.reasons });
    setBusy(false);
  }

  const pct = read?.levelPct;
  const conf = read?.confidence ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-900/50 backdrop-blur-sm sm:items-center sm:justify-center">
      <div className="w-full rounded-t-3xl bg-white p-5 sm:max-w-md sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <p className="text-lg font-bold text-ink-900">फ्यूल गेज · Fuel gauge</p>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400"><X className="h-5 w-5" /></button>
        </div>
        <p className="mt-0.5 text-sm text-slate-500">डैशबोर्ड के फ्यूल मीटर की साफ फोटो लें</p>

        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }} />

        {preview ? (
          <img src={preview} alt="gauge" className="mt-4 w-full rounded-xl object-cover" style={{ maxHeight: 220 }} />
        ) : (
          <button onClick={() => fileRef.current?.click()}
            className="mt-4 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 py-10 text-slate-500">
            <Camera className="h-9 w-9" /><span className="font-semibold">फोटो लें · Take photo</span>
          </button>
        )}

        {busy && <p className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> पढ़ रहे हैं · Reading…</p>}

        {read && !busy && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            {pct != null ? (
              <>
                <p className="text-center text-3xl font-bold text-ink-900">{pct}%</p>
                <div className="mx-auto mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className={`h-full ${pct < 20 ? "bg-rose-500" : pct < 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                </div>
                <p className={`mt-2 text-center text-xs font-medium ${conf >= 0.85 ? "text-emerald-600" : "text-amber-600"}`}>
                  {conf >= 0.85 ? "पक्का पढ़ा गया · Confident read" : `कम भरोसा · Low confidence (${Math.round(conf * 100)}%) — supervisor will check`}
                </p>
              </>
            ) : (
              <p className="text-center text-sm text-rose-600">गेज पढ़ा नहीं गया · Could not read the gauge. Try a closer, steadier photo.</p>
            )}
            {read.reasoning && <p className="mt-2 text-[11px] text-slate-400">{read.reasoning}</p>}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          {preview && <button onClick={() => { setPreview(null); setRead(null); setFile(null); fileRef.current?.click(); }}
            className="flex-1 rounded-xl bg-slate-100 py-3 font-semibold text-slate-700">दोबारा · Retake</button>}
          <button onClick={save} disabled={!file || busy}
            className="flex-1 rounded-xl bg-brand-600 py-3 font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "सेव करें · Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
