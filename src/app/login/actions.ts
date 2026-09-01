"use server";

import { db } from "@/lib/db";
import { setSession, verifyPassword } from "@/lib/auth";
import { auditAs } from "@/lib/audit";
import { checkLock, recordFailure, clearFailures, MAX_ATTEMPTS } from "@/lib/login-throttle";
import { redirect } from "next/navigation";

/**
 * Sign-in.
 *
 * Three things happen here beyond checking the password, and each exists
 * because its absence was a real hole:
 *
 *  - Attempts are throttled. The form previously accepted unlimited guesses.
 *  - Success and failure are both audited, so "who signed in, and from where"
 *    is answerable without treating a failed attempt as a successful login.
 *  - The failure message never distinguishes an unknown address from a wrong
 *    password, so the form cannot be used to enumerate who holds an account.
 */
export async function login(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!email || !password) return { error: "Enter your email and password." };

  const lock = await checkLock(email);
  if (lock.locked) {
    const mins = Math.ceil(lock.retryInSeconds / 60);
    return { error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }

  const user = await db.user.findUnique({ where: { email } });
  // Always run bcrypt, including for unknown addresses. Without the dummy
  // comparison inside `verifyPassword`, an unknown user returns tens of
  // milliseconds sooner than a wrong password for a real account.
  const passwordMatches = await verifyPassword(password, user?.password ?? "");

  if (!user || !passwordMatches) {
    const { nowLocked } = await recordFailure(email);
    // Recorded against the address that was tried rather than a user, because
    // the attempt may not correspond to a real account.
    await auditAs(null, {
      action: nowLocked ? "DENIED" : "LOGIN_FAILED",
      module: "ADMIN",
      entity: "User",
      entityId: user?.id,
      summary: nowLocked
        ? `Locked out after ${MAX_ATTEMPTS} failed sign-ins for ${email}`
        : `Failed sign-in attempt for ${email}`,
    });
    return { error: "Invalid email or password." };
  }

  // A deactivated account must not be able to sign back in. `getSession` also
  // refuses one, but failing at the door gives an honest message.
  if (user.active === false) {
    await auditAs(null, {
      action: "DENIED", module: "ADMIN", entity: "User", entityId: user.id,
      summary: `Sign-in refused for the deactivated account ${email}`,
    });
    return { error: "This account has been deactivated. Contact an administrator." };
  }

  await clearFailures(email);
  await setSession(user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
  await auditAs({ id: user.id, name: user.name, role: user.role }, {
    action: "LOGIN", module: "ADMIN", entity: "User", entityId: user.id,
    summary: `${user.name} signed in`,
  });

  redirect(user.role === "Driver" ? "/my" : "/");
}
