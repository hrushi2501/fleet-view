import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isLang, translator, type Lang } from "@/lib/i18n";

/**
 * The language for this request, for use in server components.
 *
 * Resolution order, and each step is there for a reason:
 *
 *   1. the signed-in account's saved choice — the real answer, and the one that
 *      follows a person between the office desktop and the phone on site
 *   2. a cookie — covers the sign-in page and anything else rendered before
 *      there is an account to ask, and makes the switch feel instant because it
 *      is set in the same action that saves the account
 *   3. English
 *
 * Wrapped in React's `cache` so a page rendering thirty server components asks
 * the database once, not thirty times.
 */
export const getLang = cache(async (): Promise<Lang> => {
  try {
    const session = await getSession();
    if (session) {
      const row = await db.user.findUnique({
        where: { id: session.id },
        select: { language: true },
      });
      if (isLang(row?.language)) return row.language;
    }
  } catch {
    // A language preference must never be the reason a page fails to render.
  }

  try {
    const cookie = (await cookies()).get("lang")?.value;
    if (isLang(cookie)) return cookie;
  } catch {
    // Reading cookies throws in a few rendering contexts; English is fine.
  }

  return "en";
});

/** `const t = await getT()` then `t("fuel.title", "Fuel")`. */
export async function getT(): Promise<(key: string, english: string) => string> {
  return translator(await getLang());
}
