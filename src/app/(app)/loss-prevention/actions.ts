"use server";

import { db } from "@/lib/db";
import { boundedNumber, nonNegativeNumber, oneOf, safeParseDate, sanitizeString, sanitizeOptionalString } from "@/lib/input-validation";
import { fuelAnomalyScope, recordScope, assertGlobalAccess, assertFormAccess, assertRecordAccess } from "@/lib/record-access";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { scanSignals, DEFAULT_RULES, nextCaseNo, type RuleLite, type ScanInput } from "@/lib/loss-prevention";
import { requireAction, ActionError, safe } from "@/lib/guard";
import { transition } from "@/lib/transition";

const s = (fd: FormData, k: string) => sanitizeString(fd.get(k), k);
const sOrNull = (fd: FormData, k: string) => sanitizeOptionalString(fd.get(k), k);

function refresh(id?: string) {
  revalidatePath("/loss-prevention");
  if (id) revalidatePath(`/loss-prevention/${id}`);
}

/* ---------------------------------- rules ---------------------------------- */

/** Installs the shipped rule library. Safe to call repeatedly. */
async function seedRules__impl() {
  const scopeAccess = await requireAction("admin.settings");
  assertGlobalAccess(scopeAccess);
  for (const r of DEFAULT_RULES) {
    await db.controlRule.upsert({
      where: { code: r.code },
      create: { code: r.code, name: r.name, domain: r.domain, description: r.description, severity: r.severity, threshold: r.threshold, thresholdUnit: r.thresholdUnit || null },
      update: { name: r.name, description: r.description },
    });
  }
  refresh();
}

async function updateRule__impl(id: string, fd: FormData) {
  const scopeAccess = await requireAction("admin.settings");
  await assertFormAccess(scopeAccess, fd);
  assertGlobalAccess(scopeAccess);
  const threshold = nonNegativeNumber(fd.get("threshold"), "Threshold", { max: 100_000_000, fallback: 0 });
  const severity = oneOf(s(fd, "severity") || "MEDIUM", ["CRITICAL", "HIGH", "MEDIUM", "LOW"], "Severity");
  await db.controlRule.update({
    where: { id },
    data: {
      threshold,
      severity,
      enabled: fd.get("enabled") === "on" || fd.get("enabled") === "true",
      autoCase: fd.get("autoCase") === "on" || fd.get("autoCase") === "true",
    },
  });
  refresh();
}

/* ---------------------------------- scan ---------------------------------- */

/**
 * Pull signals from every module and open or refresh a case for each.
 * Idempotent via `signalKey`, so it's safe to run on a schedule or on demand.
 */
async function runScan__impl() {
  const scopeAccess = await requireAction("loss.investigate");
  assertGlobalAccess(scopeAccess);
  const session = await getSession();

  let rules = await db.controlRule.findMany();
  if (rules.length === 0) {
    await seedRules__impl();
    rules = await db.controlRule.findMany();
  }
  const ruleLites: RuleLite[] = rules.map((r) => ({ code: r.code, enabled: r.enabled, threshold: r.threshold, severity: r.severity, autoCase: r.autoCase }));

  const [fuelAnomalies, hiredAssets, contracts, fuelTxns, compliance] = await Promise.all([
    db.fuelAnomaly.findMany(),
    db.asset.findMany({ where: { ownershipType: { in: ["HIRED", "CONTRACTOR"] } }, select: { id: true, code: true, name: true, registrationNo: true } }),
    db.hireContract.findMany({ where: { status: "Active" }, select: { assetId: true } }),
    db.fuelTransaction.findMany({ where: { type: "ISSUE" }, include: { asset: { select: { code: true } } }, orderBy: { date: "asc" } }),
    db.complianceDoc.findMany({ include: { asset: { select: { id: true, code: true, status: true } } } }),
  ]);

  const contracted = new Set(contracts.map((c) => c.assetId));
  const uncontractedHired = hiredAssets.filter((a) => !contracted.has(a.id));

  // Meter rollbacks: walk each asset's fuel entries in date order.
  const byAsset = new Map<string, typeof fuelTxns>();
  for (const t of fuelTxns) {
    if (!t.assetId) continue;
    const arr = byAsset.get(t.assetId) ?? [];
    arr.push(t);
    byAsset.set(t.assetId, arr);
  }
  const meterRollbacks: ScanInput["meterRollbacks"] = [];
  for (const [assetId, txns] of byAsset) {
    for (let i = 1; i < txns.length; i++) {
      const prev = txns[i - 1], cur = txns[i];
      if (prev.meterValue > 0 && cur.meterValue > 0 && cur.meterValue < prev.meterValue) {
        meterRollbacks.push({ assetId, assetCode: cur.asset?.code ?? "—", txnId: cur.id, from: prev.meterValue, to: cur.meterValue, date: cur.date });
      }
    }
  }

  // Fuel issues with neither photo, grouped per asset.
  const noEvidenceMap = new Map<string, { assetId: string | null; assetCode: string; count: number; litres: number; amount: number }>();
  for (const t of fuelTxns) {
    if (t.odometerPhoto || t.pumpPhoto) continue;
    const key = t.assetId ?? "unassigned";
    const cur = noEvidenceMap.get(key) ?? { assetId: t.assetId, assetCode: t.asset?.code ?? "Unassigned", count: 0, litres: 0, amount: 0 };
    cur.count++; cur.litres += t.quantity; cur.amount += t.amount;
    noEvidenceMap.set(key, cur);
  }

  const expiredRunning = compliance
    .filter((c) => c.expiryDate < new Date() && c.asset && c.asset.status !== "Off-hired" && c.asset.status !== "Idle")
    .map((c) => ({ assetId: c.asset!.id, assetCode: c.asset!.code, docType: c.docType, expiry: c.expiryDate }));

  const signals = scanSignals({
    rules: ruleLites,
    fuelAnomalies: fuelAnomalies.map((a) => ({ id: a.id, source: a.source, severity: a.severity, score: a.score, litres: a.litres, valueAtRisk: a.valueAtRisk, reasons: a.reasons, status: a.status, tankId: a.tankId, assetId: a.assetId })),
    uncontractedHired,
    meterRollbacks,
    noEvidenceFuel: [...noEvidenceMap.values()],
    expiredRunning,
  });

  const year = new Date().getFullYear();
  let created = 0, updated = 0;

  for (const sig of signals) {
    const rule = ruleLites.find((r) => r.code === sig.ruleCode);
    if (rule && !rule.autoCase) continue;

    const existing = await db.fraudCase.findUnique({ where: { signalKey: sig.signalKey } });
    if (existing) {
      // Never reopen something a human already dispositioned.
      if (["FALSE_POSITIVE", "CLOSED", "RECOVERED", "WRITTEN_OFF"].includes(existing.status)) continue;
      await db.fraudCase.update({
        where: { id: existing.id },
        data: { score: sig.score, severity: sig.severity, amountAtRisk: sig.amountAtRisk, summary: sig.summary, title: sig.title },
      });
      updated++;
      continue;
    }

    const seq = await db.fraudCase.count();
    const created_ = await db.fraudCase.create({
      data: {
        caseNo: nextCaseNo(year, seq),
        title: sig.title,
        domain: sig.domain,
        ruleCode: sig.ruleCode,
        severity: sig.severity,
        score: sig.score,
        amountAtRisk: sig.amountAtRisk,
        assetId: sig.assetId ?? null,
        driverId: sig.driverId ?? null,
        vendor: sig.vendor ?? null,
        projectId: sig.projectId ?? null,
        summary: sig.summary,
        signalKey: sig.signalKey,
        openedBy: session?.name ?? "System scan",
        evidence: {
          create: sig.evidence.map((e) => ({ kind: e.kind, refId: e.refId ?? null, label: e.label, detail: e.detail ?? null, url: e.url ?? null, addedBy: "System scan" })),
        },
        actions: {
          create: [{ action: "OPENED", note: `Auto-opened by rule ${sig.ruleCode}`, by: session?.name ?? "System scan" }],
        },
      },
    });
    if (created_) created++;
  }

  // Rule hit counts, for the "is this rule earning its keep" question.
  for (const r of rules) {
    const hits = signals.filter((x) => x.ruleCode === r.code).length;
    if (hits !== r.hits) await db.controlRule.update({ where: { id: r.id }, data: { hits } });
  }

  refresh();
  return { ok: true as const, signals: signals.length, created, updated };
}

/* ---------------------------------- cases ---------------------------------- */

async function createCase__impl(fd: FormData) {
  const scopeAccess = await requireAction("loss.investigate");
  await assertFormAccess(scopeAccess, fd);
  const session = await getSession();
  const seq = await db.fraudCase.count();
  const title = s(fd, "title");
  if (!title) throw new ActionError("Case title is required");

  const domain = oneOf(s(fd, "domain") || "FUEL", ["FUEL", "FLEET", "MAINTENANCE", "OPERATIONS", "COMPLIANCE", "OTHER"], "Domain");
  const severity = oneOf(s(fd, "severity") || "MEDIUM", ["CRITICAL", "HIGH", "MEDIUM", "LOW"], "Severity");
  const score = boundedNumber(fd.get("score"), "Score", { min: 0, max: 100, integer: true, fallback: 0 });
  const amountAtRisk = nonNegativeNumber(fd.get("amountAtRisk"), "Amount at risk", { max: 100_000_000_000, fallback: 0 });
  const dueDate = safeParseDate(fd.get("dueDate"), "Due date");

  const c = await db.fraudCase.create({
    data: {
      caseNo: nextCaseNo(new Date().getFullYear(), seq),
      title,
      domain,
      severity,
      score,
      amountAtRisk,
      assetId: sOrNull(fd, "assetId"),
      driverId: sOrNull(fd, "driverId"),
      vendor: sOrNull(fd, "vendor"),
      summary: sOrNull(fd, "summary"),
      assignedTo: sOrNull(fd, "assignedTo"),
      dueDate,
      openedBy: session?.name ?? null,
      actions: { create: [{ action: "OPENED", note: "Opened manually", by: session?.name ?? null }] },
    },
  });
  refresh(c.id);
  return c.id;
}

/**
 * Edit a case, and optionally move it to a new stage.
 *
 * The two halves are deliberately separated. Editing the assignee or root cause
 * is investigation work (`loss.investigate`). *Closing* a case — recording a
 * recovery, writing the loss off — is `loss.close`, and `SOD_CONFLICTS` names
 * holding both as a conflict: "can investigate a case and close it without
 * review". This action used to take whatever status the form posted after a
 * single `loss.investigate` check, so an investigator could close their own
 * case and the segregation existed only on paper.
 */
async function updateCase__impl(id: string, fd: FormData) {
  const scopeAccess = await requireAction("loss.investigate");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "fraudCase", id);
  const session = await getSession();
  const status = s(fd, "status");
  const prev = await db.fraudCase.findUnique({ where: { id }, select: { status: true } });
  if (!prev) throw new ActionError("That case no longer exists.");

  const dueDate = safeParseDate(fd.get("dueDate"), "Due date");

  // Field edits are investigation work and are allowed at this permission.
  await db.fraudCase.update({
    where: { id },
    data: {
      assignedTo: sOrNull(fd, "assignedTo"),
      rootCause: sOrNull(fd, "rootCause"),
      disposition: sOrNull(fd, "disposition"),
      dueDate,
    },
  });

  // The stage change is a separate control, with its own permission per move.
  if (status && status !== prev.status) {
    const closing = ["RECOVERED", "WRITTEN_OFF", "FALSE_POSITIVE", "CLOSED"].includes(status);
    await transition({
      entity: "FraudCase",
      id,
      to: status,
      data: closing ? { closedAt: new Date() } : {},
    });

    await db.caseAction.create({
      data: { caseId: id, action: "STATUS_CHANGE", note: `${prev.status} → ${status}`, by: session?.name ?? null },
    });
  }

  refresh(id);
}

async function addNote__impl(id: string, fd: FormData) {
  const scopeAccess = await requireAction("loss.investigate");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "fraudCase", id);
  const session = await getSession();
  const note = s(fd, "note");
  if (!note) return;
  await db.caseAction.create({ data: { caseId: id, action: "NOTE", note, by: session?.name ?? null } });
  refresh(id);
}

async function addEvidence__impl(id: string, fd: FormData) {
  const scopeAccess = await requireAction("loss.investigate");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "fraudCase", id);
  const session = await getSession();
  await db.caseEvidence.create({
    data: {
      caseId: id,
      kind: s(fd, "kind") || "NOTE",
      label: s(fd, "label"),
      detail: sOrNull(fd, "detail"),
      url: sOrNull(fd, "url"),
      addedBy: session?.name ?? null,
    },
  });
  await db.caseAction.create({ data: { caseId: id, action: "EVIDENCE_ADDED", note: s(fd, "label"), by: session?.name ?? null } });
  refresh(id);
}

/** Records money actually clawed back and rolls it up onto the case. */
async function addRecovery__impl(id: string, fd: FormData) {
  const scopeAccess = await requireAction("loss.close");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "fraudCase", id);
  const session = await getSession();
  const amount = nonNegativeNumber(fd.get("amount"), "Recovery amount", { max: 100_000_000, fallback: 0 });
  if (amount <= 0) return;

  const method = oneOf(
    s(fd, "method") || "CASH",
    ["CASH", "SALARY_DEDUCTION", "VENDOR_DEBIT", "INSURANCE", "LEGAL", "OTHER"],
    "Recovery method"
  );
  const date = safeParseDate(fd.get("date"), "Recovery date") ?? new Date();

  await db.caseRecovery.create({
    data: {
      caseId: id,
      amount,
      method,
      reference: sOrNull(fd, "reference"),
      note: sOrNull(fd, "note"),
      by: session?.name ?? null,
      date,
    },
  });

  const total = await db.caseRecovery.aggregate({ where: { caseId: id }, _sum: { amount: true } });
  await db.fraudCase.update({ where: { id }, data: { amountRecovered: total._sum.amount ?? 0 } });
  await db.caseAction.create({
    data: { caseId: id, action: "RECOVERY", note: `₹${amount.toLocaleString("en-IN")} via ${method}`, by: session?.name ?? null },
  });
  refresh(id);
}

async function deleteCase__impl(id: string) {
  const scopeAccess = await requireAction("loss.close");
  await assertRecordAccess(scopeAccess, "fraudCase", id);
  await db.fraudCase.delete({ where: { id } });
  revalidatePath("/loss-prevention");
}

/* ----------------------------- fraud intelligence ----------------------------- */

export type FuelTheftSignal = {
  id: string;
  assetCode: string;
  source: string;
  litres: number;
  valueAtRisk: number;
  severity: string;
  reasons: string;
  status: string;
};

export type MeterRollbackSignal = {
  assetCode: string;
  from: number;
  to: number;
  drop: number;
  date: string;
};

/**
 * Fetches fuel theft signals and meter rollback anomalies for the
 * consolidated fraud intelligence panel on the Loss Prevention page.
 */
export async function getFraudIntelligence() {
  const access = await requireAction("loss.view");
  const anomalyScope = await fuelAnomalyScope(access);
  const [anomalies, fuelTxns, assets, tanks] = await Promise.all([
    db.fuelAnomaly.findMany({
      where: { ...anomalyScope, status: { in: ["OPEN", "INVESTIGATING"] } },
      orderBy: { valueAtRisk: "desc" },
      take: 20,
    }),
    db.fuelTransaction.findMany({
      where: { type: "ISSUE", ...recordScope("fuelTransaction", access) },
      include: { asset: { select: { code: true } } },
      orderBy: { date: "asc" },
    }),
    db.asset.findMany({ where: recordScope("asset", access), select: { id: true, code: true } }),
    db.fuelTank.findMany({ where: recordScope("fuelTank", access), select: { id: true, name: true } }),
  ]);

  const assetMap = new Map(assets.map((a) => [a.id, a.code]));
  const tankMap = new Map(tanks.map((t) => [t.id, t.name]));

  const fuelTheftSignals: FuelTheftSignal[] = anomalies.map((a) => ({
    id: a.id,
    assetCode: (a.assetId ? assetMap.get(a.assetId) : null) ?? (a.tankId ? tankMap.get(a.tankId) : null) ?? "Unknown",
    source: a.source,
    litres: a.litres,
    valueAtRisk: a.valueAtRisk,
    severity: a.severity,
    reasons: a.reasons,
    status: a.status,
  }));

  // Detect meter rollbacks: walk each asset's fuel entries in date order
  const byAsset = new Map<string, typeof fuelTxns>();
  for (const t of fuelTxns) {
    if (!t.assetId) continue;
    const arr = byAsset.get(t.assetId) ?? [];
    arr.push(t);
    byAsset.set(t.assetId, arr);
  }

  const meterRollbacks: MeterRollbackSignal[] = [];
  for (const [, txns] of byAsset) {
    for (let i = 1; i < txns.length; i++) {
      const prev = txns[i - 1], cur = txns[i];
      if (prev.meterValue > 0 && cur.meterValue > 0 && cur.meterValue < prev.meterValue) {
        meterRollbacks.push({
          assetCode: cur.asset?.code ?? "—",
          from: prev.meterValue,
          to: cur.meterValue,
          drop: prev.meterValue - cur.meterValue,
          date: cur.date.toISOString(),
        });
      }
    }
  }

  const totalFuelAtRisk = fuelTheftSignals.reduce((s, a) => s + a.valueAtRisk, 0);
  const totalLitresAtRisk = fuelTheftSignals.reduce((s, a) => s + a.litres, 0);

  return {
    fuelTheftSignals,
    meterRollbacks: meterRollbacks.slice(0, 15),
    totalFuelAtRisk,
    totalLitresAtRisk,
    rollbackCount: meterRollbacks.length,
  };
}

/* ---------------------------------------------------------------------------
 * Exported actions.
 *
 * Wrapped in `safe()` so an `ActionError` comes back as `{ error }` instead of
 * being thrown — Next redacts thrown messages in production builds, which made
 * every validation message in this file invisible to the person who triggered
 * it. Return values are passed through untouched.
 * ------------------------------------------------------------------------- */
export const seedRules = safe(seedRules__impl);
export const updateRule = safe(updateRule__impl);
export const runScan = safe(runScan__impl);
export const createCase = safe(createCase__impl);
export const updateCase = safe(updateCase__impl);
export const addNote = safe(addNote__impl);
export const addEvidence = safe(addEvidence__impl);
export const addRecovery = safe(addRecovery__impl);
export const deleteCase = safe(deleteCase__impl);
