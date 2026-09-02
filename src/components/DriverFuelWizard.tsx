"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFuel, saveServicePhotos } from "@/app/(app)/entry-actions";
import { isActionError } from "@/lib/action-result";
import { PushButton } from "@/components/PushButton";
import { Truck, Camera, Check, ArrowLeft, Delete, Volume2, Fuel, LogOut, Loader2, CircleCheck, Wrench, X, Pencil, Sparkles } from "lucide-react";

type Vehicle = { id: string; code: string; regNo: string | null; name: string };
type Recent = { id: string; code: string; regNo: string | null; qty: number; date: string; odo: string | null; pump: string | null };

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = document.createElement("img");
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = url; });
    const max = 1024;
    let { width, height } = img;
    if (width > max || height > max) { const r = Math.min(max / width, max / height); width = Math.round(width * r); height = Math.round(height * r); }
    const c = document.createElement("canvas"); c.width = width; c.height = height;
    c.getContext("2d")!.drawImage(img, 0, 0, width, height);
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), "image/jpeg", 0.6)!);
    return new File([blob], "photo.jpg", { type: "image/jpeg" });
  } catch { return file; } finally { URL.revokeObjectURL(url); }
}

async function compressForOCR(file: File): Promise<File> {
  // higher resolution + quality than the stored copy, so small digits stay sharp
  if (!file.type.startsWith("image/")) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = document.createElement("img");
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = url; });
    const max = 2000; // higher res so small meter/pump digits stay sharp
    let { width, height } = img;
    if (width > max || height > max) { const r = Math.min(max / width, max / height); width = Math.round(width * r); height = Math.round(height * r); }
    const c = document.createElement("canvas"); c.width = width; c.height = height;
    c.getContext("2d")!.drawImage(img, 0, 0, width, height);
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), "image/jpeg", 0.92)!);
    return new File([blob], "ocr.jpg", { type: "image/jpeg" });
  } catch { return file; } finally { URL.revokeObjectURL(url); }
}

const cleanNum = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/[^0-9.]/g, ""));

export type OcrResult = {

  value?: string;
  litres?: string;
  rate?: string;
  amount?: string;
  confidence?: string;
  numericConfidence: number;
  recommendedUiAction: "AUTO_ADVANCE" | "CONFIRM_NEEDED" | "RETAKE_REQUIRED" | "MANUAL_ENTRY";
  reasons: string[];
};

async function ocrOdometerEx(file: File): Promise<OcrResult> {
  try {
    const fd = new FormData();
    fd.set("image", await compressForOCR(file));
    fd.set("kind", "odometer");
    const j = await (await fetch("/api/ocr", { method: "POST", body: fd })).json();
    return {
      value: cleanNum(j.value),
      confidence: j.confidence || "medium",
      numericConfidence: j.numericConfidence ?? 0.7,
      recommendedUiAction: j.recommendedUiAction || "CONFIRM_NEEDED",
      reasons: j.verification?.reasons || [],
    };
  } catch {
    return { numericConfidence: 0, recommendedUiAction: "MANUAL_ENTRY", reasons: ["Could not reach the photo reader — type the number in."] };
  }
}

async function ocrPumpEx(file: File): Promise<OcrResult> {
  try {
    const fd = new FormData();
    fd.set("image", await compressForOCR(file));
    fd.set("kind", "pump");
    const j = await (await fetch("/api/ocr", { method: "POST", body: fd })).json();
    return {
      litres: cleanNum(j.litres),
      rate: cleanNum(j.rate),
      amount: cleanNum(j.amount),
      confidence: j.confidence || "medium",
      numericConfidence: j.numericConfidence ?? 0.7,
      recommendedUiAction: j.recommendedUiAction || "CONFIRM_NEEDED",
      reasons: j.verification?.reasons || [],
    };
  } catch {
    return { numericConfidence: 0, recommendedUiAction: "MANUAL_ENTRY", reasons: ["Could not reach the photo reader — type the number in."] };
  }
}


function getGeo(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((res) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => res(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

function buzz(ms: number | number[] = 25) { try { navigator.vibrate?.(ms); } catch { /* ignore */ } }

function speak(text: string) {
  try { const u = new SpeechSynthesisUtterance(text); u.lang = "hi-IN"; u.rate = 0.92; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch { /* ignore */ }
}

type Step = "home" | "vehicle" | "odo" | "pump" | "review" | "rold" | "rnew" | "done";
type Mode = "fuel" | "repair";

const PROMPT: Record<string, string> = {
  vehicle: "अपनी गाड़ी चुनें",
  odo: "मीटर का फोटो खींचें",
  pump: "पंप मशीन का फोटो खींचें",
  review: "जांच लें, फिर भेजें",
  rold: "पुराना निकाला हुआ पुर्ज़ा का फोटो खींचें",
  rnew: "नया लगाया हुआ पुर्ज़ा का फोटो खींचें",
  done: "हो गया! धन्यवाद",
};

function StepHeader({ back, hindi, eng, step }: { back: () => void; hindi: string; eng: string; step: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 bg-white px-3 py-3 shadow-sm">
      <button onClick={back} className="rounded-xl bg-slate-100 p-3 active:bg-slate-200"><ArrowLeft className="h-6 w-6 text-slate-700" /></button>
      <div className="flex-1"><p className="text-lg font-bold text-ink-900">{hindi}</p><p className="text-xs text-slate-400">{eng}</p></div>
      <button onClick={() => speak(PROMPT[step] ?? hindi)} className="rounded-xl bg-brand-50 p-3 text-brand-600 active:bg-brand-100"><Volume2 className="h-6 w-6" /></button>
    </header>
  );
}

export function DriverFuelWizard({ vehicles, driverName, recent, defaultProjectId, dieselRate = 92.5 }: {
  vehicles: Vehicle[]; driverName: string; recent: Recent[]; defaultProjectId: string | null; dieselRate?: number;
}) {

  const [step, setStep] = useState<Step>("home");
  const [mode, setMode] = useState<Mode>("fuel");
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [odo, setOdo] = useState<File | null>(null);
  const [pump, setPump] = useState<File | null>(null);
  const [odoValue, setOdoValue] = useState("");
  const [litres, setLitres] = useState("");
  const [rate, setRate] = useState(String(dieselRate));
  const [odoConf, setOdoConf] = useState<number | null>(null);
  const [pumpConf, setPumpConf] = useState<number | null>(null);
  const [odoAction, setOdoAction] = useState<"AUTO_ADVANCE" | "CONFIRM_NEEDED" | "RETAKE_REQUIRED" | "MANUAL_ENTRY" | null>(null);
  const [pumpAction, setPumpAction] = useState<"AUTO_ADVANCE" | "CONFIRM_NEEDED" | "RETAKE_REQUIRED" | "MANUAL_ENTRY" | null>(null);
  const [captureReasons, setCaptureReasons] = useState<string[]>([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [numpad, setNumpad] = useState<null | "odo" | "litres" | "rate">(null);
  const [oldPhotos, setOldPhotos] = useState<File[]>([]);
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [pending, start] = useTransition();
  const router = useRouter();
  const camRef = useRef<HTMLInputElement>(null);
  const repairRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (PROMPT[step]) speak(PROMPT[step]); }, [step]);

  // Android hardware back button → go to previous wizard step (don't exit app)
  const stepRef = useRef(step);
  const numpadRef = useRef(numpad);

  useEffect(() => {
    stepRef.current = step;
    numpadRef.current = numpad;
  }, [step, numpad]);

  // Android home-screen quick actions (?action=fuel | repair)
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("action");
    if (a === "fuel") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode("fuel");
      setStep("vehicle");
    } else if (a === "repair") {
       
      setMode("repair");
      setStep("vehicle");
    }
  }, []);
  useEffect(() => {
    function onPop() {
      if (numpadRef.current) { setNumpad(null); window.history.pushState(null, ""); return; }
      const s = stepRef.current;
      if (s === "home") return; // let it exit the app
      if (s === "vehicle" || s === "done") {
        setVehicle(null); setOdo(null); setPump(null); setOdoValue(""); setLitres("");
        setOdoConf(null); setPumpConf(null); setOdoAction(null); setPumpAction(null);
        setOldPhotos([]); setNewPhotos([]); setStep("home");
      }
      else if (s === "odo") setStep("vehicle");
      else if (s === "pump") setStep("odo");
      else if (s === "review") setStep("pump");
      else if (s === "rold") setStep("vehicle");
      else if (s === "rnew") setStep("rold");
      window.history.pushState(null, ""); // re-arm
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => { if (step !== "home" || numpad) window.history.pushState(null, ""); }, [step, numpad]);

  function reset() {
    setVehicle(null); setOdo(null); setPump(null); setOdoValue(""); setLitres(""); setRate(String(dieselRate));
    setOdoConf(null); setPumpConf(null); setOdoAction(null); setPumpAction(null); setCaptureReasons([]);
    setOldPhotos([]); setNewPhotos([]); setNumpad(null); setMode("fuel"); setStep("home");
  }

  async function capture(which: "odo" | "pump", file: File) {
    if (which === "odo") setOdo(file); else setPump(file);
    setOcrBusy(true);
    if (which === "odo") {
      const r = await ocrOdometerEx(file);
      setOdoValue(r.value || "");
      setOdoConf(r.numericConfidence);
      setOdoAction(r.recommendedUiAction);
      setCaptureReasons(r.reasons);
      if (r.recommendedUiAction === "RETAKE_REQUIRED") {
        buzz([100, 50, 100]);
        speak("फोटो साफ नहीं है, कृपया दोबारा फोटो खींचें");
      } else if (r.recommendedUiAction === "AUTO_ADVANCE") {
        buzz(40);
      }
    } else {
      const r = await ocrPumpEx(file);
      if (r.litres) setLitres(r.litres);
      if (r.rate) setRate(r.rate);
      setPumpConf(r.numericConfidence);
      setPumpAction(r.recommendedUiAction);
      setCaptureReasons(r.reasons);
      if (r.recommendedUiAction === "RETAKE_REQUIRED") {
        buzz([100, 50, 100]);
        speak("फोटो साफ नहीं है, कृपया दोबारा फोटो खींचें");
      } else if (r.recommendedUiAction === "AUTO_ADVANCE") {
        buzz(40);
      }
    }
    setOcrBusy(false);
  }

  function finishFuel() {
    if (!vehicle || !litres || Number(litres) <= 0) return;
    const fd = new FormData();
    fd.set("type", "ISSUE");
    fd.set("assetId", vehicle.id);
    if (defaultProjectId) fd.set("projectId", defaultProjectId);
    fd.set("quantity", litres);
    fd.set("meterValue", odoValue || "0");
    fd.set("rate", rate || "92.5");
    start(async () => {
      try {
        const geo = await getGeo();
        if (geo) { fd.set("lat", String(geo.lat)); fd.set("lng", String(geo.lng)); }
        if (odo) fd.set("odometerPhoto", await compressImage(odo));
        if (pump) fd.set("pumpPhoto", await compressImage(pump));
        const result = await saveFuel(fd);
        if (isActionError(result)) { alert(result.error); return; }
        buzz([40, 50, 80]); setStep("done"); router.refresh();
      } catch { /* stay on review */ }
    });
  }

  function finishRepair() {
    if (!vehicle || newPhotos.length === 0) return;
    const fd = new FormData();
    fd.set("assetId", vehicle.id);
    start(async () => {
      try {
        for (const f of oldPhotos) fd.append("oldPhotos", await compressImage(f));
        for (const f of newPhotos) fd.append("newPhotos", await compressImage(f));
        const result = await saveServicePhotos(fd);
        if (isActionError(result)) { alert(result.error); return; }
        buzz([40, 50, 80]); setStep("done"); router.refresh();
      } catch { setStep("rnew"); }
    });
  }



  // ---- NUMPAD overlay (to fix OCR value) ----
  if (numpad) {
    const target = numpad;
    const val = target === "odo" ? odoValue : target === "rate" ? rate : litres;
    const setVal = target === "odo" ? setOdoValue : target === "rate" ? setRate : setLitres;
    const isRate = target === "rate";
    const press = (d: string) => setVal((q) => {
      if (d === "." && q.includes(".")) return q;
      return q.length < 7 ? q + d : q;
    });
    const keys = isRate
      ? ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"]
      : ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "back"];
    const title = target === "odo" ? "मीटर नंबर" : isRate ? "रेट ₹/लीटर" : "कितने लीटर?";
    const unit = target === "odo" ? "मीटर" : isRate ? "₹/लीटर" : "लीटर";
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <header className="flex items-center gap-3 bg-white px-3 py-3 shadow-sm">
          <button onClick={() => setNumpad(null)} className="rounded-xl bg-slate-100 p-3"><ArrowLeft className="h-6 w-6" /></button>
          <p className="text-lg font-bold">{title}</p>
        </header>
        <div className="flex items-center justify-center py-6">
          <div className="rounded-2xl bg-white px-8 py-5 text-center shadow-sm">
            <p className="text-6xl font-extrabold text-ink-900">{val || "0"}</p>
            <p className="text-lg font-semibold text-slate-400">{unit}</p>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-2.5 px-4">
          {keys.map((k) => (
            <button key={k} onClick={() => k === "C" ? setVal("") : k === "back" ? setVal((q) => q.slice(0, -1)) : press(k)}
              className={`flex items-center justify-center rounded-2xl text-3xl font-extrabold shadow-sm active:scale-95 ${k === "C" ? "bg-rose-100 text-rose-600" : k === "back" ? "bg-amber-100 text-amber-700" : "bg-white text-ink-900"}`}>
              {k === "back" ? <Delete className="h-8 w-8" /> : k === "C" ? "✕" : k}
            </button>
          ))}
        </div>
        <div className="p-4">
          <button onClick={() => setNumpad(null)} className="w-full rounded-2xl bg-emerald-500 py-5 text-2xl font-extrabold text-white shadow-lg active:scale-[0.98]">ठीक है</button>
        </div>
      </div>
    );
  }

  // ---- HOME ----
  if (step === "home") {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="flex flex-wrap items-center justify-between gap-3 bg-ink-900 px-4 py-4 text-white">
          <div className="flex items-center gap-2"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500"><Truck className="h-6 w-6" /></div><p className="text-base font-bold">{driverName.split(" ")[0]}</p></div>
          <a href="/api/auth/logout" className="rounded-xl bg-white/10 p-3"><LogOut className="h-6 w-6" /></a>
        </header>
        <div className="p-5">
          <button onClick={() => { setMode("fuel"); setStep("vehicle"); }} className="flex w-full flex-col items-center gap-3 rounded-3xl bg-gradient-to-br from-brand-500 to-brand-700 py-10 text-white shadow-xl shadow-brand-500/30 active:scale-[0.98]">
            <Fuel className="h-16 w-16" /><span className="text-3xl font-extrabold">डीज़ल भरें</span><span className="text-base opacity-90">+ Add Diesel</span>
          </button>
          <button onClick={() => { setMode("repair"); setStep("vehicle"); }} className="mt-4 flex w-full flex-col items-center gap-3 rounded-3xl bg-gradient-to-br from-amber-500 to-orange-600 py-10 text-white shadow-xl shadow-amber-500/30 active:scale-[0.98]">
            <Wrench className="h-16 w-16" /><span className="text-3xl font-extrabold">मरम्मत फोटो</span><span className="text-base opacity-90">+ Repair Part Photos</span>
          </button>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <PushButton label="🔔 अलर्ट चालू करें" className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-3 text-base font-bold text-brand-700 shadow-sm ring-1 ring-slate-200" />
            <a href="/install" className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-3 text-base font-bold text-emerald-700 shadow-sm ring-1 ring-slate-200">📲 ऐप इंस्टॉल</a>
          </div>
          {recent.length > 0 && (
            <div className="mt-6">
              <p className="mb-3 text-sm font-semibold text-slate-500">पिछली एंट्री · Recent</p>
              <div className="space-y-2">
                {recent.slice(0, 6).map((r) => (
                  <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
                    <div className="rounded-lg bg-yellow-300 px-2 py-1 font-mono text-sm font-bold text-black">{r.regNo ?? r.code}</div>
                    <div className="flex flex-1 items-center gap-1.5">{r.odo && <img src={r.odo} alt="" className="h-9 w-9 rounded object-cover" />}{r.pump && <img src={r.pump} alt="" className="h-9 w-9 rounded object-cover" />}</div>
                    <p className="text-lg font-extrabold text-ink-900">{r.qty}<span className="text-xs font-medium text-slate-400"> L</span></p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- VEHICLE ----
  if (step === "vehicle") {
    return (
      <div className="min-h-screen bg-slate-50">
        <StepHeader back={reset} hindi="अपनी गाड़ी चुनें" eng="Choose your vehicle" step={step} />

        <div className="grid grid-cols-2 gap-3 p-4">
          {vehicles.map((v) => (
            <button key={v.id} onClick={() => { setVehicle(v); setStep(mode === "fuel" ? "odo" : "rold"); }} className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4 shadow-sm active:scale-95 active:bg-brand-50">
              <Truck className="h-9 w-9 text-brand-600" />
              <div className="rounded-lg border-2 border-black bg-yellow-300 px-2 py-1 text-center font-mono text-base font-extrabold leading-tight text-black">{v.regNo ?? v.code}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- FUEL PHOTO (odo / pump) with OCR ----
  if (step === "odo" || step === "pump") {
    const isOdo = step === "odo";
    const file = isOdo ? odo : pump;
    const value = isOdo ? odoValue : litres;
    const conf = isOdo ? odoConf : pumpConf;
    const uiAction = isOdo ? odoAction : pumpAction;
    const preview = file ? URL.createObjectURL(file) : null;
    const isRetakeRequired = uiAction === "RETAKE_REQUIRED";

    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <StepHeader back={() => setStep(isOdo ? "vehicle" : "odo")} hindi={isOdo ? "मीटर का फोटो" : "पंप मशीन का फोटो"} eng={isOdo ? "Photo of odometer" : "Photo of fuel pump meter"} step={step} />

        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) capture(isOdo ? "odo" : "pump", f); e.currentTarget.value = ""; }} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <button onClick={() => camRef.current?.click()} className="flex aspect-square w-full max-w-xs flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl border-4 border-dashed border-brand-300 bg-white active:bg-brand-50">
            {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <><Camera className="h-24 w-24 text-brand-400" /><span className="text-xl font-bold text-brand-600">फोटो खींचें</span></>}
          </button>
          {file && (
            <div className="w-full max-w-xs rounded-2xl bg-white p-4 text-center shadow-sm">
              {ocrBusy ? (
                <p className="flex items-center justify-center gap-2 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> पढ़ रहे हैं…</p>
              ) : (
                <>
                  {uiAction === "AUTO_ADVANCE" && (
                    <p className="flex items-center justify-center gap-1 text-xs font-semibold text-emerald-600"><Sparkles className="h-3.5 w-3.5" /> ✅ बिल्कुल सही पढ़ा · High confidence ({Math.round((conf ?? 0.9) * 100)}%)</p>
                  )}
                  {uiAction === "CONFIRM_NEEDED" && (
                    <p className="flex items-center justify-center gap-1 text-xs font-semibold text-amber-600">⚠️ जांच लें · Please verify number ({Math.round((conf ?? 0.7) * 100)}%)</p>
                  )}
                  {uiAction === "RETAKE_REQUIRED" && (
                    <div className="rounded-xl bg-amber-50 p-2.5 text-center text-xs font-bold text-amber-800 ring-1 ring-amber-200">
                      ⚠️ फोटो साफ नहीं है · Photo unclear — retake it, or type the number below
                    </div>
                  )}
                  {/* Not the driver's fault and not fixable by them: say so
                      plainly and point at the way through, rather than asking
                      for another photo that will fail the same way. */}
                  {uiAction === "MANUAL_ENTRY" && (
                    <div className="rounded-xl bg-slate-100 p-2.5 text-center text-xs font-bold text-slate-700 ring-1 ring-slate-300">
                      📷 फोटो पढ़ने की सुविधा अभी बंद है · Photo reading is off — please type the number
                    </div>
                  )}

                  <p className="text-4xl font-extrabold text-ink-900">{value || "?"}<span className="text-base font-medium text-slate-400">{isOdo ? "" : " L"}</span></p>
                  
                  {captureReasons.length > 0 && (
                    <p className="mt-1 text-[11px] text-rose-600">{captureReasons[0]}</p>
                  )}

                  <div className="mt-2 flex justify-center gap-3">
                    <button onClick={() => setNumpad(isOdo ? "odo" : "litres")} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600"><Pencil className="h-3.5 w-3.5" /> ठीक करें · Fix</button>
                    {isRetakeRequired && (
                      <button onClick={() => camRef.current?.click()} className="inline-flex items-center gap-1 text-sm font-semibold text-rose-600"><Camera className="h-3.5 w-3.5" /> दोबारा खींचें · Retake</button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="p-4">
          <button disabled={!file || ocrBusy} onClick={() => setStep(isOdo ? "pump" : "review")} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-5 text-2xl font-extrabold text-white shadow-lg active:scale-[0.98] disabled:opacity-40">
            आगे <ArrowLeft className="h-7 w-7 rotate-180" />
          </button>
        </div>
      </div>
    );
  }


  // ---- REVIEW ----
  if (step === "review") {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <StepHeader back={() => setStep("pump")} hindi="जांच लें" eng="Check & send" step={step} />

        <div className="flex flex-1 flex-col gap-4 p-5">
          <button onClick={() => setNumpad("litres")} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-5 shadow-sm active:bg-slate-50">
            <div className="flex items-center gap-3"><Fuel className="h-8 w-8 text-brand-600" /><span className="text-lg font-bold text-slate-600">डीज़ल</span></div>
            <div className="flex items-center gap-2"><span className="text-4xl font-extrabold text-ink-900">{litres || "0"}</span><span className="text-lg text-slate-400">L</span><Pencil className="h-5 w-5 text-brand-500" /></div>
          </button>
          <button onClick={() => setNumpad("odo")} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-5 shadow-sm active:bg-slate-50">
            <div className="flex items-center gap-3"><Truck className="h-8 w-8 text-brand-600" /><span className="text-lg font-bold text-slate-600">मीटर</span></div>
            <div className="flex items-center gap-2"><span className="text-4xl font-extrabold text-ink-900">{odoValue || "0"}</span><Pencil className="h-5 w-5 text-brand-500" /></div>
          </button>
          <button onClick={() => setNumpad("rate")} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-5 shadow-sm active:bg-slate-50">
            <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center text-2xl font-extrabold text-brand-600">₹</span><span className="text-lg font-bold text-slate-600">रेट / लीटर</span></div>
            <div className="flex items-center gap-2"><span className="text-4xl font-extrabold text-ink-900">{rate || "0"}</span><Pencil className="h-5 w-5 text-brand-500" /></div>
          </button>
          <div className="rounded-2xl bg-brand-50 p-4 text-center">
            <p className="text-sm text-slate-500">कुल · Total</p>
            <p className="text-2xl font-extrabold text-brand-700">₹ {Math.round((Number(litres) || 0) * (Number(rate) || 0)).toLocaleString("en-IN")}</p>
          </div>
          <div className="flex gap-2">
            {odo && <img src={URL.createObjectURL(odo)} alt="" className="h-20 w-20 rounded-xl object-cover ring-1 ring-slate-200" />}
            {pump && <img src={URL.createObjectURL(pump)} alt="" className="h-20 w-20 rounded-xl object-cover ring-1 ring-slate-200" />}
            <button onClick={() => speak(`आपने ${litres || 0} लीटर डीज़ल भरा`)} className="flex h-20 w-20 flex-col items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Volume2 className="h-7 w-7" /><span className="text-[10px]">सुनें</span></button>
          </div>
        </div>
        <div className="p-4">
          <button disabled={pending || !litres || Number(litres) <= 0} onClick={finishFuel} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-5 text-2xl font-extrabold text-white shadow-lg active:scale-[0.98] disabled:opacity-40">
            {pending ? <Loader2 className="h-7 w-7 animate-spin" /> : <Check className="h-7 w-7" />} भेजें · Save
          </button>
        </div>
      </div>
    );
  }

  // ---- REPAIR: OLD then NEW ----
  if (step === "rold" || step === "rnew") {
    const isOld = step === "rold";
    const photos = isOld ? oldPhotos : newPhotos;
    const setPhotos = isOld ? setOldPhotos : setNewPhotos;
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <StepHeader back={() => setStep(isOld ? "vehicle" : "rold")} hindi={isOld ? "पुराना निकाला हुआ पुर्ज़ा" : "नया लगाया हुआ पुर्ज़ा"} eng={isOld ? "OLD removed part" : "NEW fitted part"} step={step} />

        <div className={`mx-4 mt-3 rounded-xl px-4 py-2 text-center text-sm font-bold ${isOld ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{isOld ? "① पुराना पुर्ज़ा दिखाएं" : "② नया पुर्ज़ा दिखाएं"}</div>
        <input ref={repairRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhotos((p) => [...p, f]); e.currentTarget.value = ""; }} />
        <div className="grid flex-1 grid-cols-2 content-start gap-3 p-4">
          {photos.map((f, i) => (
            <div key={i} className={`relative aspect-square overflow-hidden rounded-2xl ring-2 ${isOld ? "ring-rose-300" : "ring-emerald-300"}`}>
              <img src={URL.createObjectURL(f)} className="h-full w-full object-cover" alt="" />
              <button onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} className="absolute right-1.5 top-1.5 rounded-full bg-rose-500 p-1.5 text-white shadow"><X className="h-4 w-4" /></button>
            </div>
          ))}
          <button onClick={() => repairRef.current?.click()} className={`flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-4 border-dashed bg-white ${isOld ? "border-rose-300 active:bg-rose-50" : "border-emerald-300 active:bg-emerald-50"}`}>
            <Camera className={`h-14 w-14 ${isOld ? "text-rose-400" : "text-emerald-400"}`} /><span className={`text-base font-bold ${isOld ? "text-rose-600" : "text-emerald-600"}`}>फोटो जोड़ें</span>
          </button>
        </div>
        <div className="p-4">
          {isOld ? (
            <button onClick={() => setStep("rnew")} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-ink-900 py-5 text-2xl font-extrabold text-white shadow-lg active:scale-[0.98]">आगे <ArrowLeft className="h-7 w-7 rotate-180" /></button>
          ) : (
            <button disabled={pending || newPhotos.length === 0} onClick={finishRepair} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-5 text-2xl font-extrabold text-white shadow-lg active:scale-[0.98] disabled:opacity-40">{pending ? <Loader2 className="h-7 w-7 animate-spin" /> : <Check className="h-7 w-7" />} पूरा करें</button>
          )}
        </div>
      </div>
    );
  }

  // ---- DONE ----
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-emerald-50 p-6">
      <div className="animate-fade-up flex h-32 w-32 items-center justify-center rounded-full bg-emerald-500 shadow-xl shadow-emerald-500/40"><CircleCheck className="h-20 w-20 text-white" /></div>
      <p className="text-3xl font-extrabold text-emerald-700">हो गया!</p>
      <p className="text-base text-slate-500">Saved successfully</p>
      <button onClick={reset} className="mt-4 w-full max-w-xs rounded-2xl bg-ink-900 py-5 text-2xl font-extrabold text-white shadow-lg active:scale-[0.98]">ठीक है · OK</button>
    </div>
  );
}
