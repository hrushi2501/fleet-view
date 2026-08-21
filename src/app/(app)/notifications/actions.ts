"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { raiseWoFromSchedule } from "@/app/(app)/maintenance/actions";
import { requireAction, ActionError, safe, isActionError } from "@/lib/guard";

function refresh() {
  revalidatePath("/notifications");
  revalidatePath("/maintenance");
  revalidatePath("/dashboard");
}

function s(fd: FormData, key: string): string {
  return (fd.get(key) as string)?.trim() ?? "";
}

function n(fd: FormData, key: string): number {
  const v = fd.get(key);
  if (v === null || v === "") return 0;
  const parsed = Number(v);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Acknowledge an alert / reminder */
async function acknowledgeAlert__impl(alertId: string) {
  await requireAction("maintenance.edit");
  const session = await getSession();
  await db.alert.update({
    where: { id: alertId },
    data: {
      status: "Acknowledged",
      acknowledgedBy: session?.name || "System User",
      acknowledgedAt: new Date(),
    },
  });
  refresh();
  return { ok: true };
}

/** Resolve an alert / reminder */
async function resolveAlert__impl(alertId: string) {
  await requireAction("maintenance.edit");
  await db.alert.update({
    where: { id: alertId },
    data: {
      status: "Resolved",
      resolvedAt: new Date(),
    },
  });
  refresh();
  return { ok: true };
}

/** Snooze a service reminder with mandatory reason logging */
async function snoozeAlert__impl(fd: FormData) {
  await requireAction("maintenance.edit");
  const alertId = s(fd, "alertId");
  const snoozeDays = n(fd, "snoozeDays") || 7;
  const reason = s(fd, "reason");

  if (!alertId) throw new ActionError("Alert ID is required");
  if (!reason) throw new ActionError("A reason for deferring the reminder is required");

  const alert = await db.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw new ActionError("Alert not found");

  const currentDue = alert.dueDate ? new Date(alert.dueDate) : new Date();
  const newDue = new Date(currentDue.getTime() + snoozeDays * 86400000);

  const updatedMessage = `${alert.message} [Snoozed +${snoozeDays}d: ${reason}]`;

  await db.alert.update({
    where: { id: alertId },
    data: {
      status: "Open",
      dueDate: newDue,
      message: updatedMessage,
    },
  });

  refresh();
  return { ok: true };
}

/** Create PM Work Order directly from a due service reminder */
async function createWoFromReminder__impl(scheduleId: string) {
  await requireAction("maintenance.edit");
  const created = await raiseWoFromSchedule(scheduleId);
  // `raiseWoFromSchedule` is wrapped, so a refusal arrives as data rather
  // than an exception. Re-raise it so this action fails instead of quietly
  // returning an error object where a work-order id is expected.
  if (isActionError(created)) throw new ActionError(created.error);
  const woId = created;
  refresh();
  return woId;
}

/* ---------------------------------------------------------------------------
 * Exported actions.
 *
 * Wrapped in `safe()` so an `ActionError` comes back as `{ error }` instead of
 * being thrown — Next redacts thrown messages in production builds, which made
 * every validation message in this file invisible to the person who triggered
 * it. Return values are passed through untouched.
 * ------------------------------------------------------------------------- */
export const acknowledgeAlert = safe(acknowledgeAlert__impl);
export const resolveAlert = safe(resolveAlert__impl);
export const snoozeAlert = safe(snoozeAlert__impl);
export const createWoFromReminder = safe(createWoFromReminder__impl);
