"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, ShieldCheck, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { uploadOwnDocument } from "@/app/(app)/my/actions";
import { isActionError } from "@/lib/action-result";
import { useToast } from "@/components/Toast";

type DocumentType = "LICENSE" | "AADHAAR";

const options: { value: DocumentType; label: string; hindi: string; numberLabel: string }[] = [
  { value: "LICENSE", label: "Driving Licence", hindi: "ड्राइविंग लाइसेंस", numberLabel: "Licence number" },
  { value: "AADHAAR", label: "Aadhaar Card", hindi: "आधार कार्ड", numberLabel: "Aadhaar number" },
];

/**
 * One small upload sheet rather than a document-management screen. The list on
 * the page stays the default experience; this appears only after the driver
 * chooses Add, keeping the everyday phone flow short and easy to recover.
 */
export function DriverDocumentVault() {
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState<DocumentType>("LICENSE");
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const selected = options.find((option) => option.value === docType) ?? options[0];

  function close() {
    if (!pending) setOpen(false);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-3 text-sm font-bold text-white shadow-sm active:scale-[0.98]">
        <Plus className="h-4 w-4" /> Add document
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-900/45 p-3 sm:items-center sm:justify-center sm:p-5" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="driver-document-title" className="w-full rounded-3xl bg-white p-5 shadow-2xl sm:max-w-md">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><ShieldCheck className="h-5 w-5" /></div>
                <h2 id="driver-document-title" className="mt-3 text-xl font-bold text-ink-900">Add your document</h2>
                <p className="mt-1 text-sm text-slate-500">अपना लाइसेंस या आधार की साफ़ फोटो डालें।</p>
              </div>
              <button type="button" onClick={close} disabled={pending} aria-label="Close upload form" className="rounded-xl p-2 text-slate-500 active:bg-slate-100 disabled:opacity-50"><X className="h-5 w-5" /></button>
            </div>

            <form
              action={(fd) => start(async () => {
                const result = await uploadOwnDocument(fd);
                if (isActionError(result)) {
                  toast.error("Document was not uploaded", result.error);
                  return;
                }
                toast.success("Document uploaded", "Your latest scan is ready to view.");
                setOpen(false);
                router.refresh();
              })}
              className="mt-5 space-y-4"
            >
              <fieldset className="grid grid-cols-2 gap-2">
                <legend className="sr-only">Document type</legend>
                {options.map((option) => (
                  <label key={option.value} className={`cursor-pointer rounded-2xl p-3 ring-1 ${docType === option.value ? "bg-brand-50 ring-2 ring-brand-500" : "bg-white ring-slate-200"}`}>
                    <input type="radio" name="docType" value={option.value} checked={docType === option.value} onChange={() => setDocType(option.value)} className="sr-only" />
                    <span className="block text-sm font-bold text-ink-900">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{option.hindi}</span>
                  </label>
                ))}
              </fieldset>

              <label className="block">
                <span className="mb-1.5 block text-sm font-bold text-slate-700">{selected.numberLabel} <span className="font-medium text-slate-400">(optional)</span></span>
                <input name="number" inputMode="text" maxLength={80} autoComplete="off" className="min-h-12 w-full rounded-xl bg-slate-50 px-3 text-base text-ink-900 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-brand-500" />
              </label>

              {docType === "LICENSE" && (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-bold text-slate-700">Licence expiry <span className="font-medium text-slate-400">(optional)</span></span>
                  <input name="expiryDate" type="date" className="min-h-12 w-full rounded-xl bg-slate-50 px-3 text-base text-ink-900 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-brand-500" />
                </label>
              )}

              <label className="block rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                <span className="flex items-center gap-2 text-base font-bold text-ink-900"><Upload className="h-5 w-5 text-brand-600" /> Photo or PDF</span>
                <span className="mt-1 block text-sm text-slate-500">JPEG, PNG, WebP or PDF · up to 10 MB</span>
                <input name="document" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf" className="mt-3 block w-full text-sm text-slate-600 file:mr-3 file:min-h-10 file:rounded-xl file:border-0 file:bg-brand-600 file:px-3 file:font-bold file:text-white" />
              </label>

              <p className="text-xs leading-relaxed text-slate-500">Your scan is private. Only you and authorised office staff can open it.</p>
              <button type="submit" disabled={pending} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 text-base font-bold text-white disabled:opacity-55">
                {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                {pending ? "Uploading…" : "Upload document"}
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
