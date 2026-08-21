/**
 * The permission gate for server actions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `access.ts` closed the hole where any signed-in user could open any page. It
 * did not close the equivalent hole one layer down: a Next.js server action is
 * a POST endpoint. It is reachable by anybody who can reach the app, whether or
 * not the page that renders its button was ever shown to them. Hiding the
 * button is not access control, and neither is guarding the page it sits on.
 *
 * Before this file, seventeen action modules exported roughly a hundred and
 * thirty mutations between them and two of those checked authorisation — both
 * by comparing the legacy role *string* to `"Admin"` rather than reading a
 * permission. `deleteUser` had no check at all, so a driver's session could
 * remove user accounts.
 *
 * Every exported action now begins with `requireAction("some.code")`, which is
 * the same catalogue `rbac.ts` defines and `requireApi` enforces for REST. One
 * definition of who may do what, applied at all three doors.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { getAccess, type Access } from "@/lib/access";
import { canApprove } from "@/lib/rbac";
import { db } from "@/lib/db";

/**
 * An error whose message is safe to show a user.
 *
 * Server actions surface thrown errors to the client. Anything that is not an
 * `ActionError` should be treated as a bug and shown as a generic failure with
 * a reference, never as a raw stack — see `message()` below.
 */
export class ActionError extends Error {
  readonly safe = true;
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

/**
 * Asserts the caller is signed in and holds `code`, and hands back their access
 * context so the action can scope its writes to rows they may touch.
 *
 * Throws rather than returning a result object because that is the established
 * shape in this codebase's actions (`throw new Error("Only admins can …")`) and
 * because an action that forgets to check a returned flag would fail open.
 * Throwing fails closed.
 */
export async function requireAction(code: string): Promise<Access> {
  const access = await getAccess();
  if (!access) throw new ActionError("Your session has ended. Sign in again to continue.");

  if (!access.can(code)) {
    // Denials on sensitive permissions are worth a record: repeated attempts on
    // `fuel.approve` or `admin.users` is exactly the pattern an auditor asks
    // about, and it is invisible if only successes are logged.
    await recordDenial(access, code);
    throw new ActionError(
      `You do not have permission to do this (${code}). Ask an administrator if you need it.`,
    );
  }

  return access;
}

/** Signed in, no particular permission — for actions anyone may run on their own data. */
export async function requireUser(): Promise<Access> {
  const access = await getAccess();
  if (!access) throw new ActionError("Your session has ended. Sign in again to continue.");
  return access;
}

/**
 * Asserts the caller may approve this rupee amount.
 *
 * Holding `hire.approve` is not the same as being allowed to approve a ₹40 lakh
 * invoice. The limit lives on the role in `rbac.ts`; this reads it and refuses
 * anything above it with a message naming the ceiling, so the user knows to
 * escalate rather than guessing why the button failed.
 */
export async function requireApproval(code: string, amount: number): Promise<Access> {
  const access = await requireAction(code);

  const role = await db.user.findUnique({
    where: { id: access.session.id },
    select: { roleRef: { select: { name: true, label: true, permissions: true, approvalLimit: true } } },
  });

  const ref = role?.roleRef;
  if (!ref) {
    // No role record installed yet. `permissionsFor` makes the same allowance
    // for the legacy Admin string so setup is not deadlocked.
    if (access.session.role === "Admin") return access;
    throw new ActionError("Your account has no role assigned, so it cannot approve spend.");
  }

  const verdict = canApprove(
    {
      name: ref.name,
      label: ref.label,
      permissions: ref.permissions.split("\n").map((c) => c.trim()).filter(Boolean),
      approvalLimit: ref.approvalLimit,
    },
    code,
    amount,
  );

  if (!verdict.ok) throw new ActionError(verdict.reason ?? "This approval is above your limit.");
  return access;
}

/**
 * Turns any thrown value into something a person can read.
 *
 * `ActionError` messages are written for users and pass through. Everything
 * else is a bug, and its text may carry connection strings or SQL, so it is
 * replaced with a short reference the user can quote and the real error is left
 * to the platform log where it belongs.
 */
export function message(err: unknown): string {
  if (err instanceof ActionError) return err.message;
  const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
  console.error(`[action:${ref}]`, err);
  return `Something went wrong and the change was not saved. Quote reference ${ref} if you report this.`;
}

/** Best-effort denial record. Never blocks the refusal it is describing. */
async function recordDenial(access: Access, code: string): Promise<void> {
  const sensitive = code.startsWith("admin.") || code.endsWith(".approve") || code.endsWith(".delete") || code.endsWith(".close") || code.endsWith(".reconcile");
  if (!sensitive) return;
  try {
    await db.auditEvent.create({
      data: {
        actorId: access.session.id,
        actorName: access.session.name,
        actorRole: access.session.role,
        action: "DENIED",
        module: "ADMIN",
        summary: `Refused: ${code}`,
        changes: JSON.stringify({ permission: code, group: access.group }),
      },
    });
  } catch {
    // An audit failure must not convert a 403 into a 500.
  }
}
