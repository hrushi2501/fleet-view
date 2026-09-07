"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, CircleStop, Loader2, Mic, Phone, Radio, Siren, Upload, X } from "lucide-react";
import { reportProblem } from "@/app/(app)/my/actions";
import type { DriverEmergencyContact } from "@/app/(app)/my/_data";

type ReportKind = "ACCIDENT" | "ENGINE" | "BRAKE" | "TYRE" | "FUEL" | "ELECTRIC" | "HINDRANCE" | "OTHER";

const REPORT_KINDS: { value: ReportKind; hindi: string; english: string; blocking: boolean }[] = [
  { value: "ACCIDENT", hindi: "दुर्घटना", english: "Accident", blocking: true },
  { value: "BRAKE", hindi: "ब्रेक / स्टीयरिंग", english: "Brake or steering", blocking: true },
  { value: "ENGINE", hindi: "इंजन की दिक्कत", english: "Engine problem", blocking: true },
  { value: "TYRE", hindi: "टायर की दिक्कत", english: "Tyre problem", blocking: false },
  { value: "FUEL", hindi: "डीज़ल की दिक्कत", english: "Fuel problem", blocking: false },
  { value: "ELECTRIC", hindi: "लाइट / बिजली", english: "Light or electrical", blocking: false },
  { value: "HINDRANCE", hindi: "रास्ता बंद / रुकावट", english: "Road blocked or hindrance", blocking: false },
  { value: "OTHER", hindi: "कोई और बात", english: "Something else", blocking: false },
];

function extensionFor(mime: string): "webm" | "ogg" | "m4a" {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  return "webm";
}

function SubmitReport() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 text-lg font-bold text-white shadow-sm active:scale-[0.99] disabled:opacity-55"
    >
      {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Siren className="h-5 w-5" />}
      {pending ? "Sending report…" : "Report bhejein / Send report"}
    </button>
  );
}

/**
 * Small, deliberately native form. It remains usable as a normal form if the
 * phone has weak data or JavaScript is slow; recording is the optional layer.
 */
export function DriverReportForm({
  assetId,
  vehicleCode,
  contacts,
  missingCompanyContacts,
}: {
  assetId: string;
  vehicleCode: string;
  contacts: DriverEmergencyContact[];
  missingCompanyContacts: string[];
}) {
  const [kind, setKind] = useState<ReportKind>("ACCIDENT");
  const [recording, setRecording] = useState<File | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "ready" | "error">("idle");
  const [recordingMessage, setRecordingMessage] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTracks();
  }, []);

  useEffect(() => () => {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  }, [recordingUrl]);

  function attachRecording(file: File) {
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      if (fileInputRef.current) fileInputRef.current.files = transfer.files;
      setRecording(file);
      setRecordingUrl(URL.createObjectURL(file));
      setRecordingState("ready");
      setRecordingMessage("Voice note ready. It will be sent with this report.");
    } catch {
      setRecordingState("error");
      setRecordingMessage("Could not attach this recording. Use the upload button instead.");
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordingState("error");
      setRecordingMessage("Voice recording is not available on this phone. You can still type or upload an audio file.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const supported = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
        .find((mime) => MediaRecorder.isTypeSupported(mime));
      const recorder = supported ? new MediaRecorder(stream, { mimeType: supported }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onerror = () => {
        stopTracks();
        setRecordingState("error");
        setRecordingMessage("The voice recording failed. You can try again or type a short note.");
      };
      recorder.onstop = () => {
        if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
        stopTracks();
        if (chunks.length === 0) {
          setRecordingState("error");
          setRecordingMessage("No voice was recorded. Try again or type a short note.");
          return;
        }
        const mime = recorder.mimeType || "audio/webm";
        attachRecording(new File([new Blob(chunks, { type: mime })], `driver-report.${extensionFor(mime)}`, { type: mime }));
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecordingState("recording");
      setRecordingMessage("Recording… speak normally. It stops after 90 seconds.");
      stopTimerRef.current = setTimeout(() => recorder.state === "recording" && recorder.stop(), 90_000);
    } catch {
      stopTracks();
      setRecordingState("error");
      setRecordingMessage("Microphone permission was not allowed. You can type a note instead.");
    }
  }

  function stopRecording() {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function clearRecording() {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setRecording(null);
    setRecordingUrl(null);
    setRecordingState("idle");
    setRecordingMessage("");
  }

  const accident = kind === "ACCIDENT";

  return (
    <form action={reportProblem} className="space-y-4" aria-label="Driver report form">
      <input type="hidden" name="assetId" value={assetId} />
      <input type="hidden" name="returnTo" value="report" />

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <p className="text-sm font-medium text-slate-500">Vehicle</p>
        <p className="mt-1 text-xl font-bold text-ink-900">{vehicleCode}</p>
        <p className="mt-1 text-sm text-slate-500">पहले सुरक्षित जगह पर रुकें। Stop safely before reporting.</p>
      </section>

      <fieldset className="space-y-2">
        <legend className="px-1 text-base font-semibold text-slate-700">क्या हुआ? / What happened?</legend>
        {REPORT_KINDS.map((option) => (
          <label
            key={option.value}
            className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl px-4 ring-1 transition ${kind === option.value
              ? option.value === "ACCIDENT" ? "bg-rose-50 text-rose-900 ring-2 ring-rose-500" : "bg-brand-50 text-brand-800 ring-2 ring-brand-500"
              : "bg-white text-ink-900 ring-slate-200"}`}
          >
            <input className="h-5 w-5 accent-brand-600" type="radio" name="kind" value={option.value} checked={kind === option.value} onChange={() => setKind(option.value)} />
            <span className="min-w-0 flex-1 text-base font-semibold">{option.hindi}<span className="block text-xs font-medium opacity-70">{option.english}</span></span>
            {option.blocking && <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" aria-label="Urgent" />}
          </label>
        ))}
      </fieldset>

      {accident && (
        <section className="space-y-3 rounded-2xl border-2 border-rose-400 bg-rose-50 p-4" aria-live="polite">
          <div className="flex gap-3">
            <Siren className="mt-0.5 h-6 w-6 shrink-0 text-rose-700" />
            <div><h2 className="text-lg font-bold text-rose-950">पहले मदद बुलाएं / Call for help first</h2><p className="mt-1 text-sm text-rose-800">If anyone is hurt or in danger, call before completing this report.</p></div>
          </div>
          <div className="grid gap-2">
            {contacts.map((contact) => (
              <a key={`${contact.label}-${contact.phone}`} href={`tel:${contact.phone}`} className={`flex min-h-14 items-center gap-3 rounded-xl px-4 font-bold shadow-sm active:scale-[0.99] ${contact.tone === "critical" ? "bg-rose-700 text-white" : "bg-white text-rose-900 ring-1 ring-rose-200"}`}>
                <Phone className="h-5 w-5 shrink-0" /><span className="min-w-0 flex-1"><span className="block">{contact.label}</span><span className="block text-xs font-medium opacity-80">{contact.hint}</span></span><span className="text-lg">{contact.phone}</span>
              </a>
            ))}
          </div>
          {missingCompanyContacts.length > 0 && <p className="text-xs font-medium text-rose-800">{missingCompanyContacts.join(" and ")} number is not configured yet. Call 112, then inform your supervisor.</p>}
        </section>
      )}

      <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl bg-rose-50 px-4 text-base font-semibold text-rose-900 ring-1 ring-rose-200">
        <input type="checkbox" name="stopped" className="h-5 w-5 accent-rose-600" />
        <span>गाड़ी चल नहीं रही / Vehicle cannot move</span>
      </label>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-bold text-ink-900">आवाज़ में बताएं / Tell us by voice</h2><p className="mt-1 text-sm text-slate-500">Optional. A short voice note is easier than typing.</p></div><Radio className="h-5 w-5 shrink-0 text-brand-600" /></div>
        <input ref={fileInputRef} name="voiceRecording" type="file" accept="audio/webm,audio/ogg,audio/mp4" className="sr-only" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) attachRecording(file); }} />
        <div className="mt-3 flex gap-2">
          {recordingState === "recording" ? (
            <button type="button" onClick={stopRecording} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-3 text-sm font-bold text-white"><CircleStop className="h-5 w-5" />Stop recording</button>
          ) : (
            <button type="button" onClick={() => void startRecording()} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-3 text-sm font-bold text-white"><Mic className="h-5 w-5" />Record voice</button>
          )}
          <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700"><Upload className="h-5 w-5" />Upload</button>
        </div>
        {recordingMessage && <p className={`mt-3 text-sm ${recordingState === "error" ? "text-rose-700" : "text-slate-600"}`}>{recordingMessage}</p>}
        {recording && <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 p-3"><audio className="min-w-0 flex-1" controls preload="metadata" src={recordingUrl ?? undefined} /><button type="button" onClick={clearRecording} className="rounded-lg p-2 text-slate-500 hover:bg-slate-200" aria-label="Remove voice recording"><X className="h-5 w-5" /></button></div>}
      </section>

      <label className="block rounded-2xl bg-white p-4 ring-1 ring-slate-200"><span className="text-base font-bold text-ink-900">थोड़ा लिखना है? / Add a note</span><textarea name="note" rows={3} maxLength={500} placeholder="Optional — where are you, what happened?" className="mt-2 w-full rounded-xl bg-slate-50 p-3 text-base text-ink-900 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-brand-500" /></label>
      <SubmitReport />
    </form>
  );
}
