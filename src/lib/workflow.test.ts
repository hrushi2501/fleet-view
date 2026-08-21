/**
 * Tests for the workflow state machines.
 *
 * Each of these is a control somebody could otherwise walk around. The schema
 * documents its legal statuses in a trailing comment, and a comment stops
 * nothing — before `workflow.ts` a plain update could move a vendor invoice
 * from RECEIVED to PAID, skipping the verification and the approval that are
 * the entire point of having stages.
 *
 * Written as statements about what the business must never allow, because a
 * skipped stage leaves a row that looks identical to one that went through it.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  checkTransition, transitionsFrom, workflowFor,
  HIRE_INVOICE, FRAUD_CASE, WORK_ORDER, FUEL_RECONCILIATION,
  ALLOCATION, MOBILIZATION, WORKFLOWS,
} from "./workflow.ts";

describe("money cannot skip its approval", () => {
  test("an invoice cannot go straight from received to paid", () => {
    const r = checkTransition(HIRE_INVOICE, "RECEIVED", "PAID");
    assert.equal(r.ok, false);
  });

  test("a verified invoice still cannot be paid without approval", () => {
    const r = checkTransition(HIRE_INVOICE, "VERIFIED", "PAID");
    assert.equal(r.ok, false);
  });

  test("the full path works", () => {
    for (const [from, to] of [["RECEIVED", "VERIFIED"], ["VERIFIED", "APPROVED"], ["APPROVED", "PAID"]]) {
      assert.equal(checkTransition(HIRE_INVOICE, from!, to!).ok, true, `${from} → ${to} should be allowed`);
    }
  });

  test("paying requires the approval permission, not the edit permission", () => {
    const approve = HIRE_INVOICE.transitions.find((t) => t.from === "APPROVED" && t.to === "PAID");
    assert.equal(approve?.permission, "hire.approve");
    const verify = HIRE_INVOICE.transitions.find((t) => t.from === "RECEIVED" && t.to === "VERIFIED");
    assert.equal(verify?.permission, "hire.edit");
  });

  test("a paid invoice is final", () => {
    for (const to of ["VERIFIED", "DISPUTED", "APPROVED", "RECEIVED"]) {
      assert.equal(checkTransition(HIRE_INVOICE, "PAID", to).ok, false, `PAID → ${to} must be refused`);
    }
  });
});

describe("a loss cannot be closed without being investigated", () => {
  test("an open case cannot jump to recovered, written off, or closed", () => {
    for (const to of ["RECOVERED", "WRITTEN_OFF", "CLOSED"]) {
      assert.equal(checkTransition(FRAUD_CASE, "OPEN", to).ok, false, `OPEN → ${to} must be refused`);
    }
  });

  test("writing off a loss needs the closing permission, not the investigating one", () => {
    // SOD_CONFLICTS names loss.investigate + loss.close as a conflict, so the
    // two halves must genuinely require different permissions.
    const writeOff = FRAUD_CASE.transitions.find((t) => t.to === "WRITTEN_OFF");
    assert.equal(writeOff?.permission, "loss.close");
    const start = FRAUD_CASE.transitions.find((t) => t.from === "OPEN" && t.to === "INVESTIGATING");
    assert.equal(start?.permission, "loss.investigate");
  });

  test("a case can be sent back for more work", () => {
    assert.equal(checkTransition(FRAUD_CASE, "PENDING_APPROVAL", "INVESTIGATING").ok, true);
  });
});

describe("work orders prove the work happened", () => {
  test("an open work order cannot be closed directly", () => {
    assert.equal(checkTransition(WORK_ORDER, "Open", "Closed").ok, false);
  });

  test("signing off the cost needs the approval permission", () => {
    const close = WORK_ORDER.transitions.find((t) => t.from === "Completed" && t.to === "Closed");
    assert.equal(close?.permission, "maintenance.approve");
  });

  test("a completed order can be reopened if the work was not really finished", () => {
    assert.equal(checkTransition(WORK_ORDER, "Completed", "In-Progress").ok, true);
  });
});

describe("a fuel gap cannot be closed by whoever found it", () => {
  test("closing needs fuel.approve while explaining needs fuel.reconcile", () => {
    const close = FUEL_RECONCILIATION.transitions.find((t) => t.to === "CLOSED");
    assert.equal(close?.permission, "fuel.approve");
    const explain = FUEL_RECONCILIATION.transitions.find((t) => t.from === "OPEN" && t.to === "EXPLAINED");
    assert.equal(explain?.permission, "fuel.reconcile");
  });

  test("an open reconciliation cannot be closed without being explained or escalated", () => {
    assert.equal(checkTransition(FUEL_RECONCILIATION, "OPEN", "CLOSED").ok, false);
  });
});

describe("equipment cannot be released from a site it never reached", () => {
  test("a planned allocation cannot be released", () => {
    assert.equal(checkTransition(ALLOCATION, "PLANNED", "RELEASED").ok, false);
  });

  test("an active allocation can be released", () => {
    assert.equal(checkTransition(ALLOCATION, "ACTIVE", "RELEASED").ok, true);
  });

  test("a machine cannot arrive without being despatched", () => {
    assert.equal(checkTransition(MOBILIZATION, "APPROVED", "ARRIVED").ok, false);
    assert.equal(checkTransition(MOBILIZATION, "IN_TRANSIT", "ARRIVED").ok, true);
  });
});

describe("refusals explain what to do instead", () => {
  test("an illegal move lists the moves that are available", () => {
    const r = checkTransition(HIRE_INVOICE, "RECEIVED", "PAID");
    assert.equal(r.ok, false);
    if (r.ok) return;
    // "invalid status" tells the person nothing; the message must name a way forward.
    assert.match(r.reason, /Verify against hire logs/);
    assert.match(r.reason, /RECEIVED/);
  });

  test("an unknown status is named rather than silently ignored", () => {
    const r = checkTransition(HIRE_INVOICE, "RECEIVED", "TOTALLY_MADE_UP");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /not a valid status/);
  });

  test("moving to the state it is already in is refused clearly", () => {
    const r = checkTransition(HIRE_INVOICE, "VERIFIED", "VERIFIED");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /already/);
  });
});

describe("the machines are internally consistent", () => {
  test("every transition references states the workflow declares", () => {
    for (const wf of WORKFLOWS) {
      for (const t of wf.transitions) {
        assert.ok(wf.states.includes(t.from), `${wf.entity}: unknown from-state ${t.from}`);
        assert.ok(wf.states.includes(t.to), `${wf.entity}: unknown to-state ${t.to}`);
      }
      assert.ok(wf.states.includes(wf.initial), `${wf.entity}: initial state is not declared`);
    }
  });

  test("nothing can leave a terminal state", () => {
    for (const wf of WORKFLOWS) {
      for (const terminal of wf.terminal) {
        assert.equal(transitionsFrom(wf, terminal).length, 0, `${wf.entity}: ${terminal} has a way out`);
      }
    }
  });

  test("every non-terminal state can be left", () => {
    // A state with no exit is a record stuck forever with no error explaining why.
    for (const wf of WORKFLOWS) {
      for (const state of wf.states) {
        if (wf.terminal.includes(state)) continue;
        assert.ok(transitionsFrom(wf, state).length > 0, `${wf.entity}: ${state} is a dead end`);
      }
    }
  });

  test("every transition names a permission", () => {
    for (const wf of WORKFLOWS) {
      for (const t of wf.transitions) {
        assert.ok(t.permission, `${wf.entity}: ${t.from} → ${t.to} has no permission`);
      }
    }
  });

  test("lookup finds a workflow by model name and not by accident", () => {
    assert.equal(workflowFor("HireInvoice")?.entity, "HireInvoice");
    // Asset.status is a label a person picks, not a staged process.
    assert.equal(workflowFor("Asset"), undefined);
  });
});
