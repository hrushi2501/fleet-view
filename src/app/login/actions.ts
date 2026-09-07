"use server";

import { db } from "@/lib/db";
import { setSession, verifyPassword } from "@/lib/auth";
import { auditAs } from "@/lib/audit";
import { checkLock, recordFailure, clearFailures, MAX_ATTEMPTS } from "@/lib/login-throttle";
import { reserveRateLimit, clientIp } from "@/lib/request-rate-limit";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safe } from "@/lib/guard";

/**
 * Authentication must not become unavailable merely because the audit sink has
 * a transient problem. `audit()` is documented as best-effort elsewhere in the
 * app; login needs the same boundary so a valid password always reaches its
 * redirect after the session is issued.
 */
async function recordLoginAudit(
  ...args: Parameters<typeof auditAs>
): Promise<void> {
  try {
    await auditAs(...args);
  } catch (error) {
    console.error("[auth] Failed to record login audit event:", error);
  }
}

/**
 * A counter outage must not become a login outage. The database read and
 * password comparison still decide authentication; this only records abuse
 * protection. Successful enforcement keeps its normal 429 response.
 */
async function reserveLoginLimit(input: Parameters<typeof reserveRateLimit>[0]) {
  try {
    return await reserveRateLimit(input);
  } catch (error) {
    console.error("[auth] Login rate-limit storage is unavailable:", error);
    return null;
  }
}

async function recordLastLogin(userId: string): Promise<void> {
  try {
    await db.user.update({ where: { id: userId }, data: { lastLogin: new Date() } });
  } catch (error) {
    // This timestamp is useful operational metadata, not proof of identity.
    // Authentication has already succeeded, so it must not prevent a session
    // from being issued when the metadata write is temporarily unavailable.
    console.error("[auth] Failed to update last-login timestamp:", error);
  }
}

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
async function loginImpl(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!email || !password) return { error: "Enter your email and password." };
  if (email.length > 254 || password.length > 1024) return { error: "Invalid email or password." };

  const headerStore = await headers();
  const ip = clientIp(headerStore);
  // Drivers often share a site Wi-Fi/mobile gateway. Keep a meaningful
  // network-wide abuse limit without treating ordinary shared-device retries
  // as an attack. Per-account failures are governed below by the lockout.
  const ipLimit = await reserveLoginLimit({
    scope: "login-ip",
    subject: ip,
    limit: 60,
    windowMs: 15 * 60_000,
  });
  if (ipLimit && !ipLimit.ok) {
    const mins = Math.ceil(ipLimit.retryInSeconds / 60);
    return { error: `Too many login attempts from this network. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }

  let lock: Awaited<ReturnType<typeof checkLock>> | null = null;
  try {
    lock = await checkLock(email);
  } catch (error) {
    console.error("[auth] Login lockout storage is unavailable:", error);
  }
  if (lock?.locked) {
    const mins = Math.ceil(lock.retryInSeconds / 60);
    return { error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }


  const user = await db.user.findUnique({ where: { email } });
  // Always run bcrypt, including for unknown addresses. Without the dummy
  // comparison inside `verifyPassword`, an unknown user returns tens of
  // milliseconds sooner than a wrong password for a real account.
  const passwordMatches = await verifyPassword(password, user?.password ?? "");

  if (!user || !passwordMatches) {
    let nowLocked = false;
    try {
      ({ nowLocked } = await recordFailure(email));
    } catch (error) {
      console.error("[auth] Failed to record sign-in failure:", error);
    }
    // Recorded against the address that was tried rather than a user, because
    // the attempt may not correspond to a real account.
    await recordLoginAudit(null, {
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
    await recordLoginAudit(null, {
      action: "DENIED", module: "ADMIN", entity: "User", entityId: user.id,
      summary: `Sign-in refused for the deactivated account ${email}`,
    });
    return { error: "This account has been deactivated. Contact an administrator." };
  }

  try {
    await clearFailures(email);
  } catch (error) {
    console.error("[auth] Failed to clear sign-in failure counter:", error);
  }
  await setSession(user.id);
  await recordLastLogin(user.id);
  await recordLoginAudit({ id: user.id, name: user.name, role: user.role }, {
    action: "LOGIN", module: "ADMIN", entity: "User", entityId: user.id,
    summary: `${user.name} signed in`,
  });

  redirect(user.role === "Driver" ? "/my" : "/");
}

export const login = safe(loginImpl);
