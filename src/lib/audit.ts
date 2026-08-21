/**
 * The audit trail.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The `AuditEvent` model and the Admin → Audit screen were already here, and
 * the screen says "append-only record of who did what". It was not one. Of the
 * two hundred and ten database writes in this application, four wrote an audit
 * row: two cost entries, one admin action, one export. Signing in was not
 * recorded at all, even though the log renders a `LOGIN` badge.
 *
 * The helper existed but lived inside `app/(app)/admin/actions.ts`, a
 * `"use server"` module. Importing anything from such a file makes the importer
 * treat every export as a server action, so it could not be reused — which is
 * why it never was. Moving it into `lib` is most of the fix.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE
 *
 * Nothing in this application updates or deletes an `AuditEvent`. That
 * convention is the whole value of the table: a log that can be edited answers
 * no question an auditor is asking. If a record is wrong, the correction is a
 * new row, not an edit.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { headers } from "next/headers";
import { recordSystemAudit } from "@/lib/audit-writer";
import { getSession } from "@/lib/auth";

/** What happened. Matches the badge map on the audit screen. */
export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "UPSERT"
  | "DELETE"
  | "APPROVE"
  | "REJECT"
  | "LOGIN"
  | "LOGOUT"
  | "EXPORT"
  | "CONFIG"
  | "DENIED";

export type AuditInput = {
  action: AuditAction;
  /** FUEL | HIRE | MAINTENANCE | COMPLIANCE | ADMIN | COST | PEOPLE | FLEET | ... */
  module: string;
  /** One line a non-technical person can read months later. */
  summary: string;
  /** Prisma model name, when the event concerns one record. */
  entity?: string;
  entityId?: string;
  /** Anything worth keeping — usually a `diff()` result. */
  changes?: unknown;
};

/**
 * Appends one audit row.
 *
 * Deliberately best-effort: a failure to write the log must never roll back or
 * block the business action that succeeded. Losing an audit row is bad; losing
 * a fuel issue because the audit table was briefly unreachable is worse, and
 * the failure is loud in the platform log either way.
 *
 * Call it *after* the write it describes, so a rejected write leaves no trace
 * suggesting it happened.
 */
export async function audit(input: AuditInput): Promise<void> {
  const session = await getSession().catch(() => null);
  await recordSystemAudit({
    action: input.action,
    module: input.module,
    summary: input.summary,
    entity: input.entity,
    entityId: input.entityId,
    changes: input.changes,
    actor: session ? { id: session.id, name: session.name, role: session.role } : null,
    ip: await callerIp(),
  });
}

/**
 * Records an event for a caller already resolved by the guard.
 *
 * Saves a second session lookup on the hot path of every mutation, and works in
 * contexts where the actor is known but no cookie is present.
 */
export async function auditAs(
  actor: { id: string; name: string; role: string } | null,
  input: AuditInput,
): Promise<void> {
  await recordSystemAudit({
    action: input.action,
    module: input.module,
    summary: input.summary,
    entity: input.entity,
    entityId: input.entityId,
    changes: input.changes,
    actor,
    ip: await callerIp(),
  });
}

/**
 * Field-level difference between two versions of a record.
 *
 * "Updated the contract" is not an audit trail. "Changed dayRate from 18,000 to
 * 24,000" is the sentence that settles a dispute, so the log stores both sides
 * of every field that actually moved.
 *
 * Only changed keys are kept — storing a full before/after of a wide row makes
 * the meaningful change impossible to find.
 */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, { from: unknown; to: unknown }> | undefined {
  if (!before || !after) return undefined;
  const out: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = normalise(before[key]);
    const b = normalise(after[key]);
    if (a === b) continue;
    out[key] = { from: before[key] ?? null, to: after[key] ?? null };
  }

  return Object.keys(out).length ? out : undefined;
}

/** Dates and Decimals compare as objects otherwise, so every save looks like a change. */
function normalise(v: unknown): unknown {
  if (v instanceof Date) return v.getTime();
  if (v && typeof v === "object" && "toString" in v) return String(v);
  return v;
}

/**
 * The caller's IP, as far as it can be trusted.
 *
 * Behind Vercel's proxy the socket address is the proxy, so the left-most entry
 * of `x-forwarded-for` is the closest thing to the client. It is client-supplied
 * and therefore spoofable — recorded as a supporting detail, never as identity.
 */
async function callerIp(): Promise<string | null> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim() || null;
    return h.get("x-real-ip");
  } catch {
    // Outside a request scope — cron, worker, test.
    return null;
  }
}
