/**
 * The only supported way to change a workflow status.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EVERY STATUS CHANGE SHOULD COME THROUGH HERE
 *
 * Four things have to happen together when a record moves stage, and doing them
 * in four places means one of them eventually gets forgotten:
 *
 *   1. the move must be legal for that workflow
 *   2. the caller must hold the permission that move requires
 *   3. the write must not race another user doing the same thing
 *   4. it must leave an audit row naming both states
 *
 * (3) is the one that is easy to miss. Two people opening the same vendor
 * invoice and both clicking "Approve for payment" would, with a plain update,
 * both succeed — and the second approval overwrites the first with no trace
 * that there were two. The update below is conditional on the row still being
 * in the state that was checked, so the loser gets a clear message instead of
 * silently winning.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ActionError, requireAction, requireApproval } from "@/lib/guard";
import { checkTransition, workflowFor, type Workflow } from "@/lib/workflow";
import { moduleForModel } from "@/lib/audit-models";

/** Prisma delegates keyed by model name, for the generic status update. */
type StatusDelegate = {
  findUnique: (a: { where: { id: string }; select: Record<string, boolean> }) => Promise<Record<string, unknown> | null>;
  updateMany: (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
};

function delegateFor(entity: string): StatusDelegate {
  // Prisma exposes models camel-cased: HireInvoice → db.hireInvoice
  const key = entity.charAt(0).toLowerCase() + entity.slice(1);
  const delegate = (db as unknown as Record<string, StatusDelegate>)[key];
  if (!delegate) throw new Error(`No Prisma delegate for model "${entity}" (looked for db.${key}).`);
  return delegate;
}

export type TransitionInput = {
  /** Prisma model name, e.g. "HireInvoice". */
  entity: string;
  id: string;
  to: string;
  /**
   * Rupee value of the thing being moved, when the move is an approval.
   *
   * Supplying it routes the permission check through the role's approval limit,
   * so holding `hire.approve` is not the same as being allowed to approve any
   * amount. Omit for moves that are not approvals.
   */
  amount?: number;
  /** Extra columns to write in the same statement — timestamps, actor stamps. */
  data?: Record<string, unknown>;
  /** Appended to the audit summary, e.g. a dispute reason. */
  note?: string;
};

export type TransitionResult = { from: string; to: string; label: string };

/**
 * Validates, authorises and performs a status change.
 *
 * Throws `ActionError` with a message written for the person who clicked, so a
 * caller can surface it directly.
 */
export async function transition(input: TransitionInput): Promise<TransitionResult> {
  const wf = workflowFor(input.entity);
  if (!wf) throw new Error(`${input.entity} has no workflow defined; use a normal update.`);

  const delegate = delegateFor(input.entity);

  const current = await delegate.findUnique({ where: { id: input.id }, select: { id: true, status: true } });
  if (!current) throw new ActionError("That record no longer exists.");

  const from = String(current.status ?? "");
  const check = checkTransition(wf, from, input.to);
  if (!check.ok) throw new ActionError(check.reason);

  const { permission, label } = check.transition;

  // An approval is gated by the role's rupee ceiling as well as the permission.
  const access =
    input.amount === undefined
      ? await requireAction(permission)
      : await requireApproval(permission, input.amount);

  // Conditional on the status we validated, so a concurrent change loses rather
  // than silently overwriting.
  const written = await delegate.updateMany({
    where: { id: input.id, status: from },
    data: { ...input.data, status: input.to },
  });

  if (written.count === 0) {
    throw new ActionError(
      `Somebody else changed this while you were working on it. Reload and try again.`,
    );
  }

  await audit({
    action: input.to === "APPROVED" || input.to === "PAID" ? "APPROVE" : "UPDATE",
    module: moduleForModel(input.entity),
    entity: input.entity,
    entityId: input.id,
    summary:
      `${label}: ${input.entity} moved ${from} → ${input.to}` +
      (input.note ? ` (${input.note})` : ""),
    changes: {
      status: { from, to: input.to },
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.note ? { note: input.note } : {}),
      by: access.session.name,
    },
  });

  return { from, to: input.to, label };
}

/**
 * The moves this caller can actually make on a record right now.
 *
 * For rendering buttons. It is a convenience, not a control — `transition()`
 * re-checks everything, because a disabled button is not access control.
 */
export async function availableTransitions(
  entity: string,
  status: string,
  can: (code: string) => boolean,
): Promise<{ to: string; label: string }[]> {
  const wf: Workflow | undefined = workflowFor(entity);
  if (!wf) return [];
  return wf.transitions
    .filter((t) => t.from === status && can(t.permission))
    .map((t) => ({ to: t.to, label: t.label }));
}
