"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveFuel, saveServicePhotos } from "@/app/(app)/entry-actions";
import { isActionError } from "@/lib/action-result";
import { useToast } from "@/components/Toast";
import { Truck, Camera, Check, ArrowLeft, Delete, Volume2, Fuel, Loader2, CircleCheck, X, Pencil, Sparkles } from "lucide-react";

type Vehicle = { id: string; code: string; regNo: string | null; name: string };

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

/** Three camera captures travel in one Server Action. Keep the combined body
 * comfortably below its 8 MB boundary, including multipart overhead. */
async function compressFuelEvidence(file: File): Promise<File> {
  const compressed = await compressImage(file);
  const maxBytes = 2 * 1024 * 1024;
  if (compressed.size > maxBytes) {
    throw new Error("Photo is too large. Take a fresh dashboard or pump photo and try again.");
  }
  return compressed;
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

type Step = "vehicle" | "odo" | "pump" | "after" | "review" | "rold" | "rnew" | "done";
type Mode = "fuel" | "repair";
const FUEL_DRAFT_PREFIX = "fleetview:driver:fuel-draft:v2:";
type FuelDraft = { vehicleId: string; odoValue: string; litres: string; rate: string; amount: string; savedAt: number };

const fuelDraftKey = (vehicleId: string) => `${FUEL_DRAFT_PREFIX}${vehicleId}`;

function loadFuelDraft(vehicles: Vehicle[]): FuelDraft | null {
  try {
    const drafts = vehicles.flatMap((vehicle) => {
      const raw = window.localStorage.getItem(fuelDraftKey(vehicle.id));
      if (!raw) return [];
      const draft = JSON.parse(raw) as Partial<FuelDraft>;
      if (draft.vehicleId !== vehicle.id || Date.now() - Number(draft.savedAt) > 7 * 24 * 60 * 60 * 1000) return [];
      return [{ ...draft, rate: String(draft.rate ?? "") } as FuelDraft];
    });
    return drafts.sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
  } catch { return null; }
}
function loadFuelDraftForVehicle(vehicleId: string): FuelDraft | null {
  try {
    const raw = window.localStorage.getItem(fuelDraftKey(vehicleId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<FuelDraft>;
    if (draft.vehicleId !== vehicleId || Date.now() - Number(draft.savedAt) > 7 * 24 * 60 * 60 * 1000) return null;
    return { ...draft, rate: String(draft.rate ?? "") } as FuelDraft;
  } catch { return null; }
}
function saveFuelDraft(draft: FuelDraft) { try { window.localStorage.setItem(fuelDraftKey(draft.vehicleId), JSON.stringify(draft)); } catch { /* visible form remains available */ } }
function clearFuelDraft(vehicleId: string) { try { window.localStorage.removeItem(fuelDraftKey(vehicleId)); } catch { /* ignore */ } }

const PROMPT: Record<string, string> = {
  vehicle: "अपनी गाड़ी चुनें",
  odo: "ईंधन से पहले डैशबोर्ड का फोटो खींचें",
  pump: "पंप मशीन का फोटो खींचें",
  after: "ईंधन के बाद डैशबोर्ड का फोटो खींचें",
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

export function DriverFuelWizard({ vehicles, defaultProjectId, dieselRate = 92.5 }: {
  vehicles: Vehicle[]; defaultProjectId: string | null; dieselRate?: number;
}) {

  const [step, setStep] = useState<Step>(vehicles.length === 1 ? "review" : "vehicle");
  const [mode, setMode] = useState<Mode>("fuel");
  const [vehicle, setVehicle] = useState<Vehicle | null>(vehicles.length === 1 ? vehicles[0] : null);
  const [odo, setOdo] = useState<File | null>(null);
  const [pump, setPump] = useState<File | null>(null);
  const [afterOdo, setAfterOdo] = useState<File | null>(null);
  const [odoValue, setOdoValue] = useState("");
  const [litres, setLitres] = useState("");
  const [rate, setRate] = useState(String(dieselRate));
  const [amount, setAmount] = useState("");
  const [odoConf, setOdoConf] = useState<number | null>(null);
  const [pumpConf, setPumpConf] = useState<number | null>(null);
  const [odoAction, setOdoAction] = useState<"AUTO_ADVANCE" | "CONFIRM_NEEDED" | "RETAKE_REQUIRED" | "MANUAL_ENTRY" | null>(null);
  const [pumpAction, setPumpAction] = useState<"AUTO_ADVANCE" | "CONFIRM_NEEDED" | "RETAKE_REQUIRED" | "MANUAL_ENTRY" | null>(null);
  const [captureReasons, setCaptureReasons] = useState<string[]>([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [numpad, setNumpad] = useState<null | "odo" | "litres" | "amount">(null);
  const [oldPhotos, setOldPhotos] = useState<File[]>([]);
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const camRef = useRef<HTMLInputElement>(null);
  const repairRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (PROMPT[step]) speak(PROMPT[step]); }, [step]);
  useEffect(() => {
    const qty = Number(litres), price = Number(rate);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- amount is a derived submission field used by the existing server action.
    if (Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0) setAmount(String(Math.round(qty * price * 100) / 100));
  }, [litres, rate]);

  // Android hardware back button → go to previous wizard step (don't exit app)
  const stepRef = useRef(step);
  const numpadRef = useRef(numpad);

  useEffect(() => {
    stepRef.current = step;
    numpadRef.current = numpad;
  }, [step, numpad]);

  // The driver app hands this screen the claimed vehicle. Skip a redundant
  // picker; a saved draft is restored for review, never submitted automatically.
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("action");
    if (a === "fuel") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode("fuel");
      const draft = loadFuelDraft(vehicles);
      if (draft) {
        setVehicle(vehicles.find((v) => v.id === draft.vehicleId) ?? null);
        setOdoValue(draft.odoValue); setLitres(draft.litres); setRate(draft.rate || String(dieselRate)); setAmount(draft.amount);
      }
      setStep(vehicles.length === 1 ? "review" : "vehicle");
    } else if (a === "repair") {
       
      setMode("repair");
      setStep("vehicle");
    }
  }, [vehicles, dieselRate]);
  // Keep typed fuel details safe across a reload or a signal loss. Images stay
  // out of localStorage: browser quotas are too small and stale photos should
  // never be silently submitted later.
  useEffect(() => {
    if (!vehicle || (!odoValue && !litres && !amount)) return;
    saveFuelDraft({ vehicleId: vehicle.id, odoValue, litres, rate, amount, savedAt: Date.now() });
  }, [vehicle, odoValue, litres, rate, amount]);
  useEffect(() => {
    function onPop() {
      if (numpadRef.current) { setNumpad(null); window.history.pushState(null, ""); return; }
      const s = stepRef.current;
      if (s === "vehicle" || s === "done") {
        router.push("/my");
        return;
      }
      else if (s === "odo") setStep("vehicle");
      else if (s === "pump") setStep("odo");
      else if (s === "after") setStep("pump");
      else if (s === "review") setStep("after");
      else if (s === "rold") setStep("vehicle");
      else if (s === "rnew") setStep("rold");
      window.history.pushState(null, ""); // re-arm
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [router]);
  useEffect(() => { if (numpad) window.history.pushState(null, ""); }, [numpad]);

  function reset() {
    setVehicle(null); setOdo(null); setPump(null); setAfterOdo(null); setOdoValue(""); setLitres(""); setAmount("");
    setOdoConf(null); setPumpConf(null); setOdoAction(null); setPumpAction(null); setCaptureReasons([]);
    setOldPhotos([]); setNewPhotos([]); setNumpad(null); setMode("fuel"); router.push("/my");
  }

  async function capture(which: "odo" | "pump" | "after", file: File) {
    if (which === "odo") setOdo(file);
    else if (which === "pump") setPump(file);
    else {
      // The post-fill dashboard shot is proof of the final state, not a second
      // number to guess at. Keeping it camera-only makes the third step quick.
      setAfterOdo(file);
      setCaptureReasons([]);
      return;
    }
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
      if (r.amount) {
        setAmount(r.amount);
        if (r.litres && Number(r.litres) > 0) setRate(String(Math.round((Number(r.amount) / Number(r.litres)) * 100) / 100));
      }
      else if (r.litres) {
        const detectedRate = Number(r.rate) > 0 ? Number(r.rate) : dieselRate;
        setAmount(String(Math.round(Number(r.litres) * detectedRate * 100) / 100));
      }
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
    if (!vehicle || !litres || Number(litres) <= 0 || !amount || Number(amount) <= 0) return;
    const persistDraft = () => saveFuelDraft({ vehicleId: vehicle.id, odoValue, litres, rate, amount, savedAt: Date.now() });
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      persistDraft();
      toast.error("Fuel details saved on this phone", "Go online, check recent fuel, then tap Save once only if it is not listed.");
      return;
    }
    const fd = new FormData();
    fd.set("type", "ISSUE");
    fd.set("assetId", vehicle.id);
    if (defaultProjectId) fd.set("projectId", defaultProjectId);
    fd.set("quantity", litres);
    fd.set("meterValue", odoValue || "0");
    fd.set("amount", amount);
    start(async () => {
      try {
        const geo = await getGeo();
        if (geo) { fd.set("lat", String(geo.lat)); fd.set("lng", String(geo.lng)); }
        if (odo) fd.set("odometerPhoto", await compressFuelEvidence(odo));
        if (pump) fd.set("pumpPhoto", await compressFuelEvidence(pump));
        if (afterOdo) fd.set("afterOdometerPhoto", await compressFuelEvidence(afterOdo));
        const result = await saveFuel(fd);
        if (isActionError(result)) {
          persistDraft();
          toast.error("Fuel not saved", `${result.error} Your entered details are kept on this phone.`);
          return;
        }
        clearFuelDraft(vehicle.id); buzz([40, 50, 80]); setStep("done"); router.refresh();
      } catch {
        // A lost signal or an unexpected server response must not look like a
        // successful tap. Keep every entered value on the review screen and
        // give the driver one clear recovery instruction.
        persistDraft();
        toast.error("Fuel details saved on this phone", "Photos are not stored by the browser. Check recent fuel after signal returns; if missing, reattach any photos and tap Save once.");
      }
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
        if (isActionError(result)) { toast.error(result.error); return; }
        buzz([40, 50, 80]); setStep("done"); router.refresh();
      } catch {
        setStep("rnew");
        toast.error("Photos were not saved", "Check the signal and try again.");
      }
    });
  }



  // ---- NUMPAD overlay (to fix OCR value) ----
  if (numpad) {
    const target = numpad;
    const val = target === "odo" ? odoValue : target === "amount" ? amount : litres;
    const setVal = target === "odo" ? setOdoValue : target === "amount" ? setAmount : setLitres;
    const isAmount = target === "amount";
    const press = (d: string) => setVal((q) => {
      if (d === "." && q.includes(".")) return q;
      return q.length < 7 ? q + d : q;
    });
    const keys = isAmount
      ? ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"]
      : ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "back"];
    const title = target === "odo" ? "मीटर नंबर" : isAmount ? "कुल रकम ₹" : "कितने लीटर?";
    const unit = target === "odo" ? "मीटर" : isAmount ? "रुपये" : "लीटर";
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

  // ---- VEHICLE ----
  if (step === "vehicle") {
    return (
      <div className="min-h-screen bg-slate-50">
        <StepHeader back={reset} hindi="अपनी गाड़ी चुनें" eng="Choose your vehicle" step={step} />

        <div className="grid grid-cols-2 gap-3 p-4">
          {vehicles.map((v) => (
            <button key={v.id} onClick={() => {
              setVehicle(v);
              if (mode === "fuel") {
                const draft = loadFuelDraftForVehicle(v.id);
                if (draft) { setOdoValue(draft.odoValue); setLitres(draft.litres); setRate(draft.rate || String(dieselRate)); setAmount(draft.amount); }
              }
              setStep(mode === "fuel" ? "review" : "rold");
            }} className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4 shadow-sm active:scale-95 active:bg-brand-50">
              <Truck className="h-9 w-9 text-brand-600" />
              <div className="rounded-lg border-2 border-black bg-yellow-300 px-2 py-1 text-center font-mono text-base font-extrabold leading-tight text-black">{v.regNo ?? v.code}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- OPTIONAL FUEL EVIDENCE (before dashboard / pump / after dashboard) ----
  if (step === "odo" || step === "pump" || step === "after") {
    const isOdo = step === "odo";
    const isPump = step === "pump";
    const file = isOdo ? odo : isPump ? pump : afterOdo;
    const value = isOdo ? odoValue : litres;
    const conf = isOdo ? odoConf : pumpConf;
    const uiAction = isOdo ? odoAction : isPump ? pumpAction : null;
    const preview = file ? URL.createObjectURL(file) : null;
    const isRetakeRequired = uiAction === "RETAKE_REQUIRED";
    const nextStep: Step = isOdo ? "pump" : isPump ? "after" : "review";
    const backStep: Step = isOdo ? "vehicle" : isPump ? "odo" : "pump";
    const title = isOdo ? "पहले डैशबोर्ड का फोटो" : isPump ? "पंप मशीन का फोटो" : "बाद में डैशबोर्ड का फोटो";
    const englishTitle = isOdo ? "Dashboard before fuelling" : isPump ? "Fuel-pump display" : "Dashboard after fuelling";
    const captureKind = isOdo ? "odo" : isPump ? "pump" : "after";

    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <StepHeader back={() => setStep(backStep)} hindi={title} eng={englishTitle} step={step} />

        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) capture(captureKind, f); e.currentTarget.value = ""; }} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
            {isOdo ? "① Before" : isPump ? "② Pump" : "③ After"} · फोटो वैकल्पिक है · Photo optional for verification
          </p>
          <button onClick={() => camRef.current?.click()} className="flex aspect-square w-full max-w-xs flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl border-4 border-dashed border-brand-300 bg-white active:bg-brand-50">
            {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <><Camera className="h-24 w-24 text-brand-400" /><span className="text-xl font-bold text-brand-600">फोटो खींचें</span></>}
          </button>
          {file && (
            <div className="w-full max-w-xs rounded-2xl bg-white p-4 text-center shadow-sm">
              {!isPump && !isOdo ? (
                <p className="text-sm font-semibold text-emerald-700">फोटो जुड़ गया · Photo attached for verification</p>
              ) : ocrBusy ? (
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
          <button disabled={ocrBusy} onClick={() => setStep(nextStep)} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-5 text-2xl font-extrabold text-white shadow-lg active:scale-[0.98] disabled:opacity-40">
            {file ? "आगे · Next" : "फोटो छोड़ें · Skip photo"} <ArrowLeft className="h-7 w-7 rotate-180" />
          </button>
        </div>
      </div>
    );
  }


  // ---- REVIEW ----
  if (step === "review") {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <StepHeader back={reset} hindi="डीज़ल भरें" eng="Quick fuel entry" step={step} />

        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-4 flex items-center gap-3"><div className="rounded-2xl bg-amber-100 p-3 text-amber-700"><Fuel className="h-6 w-6" /></div><div><p className="font-extrabold text-ink-900">{vehicle?.regNo ?? vehicle?.code}</p><p className="text-xs text-slate-500">Claimed vehicle · linked to your duty</p></div></div>
            <div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-600">Litres<input type="number" min="0.01" max="10000" step="0.01" inputMode="decimal" value={litres} onChange={(event) => setLitres(event.target.value)} placeholder="0" className="mt-1.5 min-h-13 w-full rounded-xl border border-slate-200 px-3 text-lg font-extrabold text-ink-900 outline-none focus:border-brand-500" /></label><label className="text-xs font-bold text-slate-600">Rate / litre ₹<input type="number" min="0.01" max="10000" step="0.01" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} className="mt-1.5 min-h-13 w-full rounded-xl border border-slate-200 px-3 text-lg font-extrabold text-ink-900 outline-none focus:border-brand-500" /></label></div>
            <label className="mt-3 block text-xs font-bold text-slate-600">Dashboard meter <span className="font-normal text-slate-400">(optional)</span><input type="number" min="0" max="10000000" inputMode="decimal" value={odoValue} onChange={(event) => setOdoValue(event.target.value)} placeholder="Enter reading" className="mt-1.5 min-h-13 w-full rounded-xl border border-slate-200 px-3 text-lg font-extrabold text-ink-900 outline-none focus:border-brand-500" /></label>
          </div>
          <div className="rounded-2xl bg-brand-50 p-4 text-center">
            <p className="text-sm text-slate-500">कुल · Total</p>
            <p className="text-2xl font-extrabold text-brand-700">₹ {(Number(amount) || 0).toLocaleString("en-IN")}</p>
            {Number(litres) > 0 && Number(amount) > 0 && <p className="mt-1 text-xs font-medium text-brand-700">₹ {(Number(amount) / Number(litres)).toFixed(2)} / litre</p>}
          </div>
          <details className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><summary className="cursor-pointer text-sm font-bold text-slate-700">Add verification photos <span className="font-normal text-slate-400">(optional)</span></summary><p className="mt-2 text-xs text-slate-500">Photos help verify fuel use but do not stop a valid fuel entry.</p><div className="mt-3 grid grid-cols-3 gap-2">{([ ["Before dashboard", odo, "odo"], ["Pump", pump, "pump"], ["After dashboard", afterOdo, "after"] ] as const).map(([label, file, kind]) => <label key={kind} className="block cursor-pointer text-center"><input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { const photo = event.target.files?.[0]; if (photo) void capture(kind, photo); event.currentTarget.value = ""; }} /><span className="flex h-20 items-center justify-center overflow-hidden rounded-xl bg-slate-100 px-1 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">{file ? <img src={URL.createObjectURL(file)} alt={label} className="h-full w-full object-cover" /> : label}</span></label>)}</div></details>
        </div>
        <div className="p-4">
          <button disabled={pending || !litres || Number(litres) <= 0 || !amount || Number(amount) <= 0} onClick={finishFuel} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-5 text-2xl font-extrabold text-white shadow-lg active:scale-[0.98] disabled:opacity-40">
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
