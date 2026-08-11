"use client";

import { Volume2 } from "lucide-react";

export function SpeakButton({ text, label = "सुनें · Listen" }: { text: string; label?: string }) {
  function go() {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "hi-IN";
      u.rate = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }
  return (
    <button onClick={go} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand-500/30 hover:bg-brand-600">
      <Volume2 className="h-5 w-5" /> {label}
    </button>
  );
}
