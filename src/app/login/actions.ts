"use server";

import { db } from "@/lib/db";
import { setSession, verifyPassword, hashPassword, isHashed } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function login(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.password))) {
    return { error: "Invalid email or password." };
  }
  // transparently upgrade legacy plaintext passwords to bcrypt hashes
  if (!isHashed(user.password)) {
    await db.user.update({ where: { id: user.id }, data: { password: await hashPassword(password) } });
  }
  await setSession(user.id);
  redirect(user.role === "Driver" ? "/driver" : "/");
}
