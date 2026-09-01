"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, CheckCircle2, Keyboard, Loader2, LogOut, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";

type Detector = { detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

function detector(): DetectorConstructor | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector ?? null;
}

/**
 * A separate, deliberately red end-of-trip control. It cannot submit an end
 * request until the driver scans (or types) the sticker of their active vehicle.
 */
export function DriverTripEndScanner({ vehicleCode }: { vehicleCode: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"camera" | "code">("camera");
  const [code, setCode] = useState("");
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
  const close = useCallback(() => { stopCamera(); setOpen(false); setCode(""); setError(null); lockedRef.current = false; }, [stopCamera]);

  const location = useCallback(async () => {
    if (!navigator.geolocation) return {};
    return new Promise<{ lat?: number; lng?: number }>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => resolve({}),
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 60_000 },
      );
    });
  }, []);

  const finishTrip = useCallback(async (rawToken: string) => {
    const token = rawToken.trim();
    if (!token) { toast.error("Sticker code is required", "Scan the same cabin sticker to end this trip."); return; }
    lockedRef.current = true;
    stopCamera();
    setPending(true);
    try {
      const position = await location();
      const response = await fetch("/api/session/checkout", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, ...position }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; distanceKm?: number; source?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Trip end could not be confirmed.");
      toast.success("Trip ended", `${vehicleCode} · ${result.distanceKm ?? 0} km (${result.source ?? "recorded"})`);
      close();
      router.refresh();
    } catch (caught) {
      lockedRef.current = false;
      toast.error("Trip is still active", caught instanceof Error ? caught.message : "Please scan the cabin sticker again.");
    } finally { setPending(false); }
  }, [close, location, router, stopCamera, toast, vehicleCode]);

  const startCamera = useCallback(async () => {
    const BarcodeDetector = detector();
    if (!BarcodeDetector) { setError("This browser cannot read a QR code. Enter the printed FV code instead."); setMode("code"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const reader = new BarcodeDetector({ formats: ["qr_code"] });
      intervalRef.current = setInterval(() => {
        if (!videoRef.current || videoRef.current.readyState < 2 || lockedRef.current) return;
        void reader.detect(videoRef.current).then((results) => { if (results[0]?.rawValue) void finishTrip(results[0].rawValue); }).catch(() => undefined);
      }, 300);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Camera access was unavailable."); setMode("code"); }
  }, [finishTrip]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- camera fallback moves to the code-entry recovery state.
    if (open && mode === "camera") void startCamera(); else stopCamera();
    return stopCamera;
  }, [mode, open, startCamera, stopCamera]);

  const show = () => { lockedRef.current = false; setMode("camera"); setOpen(true); };
  return <>
    <button onClick={show} className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-rose-700 active:scale-95"><LogOut className="h-3.5 w-3.5" />Scan QR to end trip</button>
    {open && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:p-6" role="dialog" aria-modal="true" aria-label="End trip with vehicle QR"><div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-rose-100 bg-rose-50 px-5 py-4"><div className="flex items-center gap-2.5"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-700"><LogOut className="h-5 w-5" /></div><div><h3 className="text-base font-bold text-rose-950">End trip — QR confirmation</h3><p className="text-xs text-rose-700">You are ending the active trip for {vehicleCode}.</p></div></div><button onClick={close} disabled={pending} className="rounded-xl p-1.5 text-rose-400 hover:bg-rose-100" aria-label="Cancel trip end"><X className="h-5 w-5" /></button></div><div className="grid grid-cols-2 gap-1 border-b border-slate-100 bg-slate-50 p-2"><button onClick={() => setMode("camera")} className={cn("flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold", mode === "camera" ? "bg-white text-rose-700 shadow-sm" : "text-slate-500")}><Camera className="h-4 w-4" />Scan QR</button><button onClick={() => setMode("code")} className={cn("flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold", mode === "code" ? "bg-white text-rose-700 shadow-sm" : "text-slate-500")}><Keyboard className="h-4 w-4" />Enter code</button></div><div className="overflow-y-auto p-5"><div className="mb-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>To avoid an accidental checkout, this button does <strong>not</strong> end the trip. Scan the <strong>same cabin sticker</strong> for {vehicleCode} to confirm the end.</p></div>{mode === "camera" ? <div className="flex flex-col items-center"><div className="relative aspect-square w-full max-w-[280px] overflow-hidden rounded-3xl bg-slate-950"><video ref={videoRef} playsInline muted className="h-full w-full object-cover" /><div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="h-44 w-44 rounded-2xl border-2 border-dashed border-rose-400" /></div>{pending && <div className="absolute inset-0 grid place-items-center bg-slate-900/70"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>}</div><p className="mt-3 text-center text-xs font-semibold text-slate-600">Scan {vehicleCode}&apos;s cabin sticker to end duty.</p>{error && <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{error}</p>}</div> : <form onSubmit={(event) => { event.preventDefault(); void finishTrip(code); }} className="space-y-4"><label className="block text-xs font-semibold text-slate-700">Exact cabin sticker code<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="FV-XXXXXXXXXX" maxLength={48} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 font-mono text-sm font-bold uppercase outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100" /></label><button type="submit" disabled={pending || !code.trim()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Confirm QR and end trip</button></form>}</div></div></div>}
  </>;
}
