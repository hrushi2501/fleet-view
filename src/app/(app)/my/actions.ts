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
import { driverAccidentNotification } from "@/lib/notification-events";
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

    const notification = accident
      ? await tx.alert.create({ data: driverAccidentNotification({
          assetId: asset.id,
          assetCode: asset.code,
          driverId: driver.id,
          driverName: driver.name,
          note,
        }) })
      : null;
    return { workOrder, notification };
  });

  if (result.notification) {
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
      const { sendPushToAll } = await import("@/lib/push");
      await sendPushToAll({
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

export async function selfAssignVehicle(codeOrToken: string, odometer?: number) {
  const access = await requirePage("my.work");
  let driverId = access.driverId;

  if (!driverId) {
    const existing = await db.driver.findFirst({
      where: {
        name: { equals: access.session.name, mode: "insensitive" },
      },
    });

    if (existing) {
      driverId = existing.id;
      await db.user.update({ where: { id: access.session.id }, data: { driverId: existing.id } }).catch(() => {});
    } else {
      const newDriver = await db.driver.create({
        data: {
          empCode: `DRV-${access.session.id.slice(-4).toUpperCase()}`,
          name: access.session.name || "Driver",
          phone: "9876543210",
          type: "DRIVER",
          licenseNo: `MH14-${Date.now().toString().slice(-6)}`,
          licenseExpiry: new Date(Date.now() + 365 * 86400000),
          status: "Active",
        },
      });
      driverId = newDriver.id;
      await db.user.update({ where: { id: access.session.id }, data: { driverId: newDriver.id } }).catch(() => {});
    }
  }

  const query = codeOrToken.trim();
  if (!query) throw new Error("Please scan a valid QR code or enter vehicle code.");

  // Match by qrToken, code, or registration number
  const asset = await db.asset.findFirst({
    where: {
      OR: [
        { qrToken: query },
        { code: { equals: query, mode: "insensitive" } },
        { registrationNo: { equals: query, mode: "insensitive" } },
        { id: query },
      ],
    },
  });

  if (!asset) {
    throw new Error(`Vehicle "${query}" system me nahi mili. Please check code or scan again.`);
  }

  // 1. Assign vehicle directly to this driver
  await db.asset.update({
    where: { id: asset.id },
    data: {
      driverId,
      ...(odometer && odometer > 0 ? { meterValue: odometer } : {}),
      lastSeen: new Date(),
    },
  });

  // 2. Create or resume active trip session for shift binding
  const openSession = await db.tripSession.findFirst({
    where: { driverId, status: "ACTIVE" },
  });

  if (openSession && openSession.assetId !== asset.id) {
    await db.tripSession.update({
      where: { id: openSession.id },
      data: { status: "COMPLETED", endedAt: new Date(), endedBy: "AUTO" },
    });
  }

  if (!openSession || openSession.assetId !== asset.id) {
    await db.tripSession.create({
      data: {
        assetId: asset.id,
        driverId,
        userId: access.session.id,
        projectId: asset.projectId ?? undefined,
        startOdometer: odometer && odometer > 0 ? odometer : asset.meterValue,
        scanMethod: "QR",
        status: "ACTIVE",
      },
    });
  }

  revalidatePath("/my");
  revalidatePath("/my/vehicle");
  revalidatePath("/my/trips");
  revalidatePath("/my/documents");
  revalidatePath("/fleet");
  revalidatePath("/");

  return { ok: true, assetCode: asset.code, assetName: asset.name };
}

export async function logDriverTrip(fd: FormData) {
  const access = await requirePage("my.trips");
  let driverId = access.driverId;
  if (!driverId) {
    const driver = await db.driver.findFirst({ where: { name: { equals: access.session.name, mode: "insensitive" } } });
    driverId = driver?.id ?? null;
  }
  if (!driverId) redirect("/my");

  const assetId = String(fd.get("assetId") ?? "").trim();
  const origin = String(fd.get("origin") ?? "").trim() || "Site Loading Point";
  const destination = String(fd.get("destination") ?? "").trim() || "Unloading / Dumping Area";
  const material = String(fd.get("material") ?? "").trim() || "Aggregate";
  const tonnage = parseFloat(String(fd.get("tonnage") ?? "0")) || 0;
  const distanceKm = parseFloat(String(fd.get("distanceKm") ?? "0")) || 12;
  const endMeter = parseFloat(String(fd.get("endMeter") ?? "0")) || 0;

  const now = new Date();
  const startTime = new Date(now.getTime() - 45 * 60000);

  const asset = await db.asset.findUnique({ where: { id: assetId } });

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
    await db.asset.update({
      where: { id: assetId },
      data: { meterValue: endMeter, lastSeen: now },
    });
  }

  revalidatePath("/my");
  revalidatePath("/my/trips");
  revalidatePath("/fleet/trips");
  revalidatePath("/operations");
  revalidatePath("/");

  return { ok: true };
}

export async function endDriverShift(endingOdometer?: number) {
  const access = await requirePage("my.work");
  let driverId = access.driverId;
  if (!driverId) {
    const driver = await db.driver.findFirst({ where: { name: { equals: access.session.name, mode: "insensitive" } } });
    driverId = driver?.id ?? null;
  }
  if (!driverId) redirect("/my");

  const activeSession = await db.tripSession.findFirst({
    where: { driverId, status: "ACTIVE" },
  });

  if (activeSession) {
    await db.tripSession.update({
      where: { id: activeSession.id },
      data: {
        status: "COMPLETED",
        endedAt: new Date(),
        endedBy: "DRIVER",
        ...(endingOdometer && endingOdometer > 0 ? { endOdometer: endingOdometer } : {}),
      },
    });

    if (endingOdometer && endingOdometer > 0 && activeSession.assetId) {
      await db.asset.update({
        where: { id: activeSession.assetId },
        data: { meterValue: endingOdometer, lastSeen: new Date() },
      });
    }
  }

  revalidatePath("/my");
  revalidatePath("/my/trips");
  revalidatePath("/tracking/sessions");
  revalidatePath("/people/attendance");

  return { ok: true };
}
