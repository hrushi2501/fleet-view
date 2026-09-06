"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { setLanguage } from "@/lib/lang-actions";
import { LANGUAGES, LANGUAGE_LABEL, type Lang } from "@/lib/i18n";
import { useLang } from "@/components/LanguageProvider";

/**
 * Two words, one tap.
 *
 * A dropdown of two options is a worse control than two labels side by side,
 * and this one has to be usable by somebody who cannot read the word "Language"
 * — which is why the icon carries it and the choices are written in their own
 * language rather than translated into the current one.
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const current = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();

  function choose(lang: Lang) {
    if (lang === current || pending) return;
    start(async () => {
      await setLanguage(lang);
      router.refresh();
    });
  }

  return (
    <div
      className={
        "inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 " +
        (pending ? "opacity-60" : "")
      }
      role="group"
      aria-label="Language / Bhasha"
    >
      {!compact && <Languages className="ml-1.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
      {LANGUAGES.map((lang) => (
        <button
          key={lang}
          onClick={() => choose(lang)}
          aria-pressed={current === lang}
          title={LANGUAGE_LABEL[lang]}
          className={
            "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors " +
            (current === lang
              ? "bg-brand-600 text-white"
              : "text-slate-600 hover:bg-slate-100")
          }
        >
          {lang === "en" ? "English" : "हिंदी"}
        </button>
      ))}
    </div>
  );
}
