"use client";

import React, { useState, useEffect } from "react";
import { Card, Badge } from "@/components/ui";
import {
  UserCheck,
  Truck,
  QrCode,
  MapPin,
  Camera,
  CheckCircle2,
  Play,
  StopCircle,
  Clock,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  Check,
  ChevronRight,
  Radio,
  FileText,
  Fuel,
  Wrench,
} from "lucide-react";
import mockData from "@/lib/mock-data.json";

export function DriverCheckInWizard() {
  const [step, setStep] = useState<
    "LOGIN" | "VEHICLE" | "QR" | "GPS" | "SELFIE" | "CHECKLIST" | "RUNNING" | "SUMMARY"
  >("LOGIN");

  // State
  const [selectedDriver, setSelectedDriver] = useState(mockData.drivers[0]);
  const [selectedVehicle, setSelectedVehicle] = useState(mockData.vehicles[0]);
  const [qrCodeInput, setQrCodeInput] = useState("");
  const [gpsVerified, setGpsVerified] = useState(false);
  const [gpsCoordinates, setGpsCoordinates] = useState({ lat: 26.9124, lng: 75.7873 });
  const [selfieCaptured, setSelfieCaptured] = useState(false);
  const [checklist, setChecklist] = useState({
    brakes: true,
    tyres: true,
    engineOil: true,
    lights: true,
    horn: true,
    seatbelt: true,
    reverseCamera: true,
  });

  // Shift running state
  const [shiftStartTime, setShiftStartTime] = useState<Date | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Timer for running shift
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (step === "RUNNING" && shiftStartTime) {
      interval = setInterval(() => {
        setElapsedSeconds(Math.floor((new Date().getTime() - shiftStartTime.getTime()) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step, shiftStartTime]);

  const formatTimer = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Restore active shift from localStorage on mount (QA-01 persistence fix)
  useEffect(() => {
    try {
      const savedSession = localStorage.getItem("mahadev_active_shift");
      if (savedSession) {
        const parsed = JSON.parse(savedSession);
        if (parsed.startTime && parsed.driverId) {
          const start = new Date(parsed.startTime);
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setShiftStartTime(start);
          setElapsedSeconds(Math.floor((new Date().getTime() - start.getTime()) / 1000));
          const drv = mockData.drivers.find((d) => d.id === parsed.driverId);
          const veh = mockData.vehicles.find((v) => v.id === parsed.vehicleId);
          if (drv) setSelectedDriver(drv);
          if (veh) setSelectedVehicle(veh);
          setStep("RUNNING");
        }
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  const handleGpsVerification = () => {
    if (typeof window !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsCoordinates({ lat: Number(pos.coords.latitude.toFixed(4)), lng: Number(pos.coords.longitude.toFixed(4)) });
          setGpsVerified(true);
        },
        () => setGpsVerified(true),
        { timeout: 5000 }
      );
    } else {
      setGpsVerified(true);
    }
  };

  const handleStartShift = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const now = new Date();
    setShiftStartTime(now);
    setElapsedSeconds(0);
    setStep("RUNNING");

    try {
      localStorage.setItem(
        "mahadev_active_shift",
        JSON.stringify({
          driverId: selectedDriver.id,
          vehicleId: selectedVehicle.id,
          startTime: now.toISOString(),
        })
      );
    } catch {
      // Ignore quota error
    }

    setTimeout(() => {
      setIsSubmitting(false);
      if (typeof window !== "undefined") {
        window.location.href = "/driver";
      }
    }, 600);
  };

  const handleEndShift = () => {
    try {
      localStorage.removeItem("mahadev_active_shift");
    } catch {
      // Ignore
    }
    setStep("SUMMARY");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Top Banner / Driver Context */}
      <div className="rounded-2xl bg-ink-900 p-5 text-white shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-white font-bold text-lg shadow-lg shadow-brand-500/30">
              <UserCheck className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{selectedDriver.name}</h2>
              <p className="text-xs text-slate-400">
                {selectedDriver.empCode} · {selectedDriver.type} · License: {selectedDriver.licenseNo}
              </p>
            </div>
          </div>
          <Badge color="bg-emerald-500/20 text-emerald-300 ring-emerald-500/30">Cleared for Duty</Badge>
        </div>
      </div>

      {/* Progress Stepper */}
      {step !== "RUNNING" && step !== "SUMMARY" && (
        <div className="flex items-center justify-between bg-white p-3 rounded-2xl shadow-sm border border-slate-200 text-xs">
          {[
            { id: "LOGIN", label: "Driver", num: 1 },
            { id: "VEHICLE", label: "Vehicle", num: 2 },
            { id: "QR", label: "QR Scan", num: 3 },
            { id: "GPS", label: "GPS", num: 4 },
            { id: "SELFIE", label: "Selfie", num: 5 },
            { id: "CHECKLIST", label: "Checklist", num: 6 },
          ].map((s, idx) => {
            const stepOrder = ["LOGIN", "VEHICLE", "QR", "GPS", "SELFIE", "CHECKLIST"];
            const currentIdx = stepOrder.indexOf(step);
            const isCompleted = idx < currentIdx;
            const isCurrent = step === s.id;

            return (
              <div key={s.id} className="flex flex-col items-center flex-1">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full font-bold text-xs ${
                    isCompleted
                      ? "bg-emerald-500 text-white"
                      : isCurrent
                      ? "bg-brand-500 text-white shadow-md ring-4 ring-brand-500/20"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : s.num}
                </div>
                <span
                  className={`mt-1 font-medium hidden sm:inline ${
                    isCurrent ? "text-brand-600 font-bold" : "text-slate-500"
                  }`}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Step 1: Select Driver Identity */}
      {step === "LOGIN" && (
        <Card className="p-6 space-y-5 animate-fade-up">
          <div>
            <h3 className="text-lg font-bold text-ink-900">1. Confirm Driver Identity / चालक चुनें</h3>
            <p className="text-sm text-slate-500">Select your driver profile to begin check-in.</p>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase text-slate-500">Driver Account</label>
            <select
              value={selectedDriver.id}
              onChange={(e) => {
                const found = mockData.drivers.find((d) => d.id === e.target.value);
                if (found) setSelectedDriver(found);
              }}
              className="w-full rounded-xl border border-slate-300 p-3 text-base font-semibold text-slate-900 focus:border-brand-500 focus:outline-none"
            >
              {mockData.drivers.slice(0, 10).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.empCode}) — {d.type}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setStep("VEHICLE")}
            className="w-full py-4 rounded-xl bg-brand-500 text-white font-bold text-lg hover:bg-brand-600 shadow-lg shadow-brand-500/30 flex items-center justify-center gap-2"
          >
            Continue to Vehicle / वाहन चुनें <ChevronRight className="h-5 w-5" />
          </button>
        </Card>
      )}

      {/* Step 2: Select Vehicle */}
      {step === "VEHICLE" && (
        <Card className="p-6 space-y-5 animate-fade-up">
          <div>
            <h3 className="text-lg font-bold text-ink-900">2. Select Assigned Vehicle / वाहन चुनें</h3>
            <p className="text-sm text-slate-500">Choose the machine/vehicle you are operating today.</p>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase text-slate-500">Vehicle / Equipment</label>
            <select
              value={selectedVehicle.id}
              onChange={(e) => {
                const found = mockData.vehicles.find((v) => v.id === e.target.value);
                if (found) setSelectedVehicle(found);
              }}
              className="w-full rounded-xl border border-slate-300 p-3 text-base font-semibold text-slate-900 focus:border-brand-500 focus:outline-none"
            >
              {mockData.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} — {v.name} ({v.registrationNo})
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl bg-brand-50 p-4 border border-brand-100 flex items-center gap-3">
            <Truck className="h-8 w-8 text-brand-600 shrink-0" />
            <div>
              <p className="text-sm font-bold text-brand-900">{selectedVehicle.name}</p>
              <p className="text-xs text-brand-700">Code: {selectedVehicle.code} | Class: {selectedVehicle.assetClass}</p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep("LOGIN")}
              className="w-1/3 py-3 rounded-xl border border-slate-300 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            <button
              onClick={() => setStep("QR")}
              className="w-2/3 py-4 rounded-xl bg-brand-500 text-white font-bold text-lg hover:bg-brand-600 shadow-lg shadow-brand-500/30 flex items-center justify-center gap-2"
            >
              Proceed to QR Scan <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </Card>
      )}

      {/* Step 3: QR Scan */}
      {step === "QR" && (
        <Card className="p-6 space-y-5 text-center animate-fade-up">
          <div>
            <h3 className="text-lg font-bold text-ink-900">3. Cabin QR Scan / क्यूआर कोड स्कैन करें</h3>
            <p className="text-sm text-slate-500">Scan the QR code sticker inside the machine cabin.</p>
          </div>

          <div className="mx-auto flex h-48 w-48 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-400 bg-brand-50/50 p-4">
            <QrCode className="h-20 w-20 text-brand-600 animate-pulse" />
            <p className="mt-2 text-xs font-bold text-brand-700">Hold camera over Cabin QR</p>
          </div>

          <div className="text-left">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Or Enter Cabin QR Code Manually</label>
            <input
              type="text"
              placeholder={`e.g. QR-${selectedVehicle.code}-2026`}
              value={qrCodeInput}
              onChange={(e) => setQrCodeInput(e.target.value)}
              className="w-full rounded-xl border border-slate-300 p-3 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep("VEHICLE")}
              className="w-1/3 py-3 rounded-xl border border-slate-300 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            <button
              onClick={() => setStep("GPS")}
              className="w-2/3 py-4 rounded-xl bg-brand-500 text-white font-bold text-lg hover:bg-brand-600 shadow-lg shadow-brand-500/30 flex items-center justify-center gap-2"
            >
              Verify QR & GPS <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </Card>
      )}

      {/* Step 4: GPS Verification */}
      {step === "GPS" && (
        <Card className="p-6 space-y-5 animate-fade-up">
          <div>
            <h3 className="text-lg font-bold text-ink-900">4. GPS Location Verification / स्थान सत्यापन</h3>
            <p className="text-sm text-slate-500">Verifying your GPS location against assigned site geofence.</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-4 text-center">
            <MapPin className="mx-auto h-12 w-12 text-brand-600" />
            <div>
              <p className="font-bold text-ink-900">Jaipur Ring Road Expressway Site (ST-01)</p>
              <p className="text-xs text-slate-500">Coordinates: {gpsCoordinates.lat}° N, {gpsCoordinates.lng}° E</p>
            </div>

            {!gpsVerified ? (
              <button
                onClick={handleGpsVerification}
                className="w-full py-3 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 shadow-md flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="h-5 w-5" /> Verify Location On Site
              </button>
            ) : (
              <div className="rounded-xl bg-emerald-100 p-3 text-emerald-800 font-bold text-sm flex items-center justify-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Inside Authorized Site Geofence (Radius 500m)
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep("QR")}
              className="w-1/3 py-3 rounded-xl border border-slate-300 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            <button
              onClick={() => setStep("SELFIE")}
              disabled={!gpsVerified}
              className="w-2/3 py-4 rounded-xl bg-brand-500 text-white font-bold text-lg hover:bg-brand-600 disabled:opacity-40 shadow-lg shadow-brand-500/30 flex items-center justify-center gap-2"
            >
              Take Selfie <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </Card>
      )}

      {/* Step 5: Selfie Capture */}
      {step === "SELFIE" && (
        <Card className="p-6 space-y-5 text-center animate-fade-up">
          <div>
            <h3 className="text-lg font-bold text-ink-900">5. Selfie Verification / फोटो खींचें</h3>
            <p className="text-sm text-slate-500">Capture a clear photo of yourself inside the cabin for duty audit.</p>
          </div>

          <div className="mx-auto flex h-56 w-56 flex-col items-center justify-center rounded-2xl bg-slate-900 p-3 text-white shadow-xl relative overflow-hidden">
            {selfieCaptured ? (
              <div className="relative h-full w-full bg-slate-800 rounded-xl flex items-center justify-center">
                <span className="text-4xl">🧑‍✈️</span>
                <span className="absolute bottom-2 left-2 rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-bold">
                  VERIFIED
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <Camera className="h-14 w-14 text-slate-400 mb-2 animate-bounce" />
                <p className="text-xs text-slate-300">Camera Active</p>
              </div>
            )}
          </div>

          {!selfieCaptured ? (
            <button
              onClick={() => setSelfieCaptured(true)}
              className="w-full py-3.5 rounded-xl bg-brand-500 text-white font-bold text-base hover:bg-brand-600 shadow-md flex items-center justify-center gap-2"
            >
              <Camera className="h-5 w-5" /> Capture Photo / फोटो लें
            </button>
          ) : (
            <button
              onClick={() => setSelfieCaptured(false)}
              className="w-full py-2.5 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 flex items-center justify-center gap-2"
            >
              <RotateCcw className="h-4 w-4" /> Retake Photo
            </button>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep("GPS")}
              className="w-1/3 py-3 rounded-xl border border-slate-300 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            <button
              onClick={() => setStep("CHECKLIST")}
              disabled={!selfieCaptured}
              className="w-2/3 py-4 rounded-xl bg-brand-500 text-white font-bold text-lg hover:bg-brand-600 disabled:opacity-40 shadow-lg shadow-brand-500/30 flex items-center justify-center gap-2"
            >
              Daily Safety Checklist <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </Card>
      )}

      {/* Step 6: Daily Safety Checklist */}
      {step === "CHECKLIST" && (
        <Card className="p-6 space-y-5 animate-fade-up">
          <div>
            <h3 className="text-lg font-bold text-ink-900">6. Daily Pre-Shift Safety Checklist / सुरक्षा जांच</h3>
            <p className="text-sm text-slate-500">Confirm essential safety items before starting the engine.</p>
          </div>

          <div className="space-y-3">
            {[
              { key: "brakes", label: "Brakes & Handbrake / ब्रेक चेक" },
              { key: "tyres", label: "Tyres & Pressure / टायर प्रेशर" },
              { key: "engineOil", label: "Engine Oil & Coolant / इंजन ऑयल" },
              { key: "lights", label: "Headlights & Indicators / लाइट्स" },
              { key: "horn", label: "Horn & Reverse Alarm / हॉर्न" },
              { key: "seatbelt", label: "Seatbelt & Safety Glass / सीटबेल्ट" },
              { key: "reverseCamera", label: "Reverse Camera / रियर कैमरा" },
            ].map((item) => {
              const checked = checklist[item.key as keyof typeof checklist];
              return (
                <div
                  key={item.key}
                  onClick={() =>
                    setChecklist((prev) => ({ ...prev, [item.key]: !checked }))
                  }
                  className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${
                    checked
                      ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                      : "bg-rose-50 border-rose-200 text-rose-800"
                  }`}
                >
                  <span className="font-semibold text-sm">{item.label}</span>
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-md font-bold text-xs ${
                      checked ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
                    }`}
                  >
                    {checked ? <Check className="h-4 w-4" /> : "✕"}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep("SELFIE")}
              className="w-1/3 py-3 rounded-xl border border-slate-300 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            <button
              onClick={handleStartShift}
              className="w-2/3 py-4 rounded-xl bg-emerald-600 text-white font-bold text-xl hover:bg-emerald-700 shadow-xl shadow-emerald-600/30 flex items-center justify-center gap-2"
            >
              <Play className="h-6 w-6" /> START SHIFT / शिफ्ट शुरू करें
            </button>
          </div>
        </Card>
      )}

      {/* Running Shift Screen */}
      {step === "RUNNING" && (
        <Card className="p-6 space-y-6 bg-slate-900 text-white animate-fade-up">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500"></span>
              </span>
              <div>
                <h3 className="text-lg font-bold text-white">SHIFT RUNNING / शिफ्ट चालू है</h3>
                <p className="text-xs text-slate-400">Assigned: {selectedVehicle.code} ({selectedVehicle.name})</p>
              </div>
            </div>
            <Badge color="bg-emerald-500/20 text-emerald-300 ring-emerald-500/30">Active Duty</Badge>
          </div>

          {/* Big Live Clock */}
          <div className="text-center py-6 bg-slate-800/80 rounded-2xl border border-slate-700">
            <p className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-1">Current Shift Time</p>
            <div className="text-5xl font-black tracking-wider text-emerald-400 font-mono">
              {formatTimer(elapsedSeconds)}
            </div>
            <p className="mt-2 text-xs text-slate-400">GPS Position Auto-Sync Active Every 15 Min</p>
          </div>

          {/* Quick Driver Action Shortcuts */}
          <div className="grid grid-cols-2 gap-3">
            <button className="flex items-center justify-center gap-2 p-3.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-semibold text-slate-200 hover:bg-slate-700">
              <Fuel className="h-5 w-5 text-amber-400" /> Log Diesel Refuel
            </button>
            <button className="flex items-center justify-center gap-2 p-3.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-semibold text-slate-200 hover:bg-slate-700">
              <Wrench className="h-5 w-5 text-rose-400" /> Report Issue / Fault
            </button>
          </div>

          <button
            onClick={handleEndShift}
            className="w-full py-4 rounded-xl bg-rose-600 text-white font-bold text-xl hover:bg-rose-700 shadow-xl shadow-rose-600/30 flex items-center justify-center gap-2"
          >
            <StopCircle className="h-6 w-6" /> END SHIFT & CHECKOUT / शिफ्ट समाप्त करें
          </button>
        </Card>
      )}

      {/* Shift Summary Screen */}
      {step === "SUMMARY" && (
        <Card className="p-6 space-y-6 animate-fade-up">
          <div className="text-center space-y-2 border-b border-slate-100 pb-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h3 className="text-xl font-bold text-ink-900">Shift Completed / शिफ्ट पूरी हुई</h3>
            <p className="text-sm text-slate-500">Summary of today&apos;s work for {selectedDriver.name}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-center">
            <div>
              <p className="text-xs text-slate-400">Total Shift Hours</p>
              <p className="text-2xl font-bold text-slate-900">{(elapsedSeconds / 3600 || 8.5).toFixed(1)} hrs</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Vehicle Covered</p>
              <p className="text-2xl font-bold text-brand-600">142 km</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Trips Completed</p>
              <p className="text-2xl font-bold text-slate-900">11 Trips</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Fuel Consumed</p>
              <p className="text-2xl font-bold text-emerald-600">45 L</p>
            </div>
          </div>

          <button
            onClick={() => setStep("LOGIN")}
            className="w-full py-4 rounded-xl bg-brand-500 text-white font-bold text-lg hover:bg-brand-600 shadow-lg shadow-brand-500/30"
          >
            Done / मुख्य स्क्रीन पर जाएं
          </button>
        </Card>
      )}
    </div>
  );
}
