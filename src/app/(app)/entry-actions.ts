"use server";

import { db } from "@/lib/db";
import { businessTransaction } from "@/lib/business-transaction";
import {
  finiteNumber,
  formNumber,
  positiveNumber,
  nonNegativeNumber,
  boundedNumber,
  percentageNumber,
  coordinatePair,
  oneOf,
  safeParseDate,
  validateDateRange,
} from "@/lib/input-validation";
import { assertRecordAccess, assertFormAccess, assertGlobalAccess } from "@/lib/record-access";
import { changeWorkOrderStatus } from "@/lib/work-order-service";
import { revalidatePath } from "next/cache";
import { hashPassword, verifyPassword, getSession, passwordPolicyError, revokeSessions } from "@/lib/auth";
import { DIESEL_RATE_CACHE_KEY, getDieselRate } from "@/lib/settings";
import { serverCache } from "@/lib/cache";
import { requireAction, requireUser, ActionError, safe } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { uploadPrivateFile } from "@/lib/private-upload";
import { canSeeAsset } from "@/lib/access";
import { driverFuelFillNotification } from "@/lib/notification-events";
import { driverFuelDetails } from "@/lib/driver-refuelling";
import { invalidateLiveFleetCache } from "@/lib/fleet-edge-live";

async function uploadPhoto(file: FormDataEntryValue | null, prefix: string): Promise<string | null> {
  if (!file || typeof file === "string") return null;
  const f = file as File;
  if (!f.size) return null;
  return uploadPrivateFile(f, { folder: `fuel-${prefix}`, kind: "image" });
}

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = formNumber;

/**
 * A number field that may legitimately be blank.
 *
 * `n` returns 0 for an empty input, which is right for a meter reading and
 * wrong for a specification: a laden weight of 0 kg is not a lighter truck, it
 * is a truck nobody has measured. Blank must stay null so the page can say
 * "not recorded" instead of printing a zero.
 */
const nOrNull = (fd: FormData, k: string) => {
  const raw = String(fd.get(k) ?? "").trim();
  if (!raw) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
};

/** A text field that may be blank; empty becomes null rather than "". */
const sOrNull = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;

function docStatus(expiry: Date) {
  const days = (expiry.getTime() - Date.now()) / 86400000;
  return days < 0 ? "Expired" : days < 30 ? "Expiring" : "Valid";
}

const VALID_ASSET_CLASSES = [
  "DUMPER", "TIPPER", "EXCAVATOR", "BACKHOE", "GRADER", "ROLLER",
  "CRANE", "TRANSIT_MIXER", "WATER_TANKER", "TRUCK", "PICKUP",
  "CAR", "BIKE", "TRACTOR", "PLANT", "CRUSHER", "MINES",
] as const;

const VALID_CATEGORIES = ["VEHICLE", "EQUIPMENT"] as const;
const VALID_OWNERSHIP_TYPES = ["OWNED", "LEASED", "HIRED", "CONTRACTOR"] as const;
const VALID_STATUSES = ["Active", "Idle", "Under-Maintenance", "In-Transit", "Breakdown", "Off-hired"] as const;
const VALID_PRIMARY_METERS = ["ODOMETER", "SMU"] as const;

/* ----------------------------- ASSETS ----------------------------- */
async function saveAsset__impl(id: string | null, fd: FormData) {
  await requireAction("fleet.edit");
  const code = s(fd, "code");
  const name = s(fd, "name");
  if (!code) throw new ActionError("Asset code is required.");
  if (code.length > 50) throw new ActionError("Asset code cannot exceed 50 characters.");
  if (!name) throw new ActionError("Asset name is required.");
  if (name.length > 100) throw new ActionError("Asset name cannot exceed 100 characters.");

  const assetClass = oneOf(s(fd, "assetClass") || "DUMPER", VALID_ASSET_CLASSES, "asset class");
  const category = oneOf(s(fd, "category") || "VEHICLE", VALID_CATEGORIES, "category");
  const ownershipType = oneOf(s(fd, "ownershipType") || "OWNED", VALID_OWNERSHIP_TYPES, "ownership type");
  const status = oneOf(s(fd, "status") || "Active", VALID_STATUSES, "status");
  const primaryMeter = oneOf(s(fd, "primaryMeter") || "ODOMETER", VALID_PRIMARY_METERS, "primary meter");

  const yearMfg = boundedNumber(fd.get("yearMfg"), "Manufacturing year", {
    min: 1950,
    max: new Date().getFullYear() + 1,
    integer: true,
    fallback: new Date().getFullYear(),
  });
  const meterValue = boundedNumber(fd.get("meterValue"), "Meter reading", {
    min: 0,
    max: 10_000_000,
    fallback: 0,
  });
  const fuelCapacity = boundedNumber(fd.get("fuelCapacity"), "Fuel capacity", {
    min: 0,
    max: 50_000,
    fallback: 0,
  });
  const acquisitionCost = nonNegativeNumber(fd.get("acquisitionCost"), "Acquisition cost", {
    max: 100_000_000_000,
    fallback: 0,
  });
  const healthScore = percentageNumber(fd.get("healthScore"), "Health score", { fallback: 90 });
  const utilization = percentageNumber(fd.get("utilization"), "Utilization", { fallback: 0 });

  const rawEngineHp = fd.get("enginePowerHp");
  const enginePowerHp = rawEngineHp && String(rawEngineHp).trim()
    ? boundedNumber(rawEngineHp, "Engine power", { min: 1, max: 10_000 })
    : null;
  const rawTorque = fd.get("torqueNm");
  const torqueNm = rawTorque && String(rawTorque).trim()
    ? boundedNumber(rawTorque, "Torque", { min: 1, max: 50_000 })
    : null;
  const rawTonnage = fd.get("tonnage");
  const tonnage = rawTonnage && String(rawTonnage).trim()
    ? boundedNumber(rawTonnage, "Tonnage", { min: 0.01, max: 1_000 })
    : null;

  const rawLaden = fd.get("ladenWeightKg");
  const ladenWeightKg = rawLaden && String(rawLaden).trim()
    ? boundedNumber(rawLaden, "Gross laden weight", { min: 10, max: 500_000 })
    : null;
  const rawUnladen = fd.get("unladenWeightKg");
  const unladenWeightKg = rawUnladen && String(rawUnladen).trim()
    ? boundedNumber(rawUnladen, "Unladen weight", { min: 10, max: 500_000 })
    : null;

  if (ladenWeightKg !== null && unladenWeightKg !== null && ladenWeightKg < unladenWeightKg) {
    throw new ActionError("Gross laden weight cannot be less than unladen (tare) weight.");
  }

  const serviceDueDate = safeParseDate(fd.get("serviceDueDate"), "Next service due");
  const lastServiceDate = safeParseDate(fd.get("lastServiceDate"), "Last service date");
  validateDateRange(lastServiceDate, serviceDueDate, "Service dates");
  const registrationDate = safeParseDate(fd.get("registrationDate"), "Registration date", { minYear: 1950, maxYear: 2100 });

  const coords = coordinatePair(fd.get("lat"), fd.get("lng"), "Vehicle location");

  const data = {
    code,
    name,
    assetClass,
    category,
    ownershipType,
    make: s(fd, "make"),
    model: s(fd, "model"),
    yearMfg,
    primaryMeter,
    meterValue,
    fuelCapacity,
    status,
    registrationNo: s(fd, "registrationNo") || null,
    acquisitionCost,
    healthScore,
    utilization,
    serviceDueDate,
    lastServiceDate,
    projectId: s(fd, "projectId") || null,
    chassisNo: sOrNull(fd, "chassisNo"),
    engineNo: sOrNull(fd, "engineNo"),
    fuelType: sOrNull(fd, "fuelType"),
    emissionNorm: sOrNull(fd, "emissionNorm"),
    segment: sOrNull(fd, "segment"),
    vehicleApplication: sOrNull(fd, "vehicleApplication"),
    branch: sOrNull(fd, "branch"),
    specification: sOrNull(fd, "specification"),
    engineModel: sOrNull(fd, "engineModel"),
    transmission: sOrNull(fd, "transmission"),
    enginePowerHp,
    torqueNm,
    ladenWeightKg,
    unladenWeightKg,
    tonnage,
    registrationDate,
    ...(coords.lat !== null ? { lat: coords.lat } : {}),
    ...(coords.lng !== null ? { lng: coords.lng } : {}),
  };
  if (id) {
    const before = await db.asset.findUnique({ where: { id }, select: { meterValue: true } });
    if (before && before.meterValue > 0 && data.meterValue < before.meterValue) {
      throw new ActionError(`Odometer reading (${data.meterValue} km) cannot be lower than existing reading (${before.meterValue} km).`);
    }
    const updated = await db.asset.updateMany({ where: { id, decommissionedOn: null }, data });
    if (updated.count !== 1) throw new ActionError("Decommissioned vehicles cannot be edited. Restore it deliberately before changing its register record.");
  }
  else {
    const existing = await db.asset.findUnique({ where: { code }, select: { id: true } });
    if (existing) throw new ActionError(`Asset code "${code}" is already in use.`);
    await db.asset.create({ data });
  }
  revalidatePath("/fleet");
  revalidatePath("/");
  await invalidateLiveFleetCache();
}

async function deleteAsset__impl(id: string) {
  const access = await requireAction("fleet.delete");
  await assertRecordAccess(access, "asset", id);
  const asset = await db.asset.findUnique({
    where: { id },
    select: { id: true, code: true, status: true, decommissionedOn: true },
  });
  if (!asset) throw new ActionError("That vehicle no longer exists.");
  if (asset.decommissionedOn) throw new ActionError("This vehicle has already been decommissioned.");

  const now = new Date();
  // A vehicle has fuel, trips, compliance, cost, maintenance and telemetry
  // evidence attached. Removing those rows makes operational history and later
  // financial reconciliation impossible, so the register's former "delete" is
  // intentionally a retirement operation.
  await businessTransaction(access.session, async (tx) => {
    await tx.tripSession.updateMany({
      where: { assetId: id, status: "ACTIVE" },
      data: { status: "COMPLETED", endedAt: now, endedBy: "ADMIN" },
    });
    await tx.asset.update({
      where: { id },
      data: {
        status: "Off-hired",
        projectId: null,
        driverId: null,
        decommissionedOn: asset.decommissionedOn ?? now,
      },
    });
    await tx.assetLifecycleEvent.create({
      data: {
        assetId: id,
        kind: "DECOMMISSIONED",
        date: now,
        fromValue: asset.status,
        toValue: "Off-hired",
        note: "Decommissioned from the fleet register; linked history retained.",
        by: access.session.name,
      },
    });
  });
  await audit({
    action: "UPDATE", module: "FLEET", entity: "Asset", entityId: id,
    summary: `Decommissioned ${asset.code}; linked operational and financial history retained.`,
    changes: { fromStatus: asset.status, toStatus: "Off-hired", decommissionedOn: now.toISOString() },
  });
  revalidatePath("/fleet");
  revalidatePath("/");
  await invalidateLiveFleetCache();
}

/* ----------------------------- DRIVERS ----------------------------- */
async function saveDriver__impl(id: string | null, fd: FormData) {
  const scopeAccess = await requireAction("people.edit");
  await assertFormAccess(scopeAccess, fd);
  if (id) await assertRecordAccess(scopeAccess, "driver", id);
  const phone = s(fd, "phone");

  // Phone format validation — 10-digit Indian mobile number (no country code).
  // The regex accepts an optional leading +91 or 0 prefix before the 10 digits.
  // Source: standard Indian telecom numbering plan (TRAI); digits 6–9 as first digit
  // covers all current Jio/Airtel/Vi/BSNL ranges.
  if (phone && !/^(?:\+91|91|0)?[6-9]\d{9}$/.test(phone)) {
    throw new ActionError("Phone must be a valid 10-digit Indian mobile number (e.g. 9XXXXXXXXX).");
  }

  // License number format: [STATE:2alpha][RTO:2digits] [YEAR:4digits][SERIAL:7digits]
  // Confirmed team format example: RJ14 20241234567
  // The space between RTO code and year is optional to handle legacy entries without it.
  // Case-insensitive — stored/displayed as-is but both RJ14 and rj14 are accepted on entry.
  // Note: existing seed data may pre-date this validation; the check only runs on new saves.
  const licenseNo = s(fd, "licenseNo");
  if (licenseNo && !/^[A-Za-z]{2}\d{2}\s?\d{11}$/.test(licenseNo)) {
    throw new ActionError(
      'License number must follow the format: state code + RTO code + year + serial (e.g. RJ14 20241234567).'
    );
  }


  // Duplicate phone check — two drivers must not share the same phone number.
  if (phone) {
    const existing = await db.driver.findFirst({
      where: { phone, ...(id ? { NOT: { id } } : {}) },
    });
    if (existing) {
      throw new ActionError(
        `Phone number is already registered to ${existing.name} (${existing.empCode}).`
      );
    }
  }

  // Validate a requested login before creating the driver record. Otherwise a
  // weak/missing password would leave an orphan person behind after the action
  // correctly refuses the credential.
  const createLogin = !id && s(fd, "createLogin") === "true";
  const loginEmail = s(fd, "loginEmail").toLowerCase();
  const loginPassword = s(fd, "loginPassword");
  if (createLogin) {
    if (!loginEmail) throw new ActionError("Enter an email to create a driver login.");
    const passwordError = passwordPolicyError(loginPassword);
    if (passwordError) throw new ActionError(passwordError);
  }

  const empCode = s(fd, "empCode");
  const name = s(fd, "name");
  if (!empCode) throw new ActionError("Employee code is required.");
  if (!name) throw new ActionError("Driver name is required.");

  const type = oneOf(s(fd, "type") || "DRIVER", ["DRIVER", "OPERATOR"] as const, "driver type");
  const status = oneOf(s(fd, "status") || "Active", ["Active", "Inactive", "Suspended"] as const, "driver status");
  const licenseExpiry = safeParseDate(fd.get("licenseExpiry"), "License expiry") || new Date(Date.now() + 365 * 86400000);

  const data = {
    empCode,
    name,
    phone,
    type,
    licenseNo,
    licenseExpiry,
    certifications: s(fd, "certifications"),
    safetyScore: percentageNumber(fd.get("safetyScore"), "Safety score", { fallback: 80 }),
    performanceScore: percentageNumber(fd.get("performanceScore"), "Performance score", { fallback: 80 }),
    attendance: percentageNumber(fd.get("attendance"), "Attendance", { fallback: 95 }),
    status,
  };
  if (id) {
    await db.driver.update({ where: { id }, data });
    // If the driver is marked Inactive or Suspended, release any active vehicle they hold
    if (data.status === "Inactive" || data.status === "Suspended") {
      const now = new Date();
      await db.tripSession.updateMany({
        where: { driverId: id, status: "ACTIVE" },
        data: { status: "COMPLETED", endedAt: now, endedBy: "ADMIN" },
      });
      await db.asset.updateMany({
        where: { driverId: id },
        data: { driverId: null },
      });
    }
  } else {
    const driver = await db.driver.create({ data });

    if (createLogin) {
      const existingUser = await db.user.findUnique({ where: { email: loginEmail } });
      if (!existingUser) {
        const driverRole = await db.role.findUnique({ where: { name: "Driver" } });
        await db.user.create({
          data: {
            name: data.name,
            email: loginEmail,
            password: await hashPassword(loginPassword),
            role: "Driver",
            roleId: driverRole?.id ?? null,
            driverId: driver.id,
          },
        });
      }
    }
  }
  revalidatePath("/drivers");
  revalidatePath("/users");
}

async function deleteDriver__impl(id: string) {
  const scopeAccess = await requireAction("people.edit");
  await assertRecordAccess(scopeAccess, "driver", id);
  const now = new Date();
  await db.tripSession.updateMany({
    where: { driverId: id, status: "ACTIVE" },
    data: { status: "COMPLETED", endedAt: now, endedBy: "ADMIN" },
  });
  await db.asset.updateMany({ where: { driverId: id }, data: { driverId: null } });
  await db.trip.updateMany({ where: { driverId: id }, data: { driverId: null } });
  await db.alert.updateMany({ where: { driverId: id }, data: { driverId: null } });
  await db.user.updateMany({ where: { driverId: id }, data: { driverId: null } });
  await db.driver.delete({ where: { id } });
  revalidatePath("/drivers");
  revalidatePath("/users");
}

/* ----------------------------- FUEL ----------------------------- */
const VALID_FUEL_TYPES = ["ISSUE", "RECEIPT", "TRANSFER", "ADJUSTMENT"] as const;

async function saveFuel__impl(fd: FormData) {
  const access = await requireAction("fuel.issue");
  await assertFormAccess(access, fd);
  const type = oneOf(s(fd, "type") || "ISSUE", VALID_FUEL_TYPES, "fuel transaction type");
  if (access.group === "DRIVER" && type !== "ISSUE") {
    throw new ActionError("Drivers can record fuel issued to their checked-in vehicle only.");
  }
  const quantity = n(fd, "quantity");
  const postedAmount = String(fd.get("amount") ?? "").trim();
  const amountFromDriver = postedAmount
    ? finiteNumber(postedAmount, "Fuel amount", { min: 0.01, max: 500_000 })
    : null;
  const financials = access.group === "DRIVER"
    ? driverFuelDetails(quantity, amountFromDriver ?? 0)
    : { rate: n(fd, "rate") || (await getDieselRate()), amount: 0 };
  const rate = financials.rate;
  const hasSensor = type === "ISSUE" && String(fd.get("sensorRise") ?? "").trim() !== "";
  const sensorRise = hasSensor ? n(fd, "sensorRise") : 0;
  const variancePct = hasSensor && quantity ? Math.round(((quantity - sensorRise) / quantity) * 1000) / 10 : 0;
  const anomaly = hasSensor && variancePct > 10;
  // fill location captured from the driver's phone
  const lat = s(fd, "lat") ? finiteNumber(fd.get("lat"), "Latitude", { min: -90, max: 90 }) : null;
  const lng = s(fd, "lng") ? finiteNumber(fd.get("lng"), "Longitude", { min: -180, max: 180 }) : null;
  const assetId = s(fd, "assetId") || null;

  if (quantity <= 0) throw new ActionError("Fuel quantity must be greater than 0 litres.");

  const tankId = s(fd, "tankId") || null;
  const asset = assetId ? await db.asset.findUnique({ where: { id: assetId } }) : null;
  if (asset && asset.fuelCapacity > 0 && quantity > asset.fuelCapacity * 1.5) {
    throw new ActionError(`Fuel quantity (${quantity} L) exceeds plausible tank capacity (${asset.fuelCapacity} L).`);
  }

  // The driver wizard calls the same action as the office fuel form. A Server
  // Action is still directly POSTable, so a driver must prove the submitted
  // asset is their assigned vehicle before it can create either a fuel row or
  // the notification that follows it.
  let driverEvent: ReturnType<typeof driverFuelFillNotification> | null = null;
  let driverName: string | null = null;
  let claimedSessionId: string | null = null;
  if (access.group === "DRIVER") {
    if (!assetId || !access.driverId || !(await canSeeAsset(access, assetId))) {
      throw new ActionError("You may record fuel only for your assigned vehicle.");
    }
    const [driver, claimedSession] = await Promise.all([
      db.driver.findUnique({ where: { id: access.driverId }, select: { id: true, name: true } }),
      db.tripSession.findFirst({
        where: { assetId, driverId: access.driverId, userId: access.session.id, status: "ACTIVE" },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      }),
    ]);
    if (!driver || !asset) throw new ActionError("Your assigned vehicle could not be found.");
    if (!claimedSession) throw new ActionError("Check in to this vehicle before recording fuel.");
    driverName = driver.name;
    claimedSessionId = claimedSession.id;
    driverEvent = driverFuelFillNotification({
      assetId: asset.id,
      assetCode: asset.code,
      driverId: driver.id,
      driverName: driver.name,
      quantity,
      rate,
    });
  }

  // Camera captures are optional verification evidence. The fuel entry itself
  // must remain usable when a low-end phone has no camera, storage, or signal.
  // `uploadPhoto` returns null for an omitted capture, preserving that fact.
  const [odometerPhoto, pumpPhoto, afterOdometerPhoto] = await Promise.all([
    uploadPhoto(fd.get("odometerPhoto"), "odo-before"),
    uploadPhoto(fd.get("pumpPhoto"), "pump"),
    uploadPhoto(fd.get("afterOdometerPhoto"), "odo-after"),
  ]);

  // geofence check: how far is the fill from the vehicle's known GPS position?
  let geofenceOk = fd.get("geofenceOk") !== "false";
  if (lat != null && lng != null && asset && (asset.lat || asset.lng)) {
    const R = 6371, dLat = ((asset.lat - lat) * Math.PI) / 180, dLng = ((asset.lng - lng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) * Math.cos((asset.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (distKm > 15) geofenceOk = false; // fill logged >15km from the vehicle
  }

  const meterValue = boundedNumber(fd.get("meterValue"), "Meter reading", { min: 0, max: 10_000_000, fallback: 0 });
  const activeSession = assetId
    ? await db.tripSession.findFirst({
        where: { assetId, status: "ACTIVE" },
        orderBy: { startedAt: "desc" },
      })
    : null;

  const fuelledAt = new Date();
  await businessTransaction(access.session, async (tx) => {
    // Re-read inside the serializable transaction. A checkout that won the
    // race after the camera capture must not leave a fill linked to a closed
    // or different driver's claim.
    const session = access.group === "DRIVER"
      ? await tx.tripSession.findFirst({
          where: { id: claimedSessionId ?? "__none__", assetId: assetId!, driverId: access.driverId!, userId: access.session.id, status: "ACTIVE" },
          select: { id: true, projectId: true },
        })
      : activeSession;
    if (access.group === "DRIVER" && !session) throw new ActionError("Your vehicle check-in ended before this fuel record was saved. Check in again and retry.");
    await tx.fuelTransaction.create({
      data: {
        type,
        assetId,
        tankId,
        sessionId: session?.id ?? null,
        source: tankId ? "SITE_TANK" : s(fd, "source") || "RETAIL",
        projectId: access.group === "DRIVER" ? session?.projectId ?? asset?.projectId ?? null : s(fd, "projectId") || asset?.projectId || null,
        quantity,
        rate,
        amount: access.group === "DRIVER" ? financials.amount : Math.round(quantity * rate),
        meterValue,
        sensorRise,
        variancePct,
        anomaly,
        geofenceOk,
        odometerPhoto,
        pumpPhoto,
        afterOdometerPhoto,
        issuedBy: driverName ?? (s(fd, "issuedBy") || null),
        lat,
        lng,
        date: fuelledAt,
      },
    });

    if (tankId) {
      await tx.fuelTank.update({
        where: { id: tankId },
        data: { currentLevel: { decrement: quantity } },
      });
    }

    if (driverEvent) await tx.alert.create({ data: driverEvent });

    if (assetId && meterValue > 0) {
      const currentMeter = asset?.meterValue ?? 0;
      // Only advance odometer; prevent backwards rollback
      if (meterValue >= currentMeter) {
        await tx.asset.update({
          where: { id: assetId },
          data: {
            meterValue,
            ...(lat != null && lng != null ? { lat, lng } : {}),
            lastSeen: new Date(),
          },
        });
        await tx.meterReading.create({
          data: {
            assetId,
            meterType: "ODOMETER",
            value: meterValue,
            source: "FUEL",
            date: new Date(),
          },
        });
      }
    }
  });

  revalidatePath("/fuel");
  revalidatePath("/");
  revalidatePath("/reports");
  revalidatePath("/reports/notifications");
  await invalidateLiveFleetCache();
}


/* ----------------------------- SERVICE / REPAIR PHOTOS (driver) ----------------------------- */
async function saveServicePhotos__impl(fd: FormData) {
  const scopeAccess = await requireAction("maintenance.edit");
  await assertFormAccess(scopeAccess, fd);
  const assetId = s(fd, "assetId");
  if (!assetId) throw new ActionError("Select a vehicle.");
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ActionError("Vehicle not found.");

  const collect = async (field: string, prefix: string) => {
    const files = fd.getAll(field).filter((f) => typeof f !== "string" && (f as File).size > 0) as File[];
    const urls: string[] = [];
    for (const f of files) { const u = await uploadPhoto(f, prefix); if (u) urls.push(u); }
    return urls;
  };
  const oldUrls = await collect("oldPhotos", "oldpart");
  const newUrls = await collect("newPhotos", "newpart");
  await db.workOrder.create({
    data: {
      woNo: `SR-${Date.now().toString().slice(-8)}`,
      assetId,
      type: "REPAIR",
      priority: "Medium",
      status: "Completed",
      description: s(fd, "note") || "Repair part photos (old + new) uploaded by driver",
      partPhotos: JSON.stringify({ old: oldUrls, new: newUrls }),
      completedAt: new Date(),
    },
  });
  revalidatePath("/maintenance");
  revalidatePath("/driver");
}

async function setDieselRate__impl(fd: FormData) {
  const scopeAccess = await requireAction("admin.settings");
  await assertFormAccess(scopeAccess, fd);
  assertGlobalAccess(scopeAccess);
  const session = await getSession();
  if (session?.role !== "Admin") throw new ActionError("Only admins can set the rate.");
  const rate = boundedNumber(fd.get("rate"), "Diesel rate", { min: 30, max: 200 });
  await db.setting.upsert({ where: { key: "dieselRate" }, update: { value: String(rate) }, create: { key: "dieselRate", value: String(rate) } });
  await serverCache.del(DIESEL_RATE_CACHE_KEY);
  revalidatePath("/fuel");
  revalidatePath("/driver");
}

async function updateFuel__impl(id: string, fd: FormData) {
  const scopeAccess = await requireAction("fuel.issue");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "fuelTransaction", id);
  const quantity = positiveNumber(fd.get("quantity"), "Fuel quantity", { max: 100_000 });
  const rate = positiveNumber(fd.get("rate") || 92.5, "Fuel rate", { max: 500 });
  const meterValue = boundedNumber(fd.get("meterValue"), "Meter reading", { min: 0, max: 10_000_000, fallback: 0 });
  const data: { quantity: number; rate: number; amount: number; meterValue: number; date?: Date } = {
    quantity, rate, amount: Math.round(quantity * rate), meterValue,
  };
  const d = safeParseDate(fd.get("date"), "Fuel transaction date");
  if (d) data.date = d;
  await db.fuelTransaction.update({ where: { id }, data });
  revalidatePath("/fuel");
  revalidatePath("/");
  await invalidateLiveFleetCache();
}

async function deleteFuel__impl(id: string) {
  const scopeAccess = await requireAction("fuel.approve");
  await assertRecordAccess(scopeAccess, "fuelTransaction", id);
  await db.fuelTransaction.delete({ where: { id } });
  revalidatePath("/fuel");
  revalidatePath("/");
  await invalidateLiveFleetCache();
}

/* ----------------------------- WORK ORDER ----------------------------- */
const VALID_WO_TYPES = ["PM", "REPAIR", "BREAKDOWN", "INSPECTION", "TYRE"] as const;
const VALID_WO_PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
const VALID_WO_STATUSES = ["Open", "In-Progress", "Waiting-Parts", "Completed", "Closed"] as const;

async function saveWorkOrder__impl(fd: FormData) {
  const scopeAccess = await requireAction("maintenance.edit");
  await assertFormAccess(scopeAccess, fd);
  const labor = nonNegativeNumber(fd.get("laborCost"), "Labor cost", { max: 10_000_000, fallback: 0 });
  const parts = nonNegativeNumber(fd.get("partsCost"), "Parts cost", { max: 50_000_000, fallback: 0 });
  const downtimeHrs = boundedNumber(fd.get("downtimeHrs"), "Downtime hours", { min: 0, max: 8_760, fallback: 0 });
  const assetId = s(fd, "assetId");
  if (!assetId) throw new ActionError("Asset is required.");
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ActionError("Asset not found.");

  const type = oneOf(s(fd, "type") || "PM", VALID_WO_TYPES, "work order type");
  const priority = oneOf(s(fd, "priority") || "Medium", VALID_WO_PRIORITIES, "priority");
  const status = oneOf(s(fd, "status") || "Open", VALID_WO_STATUSES, "work order status");

  await businessTransaction(scopeAccess.session, async (tx) => {
    await tx.workOrder.create({
      data: {
        woNo: `WO-${Date.now().toString().slice(-8)}`,
        assetId,
        projectId: asset.projectId,
        type,
        priority,
        status,
        description: s(fd, "description"),
        laborCost: labor,
        partsCost: parts,
        totalCost: labor + parts,
        downtimeHrs,
        warranty: fd.get("warranty") === "on",
        reportedAt: new Date(),
        completedAt: status === "Completed" || status === "Closed" ? new Date() : null,
      },
    });

    if (assetId && (type === "BREAKDOWN" || priority === "Critical") && status !== "Completed" && status !== "Closed") {
      await tx.asset.update({
        where: { id: assetId },
        data: { status: "Breakdown" },
      });
    }
  });
  revalidatePath("/maintenance");
  revalidatePath("/");
}

async function updateWorkOrderStatus__impl(id: string, status: string) {
  const access = await requireAction("maintenance.edit");
  const validStatus = oneOf(status, VALID_WO_STATUSES, "work order status");
  await changeWorkOrderStatus(access, id, validStatus);
  revalidatePath("/maintenance");
  revalidatePath("/fleet");
  revalidatePath("/costs");
  revalidatePath("/");
  await invalidateLiveFleetCache();
}

/* ----------------------------- COMPLIANCE ----------------------------- */
const VALID_DOC_TYPES = [
  "RC", "FITNESS", "INSURANCE", "PUC", "ROAD_TAX", "NATIONAL_PERMIT", "STATE_PERMIT", "CALIBRATION",
] as const;

async function saveCompliance__impl(fd: FormData) {
  const scopeAccess = await requireAction("compliance.edit");
  await assertFormAccess(scopeAccess, fd);
  const docType = oneOf(s(fd, "docType"), VALID_DOC_TYPES, "compliance document type");
  const number = s(fd, "number");
  if (!number) throw new ActionError("Document number is required.");
  const issueDate = safeParseDate(fd.get("issueDate"), "Issue date") || new Date();
  const expiry = safeParseDate(fd.get("expiryDate"), "Expiry date", { required: true })!;
  validateDateRange(issueDate, expiry, "Compliance document validity");

  await db.complianceDoc.create({
    data: {
      assetId: s(fd, "assetId"),
      docType,
      number,
      issueDate,
      expiryDate: expiry,
      status: docStatus(expiry),
    },
  });
  revalidatePath("/compliance");
  revalidatePath("/my/documents");
  revalidatePath("/my");
  revalidatePath("/");
}

async function renewComplianceDoc__impl(id: string, fd: FormData) {
  const scopeAccess = await requireAction("compliance.edit");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "complianceDoc", id);
  const number = s(fd, "number");
  const issueDate = safeParseDate(fd.get("issueDate"), "Issue date") || new Date();
  const expiry = safeParseDate(fd.get("expiryDate"), "Expiry date", { required: true })!;
  validateDateRange(issueDate, expiry, "Compliance document validity");

  await db.complianceDoc.update({
    where: { id },
    data: {
      ...(number ? { number } : {}),
      issueDate,
      expiryDate: expiry,
      status: docStatus(expiry),
    },
  });

  revalidatePath("/compliance");
  revalidatePath("/my/documents");
  revalidatePath("/my");
  revalidatePath("/fleet");
  revalidatePath("/");
}

/* ----------------------------- USERS / ACCESS ----------------------------- */
async function saveUser__impl(fd: FormData) {
  const scopeAccess = await requireAction("admin.users");
  await assertFormAccess(scopeAccess, fd);
  const email = s(fd, "email").toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new ActionError("A user with this email already exists.");
  const role = s(fd, "role") || "Driver";
  const name = s(fd, "name");
  const password = s(fd, "password");
  const passwordError = passwordPolicyError(password);
  if (passwordError) throw new ActionError(passwordError);
  let driverId = s(fd, "driverId") || null;

  // If role is Driver and no existing driver is selected, auto-create a person record
  if (role === "Driver" && !driverId && s(fd, "autoCreateDriver") !== "false") {
    const empCode = s(fd, "empCode") || `DRV-${Math.floor(1000 + Math.random() * 9000)}`;
    const phone = s(fd, "phone") || "9999999999";
    const licenseNo = s(fd, "licenseNo") || "DL-PENDING";
    const driver = await db.driver.create({
      data: {
        name,
        empCode,
        phone,
        licenseNo,
        type: "DRIVER",
        status: "Active",
        licenseExpiry: new Date(Date.now() + 365 * 86400000),
      },
    });
    driverId = driver.id;
  }

  const roleRecord = await db.role.findUnique({ where: { name: role } });

  await db.user.create({
    data: {
      name,
      email,
      role,
      roleId: roleRecord?.id ?? null,
      driverId,
      password: await hashPassword(password),
    },
  });
  revalidatePath("/users");
  revalidatePath("/admin/roles");
  revalidatePath("/drivers");
}

/**
 * Guarded on identity rather than a permission — everyone may change their own
 * password, and nobody may change it without proving they know the current one.
 */
async function changeOwnPassword__impl(fd: FormData) {
  const access = await requireUser();
  const current = s(fd, "current"), next = s(fd, "next"), confirm = s(fd, "confirm");
  const passwordError = passwordPolicyError(next);
  if (passwordError) throw new ActionError(passwordError);
  if (next !== confirm) throw new ActionError("New passwords do not match.");
  const user = await db.user.findUnique({ where: { id: access.session.id } });
  if (!user || !(await verifyPassword(current, user.password))) {
    throw new ActionError("Current password is incorrect.");
  }
  await db.user.update({ where: { id: user.id }, data: { password: await hashPassword(next) } });

  // The point of changing a password is usually that the old one is no longer
  // trusted. Sessions opened with it have to die with it, on every device.
  await revokeSessions(user.id);
  await audit({
    action: "UPDATE", module: "ADMIN", entity: "User", entityId: user.id,
    summary: `${user.name} changed their own password`,
  });
}

async function adminResetUserPassword__impl(userId: string, newPass: string) {
  await requireAction("admin.users");
  const passwordError = passwordPolicyError(newPass);
  if (passwordError) throw new ActionError(passwordError);
  const target = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  if (!target) throw new ActionError("That user no longer exists.");

  await db.user.update({ where: { id: userId }, data: { password: await hashPassword(newPass) } });
  // A reset is an access-removal event as often as it is a helpdesk one.
  await revokeSessions(userId);
  await audit({
    action: "UPDATE", module: "ADMIN", entity: "User", entityId: userId,
    summary: `Reset the password for ${target.name} (${target.email})`,
  });
  revalidatePath("/users");
}

async function deleteUser__impl(id: string) {
  const access = await requireAction("admin.users");
  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw new ActionError("That user no longer exists.");

  if (user.role === "Admin") {
    const admins = await db.user.count({ where: { role: "Admin" } });
    if (admins <= 1) throw new ActionError("Cannot delete the last admin account.");
  }
  // Deleting your own login locks you out mid-session and, if you were the
  // second-to-last admin, can leave the system with no way back in.
  if (user.id === access.session.id) {
    throw new ActionError("You cannot delete the account you are signed in with.");
  }

  await db.user.delete({ where: { id } });
  // The row is gone; the cookie is not. Without this, a deleted user's session
  // keeps working until it expires.
  await revokeSessions(id);
  await audit({
    action: "DELETE", module: "ADMIN", entity: "User", entityId: id,
    summary: `Deleted the user ${user.name} (${user.email})`,
    changes: { name: user.name, email: user.email, role: user.role },
  });
  revalidatePath("/users");
}

/* ----------------------------- PROJECT ----------------------------- */
async function saveProject__impl(fd: FormData) {
  const scopeAccess = await requireAction("fleet.edit");
  await assertFormAccess(scopeAccess, fd);
  assertGlobalAccess(scopeAccess);
  const code = s(fd, "code");
  const name = s(fd, "name");
  if (!code || !name) throw new ActionError("Project code and name are required");

  // Uniqueness check
  const existing = await db.project.findUnique({ where: { code } });
  if (existing) throw new ActionError(`A project with code "${code}" already exists`);

  const budget = nonNegativeNumber(fd.get("budget"), "Project budget", { max: 100_000_000_000, fallback: 0 });
  const spent = nonNegativeNumber(fd.get("spent"), "Spent amount", { max: 100_000_000_000, fallback: 0 });
  const coords = coordinatePair(fd.get("lat"), fd.get("lng"), "Project location");

  const project = await db.project.create({
    data: {
      code,
      name,
      location: s(fd, "location"),
      client: s(fd, "client"),
      budget,
      spent,
      lat: coords.lat ?? 0,
      lng: coords.lng ?? 0,
      status: s(fd, "status") || "Active",
    },
  });

  await audit({
    action: "CREATE",
    module: "PROJECT",
    entity: "Project",
    entityId: project.id,
    summary: `Created project ${code} — ${name}`,
  });

  revalidatePath("/sites");
  revalidatePath("/projects");
  revalidatePath("/fleet");
  revalidatePath("/operations");
  revalidatePath("/fuel");
  revalidatePath("/production");
  revalidatePath("/costs");
  revalidatePath("/");
}

async function updateProject__impl(id: string, fd: FormData) {
  const scopeAccess = await requireAction("fleet.edit");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "project", id);
  const code = s(fd, "code");
  const name = s(fd, "name");
  if (!code || !name) throw new ActionError("Project code and name are required");

  const existing = await db.project.findUnique({ where: { id } });
  if (!existing) throw new ActionError("Project not found");

  // Uniqueness check (skip self)
  const dup = await db.project.findUnique({ where: { code } });
  if (dup && dup.id !== id) throw new ActionError(`A project with code "${code}" already exists`);

  const budget = nonNegativeNumber(fd.get("budget"), "Project budget", { max: 100_000_000_000, fallback: 0 });
  const spent = nonNegativeNumber(fd.get("spent"), "Spent amount", { max: 100_000_000_000, fallback: 0 });
  const coords = coordinatePair(fd.get("lat"), fd.get("lng"), "Project location");

  await db.project.update({
    where: { id },
    data: {
      code,
      name,
      location: s(fd, "location"),
      client: s(fd, "client"),
      budget,
      spent,
      lat: coords.lat ?? 0,
      lng: coords.lng ?? 0,
      status: s(fd, "status") || existing.status,
    },
  });

  await audit({
    action: "UPDATE",
    module: "PROJECT",
    entity: "Project",
    entityId: id,
    summary: `Updated project ${code} — ${name}`,
    changes: { from: { code: existing.code, name: existing.name }, to: { code, name } },
  });

  revalidatePath("/sites");
  revalidatePath("/projects");
  revalidatePath("/fleet");
  revalidatePath("/operations");
  revalidatePath("/fuel");
  revalidatePath("/production");
  revalidatePath("/costs");
  revalidatePath("/");
}

async function deleteProject__impl(id: string) {
  const scopeAccess = await requireAction("fleet.edit");
  await assertRecordAccess(scopeAccess, "project", id);
  const project = await db.project.findUnique({ where: { id } });
  if (!project) throw new ActionError("Project not found");

  // ACID: single transaction for all cascade cleanup across all 15 project relations
  await businessTransaction(scopeAccess.session, async (tx) => {
    // 1. Unlink optional relations (set projectId to null so historical logs remain intact)
    await tx.asset.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await tx.trip.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await tx.fuelTransaction.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await tx.workOrder.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await tx.costTransaction.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await tx.productionLog.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await tx.attendance.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await tx.weighbridgeTicket.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await tx.tripSession.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await tx.fuelTank.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await tx.fraudCase.updateMany({ where: { projectId: id }, data: { projectId: null } });

    // 2. Delete child models required by or strictly bound to this project
    await tx.projectRevenue.deleteMany({ where: { projectId: id } });
    await tx.allocation.deleteMany({ where: { projectId: id } });
    await tx.mobilizationOrder.deleteMany({ where: { OR: [{ toProjectId: id }, { fromProjectId: id }] } });
    await tx.equipmentPlan.deleteMany({ where: { projectId: id } });
    await tx.site.deleteMany({ where: { projectId: id } });

    // 3. Delete the project
    await tx.project.delete({ where: { id } });
  });

  await audit({
    action: "DELETE",
    module: "PROJECT",
    entity: "Project",
    entityId: id,
    summary: `Deleted project ${project.code} — ${project.name}`,
  });

  revalidatePath("/sites");
  revalidatePath("/projects");
  revalidatePath("/fleet");
  revalidatePath("/operations");
  revalidatePath("/fuel");
  revalidatePath("/production");
  revalidatePath("/costs");
  revalidatePath("/");
}

/* ---------------------------------------------------------------------------
 * Exported actions.
 *
 * Each implementation above is wrapped in `safe()`, which converts an
 * `ActionError` into a returned `{ error }`. Next redacts *thrown* messages in
 * production builds, so validation text like "Phone must be a valid 10-digit
 * Indian mobile number" never reached the person typing it — the form's error
 * banner rendered faithfully and said nothing useful. Returned data crosses the
 * boundary intact.
 *
 * Unexpected errors are still thrown, so they reach the error boundary and the
 * platform log rather than being dressed up as a validation message.
 * ------------------------------------------------------------------------- */
export const saveAsset = safe(saveAsset__impl);
export const deleteAsset = safe(deleteAsset__impl);
export const saveDriver = safe(saveDriver__impl);
export const deleteDriver = safe(deleteDriver__impl);
export const saveFuel = safe(saveFuel__impl);
export const saveServicePhotos = safe(saveServicePhotos__impl);
export const setDieselRate = safe(setDieselRate__impl);
export const updateFuel = safe(updateFuel__impl);
export const deleteFuel = safe(deleteFuel__impl);
export const saveWorkOrder = safe(saveWorkOrder__impl);
export const updateWorkOrderStatus = safe(updateWorkOrderStatus__impl);
export const saveCompliance = safe(saveCompliance__impl);
export const renewComplianceDoc = safe(renewComplianceDoc__impl);
export const saveUser = safe(saveUser__impl);
export const changeOwnPassword = safe(changeOwnPassword__impl);
export const adminResetUserPassword = safe(adminResetUserPassword__impl);
export const deleteUser = safe(deleteUser__impl);
export const saveProject = safe(saveProject__impl);
export const updateProject = safe(updateProject__impl);
export const deleteProject = safe(deleteProject__impl);
