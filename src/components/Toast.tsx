"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { CheckCircle2, AlertCircle, Info, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastType = "success" | "error" | "info" | "loading";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  toast: {
    success: (title: string, message?: string, duration?: number) => string;
    error: (title: string, message?: string, duration?: number) => string;
    info: (title: string, message?: string, duration?: number) => string;
    loading: (title: string, message?: string) => string;
    dismiss: (id: string) => void;
  };
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastType, title: string, message?: string, duration = 4000) => {
      const id = Math.random().toString(36).substring(2, 9);
      const newToast: Toast = { id, type, title, message, duration };

      setToasts((prev) => [...prev, newToast]);

      if (type !== "loading" && duration > 0) {
        setTimeout(() => {
          dismiss(id);
        }, duration);
      }

      return id;
    },
    [dismiss]
  );

  const toast = {
    success: (title: string, message?: string, duration?: number) => addToast("success", title, message, duration),
    error: (title: string, message?: string, duration?: number) => addToast("error", title, message, duration),
    info: (title: string, message?: string, duration?: number) => addToast("info", title, message, duration),
    loading: (title: string, message?: string) => addToast("loading", title, message, 0),
    dismiss,
  };

  return (
    <ToastContext.Provider value={{ toasts, toast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const noopToast = {
  success: (_title: string, _message?: string, _duration?: number) => "",
  error: (_title: string, _message?: string, _duration?: number) => "",
  info: (_title: string, _message?: string, _duration?: number) => "",
  loading: (_title: string, _message?: string) => "",
  dismiss: (_id: string) => {},
};

export function useToast() {
  const context = useContext(ToastContext);
  return context ? context.toast : noopToast;
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-9999 flex w-full max-w-sm flex-col gap-2.5 px-4 sm:px-0"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
    error: <AlertCircle className="h-5 w-5 text-rose-600" />,
    info: <Info className="h-5 w-5 text-sky-600" />,
    loading: <Loader2 className="h-5 w-5 animate-spin text-brand-600" />,
  };

  const borders = {
    success: "border-emerald-200 bg-white/95 text-ink-900 shadow-emerald-900/10",
    error: "border-rose-200 bg-white/95 text-ink-900 shadow-rose-900/10",
    info: "border-sky-200 bg-white/95 text-ink-900 shadow-sky-900/10",
    loading: "border-brand-200 bg-white/95 text-ink-900 shadow-brand-900/10",
  };

  return (
    <div
      role="status"
      className={cn(
        "relative flex items-start gap-3 rounded-2xl border p-4 shadow-xl backdrop-blur-md transition-all duration-300 animate-fade-up",
        borders[toast.type]
      )}
    >
      <div className="shrink-0 pt-0.5">{icons[toast.type]}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight text-ink-900">{toast.title}</p>
        {toast.message && <p className="mt-1 text-xs text-slate-500 leading-relaxed">{toast.message}</p>}
      </div>
      {toast.type !== "loading" && (
        <button
          onClick={onDismiss}
          className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export default ToastProvider;
