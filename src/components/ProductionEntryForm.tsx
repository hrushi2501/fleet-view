"use client";

import React, { useState } from "react";
import { Card, SectionTitle, Badge } from "@/components/ui";
import {
  Boxes,
  Truck,
  FolderKanban,
  MapPin,
  Clock,
  Fuel,
  Sun,
  CloudRain,
  Upload,
  CheckCircle2,
  FileText,
  User,
  AlertCircle,
} from "lucide-react";
import mockData from "@/lib/mock-data.json";

export function ProductionEntryForm() {
  const [projectId, setProjectId] = useState(mockData.projects[0].id);
  const [siteId, setSiteId] = useState(mockData.sites[0].id);
  const [vehicleId, setVehicleId] = useState(mockData.vehicles[0].id);
  const [operatorId, setOperatorId] = useState(mockData.drivers[1].id);
  const [outputType, setOutputType] = useState("TONNES");
  const [quantity, setQuantity] = useState<number | "">(450);
  const [hours, setHours] = useState<number | "">(8.5);
  const [fuelUsed, setFuelUsed] = useState<number | "">(120);
  const [weather, setWeather] = useState("SUNNY");
  const [status, setStatus] = useState("COMPLETED");
  const [remarks, setRemarks] = useState("");

  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        setErrors((prev) => ({ ...prev, image: "Image size must be under 5MB." }));
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      setImagePreview(previewUrl);
      setErrors((prev) => ({ ...prev, image: "" }));
    }
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const newErrors: Record<string, string> = {};

    const qty = Number(quantity);
    const hrs = Number(hours);
    const fuel = Number(fuelUsed);

    if (!quantity || isNaN(qty) || qty <= 0) {
      newErrors.quantity = "Please enter a valid output quantity greater than 0.";
    } else if (qty > 100000) {
      newErrors.quantity = "Quantity exceeds maximum single-day threshold (100,000).";
    }

    if (!hours || isNaN(hrs) || hrs <= 0) {
      newErrors.hours = "Working hours must be greater than 0.";
    } else if (hrs > 24) {
      newErrors.hours = "Daily working hours cannot exceed 24 hours.";
    }

    if (fuelUsed !== "" && (isNaN(fuel) || fuel < 0)) {
      newErrors.fuelUsed = "Fuel used cannot be negative.";
    } else if (fuel > 1000) {
      newErrors.fuelUsed = "Fuel consumption exceeds maximum single-day tank threshold (1,000 L).";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});
    
    setTimeout(() => {
      setIsSubmitting(false);
      setSubmitted(true);
    }, 400);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="p-6 md:p-8 animate-fade-up">
        <SectionTitle
          title="Daily Construction Production Entry"
          subtitle="Supervisor portal to record daily site output, machine working hours & diesel consumption."
        />

        {submitted ? (
          <div className="my-8 rounded-2xl bg-emerald-50 p-6 text-center border border-emerald-200 space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h3 className="text-xl font-bold text-emerald-900">Production Log Recorded Successfully!</h3>
            <p className="text-sm text-emerald-700 max-w-md mx-auto">
              The entry has been appended to the daily productivity dashboard and site ledger.
            </p>
            <button
              onClick={() => setSubmitted(false)}
              className="mt-2 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 shadow-md"
            >
              Log Another Entry
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6 mt-6">
            {/* Section 1: Project & Site */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5 flex items-center gap-1.5">
                  <FolderKanban className="h-4 w-4 text-brand-600" /> Project
                </label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-3 text-sm font-medium text-slate-900 focus:border-brand-500 focus:outline-none"
                >
                  {mockData.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5 flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-brand-600" /> Construction Site Location
                </label>
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-3 text-sm font-medium text-slate-900 focus:border-brand-500 focus:outline-none"
                >
                  {mockData.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Section 2: Vehicle & Operator */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5 flex items-center gap-1.5">
                  <Truck className="h-4 w-4 text-brand-600" /> Vehicle / Equipment
                </label>
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-3 text-sm font-medium text-slate-900 focus:border-brand-500 focus:outline-none"
                >
                  {mockData.vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code} - {v.name} ({v.assetClass})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5 flex items-center gap-1.5">
                  <User className="h-4 w-4 text-brand-600" /> Operator / Driver
                </label>
                <select
                  value={operatorId}
                  onChange={(e) => setOperatorId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-3 text-sm font-medium text-slate-900 focus:border-brand-500 focus:outline-none"
                >
                  {mockData.drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.empCode})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Section 3: Output Type & Quantity */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5">Output Unit Type</label>
                <select
                  value={outputType}
                  onChange={(e) => setOutputType(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-3 text-sm font-medium text-slate-900 focus:border-brand-500 focus:outline-none"
                >
                  <option value="TONNES">Tonnes (t)</option>
                  <option value="CUBIC_METRES">Cubic Metres (m³)</option>
                  <option value="TRIPS">Total Trips</option>
                  <option value="COMPACTED_SQM">Compacted Area (m²)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5">Output Quantity</label>
                <input
                  type="number"
                  placeholder="e.g. 450"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : "")}
                  className={`w-full rounded-xl border p-3 text-sm font-semibold focus:outline-none ${
                    errors.quantity ? "border-rose-500 bg-rose-50" : "border-slate-300"
                  }`}
                />
                {errors.quantity && <p className="mt-1 text-xs text-rose-600">{errors.quantity}</p>}
              </div>
            </div>

            {/* Section 4: Working Hours & Fuel Used */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5 flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-brand-600" /> Working Hours (hrs)
                </label>
                <input
                  type="number"
                  step="0.5"
                  placeholder="e.g. 8.5"
                  value={hours}
                  onChange={(e) => setHours(e.target.value ? Number(e.target.value) : "")}
                  className={`w-full rounded-xl border p-3 text-sm font-semibold focus:outline-none ${
                    errors.hours ? "border-rose-500 bg-rose-50" : "border-slate-300"
                  }`}
                />
                {errors.hours && <p className="mt-1 text-xs text-rose-600">{errors.hours}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5 flex items-center gap-1.5">
                  <Fuel className="h-4 w-4 text-brand-600" /> Diesel Fuel Consumed (Litres)
                </label>
                <input
                  type="number"
                  placeholder="e.g. 120"
                  value={fuelUsed}
                  onChange={(e) => setFuelUsed(e.target.value ? Number(e.target.value) : "")}
                  className={`w-full rounded-xl border p-3 text-sm font-semibold focus:outline-none ${
                    errors.fuelUsed ? "border-rose-500 bg-rose-50" : "border-slate-300"
                  }`}
                />
                {errors.fuelUsed && <p className="mt-1 text-xs text-rose-600">{errors.fuelUsed}</p>}
              </div>
            </div>

            {/* Section 5: Weather & Status */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5">Weather Conditions</label>
                <select
                  value={weather}
                  onChange={(e) => setWeather(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-3 text-sm font-medium text-slate-900 focus:border-brand-500 focus:outline-none"
                >
                  <option value="SUNNY">☀️ Clear / Sunny</option>
                  <option value="CLOUDY">⛅ Overcast / Cloudy</option>
                  <option value="RAINY">🌧️ Rain Interrupted</option>
                  <option value="HOT">🔥 Extreme Heat</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5">Work Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-3 text-sm font-medium text-slate-900 focus:border-brand-500 focus:outline-none"
                >
                  <option value="COMPLETED">Completed Shift Output</option>
                  <option value="PARTIAL">Partial Output (Breakdown/Rain)</option>
                  <option value="IDLE">Idle Shift (No Material)</option>
                </select>
              </div>
            </div>

            {/* Section 6: Image Upload */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5 flex items-center gap-1.5">
                <Upload className="h-4 w-4 text-brand-600" /> Upload Site Work Proof / Slip Photo
              </label>
              <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 p-4 text-center hover:bg-slate-50 transition-colors">
                {imagePreview ? (
                  <div className="relative">
                    <img src={imagePreview} alt="Preview" className="h-32 object-cover rounded-xl shadow-md" />
                    <button
                      type="button"
                      onClick={() => setImagePreview(null)}
                      className="mt-2 text-xs font-semibold text-rose-600 hover:underline"
                    >
                      Remove Photo
                    </button>
                  </div>
                ) : (
                  <label className="cursor-pointer">
                    <Upload className="mx-auto h-8 w-8 text-slate-400 mb-1" />
                    <span className="text-xs font-semibold text-brand-600">Click to upload photo</span>
                    <span className="text-xs text-slate-400 block">PNG, JPG up to 5MB</span>
                    <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                  </label>
                )}
              </div>
            </div>

            {/* Section 7: Remarks */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 mb-1.5">Supervisor Remarks</label>
              <textarea
                rows={3}
                placeholder="Notes on lead distance, quarry source, material grade..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full rounded-xl border border-slate-300 p-3 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              className="w-full py-4 rounded-xl bg-brand-500 text-white font-bold text-lg hover:bg-brand-600 shadow-xl shadow-brand-500/30 transition-all"
            >
              Submit Daily Production Log
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
