/**
 * State machines for the records that move through a process.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Every workflow in this schema is a `String` column with its legal values
 * written in a comment beside it:
 *
 *     status String @default("RECEIVED") // RECEIVED | VERIFIED | DISPUTED | APPROVED | PAID
 *
 * A comment stops nothing. `db.hireInvoice.update({ data: { status: "PAID" } })`
 * moves a vendor invoice straight from RECEIVED to PAID, skipping the
 * verification and the approval that are the entire control — and it leaves a
 * record that looks exactly like one that went through them. The same applies
 * to closing a fraud case without investigating it, or releasing an allocation
 * that was never active.
 *
 * So the legal moves live here as data, in one place, next to who is allowed to
 * make each one. The comment in the schema stays as documentation; this is the
 * thing that actually holds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT MODELLED
 *
 * Only workflows where an invalid jump has a real consequence — money, recovery,
 * or a compliance claim. `Asset.status` and `Attendance.status` are labels a
 * person picks, not stages with an order, and forcing a machine onto them would
 * add ceremony without adding a control.
 *
 * `ComplianceDoc.status` and `Alert.status` are excluded for a different reason:
 * both are recomputed by sweeps from the underlying facts (an expiry date, a
 * live condition), so they are derived values rather than decisions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Transition = {
  from: string;
  to: string;
  /** Permission code required to make this move. */
  permission: string;
  /** What a person would call this action, used in errors and the audit line. */
  label: string;
};

export type Workflow = {
  /** Prisma model name. */
  entity: string;
  initial: string;
  states: readonly string[];
  /** States nothing may leave. */
  terminal: readonly string[];
  transitions: readonly Transition[];
};

/**
 * Vendor invoices. The one that matters most — this is money leaving.
 *
 * RECEIVED → VERIFIED → APPROVED → PAID is the control: somebody checks the
 * invoice against the hire logs, somebody else with an approval limit approves
 * it, and only then can it be paid. DISPUTED is reachable from either of the
 * first two and returns to VERIFIED once settled.
 *
 * There is deliberately no RECEIVED → PAID and no VERIFIED → PAID.
 */
export const HIRE_INVOICE: Workflow = {
  entity: "HireInvoice",
  initial: "RECEIVED",
  states: ["RECEIVED", "VERIFIED", "DISPUTED", "APPROVED", "PAID"],
  terminal: ["PAID"],
  transitions: [
    { from: "RECEIVED", to: "VERIFIED", permission: "hire.edit", label: "Verify against hire logs" },
    { from: "RECEIVED", to: "DISPUTED", permission: "hire.edit", label: "Raise a dispute" },
    { from: "VERIFIED", to: "DISPUTED", permission: "hire.edit", label: "Raise a dispute" },
    { from: "DISPUTED", to: "VERIFIED", permission: "hire.edit", label: "Settle the dispute" },
    { from: "VERIFIED", to: "APPROVED", permission: "hire.approve", label: "Approve for payment" },
    { from: "APPROVED", to: "PAID", permission: "hire.approve", label: "Record payment" },
    // An approval can be withdrawn while the money has not moved.
    { from: "APPROVED", to: "VERIFIED", permission: "hire.approve", label: "Withdraw approval" },
  ],
};

/**
 * Loss-prevention cases.
 *
 * A case cannot be closed straight from OPEN: something has to have been
 * investigated before it is written off or dismissed, because "closed without
 * investigation" and "investigated and found harmless" are the same row
 * otherwise. Writing off a loss needs the same permission as closing one.
 */
export const FRAUD_CASE: Workflow = {
  entity: "FraudCase",
  initial: "OPEN",
  states: ["OPEN", "INVESTIGATING", "PENDING_APPROVAL", "RECOVERED", "WRITTEN_OFF", "FALSE_POSITIVE", "CLOSED"],
  terminal: ["CLOSED"],
  transitions: [
    { from: "OPEN", to: "INVESTIGATING", permission: "loss.investigate", label: "Start investigating" },
    { from: "OPEN", to: "FALSE_POSITIVE", permission: "loss.investigate", label: "Mark a false positive" },
    { from: "INVESTIGATING", to: "FALSE_POSITIVE", permission: "loss.investigate", label: "Mark a false positive" },
    { from: "INVESTIGATING", to: "PENDING_APPROVAL", permission: "loss.investigate", label: "Send for approval" },
    { from: "PENDING_APPROVAL", to: "RECOVERED", permission: "loss.close", label: "Record recovery" },
    { from: "PENDING_APPROVAL", to: "WRITTEN_OFF", permission: "loss.close", label: "Write off the loss" },
    { from: "PENDING_APPROVAL", to: "INVESTIGATING", permission: "loss.investigate", label: "Send back for more work" },
    { from: "RECOVERED", to: "CLOSED", permission: "loss.close", label: "Close the case" },
    { from: "WRITTEN_OFF", to: "CLOSED", permission: "loss.close", label: "Close the case" },
    { from: "FALSE_POSITIVE", to: "CLOSED", permission: "loss.close", label: "Close the case" },
  ],
};

/**
 * Work orders. Guards the spend: a work order cannot be closed without having
 * been completed, so "closed" always means the work happened.
 */
export const WORK_ORDER: Workflow = {
  entity: "WorkOrder",
  initial: "Open",
  states: ["Open", "In-Progress", "Completed", "Closed", "Cancelled"],
  terminal: ["Closed", "Cancelled"],
  transitions: [
    { from: "Open", to: "In-Progress", permission: "maintenance.edit", label: "Start work" },
    { from: "Open", to: "Cancelled", permission: "maintenance.edit", label: "Cancel" },
    { from: "In-Progress", to: "Completed", permission: "maintenance.edit", label: "Mark complete" },
    { from: "In-Progress", to: "Cancelled", permission: "maintenance.edit", label: "Cancel" },
    // Closing signs off the cost, so it sits with whoever approves spend.
    { from: "Completed", to: "Closed", permission: "maintenance.approve", label: "Sign off and close" },
    { from: "Completed", to: "In-Progress", permission: "maintenance.edit", label: "Reopen — work not finished" },
  ],
};

/**
 * Fuel reconciliation. ESCALATED exists so a gap that cannot be explained
 * becomes somebody's problem rather than being closed quietly.
 */
export const FUEL_RECONCILIATION: Workflow = {
  entity: "FuelReconciliation",
  initial: "OPEN",
  states: ["OPEN", "EXPLAINED", "ESCALATED", "CLOSED"],
  terminal: ["CLOSED"],
  transitions: [
    { from: "OPEN", to: "EXPLAINED", permission: "fuel.reconcile", label: "Record an explanation" },
    { from: "OPEN", to: "ESCALATED", permission: "fuel.reconcile", label: "Escalate the gap" },
    { from: "EXPLAINED", to: "ESCALATED", permission: "fuel.reconcile", label: "Escalate the gap" },
    { from: "ESCALATED", to: "EXPLAINED", permission: "fuel.reconcile", label: "Record an explanation" },
    { from: "EXPLAINED", to: "CLOSED", permission: "fuel.approve", label: "Accept and close" },
    { from: "ESCALATED", to: "CLOSED", permission: "fuel.approve", label: "Accept and close" },
  ],
};

/** Equipment allocations to a site. */
export const ALLOCATION: Workflow = {
  entity: "Allocation",
  initial: "PLANNED",
  states: ["PLANNED", "ACTIVE", "RELEASED", "CANCELLED"],
  terminal: ["RELEASED", "CANCELLED"],
  transitions: [
    { from: "PLANNED", to: "ACTIVE", permission: "production.edit", label: "Mobilise to site" },
    { from: "PLANNED", to: "CANCELLED", permission: "production.edit", label: "Cancel" },
    // Only something that was actually on site can be released from it.
    { from: "ACTIVE", to: "RELEASED", permission: "production.edit", label: "Release from site" },
  ],
};

/** Moving a machine between sites. */
export const MOBILIZATION: Workflow = {
  entity: "MobilizationOrder",
  initial: "REQUESTED",
  states: ["REQUESTED", "APPROVED", "IN_TRANSIT", "ARRIVED", "CANCELLED"],
  terminal: ["ARRIVED", "CANCELLED"],
  transitions: [
    { from: "REQUESTED", to: "APPROVED", permission: "production.edit", label: "Approve the move" },
    { from: "REQUESTED", to: "CANCELLED", permission: "production.edit", label: "Cancel" },
    { from: "APPROVED", to: "IN_TRANSIT", permission: "production.edit", label: "Despatch" },
    { from: "APPROVED", to: "CANCELLED", permission: "production.edit", label: "Cancel" },
    { from: "IN_TRANSIT", to: "ARRIVED", permission: "production.edit", label: "Confirm arrival" },
  ],
};

/** Driver violations. */
export const VIOLATION: Workflow = {
  entity: "Violation",
  initial: "OPEN",
  states: ["OPEN", "ACTIONED", "DISMISSED"],
  terminal: ["ACTIONED", "DISMISSED"],
  transitions: [
    { from: "OPEN", to: "ACTIONED", permission: "people.discipline", label: "Record the action taken" },
    { from: "OPEN", to: "DISMISSED", permission: "people.discipline", label: "Dismiss" },
  ],
};

export const WORKFLOWS: readonly Workflow[] = [
  HIRE_INVOICE, FRAUD_CASE, WORK_ORDER, FUEL_RECONCILIATION,
  ALLOCATION, MOBILIZATION, VIOLATION,
];

/** The machine for a model, or undefined when its status is a free label. */
export function workflowFor(entity: string): Workflow | undefined {
  return WORKFLOWS.find((w) => w.entity === entity);
}

export type TransitionCheck =
  | { ok: true; transition: Transition }
  | { ok: false; reason: string };

/**
 * Whether a move is legal, ignoring who is asking.
 *
 * Errors name the states involved and what *is* possible from here, because
 * "invalid status" tells the person nothing about what to do next.
 */
export function checkTransition(wf: Workflow, from: string, to: string): TransitionCheck {
  if (from === to) return { ok: false, reason: `This is already ${to}.` };

  if (!wf.states.includes(to)) {
    return { ok: false, reason: `"${to}" is not a valid status for ${wf.entity}.` };
  }
  if (wf.terminal.includes(from)) {
    return { ok: false, reason: `This is ${from} and cannot be changed further.` };
  }

  const transition = wf.transitions.find((t) => t.from === from && t.to === to);
  if (!transition) {
    const options = wf.transitions.filter((t) => t.from === from);
    const list = options.length
      ? options.map((t) => `${t.label} (→ ${t.to})`).join(", ")
      : "nothing";
    return { ok: false, reason: `Cannot go from ${from} to ${to}. From ${from} you can: ${list}.` };
  }

  return { ok: true, transition };
}

/** Moves available from a state, for rendering only the buttons that will work. */
export function transitionsFrom(wf: Workflow, from: string): Transition[] {
  if (wf.terminal.includes(from)) return [];
  return wf.transitions.filter((t) => t.from === from);
}
