"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, CircleHelp, Fuel, QrCode, Wrench, type LucideIcon } from "lucide-react";

type Language = "hi" | "en";

type HelpTask = {
  icon: LucideIcon;
  href: string;
  title: string;
  steps: readonly string[];
};

const HELP: Record<Language, { title: string; intro: string; support: string; tasks: readonly HelpTask[] }> = {
  hi: {
    title: "मदद", intro: "काम जल्दी पूरा करने के छोटे चरण।", support: "फिर भी दिक्कत हो तो सुपरवाइज़र से बात करें।",
    tasks: [
      { icon: QrCode, href: "/my", title: "ड्यूटी शुरू करें", steps: ["My Work खोलें", "कैबिन का QR स्कैन करें", "संदेश देखकर शुरू करें"] },
      { icon: Fuel, href: "/my/fuel?action=fuel", title: "डीज़ल भरें", steps: ["Fuel खोलें", "लीटर और मीटर भरें", "मांगी गई फोटो जोड़ें"] },
      { icon: QrCode, href: "/my", title: "ड्यूटी खत्म करें", steps: ["My Work खोलें", "End duty दबाएँ", "कैबिन का QR स्कैन करें"] },
      { icon: Wrench, href: "/my/service", title: "समस्या बताएं", steps: ["Service खोलें", "समस्या चुनें या लिखें", "सुपरवाइज़र के निर्देश देखें"] },
    ],
  },
  en: {
    title: "Help", intro: "Short steps to finish each task.", support: "Still stuck? Speak to your supervisor.",
    tasks: [
      { icon: QrCode, href: "/my", title: "Start duty", steps: ["Open My Work", "Scan the cabin QR", "Read the confirmation"] },
      { icon: Fuel, href: "/my/fuel?action=fuel", title: "Add diesel", steps: ["Open Fuel", "Enter litres and meter", "Add requested photos"] },
      { icon: QrCode, href: "/my", title: "End duty", steps: ["Open My Work", "Tap End duty", "Scan the cabin QR"] },
      { icon: Wrench, href: "/my/service", title: "Report a problem", steps: ["Open Service", "Choose or describe the problem", "Check supervisor instructions"] },
    ],
  },
};

export function DriverHelp() {
  const [language, setLanguage] = useState<Language>("hi");
  const copy = HELP[language];

  return (
    <section lang={language} className="space-y-4" aria-labelledby="driver-help-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="driver-help-title" className="text-xl font-bold text-ink-900">{copy.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{copy.intro}</p>
        </div>
        <div className="flex shrink-0 rounded-xl bg-slate-200 p-1 text-xs font-bold" aria-label="Language">
          <button type="button" onClick={() => setLanguage("hi")} aria-pressed={language === "hi"} className={`min-h-9 rounded-lg px-3 ${language === "hi" ? "bg-white text-ink-900 shadow-sm" : "text-slate-600"}`}>हिंदी</button>
          <button type="button" onClick={() => setLanguage("en")} aria-pressed={language === "en"} className={`min-h-9 rounded-lg px-3 ${language === "en" ? "bg-white text-ink-900 shadow-sm" : "text-slate-600"}`}>English</button>
        </div>
      </div>

      <div className="space-y-3">
        {copy.tasks.map((task) => {
          const Icon = task.icon;
          return (
            <Link key={task.title} href={task.href} className="block rounded-2xl bg-white p-4 ring-1 ring-slate-200 active:bg-slate-50">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon className="h-5 w-5" aria-hidden /></span>
                <h3 className="flex-1 text-base font-bold text-ink-900">{task.title}</h3>
                <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden />
              </div>
              <ol className="mt-3 grid gap-1.5 text-sm text-slate-700">
                {task.steps.map((step, index) => <li key={step} className="flex gap-2"><span className="font-bold text-brand-700">{index + 1}.</span><span>{step}</span></li>)}
              </ol>
            </Link>
          );
        })}
      </div>

      <p className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700"><CircleHelp className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />{copy.support}</p>
    </section>
  );
}
