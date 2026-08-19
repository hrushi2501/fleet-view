"use client";

import React, { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  QrCode,
  Camera,
  Search,
  X,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Truck,
  Sparkles,
  RefreshCw,
  Flashlight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/Toast";
import { selfAssignVehicle } from "@/app/(app)/my/actions";

interface VehicleOption {
  id: string;
  code: string;
  name: string;
  registrationNo: string | null;
  assetClass: string;
}

export function DriverQrScanner({
  vehicles = [],
  triggerVariant = "card",
  currentVehicleCode,
}: {
  vehicles?: VehicleOption[];
  triggerVariant?: "card" | "button" | "banner";
  currentVehicleCode?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"camera" | "search">("camera");
  const [query, setQuery] = useState("");
  const [odometer, setOdometer] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const router = useRouter();
  const toast = useToast();

  // Start / Stop Camera stream
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera not supported on this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
      }

      // Barcode detection loop
      startScanningLoop();
    } catch (err: any) {
      setCameraActive(false);
      setCameraError(
        err?.message || "Camera access denied. You can still pick your vehicle from the list below."
      );
      setTab("search");
    }
  };

  const stopCamera = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const startScanningLoop = () => {
    if (!("BarcodeDetector" in window)) {
      return; // Fallback to manual selection or capture
    }

    try {
      // @ts-ignore
      const detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128", "data_matrix"] });

      scanIntervalRef.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const barcodes = await detector.detect(videoRef.current);
          if (barcodes && barcodes.length > 0) {
            const raw = barcodes[0].rawValue;
            if (raw) {
              handleDetectedCode(raw);
            }
          }
        } catch {
          // ignore detection frame errors
        }
      }, 300);
    } catch {
      // BarcodeDetector initialization error
    }
  };

  const handleDetectedCode = (code: string) => {
    stopCamera();
    if ("vibrate" in navigator) {
      navigator.vibrate([100, 50, 100]);
    }
    setScannedCode(code);
    executeAssignment(code);
  };

  const executeAssignment = (codeToAssign: string) => {
    const meter = parseFloat(odometer) || undefined;
    startTransition(async () => {
      try {
        const res = await selfAssignVehicle(codeToAssign, meter);
        toast.success(`✓ Gaadi assign ho gayi: ${res.assetCode} (${res.assetName})`);
        setOpen(false);
        router.refresh();
      } catch (err: any) {
        toast.error("Assignment Failed", err.message || "Could not link vehicle");
      }
    });
  };

  useEffect(() => {
    if (open && tab === "camera") {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [open, tab]);

  const filteredVehicles = vehicles.filter((v) => {
    const q = query.toLowerCase();
    return (
      v.code.toLowerCase().includes(q) ||
      v.name.toLowerCase().includes(q) ||
      (v.registrationNo && v.registrationNo.toLowerCase().includes(q))
    );
  });

  return (
    <>
      {/* Trigger Variant 1: Hero Action Card (When no vehicle is assigned or on My Work) */}
      {triggerVariant === "card" && (
        <div className="relative overflow-hidden rounded-3xl border-2 border-brand-500/30 bg-gradient-to-br from-brand-600 via-brand-700 to-ink-900 p-6 text-white shadow-xl shadow-brand-600/20">
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-md ring-4 ring-white/30 shadow-inner">
              <QrCode className="h-9 w-9 text-white animate-pulse" />
            </div>

            <h2 className="mt-4 text-xl font-black tracking-tight">
              {currentVehicleCode ? "Switch Vehicle / Gaadi Badlein" : "Scan Vehicle QR / Gaadi Scan Karein"}
            </h2>
            <p className="mt-1 max-w-xs text-xs text-brand-100/90 leading-relaxed">
              Cabin me laga QR code scan karein ya gaadi select karein apni shift shuru karne ke liye.
            </p>

            <button
              onClick={() => setOpen(true)}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-sm font-bold text-brand-700 shadow-lg shadow-black/10 transition-transform active:scale-95 hover:bg-slate-50"
            >
              <Camera className="h-5 w-5 text-brand-600" />
              <span>Open QR Camera Scanner</span>
            </button>
          </div>
        </div>
      )}

      {/* Trigger Variant 2: Compact Button */}
      {triggerVariant === "button" && (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2 text-xs font-bold text-brand-700 shadow-xs hover:bg-brand-100 active:scale-95 transition-all"
        >
          <QrCode className="h-4 w-4" />
          <span>Scan / Change Vehicle</span>
        </button>
      )}

      {/* Trigger Variant 3: Slim Mobile Banner */}
      {triggerVariant === "banner" && (
        <div className="flex items-center justify-between rounded-2xl border border-brand-200 bg-brand-50/80 p-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-ink-900">Cabin QR Scanner</p>
              <p className="text-[11px] text-slate-500">Scan code to link machine</p>
            </div>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="rounded-xl bg-brand-500 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-brand-600 active:scale-95"
          >
            Scan Now
          </button>
        </div>
      )}

      {/* Full-Screen Scanner Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:p-6">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/10">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <QrCode className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink-900">Vehicle Check-In</h3>
                  <p className="text-xs text-slate-500">Scan QR or select machine</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="grid grid-cols-2 gap-1 border-b border-slate-100 bg-slate-50 p-2">
              <button
                onClick={() => setTab("camera")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition-all",
                  tab === "camera"
                    ? "bg-white text-brand-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                <Camera className="h-4 w-4" />
                <span>Live Camera</span>
              </button>
              <button
                onClick={() => setTab("search")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition-all",
                  tab === "search"
                    ? "bg-white text-brand-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                <Search className="h-4 w-4" />
                <span>Select from List</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto p-5">
              {/* TAB 1: Camera Scanner */}
              {tab === "camera" && (
                <div className="flex flex-col items-center">
                  <div className="relative aspect-square w-full max-w-[280px] overflow-hidden rounded-3xl bg-slate-950 shadow-inner">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className="h-full w-full object-cover"
                    />

                    {/* Scanner Framing Box */}
                    <div className="absolute inset-0 flex items-center justify-center p-6">
                      <div className="relative h-44 w-44 rounded-2xl border-2 border-dashed border-brand-400 bg-brand-500/10">
                        {/* Target Reticles */}
                        <div className="absolute -left-1 -top-1 h-4 w-4 border-l-4 border-t-4 border-brand-400" />
                        <div className="absolute -right-1 -top-1 h-4 w-4 border-r-4 border-t-4 border-brand-400" />
                        <div className="absolute -bottom-1 -left-1 h-4 w-4 border-b-4 border-l-4 border-brand-400" />
                        <div className="absolute -bottom-1 -right-1 h-4 w-4 border-b-4 border-r-4 border-brand-400" />

                        {/* Animated Laser Line */}
                        <div className="absolute inset-x-2 h-0.5 bg-gradient-to-r from-transparent via-brand-400 to-transparent animate-bounce" />
                      </div>
                    </div>

                    {pending && (
                      <div className="absolute inset-0 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs">
                        <Loader2 className="h-8 w-8 text-white animate-spin" />
                      </div>
                    )}
                  </div>

                  <p className="mt-3 text-center text-xs font-semibold text-slate-600">
                    Cabin sticker par camera point karein
                  </p>
                  <p className="text-center text-[11px] text-slate-400">
                    QR code scan hote hi gaadi automatically assign ho jayegi
                  </p>

                  {cameraError && (
                    <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                      <p>{cameraError}</p>
                    </div>
                  )}

                  {/* Manual photo capture fallback */}
                  <label className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 active:scale-98">
                    <Camera className="h-4 w-4 text-slate-500" />
                    <span>Upload QR Photo from Gallery</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        // @ts-ignore
                        if ("BarcodeDetector" in window) {
                          try {
                            const img = new Image();
                            img.src = URL.createObjectURL(file);
                            await img.decode();
                            // @ts-ignore
                            const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
                            const barcodes = await detector.detect(img);
                            if (barcodes && barcodes.length > 0) {
                              handleDetectedCode(barcodes[0].rawValue);
                              return;
                            }
                          } catch { }
                        }
                        setTab("search");
                        toast.error("Please pick your vehicle code from the list below.");
                      }}
                    />
                  </label>
                </div>
              )}

              {/* TAB 2: Search & Select Vehicle */}
              {tab === "search" && (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search code or reg. no (e.g. DMP-001, RJ14...)"
                      className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    />
                  </div>

                  <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                    {filteredVehicles.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => executeAssignment(v.code)}
                        disabled={pending}
                        className="flex w-full items-center justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left transition-all hover:border-brand-300 hover:bg-brand-50/40 active:scale-[0.99] disabled:opacity-60"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                            <Truck className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-ink-900">{v.code}</p>
                            <p className="text-[11px] text-slate-500">
                              {v.name} {v.registrationNo ? `· ${v.registrationNo}` : ""}
                            </p>
                          </div>
                        </div>
                        <span className="rounded-lg bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-700">
                          Select
                        </span>
                      </button>
                    ))}

                    {filteredVehicles.length === 0 && (
                      <div className="py-6 text-center text-xs text-slate-400">
                        Koi vehicle nahi mila. Please try another search.
                      </div>
                    )}
                  </div>

                  {/* Manual Code Input Bar */}
                  <div className="border-t border-slate-100 pt-3">
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Or Type Vehicle Code Directly:
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value.toUpperCase())}
                        placeholder="EXC-012"
                        className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs uppercase font-bold outline-none focus:border-brand-500"
                      />
                      <button
                        type="button"
                        onClick={() => executeAssignment(query)}
                        disabled={pending || !query.trim()}
                        className="rounded-xl bg-brand-500 px-4 py-2 text-xs font-bold text-white hover:bg-brand-600 disabled:opacity-50"
                      >
                        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Assign"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default DriverQrScanner;
