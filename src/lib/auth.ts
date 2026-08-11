import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "./db";

const COOKIE = "fv_session";

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

/** Verifies a password; supports legacy plaintext records so old accounts keep working. */
export async function verifyPassword(plain: string, stored: string) {
  if (stored.startsWith("$2")) return bcrypt.compare(plain, stored);
  return plain === stored;
}

export function isHashed(stored: string) {
  return stored.startsWith("$2");
}

export async function getSession() {
  const store = await cookies();
  const uid = store.get(COOKIE)?.value;
  if (!uid) return null;
  const user = await db.user.findUnique({ where: { id: uid } });
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function setSession(userId: string) {
  const store = await cookies();
  store.set(COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export const ROLE_LABEL: Record<string, string> = {
  Admin: "Administrator",
  Driver: "Truck Driver",
  FleetManager: "Fleet Manager",
  Finance: "Finance Controller",
  SiteManager: "Site Manager",
  Workshop: "Workshop Manager",
};
