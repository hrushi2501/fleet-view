"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { raiseWoFromSchedule } from "@/app/(app)/maintenance/actions";
import { requireAction } from "@/lib/guard";

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
export async function acknowledgeAlert(alertId: string) {
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
export async function resolveAlert(alertId: string) {
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
export async function snoozeAlert(fd: FormData) {
  await requireAction("maintenance.edit");
  const alertId = s(fd, "alertId");
  const snoozeDays = n(fd, "snoozeDays") || 7;
  const reason = s(fd, "reason");

  if (!alertId) throw new Error("Alert ID is required");
  if (!reason) throw new Error("A reason for deferring the reminder is required");

  const alert = await db.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw new Error("Alert not found");

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
export async function createWoFromReminder(scheduleId: string) {
  await requireAction("maintenance.edit");
  const woId = await raiseWoFromSchedule(scheduleId);
  refresh();
  return woId;
}
