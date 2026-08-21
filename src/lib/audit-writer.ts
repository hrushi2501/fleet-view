/**
 * The one place an audit row is physically written.
 *
 * Sits underneath the Prisma extension deliberately: it uses `rawDb`, the
 * unextended client, so recording an event does not itself trigger the
 * extension that recorded it.
 *
 * `audit.ts` is the API the application calls, with real summaries. This is the
 * plumbing both it and the extension share.
 */
import { rawDb } from "./db";

export type SystemAuditRow = {
  action: string;
  module: string;
  summary: string;
  entity?: string;
  entityId?: string;
  changes?: unknown;
  actor?: { id: string; name: string; role: string } | null;
  ip?: string | null;
};

/**
 * Appends one row. Never throws.
 *
 * The actor is resolved by the caller rather than here, because looking up the
 * session inside a write path would add a query to every audited operation and
 * this runs on the hot path of every mutation in the app.
 */
export async function recordSystemAudit(row: SystemAuditRow): Promise<void> {
  try {
    await rawDb.auditEvent.create({
      data: {
        actorId: row.actor?.id ?? null,
        actorName: row.actor?.name ?? "System",
        actorRole: row.actor?.role ?? null,
        action: row.action,
        module: row.module,
        entity: row.entity ?? null,
        entityId: row.entityId ?? null,
        summary: row.summary,
        changes: row.changes === undefined ? null : JSON.stringify(row.changes),
        ip: row.ip ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] write failed:", row.action, row.module, err);
  }
}
