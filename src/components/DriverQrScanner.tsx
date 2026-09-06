"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, CheckCircle2, Keyboard, Loader2, QrCode, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";

type BarcodeDetectorInstance = { detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>> };
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorInstance;
type ScanResponse = { ok?: boolean; error?: string; message?: string; vehicle?: { code: string; registrationNo: string | null }; documentWarnings?: string[]; blockers?: string[]; cautions?: string[] };

function barcodeDetector(): BarcodeDetectorConstructor | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector ?? null;
}

/** The only driver-to-vehicle binding UI. A cabin sticker is the source of truth. */
export function DriverQrScanner({ triggerVariant = "card", currentVehicleCode }: { triggerVariant?: "card" | "button" | "banner"; currentVehicleCode?: string | null }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"camera" | "code">("camera");
  const [code, setCode] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanLockedRef = useRef(false);
  const router = useRouter();
  const toast = useToast();

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) { clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);
  const close = useCallback(() => { stopCamera(); setOpen(false); setCameraError(null); setCode(""); scanLockedRef.current = false; }, [stopCamera]);

  const readLocation = useCallback(async () => {
    if (!navigator.geolocation) return {};
    return new Promise<{ lat?: number; lng?: number }>((resolve) => {
      const timeout = window.setTimeout(() => resolve({}), 7000);
      navigator.geolocation.getCurrentPosition(
        (position) => { window.clearTimeout(timeout); resolve({ lat: position.coords.latitude, lng: position.coords.longitude }); },
        () => { window.clearTimeout(timeout); resolve({}); },
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 6000 },
      );
    });
  }, []);

  const checkIn = useCallback(async (rawToken: string) => {
    const token = rawToken.trim();
    if (!token) { toast.error("Sticker code is required", "Scan the cabin QR, or enter the FV code printed below it."); return; }
    scanLockedRef.current = true;
    stopCamera();
    setPending(true);
    try {
      const location = await readLocation();
      const response = await fetch("/api/session/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, ...location }) });
      const result = await response.json().catch(() => ({})) as ScanResponse;
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Vehicle check-in could not be completed.");
      const vehicle = result.vehicle ? `${result.vehicle.code}${result.vehicle.registrationNo ? ` · ${result.vehicle.registrationNo}` : ""}` : "vehicle";
      const notes = [...(result.documentWarnings ?? []), ...(result.blockers ?? []), ...(result.cautions ?? [])];
      toast.success("Vehicle check-in complete", `${vehicle}. ${result.message ?? ""}`.trim());
      if (notes.length) toast.info("Please review before driving", notes.slice(0, 2).join(" · "), 7000);
      close();
      router.refresh();
    } catch (error) {
      scanLockedRef.current = false;
      toast.error("Check-in could not be completed", error instanceof Error ? error.message : "Please try again or contact your supervisor.");
    } finally { setPending(false); }
  }, [close, readLocation, router, stopCamera, toast]);

  const handleDetectedCode = useCallback((token: string) => {
    if (scanLockedRef.current) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([100, 50, 100]);
    void checkIn(token);
  }, [checkIn]);

  const startCamera = useCallback(async () => {
    const Detector = barcodeDetector();
    if (!Detector) { setCameraError("This browser cannot read QR codes directly. Use the printed FV code instead."); setMode("code"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const detector = new Detector({ formats: ["qr_code"] });
      scanIntervalRef.current = setInterval(() => {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || scanLockedRef.current) return;
        void detector.detect(video).then((codes) => { const token = codes[0]?.rawValue; if (token) handleDetectedCode(token); }).catch(() => undefined);
      }, 300);
    } catch (error) { setCameraError(error instanceof Error ? error.message : "Camera access was not available."); setMode("code"); }
  }, [handleDetectedCode]);

  useEffect(() => {
    // Camera setup is an external subscription. Its async failure changes to
    // the manual-code view, the only useful recovery state for this workflow.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && mode === "camera") void startCamera(); else stopCamera();
    return stopCamera;
  }, [mode, open, startCamera, stopCamera]);
  const openScanner = () => { scanLockedRef.current = false; setMode("camera"); setOpen(true); };
  const title = currentVehicleCode ? "Change vehicle" : "Scan vehicle QR";
  const description = currentVehicleCode ? `Finish or switch from ${currentVehicleCode} by scanning the cabin sticker of the vehicle you are taking.` : "Scan the QR sticker inside the cabin to start your vehicle check-in.";

  return <>
    {triggerVariant === "card" && <div className="relative overflow-hidden rounded-3xl border-2 border-brand-500/30 bg-linear-to-br from-brand-600 via-brand-700 to-ink-900 p-6 text-white shadow-xl shadow-brand-600/20"><div className="relative z-10 flex flex-col items-center text-center"><div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 ring-4 ring-white/30"><QrCode className="h-9 w-9 animate-pulse" /></div><h2 className="mt-4 text-xl font-black tracking-tight">{title}</h2><p className="mt-1 max-w-xs text-xs leading-relaxed text-brand-100">Cabin ke andar laga QR sticker scan karein. Gaadi list se select nahi hoti.</p><button onClick={openScanner} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-sm font-bold text-brand-700 shadow-lg hover:bg-slate-50 active:scale-95"><Camera className="h-5 w-5" />Open QR scanner</button></div></div>}
    {triggerVariant === "button" && <button onClick={openScanner} className="inline-flex items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2 text-xs font-bold text-brand-700 shadow-xs hover:bg-brand-100 active:scale-95"><QrCode className="h-4 w-4" />{title}</button>}
    {triggerVariant === "banner" && <div className="flex items-center justify-between rounded-2xl border border-brand-200 bg-brand-50/80 p-3.5"><div className="flex items-center gap-2.5"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white"><QrCode className="h-5 w-5" /></div><div><p className="text-xs font-bold text-ink-900">Cabin QR scanner</p><p className="text-[11px] text-slate-500">Scan sticker to check in</p></div></div><button onClick={openScanner} className="rounded-xl bg-brand-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-600 active:scale-95">Scan now</button></div>}
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:p-6" role="dialog" aria-modal="true" aria-label="Vehicle QR check-in"><div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/10"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-2.5"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><QrCode className="h-5 w-5" /></div><div><h3 className="text-base font-bold text-ink-900">Vehicle check-in</h3><p className="text-xs text-slate-500">{description}</p></div></div><button onClick={close} disabled={pending} className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close scanner"><X className="h-5 w-5" /></button></div><div className="grid grid-cols-2 gap-1 border-b border-slate-100 bg-slate-50 p-2"><button onClick={() => setMode("camera")} className={cn("flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold", mode === "camera" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500")}><Camera className="h-4 w-4" />Scan QR</button><button onClick={() => setMode("code")} className={cn("flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold", mode === "code" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500")}><Keyboard className="h-4 w-4" />Enter code</button></div><div className="overflow-y-auto p-5"><ol className="mb-4 grid grid-cols-3 gap-2 text-center text-[11px] font-medium text-slate-500"><li><span className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-brand-700">1</span>Find cabin sticker</li><li><span className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-brand-700">2</span>Scan or enter FV code</li><li><span className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-brand-700">3</span>Check message</li></ol>{mode === "camera" ? <div className="flex flex-col items-center"><div className="relative aspect-square w-full max-w-70 overflow-hidden rounded-3xl bg-slate-950 shadow-inner"><video ref={videoRef} playsInline muted className="h-full w-full object-cover" /><div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"><div className="h-44 w-44 rounded-2xl border-2 border-dashed border-brand-400 bg-brand-500/10" /></div>{pending && <div className="absolute inset-0 flex items-center justify-center bg-slate-900/70"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>}</div><p className="mt-3 text-center text-xs font-semibold text-slate-600">Camera ko cabin sticker par rakhein.</p>{cameraError && <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />{cameraError}</div>}</div> : <form onSubmit={(event) => { event.preventDefault(); void checkIn(code); }} className="space-y-4"><div className="rounded-2xl border border-sky-100 bg-sky-50 p-3 text-xs leading-relaxed text-sky-800">If camera permission is unavailable, type the exact <strong>FV-...</strong> code printed below the QR sticker. Registration number and vehicle code will not work here.</div><label className="block text-xs font-semibold text-slate-700">Cabin sticker code<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="FV-XXXXXXXXXX" maxLength={48} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 font-mono text-sm font-bold uppercase tracking-wide outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /></label><button type="submit" disabled={pending || !code.trim()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Check in to vehicle</button><p className="text-center text-[11px] text-slate-500">Sticker missing or damaged? Ask your supervisor to print a replacement; do not select another vehicle.</p></form>}</div></div></div>}
  </>;
}

export default DriverQrScanner;
