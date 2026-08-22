/**
 * Audit-by-default for business writes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY AN EXTENSION RATHER THAN A CALL AT EVERY WRITE
 *
 * This application had 210 database writes and 4 audit rows. The helper to
 * write one existed; people simply did not call it, which is what happens to
 * any convention that depends on remembering. The four modules where money
 * actually moves — fuel, cost, hire, loss prevention — had zero coverage
 * between them.
 *
 * Making it structural fixes the class of bug instead of the instances: a new
 * action written next year is audited because it wrote to the database, not
 * because its author remembered a rule.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS NOT
 *
 * It is a floor, not a replacement for a written summary. "Updated HireContract
 * cmx…" is enough to prove *that* something changed and by whom; it is not the
 * sentence that settles a dispute. Where an action already writes an explicit
 * `audit()` call with a real summary — "Changed dayRate from 18,000 to 24,000"
 * — that row is the useful one and this adds the machine-readable twin beside
 * it. Keep writing the good summaries.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FAILURE POSTURE
 *
 * Recording is best-effort and never rethrows. Losing an audit row is bad;
 * failing a fuel issue because the audit insert timed out is worse, and this
 * runs against a live client system. Failures are logged loudly instead.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Prisma } from "@prisma/client";
import { auditableModel, moduleForModel } from "./audit-models";

/** Operations that change data. Reads pass straight through untouched. */
const WRITE_OPS = new Set([
  "create", "createMany", "createManyAndReturn",
  "update", "updateMany", "upsert",
  "delete", "deleteMany",
]);

/** Maps a Prisma operation onto the audit vocabulary the log already uses. */
function actionFor(op: string): string {
  if (op.startsWith("create")) return "CREATE";
  if (op === "upsert") return "UPSERT";
  if (op.startsWith("update")) return "UPDATE";
  return "DELETE";
}

/**
 * A record id from the operation's arguments, when there is exactly one.
 *
 * `updateMany`/`deleteMany` touch a set, so there is no single id to record —
 * the summary carries the count instead.
 */
function idFrom(args: unknown): string | undefined {
  const where = (args as { where?: Record<string, unknown> } | undefined)?.where;
  const id = where?.id;
  return typeof id === "string" ? id : undefined;
}

/** How many rows an operation reported touching, when it reports one. */
function countFrom(result: unknown): number | undefined {
  const c = (result as { count?: number } | undefined)?.count;
  return typeof c === "number" ? c : undefined;
}

/**
 * The extension.
 *
 * Applied in `db.ts`. Note the deliberate ordering: the write runs first and
 * the audit row is only appended once it has succeeded, so a rejected write
 * leaves no trace suggesting it happened.
 */
export const auditExtension = Prisma.defineExtension({
  name: "audit",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args);

        if (!WRITE_OPS.has(operation) || !auditableModel(model)) return result;

        // Imported lazily. This module is pulled in by `db.ts`, and `audit.ts`
        // imports `db` — a static import here would close that cycle and leave
        // one of them undefined at module-evaluation time.
        try {
          const { recordSystemAudit } = await import("./audit-writer");
          const count = countFrom(result);
          const entityId = idFrom(args);

          // Who did it, when there is a signed-in caller.
          //
          // Without this every automatically-audited write is attributed to
          // "System" — including one an administrator made by clicking Save,
          // which is what the live log showed the first time this ran. An audit
          // trail whose answer to "who did this" is always "System" does not
          // answer the question it exists for.
          //
          // Imported lazily, and allowed to fail: outside a request scope — the
          // cron, the telematics worker — there is no cookie to read, and
          // "System" is then the truthful answer rather than a fallback.
          let actor: { id: string; name: string; role: string } | null = null;
          try {
            const { getSession } = await import("./auth");
            const s = await getSession();
            if (s) actor = { id: s.id, name: s.name, role: s.role };
          } catch {
            // No request context.
          }

          await recordSystemAudit({
            actor,
            action: actionFor(operation),
            module: moduleForModel(model!),
            entity: model!,
            entityId,
            summary:
              count === undefined
                ? `${actionFor(operation)} ${model}${entityId ? ` ${entityId}` : ""}`
                : `${actionFor(operation)} ${model} — ${count} record${count === 1 ? "" : "s"}`,
          });
        } catch (err) {
          console.error("[audit-extension] could not record", model, operation, err);
        }

        return result;
      },
    },
  },
});
