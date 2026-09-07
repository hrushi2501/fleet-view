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
import { businessTransaction } from "@/lib/business-transaction";
import { positiveNumber, finiteNumber, oneOf } from "@/lib/input-validation";
import { ActionError, safe } from "@/lib/guard";
import { requirePage, canSeeAsset } from "@/lib/access";
import { auditAs } from "@/lib/audit";
import { uploadPrivateFile } from "@/lib/private-upload";
import { driverAccidentNotification, driverProblemNotification } from "@/lib/notification-events";
// A "use server" module may only export async functions, so the list of
// problems a driver can pick from lives with the rest of the driver app's data.
import { PROBLEM_KINDS } from "./_data";

export async function reportProblem(fd: FormData) {
  const access = await requirePage("my.report");

  // No person record means no vehicle of their own, so there is nothing this
  // action could legitimately be reporting against.
  if (!access.driverId) redirect("/my");

  const assetId = String(fd.get("assetId") ?? "").trim();
  const kind = String(fd.get("kind") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim().slice(0, 500);
  const stopped = fd.get("stopped") === "on";
  const returnToReport = fd.get("returnTo") === "report";

  const chosen = PROBLEM_KINDS.find((p) => p.value === kind);
  if (!assetId || !chosen) redirect("/my/vehicle?error=1");

  // The claim in the form body, checked against what this session may see.
  if (!(await canSeeAsset(access, assetId))) redirect("/my");

  const [driver, asset] = await Promise.all([
    db.driver.findUnique({
    where: { id: access.driverId },
    select: { id: true, name: true, phone: true },
    }),
    db.asset.findUnique({ where: { id: assetId }, select: { id: true, code: true, projectId: true } }),
  ]);
  if (!driver || !asset) redirect("/my");

  // Voice evidence is optional, but when it is supplied it travels through
  // the same private, signature-verified Blob path as regulated documents.
  // Do this before the database transaction: an object-store upload cannot be
  // rolled back with Postgres, and a failed upload must never create a report
  // that claims to include a recording it does not have.
  const recording = fd.get("voiceRecording");
  const voiceRecordingUrl = recording && typeof recording !== "string" && recording.size > 0
    ? await uploadPrivateFile(recording, { folder: "driver-report-audio", kind: "audio" })
    : null;

  // A stuck vehicle is a breakdown and goes to the top of the workshop's list;
  // anything the driver can still drive on is a repair. The driver's own words
  // are kept verbatim — a summary written by the software loses the detail the
  // fitter actually needs.
  const blocking = stopped || chosen.blocking;
  const description = [
    chosen.label,
    stopped ? "Vehicle chal nahi rahi." : null,
    note || null,
    voiceRecordingUrl ? "Voice recording attached." : null,
    driver ? `Reported by ${driver.name}${driver.phone ? ` (${driver.phone})` : ""} from the driver app.` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  const accident = kind === "ACCIDENT";
  const result = await businessTransaction(access.session, async (tx) => {
    const workOrder = await tx.workOrder.create({
      data: {
      // Date plus randomness rather than a counter: two drivers reporting in the
      // same second must not collide on a unique column.
      woNo: `DR-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase(),
      assetId,
      projectId: asset.projectId,
      type: stopped || accident ? "BREAKDOWN" : "REPAIR",
      priority: stopped || accident ? "Critical" : blocking ? "High" : "Medium",
      status: "Open",
      description,
      partPhotos: voiceRecordingUrl ? JSON.stringify({ driverReportAudio: voiceRecordingUrl }) : null,
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
  revalidatePath("/my/report");
  revalidatePath("/my/service");
  // The workshop's own screens are what make this report worth filing.
  revalidatePath("/maintenance");
  revalidatePath("/reports");
  revalidatePath("/reports/notifications");

  redirect(returnToReport ? "/my/report?reported=1" : "/my/service?reported=1");
}

async function logDriverTrip__impl(fd: FormData) {
  const access = await requirePage("my.trips");
  if (!access.driverId) throw new ActionError("A linked driver account is required.");
  const assetId = String(fd.get("assetId") ?? "").trim();
  if (!assetId || !(await canSeeAsset(access, assetId))) throw new ActionError("This is not your assigned machine.");
  const submissionId = String(fd.get("submissionId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(submissionId)) throw new ActionError("Reload the trip form and try again.");
  const tonnage = positiveNumber(fd.get("tonnage"), "Tonnage");
  if (tonnage > 1_000) throw new ActionError("Tonnage is above the permitted trip-entry limit.");
  const distanceKm = finiteNumber(fd.get("distanceKm"), "Distance", { min: 0, max: 1_000 });
  const meterText = String(fd.get("endMeter") ?? "").trim();
  const endMeter = meterText ? finiteNumber(meterText, "Meter", { min: 0, max: 10_000_000 }) : null;
  await businessTransaction(access.session, async tx => {
    const previous = await tx.trip.findFirst({ where: { driverId: access.driverId, id: { endsWith: "_" + submissionId } } });
    if (previous) return;
    const session = await tx.tripSession.findFirst({ where: { assetId, driverId: access.driverId!, userId: access.session.id, status: "ACTIVE" }, include: { asset: true } });
    if (!session) throw new ActionError("Check in before recording a haul.");
    if (endMeter !== null && endMeter < session.asset.meterValue) throw new ActionError("Meter cannot be below the recorded machine meter.");
    const now = new Date();
    await tx.trip.create({ data: {
      id: `haul_${session.id}_${submissionId}`, assetId, driverId: access.driverId, projectId: session.projectId,
      tonnage, distanceKm, status: "Completed", startTime: now, endTime: now, gpsVerified: false,
    } });
    if (endMeter !== null) {
      await tx.asset.updateMany({ where: { id: assetId, meterValue: { lt: endMeter } }, data: { meterValue: endMeter } });
      await tx.meterReading.create({ data: {
        assetId, meterType: session.asset.primaryMeter === "SMU" ? "SMU" : "ODOMETER",
        value: endMeter, source: "MOBILE", refId: `haul_${session.id}_${submissionId}`, recordedBy: access.session.name,
      } });
    }
  });
  revalidatePath("/my");
  revalidatePath("/my/trips");
  revalidatePath("/fleet/trips");
  revalidatePath("/");
  return { ok: true };
}
export const logDriverTrip = safe(logDriverTrip__impl);

const DRIVER_UPLOADABLE_DOCUMENTS = ["LICENSE", "AADHAAR"] as const;

/**
 * Turns a native date input into a real, calendar-safe Date. `new Date(value)`
 * silently accepts impossible days in some environments, which would put the
 * wrong expiry date into a driver's safety record.
 */
function optionalCalendarDate(value: FormDataEntryValue | null, label: string): Date | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ActionError(`${label} must be a valid date.`);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new ActionError(`${label} must be a valid date.`);
  }
  return date;
}

/**
 * A driver may add a scan for their own current licence or Aadhaar card only.
 * The driver ID is read from the signed-in session, never accepted from the
 * form, so changing hidden form fields cannot attach a document to somebody
 * else. Re-uploading the same type replaces the current scan rather than
 * creating an ambiguous stack of competing copies.
 */
async function uploadOwnDocument__impl(fd: FormData) {
  const access = await requirePage("my.documents");
  if (!access.driverId) throw new ActionError("A linked driver account is required to upload documents.");

  const docType = oneOf(String(fd.get("docType") ?? "").trim(), DRIVER_UPLOADABLE_DOCUMENTS, "document type");
  const file = fd.get("document");
  if (!file || typeof file === "string" || file.size === 0) {
    throw new ActionError("Choose a licence or Aadhaar scan to upload.");
  }

  const number = String(fd.get("number") ?? "").trim();
  if (number.length > 80) throw new ActionError("Document number is too long.");
  const expiryDate = optionalCalendarDate(fd.get("expiryDate"), "Expiry date");
  const documentUrl = await uploadPrivateFile(file, { folder: "driver-documents", kind: "document" });

  const current = await db.personDocument.findFirst({
    where: { driverId: access.driverId, docType },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const supplied = {
    documentUrl,
    ...(number ? { number } : {}),
    ...(expiryDate ? { expiryDate } : {}),
  };

  if (current) {
    await db.personDocument.update({ where: { id: current.id }, data: supplied });
  } else {
    await db.personDocument.create({
      data: { driverId: access.driverId, docType, number: number || null, expiryDate, documentUrl },
    });
  }

  revalidatePath("/my");
  revalidatePath("/my/documents");
  return { ok: true, documentType: docType };
}

export const uploadOwnDocument = safe(uploadOwnDocument__impl);
