"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { hashPassword, verifyPassword, getSession, revokeSessions } from "@/lib/auth";
import { getDieselRate } from "@/lib/settings";
import { requireAction, requireUser, ActionError, safe } from "@/lib/guard";
import { audit } from "@/lib/audit";

async function uploadPhoto(file: FormDataEntryValue | null, prefix: string): Promise<string | null> {
  if (!file || typeof file === "string") return null;
  const f = file as File;
  if (!f.size) return null;
  const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
  const blob = await put(`fuel/${prefix}-${Date.now()}.${ext}`, f, { access: "public", addRandomSuffix: true });
  return blob.url;
}

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k) ?? 0) || 0;

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

/* ----------------------------- ASSETS ----------------------------- */
async function saveAsset__impl(id: string | null, fd: FormData) {
  await requireAction("fleet.edit");
  const data = {
    code: s(fd, "code"),
    name: s(fd, "name"),
    assetClass: s(fd, "assetClass"),
    category: s(fd, "category") || "VEHICLE",
    ownershipType: s(fd, "ownershipType"),
    make: s(fd, "make"),
    model: s(fd, "model"),
    yearMfg: n(fd, "yearMfg") || new Date().getFullYear(),
    primaryMeter: s(fd, "primaryMeter"),
    meterValue: n(fd, "meterValue"),
    fuelCapacity: n(fd, "fuelCapacity"),
    status: s(fd, "status") || "Active",
    registrationNo: s(fd, "registrationNo") || null,
    acquisitionCost: n(fd, "acquisitionCost"),
    healthScore: n(fd, "healthScore") || 90,
    utilization: n(fd, "utilization"),
    serviceDueDate: s(fd, "serviceDueDate") ? new Date(s(fd, "serviceDueDate")) : null,
    lastServiceDate: s(fd, "lastServiceDate") ? new Date(s(fd, "lastServiceDate")) : null,
    projectId: s(fd, "projectId") || null,
    // Identity and specification. These were not in the form at all, so
    // `chassisNo` and `engineNo` were unreachable once a vehicle existed, and
    // the specification fields the vehicle page now shows had no way of ever
    // being filled — every one of them would have read "not recorded" forever.
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
    enginePowerHp: nOrNull(fd, "enginePowerHp"),
    torqueNm: nOrNull(fd, "torqueNm"),
    ladenWeightKg: nOrNull(fd, "ladenWeightKg"),
    unladenWeightKg: nOrNull(fd, "unladenWeightKg"),
    tonnage: nOrNull(fd, "tonnage"),
    registrationDate: s(fd, "registrationDate") ? new Date(s(fd, "registrationDate")) : null,
    ...(s(fd, "lat") ? { lat: n(fd, "lat") } : {}),
    ...(s(fd, "lng") ? { lng: n(fd, "lng") } : {}),
  };
  if (id) await db.asset.update({ where: { id }, data });
  else await db.asset.create({ data });
  revalidatePath("/fleet");
  revalidatePath("/");
}

async function deleteAsset__impl(id: string) {
  await requireAction("fleet.delete");
  await db.$transaction([
    db.fuelTransaction.deleteMany({ where: { assetId: id } }),
    db.trip.deleteMany({ where: { assetId: id } }),
    db.workOrder.deleteMany({ where: { assetId: id } }),
    db.complianceDoc.deleteMany({ where: { assetId: id } }),
    db.alert.deleteMany({ where: { assetId: id } }),
    db.costTransaction.deleteMany({ where: { assetId: id } }),
    db.asset.delete({ where: { id } }),
  ]);
  revalidatePath("/fleet");
}

/* ----------------------------- DRIVERS ----------------------------- */
async function saveDriver__impl(id: string | null, fd: FormData) {
  await requireAction("people.edit");
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

  const data = {
    empCode: s(fd, "empCode"),
    name: s(fd, "name"),
    phone,
    type: s(fd, "type") || "DRIVER",
    licenseNo,
    licenseExpiry: new Date(s(fd, "licenseExpiry") || Date.now()),
    certifications: s(fd, "certifications"),
    safetyScore: n(fd, "safetyScore") || 80,
    performanceScore: n(fd, "performanceScore") || 80,
    attendance: n(fd, "attendance") || 95,
    status: s(fd, "status") || "Active",
  };
  if (id) {
    await db.driver.update({ where: { id }, data });
  } else {
    const driver = await db.driver.create({ data });
    const createLogin = s(fd, "createLogin") === "true";
    const loginEmail = s(fd, "loginEmail").toLowerCase();
    const loginPassword = s(fd, "loginPassword") || "driver123";

    if (createLogin && loginEmail) {
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
  await requireAction("people.edit");
  await db.asset.updateMany({ where: { driverId: id }, data: { driverId: null } });
  await db.trip.updateMany({ where: { driverId: id }, data: { driverId: null } });
  await db.alert.updateMany({ where: { driverId: id }, data: { driverId: null } });
  await db.user.updateMany({ where: { driverId: id }, data: { driverId: null } });
  await db.driver.delete({ where: { id } });
  revalidatePath("/drivers");
  revalidatePath("/users");
}

/* ----------------------------- FUEL ----------------------------- */
async function saveFuel__impl(fd: FormData) {
  await requireAction("fuel.issue");
  const type = s(fd, "type") || "ISSUE";
  const quantity = n(fd, "quantity");
  const rate = n(fd, "rate") || (await getDieselRate());
  const hasSensor = type === "ISSUE" && String(fd.get("sensorRise") ?? "").trim() !== "";
  const sensorRise = hasSensor ? n(fd, "sensorRise") : 0;
  const variancePct = hasSensor && quantity ? Math.round(((quantity - sensorRise) / quantity) * 1000) / 10 : 0;
  const anomaly = hasSensor && variancePct > 10;
  const [odometerPhoto, pumpPhoto] = await Promise.all([
    uploadPhoto(fd.get("odometerPhoto"), "odo"),
    uploadPhoto(fd.get("pumpPhoto"), "pump"),
  ]);

  // fill location captured from the driver's phone
  const lat = s(fd, "lat") ? Number(fd.get("lat")) : null;
  const lng = s(fd, "lng") ? Number(fd.get("lng")) : null;
  const assetId = s(fd, "assetId") || null;

  // geofence check: how far is the fill from the vehicle's known GPS position?
  let geofenceOk = fd.get("geofenceOk") !== "false";
  if (lat != null && lng != null && assetId) {
    const asset = await db.asset.findUnique({ where: { id: assetId } });
    if (asset && (asset.lat || asset.lng)) {
      const R = 6371, dLat = ((asset.lat - lat) * Math.PI) / 180, dLng = ((asset.lng - lng) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) * Math.cos((asset.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (distKm > 15) geofenceOk = false; // fill logged >15km from the vehicle
    }
  }

  const meterValue = n(fd, "meterValue");

  await db.$transaction(async (tx) => {
    await tx.fuelTransaction.create({
      data: {
        type,
        assetId,
        projectId: s(fd, "projectId") || null,
        quantity,
        rate,
        amount: quantity * rate,
        meterValue,
        sensorRise,
        variancePct,
        anomaly,
        geofenceOk,
        odometerPhoto,
        pumpPhoto,
        lat,
        lng,
        date: new Date(),
      },
    });

    if (assetId && meterValue > 0) {
      await tx.asset.update({
        where: { id: assetId },
        data: {
          meterValue,
          ...(lat != null && lng != null ? { lat, lng } : {}),
          lastSeen: new Date(),
        },
      });
    }
  });

  revalidatePath("/fuel");
  revalidatePath("/");
}


/* ----------------------------- SERVICE / REPAIR PHOTOS (driver) ----------------------------- */
async function saveServicePhotos__impl(fd: FormData) {
  await requireAction("maintenance.edit");
  const assetId = s(fd, "assetId");
  if (!assetId) throw new ActionError("Select a vehicle.");
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
  await requireAction("admin.settings");
  const session = await getSession();
  if (session?.role !== "Admin") throw new ActionError("Only admins can set the rate.");
  const rate = n(fd, "rate");
  if (!rate || rate < 30 || rate > 200) throw new ActionError("Enter a valid diesel rate (₹/L).");
  await db.setting.upsert({ where: { key: "dieselRate" }, update: { value: String(rate) }, create: { key: "dieselRate", value: String(rate) } });
  revalidatePath("/fuel");
  revalidatePath("/driver");
}

async function updateFuel__impl(id: string, fd: FormData) {
  await requireAction("fuel.issue");
  const quantity = n(fd, "quantity");
  const rate = n(fd, "rate") || 92.5;
  const data: { quantity: number; rate: number; amount: number; meterValue: number; date?: Date } = {
    quantity, rate, amount: Math.round(quantity * rate), meterValue: n(fd, "meterValue"),
  };
  const d = s(fd, "date");
  if (d) data.date = new Date(d);
  await db.fuelTransaction.update({ where: { id }, data });
  revalidatePath("/fuel");
  revalidatePath("/");
}

async function deleteFuel__impl(id: string) {
  await requireAction("fuel.approve");
  await db.fuelTransaction.delete({ where: { id } });
  revalidatePath("/fuel");
  revalidatePath("/");
}

/* ----------------------------- WORK ORDER ----------------------------- */
async function saveWorkOrder__impl(fd: FormData) {
  await requireAction("maintenance.edit");
  const labor = n(fd, "laborCost");
  const parts = n(fd, "partsCost");
  await db.workOrder.create({
    data: {
      woNo: `WO-${Date.now().toString().slice(-8)}`,
      assetId: s(fd, "assetId"),
      type: s(fd, "type") || "PM",
      priority: s(fd, "priority") || "Medium",
      status: s(fd, "status") || "Open",
      description: s(fd, "description"),
      laborCost: labor,
      partsCost: parts,
      totalCost: labor + parts,
      downtimeHrs: n(fd, "downtimeHrs"),
      warranty: fd.get("warranty") === "on",
      reportedAt: new Date(),
      completedAt: s(fd, "status") === "Completed" || s(fd, "status") === "Closed" ? new Date() : null,
    },
  });
  revalidatePath("/maintenance");
  revalidatePath("/");
}

async function updateWorkOrderStatus__impl(id: string, status: string) {
  await requireAction("maintenance.edit");
  await db.workOrder.update({
    where: { id },
    data: { status, completedAt: status === "Completed" || status === "Closed" ? new Date() : null },
  });
  revalidatePath("/maintenance");
}

/* ----------------------------- COMPLIANCE ----------------------------- */
async function saveCompliance__impl(fd: FormData) {
  await requireAction("compliance.edit");
  const expiry = new Date(s(fd, "expiryDate") || Date.now());
  await db.complianceDoc.create({
    data: {
      assetId: s(fd, "assetId"),
      docType: s(fd, "docType"),
      number: s(fd, "number"),
      issueDate: new Date(s(fd, "issueDate") || Date.now()),
      expiryDate: expiry,
      status: docStatus(expiry),
    },
  });
  revalidatePath("/compliance");
  revalidatePath("/my/documents");
  revalidatePath("/my");
  revalidatePath("/");
}

export async function renewComplianceDoc(id: string, fd: FormData) {
  const expiry = new Date(s(fd, "expiryDate") || Date.now());
  const number = s(fd, "number");
  const issueDateStr = s(fd, "issueDate");
  const issueDate = issueDateStr ? new Date(issueDateStr) : new Date();

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
  await requireAction("admin.users");
  const email = s(fd, "email").toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new ActionError("A user with this email already exists.");
  const role = s(fd, "role") || "Driver";
  const name = s(fd, "name");
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
      password: await hashPassword(s(fd, "password") || "driver123"),
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
  if (next.length < 6) throw new ActionError("New password must be at least 6 characters.");
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
  if (!newPass || newPass.length < 6) throw new ActionError("Password must be at least 6 characters.");
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
  await requireAction("fleet.edit");
  const code = s(fd, "code");
  const name = s(fd, "name");
  if (!code || !name) throw new ActionError("Project code and name are required");

  // Uniqueness check
  const existing = await db.project.findUnique({ where: { code } });
  if (existing) throw new ActionError(`A project with code "${code}" already exists`);

  const project = await db.project.create({
    data: {
      code,
      name,
      location: s(fd, "location"),
      client: s(fd, "client"),
      budget: n(fd, "budget"),
      spent: n(fd, "spent"),
      lat: n(fd, "lat"),
      lng: n(fd, "lng"),
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
  await requireAction("fleet.edit");
  const code = s(fd, "code");
  const name = s(fd, "name");
  if (!code || !name) throw new ActionError("Project code and name are required");

  const existing = await db.project.findUnique({ where: { id } });
  if (!existing) throw new ActionError("Project not found");

  // Uniqueness check (skip self)
  const dup = await db.project.findUnique({ where: { code } });
  if (dup && dup.id !== id) throw new ActionError(`A project with code "${code}" already exists`);

  await db.project.update({
    where: { id },
    data: {
      code,
      name,
      location: s(fd, "location"),
      client: s(fd, "client"),
      budget: n(fd, "budget"),
      spent: n(fd, "spent"),
      lat: n(fd, "lat"),
      lng: n(fd, "lng"),
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
  await requireAction("fleet.edit");
  const project = await db.project.findUnique({ where: { id } });
  if (!project) throw new ActionError("Project not found");

  // ACID: single transaction for all cascade cleanup across all 15 project relations
  await db.$transaction(async (tx) => {
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
export const saveUser = safe(saveUser__impl);
export const changeOwnPassword = safe(changeOwnPassword__impl);
export const adminResetUserPassword = safe(adminResetUserPassword__impl);
export const deleteUser = safe(deleteUser__impl);
export const saveProject = safe(saveProject__impl);
export const updateProject = safe(updateProject__impl);
export const deleteProject = safe(deleteProject__impl);
