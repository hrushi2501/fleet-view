"use client";

import { createContext, useContext } from "react";
import { translator, type Lang } from "@/lib/i18n";

/**
 * The chosen language, handed to client components.
 *
 * Server components read it from the account directly; client components cannot,
 * so the layout resolves it once and passes it down through here. One lookup per
 * page either way.
 */
const LanguageContext = createContext<Lang>("en");

export function LanguageProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LanguageContext.Provider value={lang}>{children}</LanguageContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LanguageContext);
}

/** `const t = useT()` then `t("common.save", "Save")`. */
export function useT(): (key: string, english: string) => string {
  return translator(useContext(LanguageContext));
}
