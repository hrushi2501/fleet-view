"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { raiseWoFromSchedule } from "@/app/(app)/maintenance/actions";
import { requireAction, ActionError, safe, isActionError } from "@/lib/guard";
import { assertRecordAccess } from "@/lib/record-access";
import {
  formNumber,
  boundedNumber,
  sanitizeString,
  sanitizeOptionalString,
  sanitizeId,
} from "@/lib/input-validation";

function refresh() {
  revalidatePath("/notifications");
  revalidatePath("/maintenance");
  revalidatePath("/dashboard");
}

const s = (fd: FormData, key: string) => sanitizeString(fd.get(key), key);
const n = formNumber;

/** Acknowledge an alert / reminder */
async function acknowledgeAlert__impl(rawAlertId: string) {
  const alertId = sanitizeId(rawAlertId, "Alert ID");
  const scopeAccess = await requireAction("maintenance.edit");
  await assertRecordAccess(scopeAccess, "alert", alertId);
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
async function resolveAlert__impl(rawAlertId: string) {
  const alertId = sanitizeId(rawAlertId, "Alert ID");
  const scopeAccess = await requireAction("maintenance.edit");
  await assertRecordAccess(scopeAccess, "alert", alertId);
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
  const scopeAccess = await requireAction("maintenance.edit");
  const alertId = sanitizeId(s(fd, "alertId"), "Alert ID");
  const snoozeDays = boundedNumber(fd.get("snoozeDays"), "Snooze days", { min: 1, max: 90, integer: true, fallback: 7 });
  const reason = sanitizeString(fd.get("reason"), "Reason", { required: true, maxLength: 1_000 });

  await assertRecordAccess(scopeAccess, "alert", alertId);

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
async function createWoFromReminder__impl(rawScheduleId: string) {
  const scheduleId = sanitizeId(rawScheduleId, "Schedule ID");
  const scopeAccess = await requireAction("maintenance.edit");
  await assertRecordAccess(scopeAccess, "maintenanceSchedule", scheduleId);
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
