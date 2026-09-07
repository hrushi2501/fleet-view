"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, CheckCircle2, Keyboard, Loader2, LogOut, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";

type Detector = { detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;
type Mode = "camera" | "code" | "fallback";

function detector(): DetectorConstructor | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector ?? null;
}

/** QR is normal proof. A damaged-sticker fallback remains tied to the driver's active session. */
export function DriverTripEndScanner({ vehicleCode, registrationNo = null, sessionId }: { vehicleCode: string; registrationNo?: string | null; sessionId?: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("camera");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [odometer, setOdometer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockedRef = useRef(false);
  const router = useRouter();
  const toast = useToast();

  const stopCamera = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);
  const close = useCallback(() => { stopCamera(); setOpen(false); setCode(""); setConfirmation(""); setOdometer(""); setError(null); lockedRef.current = false; }, [stopCamera]);

  const location = useCallback(async () => {
    if (!navigator.geolocation) return {};
    return new Promise<{ lat?: number; lng?: number }>((resolve) => navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve({}), { enableHighAccuracy: false, timeout: 6000, maximumAge: 60_000 },
    ));
  }, []);

  const finishTrip = useCallback(async (rawToken?: string, fallback = false) => {
    const token = rawToken?.trim() ?? "";
    if (!fallback && !token) { toast.error("Sticker code is required", "Scan the same cabin sticker to end this trip."); return; }
    if (fallback && confirmation.replace(/[^a-z0-9]/gi, "").length < 4) { toast.error("Enter the last 4 characters", "Read the vehicle number plate, then enter its last 4 characters."); return; }
    lockedRef.current = true; stopCamera(); setPending(true);
    try {
      const position = await location();
      const response = await fetch("/api/session/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        ...(token ? { token } : {}), ...(fallback ? { confirmVehicle: confirmation } : {}), sessionId,
        ...(odometer.trim() ? { odometer } : {}), ...position,
      }) });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; distanceKm?: number; source?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Trip end could not be confirmed.");
      toast.success("Trip ended", `${vehicleCode} · ${result.distanceKm ?? 0} km (${result.source ?? "recorded"})`);
      close(); router.refresh();
    } catch (caught) {
      lockedRef.current = false;
      toast.error("Trip end not confirmed", caught instanceof Error ? caught.message : "Please try again when signal returns.");
    } finally { setPending(false); }
  }, [close, confirmation, location, odometer, router, sessionId, stopCamera, toast, vehicleCode]);

  const startCamera = useCallback(async () => {
    const BarcodeDetector = detector();
    if (!BarcodeDetector) { setError("This browser cannot read a QR code. Use vehicle confirmation below."); setMode("fallback"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream; await videoRef.current.play();
      const reader = new BarcodeDetector({ formats: ["qr_code"] });
      intervalRef.current = setInterval(() => {
        if (!videoRef.current || videoRef.current.readyState < 2 || lockedRef.current) return;
        void reader.detect(videoRef.current).then((results) => { if (results[0]?.rawValue) void finishTrip(results[0].rawValue); }).catch(() => undefined);
      }, 300);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Camera access was unavailable."); setMode("fallback"); }
  }, [finishTrip]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- camera capability can intentionally choose the visible fallback state.
    if (open && mode === "camera") void startCamera(); else stopCamera();
    return stopCamera;
  }, [mode, open, startCamera, stopCamera]);

  const vehicleLabel = registrationNo ?? vehicleCode;
  const fields = <label className="mb-4 block text-xs font-semibold text-slate-700">Closing odometer / SMU <span className="font-normal text-slate-400">(optional)</span><input type="number" min="0" max="10000000" inputMode="decimal" value={odometer} onChange={(event) => setOdometer(event.target.value)} placeholder="Meter reading" className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-bold outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100" /></label>;
  return <>
    <button onClick={() => { lockedRef.current = false; setMode("camera"); setOpen(true); }} className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-rose-700 active:scale-95"><LogOut className="h-3.5 w-3.5" />End duty</button>
    {open && <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:p-6" role="dialog" aria-modal="true" aria-label="End trip with vehicle QR"><div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-100 bg-rose-50 px-5 py-4"><div className="flex items-center gap-2.5"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-700"><LogOut className="h-5 w-5" /></div><div><h3 className="text-base font-bold text-rose-950">End duty</h3><p className="text-xs text-rose-700">Active vehicle: {vehicleLabel}.</p></div></div><button onClick={close} disabled={pending} className="rounded-xl p-1.5 text-rose-400 hover:bg-rose-100" aria-label="Cancel trip end"><X className="h-5 w-5" /></button></div><div className="grid grid-cols-3 gap-1 border-b border-slate-100 bg-slate-50 p-2"><button onClick={() => setMode("camera")} className={cn("flex items-center justify-center gap-1 rounded-xl py-2 text-xs font-bold", mode === "camera" ? "bg-white text-rose-700 shadow-sm" : "text-slate-500")}><Camera className="h-4 w-4" />Scan</button><button onClick={() => setMode("code")} className={cn("flex items-center justify-center gap-1 rounded-xl py-2 text-xs font-bold", mode === "code" ? "bg-white text-rose-700 shadow-sm" : "text-slate-500")}><Keyboard className="h-4 w-4" />Code</button><button onClick={() => setMode("fallback")} className={cn("flex items-center justify-center gap-1 rounded-xl py-2 text-xs font-bold", mode === "fallback" ? "bg-white text-rose-700 shadow-sm" : "text-slate-500")}><ShieldCheck className="h-4 w-4" />Confirm</button></div><div className="overflow-x-auto overflow-y-auto p-5"><div className="mb-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>Scan the cabin sticker whenever possible. If it is damaged or your phone cannot scan it, use <strong>Confirm</strong> and enter the last four characters of {vehicleLabel}.</p></div>{fields}{mode === "camera" ? <div className="flex flex-col items-center"><div className="relative aspect-square w-full max-w-70 overflow-hidden rounded-3xl bg-slate-950"><video ref={videoRef} playsInline muted className="h-full w-full object-cover" /><div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="h-44 w-44 rounded-2xl border-2 border-dashed border-rose-400" /></div>{pending && <div className="absolute inset-0 grid place-items-center bg-slate-900/70"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>}</div><p className="mt-3 text-center text-xs font-semibold text-slate-600">Scan {vehicleCode}&apos;s cabin sticker.</p>{error && <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{error}</p>}</div> : mode === "code" ? <form onSubmit={(event) => { event.preventDefault(); void finishTrip(code); }} className="space-y-4"><label className="block text-xs font-semibold text-slate-700">Exact cabin sticker code<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="FV-XXXXXXXXXX" maxLength={48} className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm font-bold uppercase outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100" /></label><button type="submit" disabled={pending || !code.trim()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Confirm code and end duty</button></form> : <form onSubmit={(event) => { event.preventDefault(); void finishTrip(undefined, true); }} className="space-y-4"><label className="block text-xs font-semibold text-slate-700">Last 4 characters of {vehicleLabel}<input value={confirmation} onChange={(event) => setConfirmation(event.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="e.g. 1234" maxLength={8} className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-3 font-mono text-base font-bold uppercase outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100" /></label><p className="rounded-xl bg-slate-100 p-3 text-xs text-slate-600">This works only for your currently assigned, active duty. It does not bypass the driver or vehicle checks.</p><button type="submit" disabled={pending || confirmation.replace(/[^a-z0-9]/gi, "").length < 4} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Confirm vehicle and end duty</button></form>}</div></div></div>}
  </>;
}
