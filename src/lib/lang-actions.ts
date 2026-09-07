"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser, safe } from "@/lib/guard";
import { isLang } from "@/lib/i18n";

/**
 * Saves a person's language against their account.
 *
 * Deliberately available to anyone signed in, with no permission attached: the
 * language somebody reads in is their own business, not something an
 * administrator should have to grant. A driver must be able to fix this for
 * themselves on the first screen they meet.
 *
 * The cookie is written too, so the change shows on the very next render
 * without waiting for the session to be re-read.
 */
async function setLanguage__impl(lang: string) {
  const access = await requireUser();
  if (!isLang(lang)) return { ok: false as const, error: "Unknown language." };

  await db.user.update({ where: { id: access.session.id }, data: { language: lang } });

  (await cookies()).set("lang", lang, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
  });

  // Every screen carries text, so the whole tree is stale.
  revalidatePath("/", "layout");
  return { ok: true as const, lang };
}

export const setLanguage = safe(setLanguage__impl);
