"use client";

import { useT } from "@/components/LanguageProvider";

/**
 * One string, in the reader's language.
 *
 * A component rather than a hook so it can be used from inside the shared
 * server-rendered primitives — `SectionTitle`, `StatCard` and the page
 * headings — without turning those into client components. Making `ui.tsx`
 * client-side would have pulled recharts and the whole chart layer into the
 * browser bundle to translate a heading; this ships a few hundred bytes
 * instead.
 *
 * It renders the English unchanged when there is no translation yet, so a
 * half-finished dictionary is a working screen rather than a blank one.
 */
export function Txt({ text }: { text?: string | null }) {
  const t = useT();
  if (!text) return null;
  return <>{t(text, text)}</>;
}
