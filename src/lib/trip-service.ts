import type { Transaction, Actor } from "./business-transaction";
import { ActionError } from "./action-error";
import { finiteNumber } from "./input-validation";
import { reconstructPath, validateOdometerAtCheckout } from "./telematics";

export type DutyEnd = { odometer?: number | null; lat?: number | null; lng?: number | null; notes?: string; endedBy: "DRIVER" | "AUTO" | "ADMIN" };

/**
 * Damaged-sticker recovery proof. It is intentionally only a plate/code suffix
 * comparison; the route supplies the asset from the caller's already-active
 * duty session, never from a client-selected vehicle id.
 */
export function matchesActiveVehicleConfirmation(
  confirmation: string,
  registrationNo: string | null,
  assetCode: string,
): boolean {
  const entered = confirmation.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const assigned = (registrationNo ?? assetCode).replace(/[^a-z0-9]/gi, "").toUpperCase();
  return entered.length === 4 && assigned.endsWith(entered);
}

/** Called inside a serializable business transaction by every duty-ending path. */
export async function completeDuty(tx: Transaction, sessionId: string, actor: Actor, end: DutyEnd) {
  const active = await tx.tripSession.findUnique({ where: { id: sessionId }, include: { asset: true } });
  if (!active) throw new ActionError("Trip not found.");
  if (active.status === "COMPLETED") return { sessionId: active.id, distanceKm: active.distanceKm, source: "recorded completion" };
  if (active.status !== "ACTIVE") throw new ActionError("This duty is no longer active.");
  const endMeter = end.odometer ?? null;
  const isOdometer = active.asset.primaryMeter !== "SMU";
  if (endMeter !== null) {
    finiteNumber(endMeter, "Closing meter", { min: 0 });
    if (active.startOdometer !== null && endMeter < active.startOdometer) throw new ActionError("Closing meter cannot be below the starting meter.");
    if (isOdometer) {
      const valid = validateOdometerAtCheckout(endMeter, active.startOdometer);
      if (!valid.valid) throw new ActionError(valid.error!);
    }
  }
  const readings = await tx.telemetryReading.findMany({ where: { sessionId }, orderBy: { recordedAt: "asc" }, select: {
    id: true, recordedAt: true, lat: true, lng: true, speedKph: true, odometerKm: true, fuelLevelPct: true, ignitionOn: true, source: true,
  } });
  const path = reconstructPath(readings);
  const meterDistance = isOdometer && endMeter !== null && active.startOdometer !== null ? endMeter - active.startOdometer : 0;
  const distanceKm = path.distanceKm > 0.05 ? path.distanceKm : meterDistance;
  const now = new Date();
  const written = await tx.tripSession.updateMany({ where: { id: sessionId, status: "ACTIVE" }, data: {
    status: "COMPLETED", endedAt: now, endedBy: end.endedBy, endOdometer: endMeter,
    endLat: end.lat, endLng: end.lng, notes: end.notes, distanceKm,
  } });
  if (written.count !== 1) throw new ActionError("The duty changed. Please reload.");
  // A duty summary is not another haul. Existing manual hauls already contribute
  // distance and tonnage to Trip-based reports; the duty retains its own measured total.
  const hauls = await tx.trip.count({ where: { id: { startsWith: `haul_${sessionId}_` } } });
  if (!hauls) await tx.trip.create({ data: {
    id: `duty_${sessionId}`, assetId: active.assetId, driverId: active.driverId, projectId: active.projectId,
    startTime: active.startedAt, endTime: now, distanceKm, idleHours: path.idleMinutes / 60,
    engineHours: !isOdometer && endMeter !== null && active.startOdometer !== null ? endMeter - active.startOdometer : 0,
    gpsVerified: path.points > 1 && path.discarded < path.points - 1, status: "Completed",
  } });
  await tx.asset.updateMany({ where: { id: active.assetId, driverId: active.driverId }, data: { driverId: null } });
  if (endMeter !== null) {
    await tx.asset.updateMany({ where: { id: active.assetId, meterValue: { lt: endMeter } }, data: { meterValue: endMeter } });
    await tx.meterReading.create({ data: {
      id: `duty_${sessionId}`, assetId: active.assetId, meterType: isOdometer ? "ODOMETER" : "SMU",
      value: endMeter, source: "MOBILE", refId: sessionId, recordedBy: actor?.name ?? null,
    } });
  }
  return { sessionId, distanceKm, source: path.distanceKm > 0.05 ? "GPS path" : meterDistance > 0 ? "odometer difference" : "no distance recorded" };
}
