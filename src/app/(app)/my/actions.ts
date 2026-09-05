"use server";

/**
 * The one thing a driver can write from this app besides a fuel entry: telling
 * the workshop something is wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ACTION RE-CHECKS EVERYTHING THE PAGE ALREADY CHECKED
 *
 * A server action is a public endpoint. The page that renders the form guards
 * itself with `requirePage`, but nothing stops a request being posted straight
 * at this function with somebody else's `assetId` in the body. So the ownership
 * of the vehicle is proven here, from the caller's session, and the id in the
 * form is treated as a claim to verify rather than as an instruction.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePage, canSeeAsset } from "@/lib/access";
import { auditAs } from "@/lib/audit";
import { driverAccidentNotification, driverProblemNotification } from "@/lib/notification-events";
// A "use server" module may only export async functions, so the list of
// problems a driver can pick from lives with the rest of the driver app's data.
import { PROBLEM_KINDS } from "./_data";

export async function reportProblem(fd: FormData) {
  const access = await requirePage("my.vehicle");

  // No person record means no vehicle of their own, so there is nothing this
  // action could legitimately be reporting against.
  if (!access.driverId) redirect("/my");

  const assetId = String(fd.get("assetId") ?? "").trim();
  const kind = String(fd.get("kind") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim().slice(0, 500);
  const stopped = fd.get("stopped") === "on";

  const chosen = PROBLEM_KINDS.find((p) => p.value === kind);
  if (!assetId || !chosen) redirect("/my/vehicle?error=1");

  // The claim in the form body, checked against what this session may see.
  if (!(await canSeeAsset(access, assetId))) redirect("/my");

  const [driver, asset] = await Promise.all([
    db.driver.findUnique({
    where: { id: access.driverId },
    select: { id: true, name: true, phone: true },
    }),
    db.asset.findUnique({ where: { id: assetId }, select: { id: true, code: true } }),
  ]);
  if (!driver || !asset) redirect("/my");

  // A stuck vehicle is a breakdown and goes to the top of the workshop's list;
  // anything the driver can still drive on is a repair. The driver's own words
  // are kept verbatim — a summary written by the software loses the detail the
  // fitter actually needs.
  const blocking = stopped || chosen.blocking;
  const description = [
    chosen.label,
    stopped ? "Vehicle chal nahi rahi." : null,
    note || null,
    driver ? `Reported by ${driver.name}${driver.phone ? ` (${driver.phone})` : ""} from the driver app.` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  const accident = kind === "ACCIDENT";
  const result = await db.$transaction(async (tx) => {
    const workOrder = await tx.workOrder.create({
      data: {
      // Date plus randomness rather than a counter: two drivers reporting in the
      // same second must not collide on a unique column.
      woNo: `DR-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase(),
      assetId,
      type: stopped || accident ? "BREAKDOWN" : "REPAIR",
      priority: stopped || accident ? "Critical" : blocking ? "High" : "Medium",
      status: "Open",
      description,
      reportedAt: new Date(),
      },
    });

    const notification = await tx.alert.create({
      data: accident
        ? driverAccidentNotification({
          assetId: asset.id,
          assetCode: asset.code,
          driverId: driver.id,
          driverName: driver.name,
          note,
        })
        : driverProblemNotification({
          assetId: asset.id,
          assetCode: asset.code,
          driverId: driver.id,
          driverName: driver.name,
          kind: chosen.label,
          blocking,
          note,
        }),
    });
    if (stopped || accident) {
      await tx.asset.update({
        where: { id: assetId },
        data: { status: "Breakdown" },
      });
    }

    return { workOrder, notification };
  });

  if (accident) {
    await auditAs(access.session, {
      action: "CREATE",
      module: "NOTIFICATIONS",
      entity: "Alert",
      entityId: result.notification.id,
      summary: `Critical accident notification raised for ${asset.code}.`,
      changes: { workOrderId: result.workOrder.id, severity: "Critical", category: "Driver" },
    });

    // Accident alerts are the one driver event loud enough to leave the in-app
    // queue immediately. Web push is best-effort: missing VAPID configuration
    // or a provider outage must never prevent the safety report from being
    // recorded in Alert, WorkOrder, and AuditEvent.
    try {
      const [{ sendPushToUsers }, { administratorNotificationUserIds }] = await Promise.all([
        import("@/lib/push"),
        import("@/lib/notification-recipients"),
      ]);
      await sendPushToUsers(await administratorNotificationUserIds(), {
        title: result.notification.title,
        body: result.notification.message,
        url: result.notification.actionUrl ?? "/maintenance",
      });
    } catch (error) {
      console.error("[driver-accident] priority push failed", error);
    }
  }

  revalidatePath("/my");
  revalidatePath("/my/vehicle");
  revalidatePath("/my/service");
  // The workshop's own screens are what make this report worth filing.
  revalidatePath("/maintenance");
  revalidatePath("/reports");
  revalidatePath("/reports/notifications");

  redirect("/my/service?reported=1");
}

export async function logDriverTrip(fd: FormData) {
  const access = await requirePage("my.trips");
  const driverId = access.driverId;
  if (!driverId) redirect("/my");

  const assetId = String(fd.get("assetId") ?? "").trim();
  if (!assetId || !(await canSeeAsset(access, assetId))) redirect("/my");
  const _origin = String(fd.get("origin") ?? "").trim() || "Site Loading Point";
  const _destination = String(fd.get("destination") ?? "").trim() || "Unloading / Dumping Area";
  const _material = String(fd.get("material") ?? "").trim() || "Aggregate";
  const tonnage = parseFloat(String(fd.get("tonnage") ?? "0")) || 0;
  const distanceKm = parseFloat(String(fd.get("distanceKm") ?? "0")) || 12;
  const endMeter = parseFloat(String(fd.get("endMeter") ?? "0")) || 0;

  const now = new Date();
  const startTime = new Date(now.getTime() - 45 * 60000);

  const asset = await db.asset.findFirst({
    where: { id: assetId },
    select: { projectId: true },
  });
  if (!asset) redirect("/my");

  await db.trip.create({
    data: {
      assetId,
      driverId,
      projectId: asset?.projectId ?? null,
      tonnage,
      distanceKm,
      status: "Completed",
      startTime,
      endTime: now,
      gpsVerified: true,
    },
  });

  if (endMeter > 0 && assetId) {
    const currentAsset = await db.asset.findUnique({ where: { id: assetId }, select: { meterValue: true } });
    if (currentAsset && endMeter > currentAsset.meterValue) {
      await db.asset.update({
        where: { id: assetId },
        data: { meterValue: endMeter, lastSeen: now },
      });
      await db.meterReading.create({
        data: {
          assetId,
          meterType: "ODOMETER",
          value: endMeter,
          source: "MOBILE",
          recordedBy: access.session.name,
        },
      });
    }
  }

  revalidatePath("/my");
  revalidatePath("/my/trips");
  revalidatePath("/fleet/trips");
  revalidatePath("/operations");
  revalidatePath("/");

  return { ok: true };
}
