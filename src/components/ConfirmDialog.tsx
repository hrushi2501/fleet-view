"use client";

import React, { useState, useTransition, useEffect } from "react";
import { AlertTriangle, Loader2, X, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warning" | "primary";
  requireTextMatch?: string;
  icon?: React.ReactNode;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  tone = "danger",
  requireTextMatch,
  icon,
}: ConfirmDialogProps) {
  const [typedValue, setTypedValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isMatchValid = !requireTextMatch || typedValue.trim() === requireTextMatch.trim();

  const handleClose = () => {
    setTypedValue("");
    setError("");
    onClose();
  };

  const handleConfirm = () => {
    if (!isMatchValid) return;
    setError("");
    startTransition(async () => {
      try {
        await onConfirm();
        handleClose();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Action failed. Please try again.");
      }
    });
  };

  const tones = {
    danger: {
      btn: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300",
      iconBg: "bg-rose-50 text-rose-600 ring-rose-200",
    },
    warning: {
      btn: "bg-amber-600 text-white hover:bg-amber-700 disabled:bg-amber-300",
      iconBg: "bg-amber-50 text-amber-600 ring-amber-200",
    },
    primary: {
      btn: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300",
      iconBg: "bg-brand-50 text-brand-600 ring-brand-200",
    },
  };

  return (
    <div
      className="fixed inset-0 z-9995 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
    >
      <div
        className="relative my-8 w-full max-w-md overflow-hidden rounded-3xl border border-white/50 bg-white p-6 shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1",
              tones[tone].iconBg
            )}
          >
            {icon || (tone === "danger" ? <Trash2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />)}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-ink-900 leading-tight">{title}</h3>
            {description && <p className="mt-1 text-sm text-slate-500 leading-relaxed">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {requireTextMatch && (
          <div className="mt-4 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <label className="block text-xs font-semibold text-slate-700">
              Type <span className="font-mono text-rose-600 select-all font-bold">{requireTextMatch}</span> to confirm:
            </label>
            <input
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              placeholder={requireTextMatch}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-200"
            />
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs font-medium text-rose-600 border border-rose-200">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending || !isMatchValid}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-xs transition-colors",
              tones[tone].btn
            )}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
