"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { hashPassword, verifyPassword, getSession } from "@/lib/auth";
import { getDieselRate } from "@/lib/settings";

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

function docStatus(expiry: Date) {
  const days = (expiry.getTime() - Date.now()) / 86400000;
  return days < 0 ? "Expired" : days < 30 ? "Expiring" : "Valid";
}

/* ----------------------------- ASSETS ----------------------------- */
export async function saveAsset(id: string | null, fd: FormData) {
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
    ...(s(fd, "lat") ? { lat: n(fd, "lat") } : {}),
    ...(s(fd, "lng") ? { lng: n(fd, "lng") } : {}),
  };
  if (id) await db.asset.update({ where: { id }, data });
  else await db.asset.create({ data });
  revalidatePath("/fleet");
  revalidatePath("/");
}

export async function deleteAsset(id: string) {
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
export async function saveDriver(id: string | null, fd: FormData) {
  const phone = s(fd, "phone");

  // Phone format validation — 10-digit Indian mobile number (no country code).
  // The regex accepts an optional leading +91 or 0 prefix before the 10 digits.
  // Source: standard Indian telecom numbering plan (TRAI); digits 6–9 as first digit
  // covers all current Jio/Airtel/Vi/BSNL ranges.
  if (phone && !/^(?:\+91|91|0)?[6-9]\d{9}$/.test(phone)) {
    throw new Error("Phone must be a valid 10-digit Indian mobile number (e.g. 9XXXXXXXXX).");
  }

  // License number format: [STATE:2alpha][RTO:2digits] [YEAR:4digits][SERIAL:7digits]
  // Confirmed team format example: RJ14 20241234567
  // The space between RTO code and year is optional to handle legacy entries without it.
  // Case-insensitive — stored/displayed as-is but both RJ14 and rj14 are accepted on entry.
  // Note: existing seed data may pre-date this validation; the check only runs on new saves.
  const licenseNo = s(fd, "licenseNo");
  if (licenseNo && !/^[A-Za-z]{2}\d{2}\s?\d{11}$/.test(licenseNo)) {
    throw new Error(
      'License number must follow the format: state code + RTO code + year + serial (e.g. RJ14 20241234567).'
    );
  }


  // Duplicate phone check — two drivers must not share the same phone number.
  if (phone) {
    const existing = await db.driver.findFirst({
      where: { phone, ...(id ? { NOT: { id } } : {}) },
    });
    if (existing) {
      throw new Error(
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
  if (id) await db.driver.update({ where: { id }, data });
  else await db.driver.create({ data });
  revalidatePath("/drivers");
}

export async function deleteDriver(id: string) {
  await db.asset.updateMany({ where: { driverId: id }, data: { driverId: null } });
  await db.trip.updateMany({ where: { driverId: id }, data: { driverId: null } });
  await db.alert.updateMany({ where: { driverId: id }, data: { driverId: null } });
  await db.driver.delete({ where: { id } });
  revalidatePath("/drivers");
}

/* ----------------------------- FUEL ----------------------------- */
export async function saveFuel(fd: FormData) {
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
export async function saveServicePhotos(fd: FormData) {
  const assetId = s(fd, "assetId");
  if (!assetId) throw new Error("Select a vehicle.");
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

export async function setDieselRate(fd: FormData) {
  const session = await getSession();
  if (session?.role !== "Admin") throw new Error("Only admins can set the rate.");
  const rate = n(fd, "rate");
  if (!rate || rate < 30 || rate > 200) throw new Error("Enter a valid diesel rate (₹/L).");
  await db.setting.upsert({ where: { key: "dieselRate" }, update: { value: String(rate) }, create: { key: "dieselRate", value: String(rate) } });
  revalidatePath("/fuel");
  revalidatePath("/driver");
}

export async function updateFuel(id: string, fd: FormData) {
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

export async function deleteFuel(id: string) {
  await db.fuelTransaction.delete({ where: { id } });
  revalidatePath("/fuel");
  revalidatePath("/");
}

/* ----------------------------- WORK ORDER ----------------------------- */
export async function saveWorkOrder(fd: FormData) {
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

export async function updateWorkOrderStatus(id: string, status: string) {
  await db.workOrder.update({
    where: { id },
    data: { status, completedAt: status === "Completed" || status === "Closed" ? new Date() : null },
  });
  revalidatePath("/maintenance");
}

/* ----------------------------- COMPLIANCE ----------------------------- */
export async function saveCompliance(fd: FormData) {
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
  revalidatePath("/");
}

/* ----------------------------- USERS / ACCESS ----------------------------- */
export async function saveUser(fd: FormData) {
  const email = s(fd, "email").toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new Error("A user with this email already exists.");
  await db.user.create({
    data: {
      name: s(fd, "name"),
      email,
      role: s(fd, "role") || "Driver",
      password: await hashPassword(s(fd, "password") || "driver123"),
    },
  });
  revalidatePath("/users");
}

export async function changeOwnPassword(fd: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  const current = s(fd, "current"), next = s(fd, "next"), confirm = s(fd, "confirm");
  if (next.length < 6) throw new Error("New password must be at least 6 characters.");
  if (next !== confirm) throw new Error("New passwords do not match.");
  const user = await db.user.findUnique({ where: { id: session.id } });
  if (!user || !(await verifyPassword(current, user.password))) throw new Error("Current password is incorrect.");
  await db.user.update({ where: { id: user.id }, data: { password: await hashPassword(next) } });
}

export async function adminResetUserPassword(userId: string, newPass: string) {
  const session = await getSession();
  if (session?.role !== "Admin") throw new Error("Only admins can reset passwords.");
  if (!newPass || newPass.length < 6) throw new Error("Password must be at least 6 characters.");
  await db.user.update({ where: { id: userId }, data: { password: await hashPassword(newPass) } });
  revalidatePath("/users");
}

export async function deleteUser(id: string) {
  const user = await db.user.findUnique({ where: { id } });
  if (user?.role === "Admin") {
    const admins = await db.user.count({ where: { role: "Admin" } });
    if (admins <= 1) throw new Error("Cannot delete the last admin account.");
  }
  await db.user.delete({ where: { id } });
  revalidatePath("/users");
}

/* ----------------------------- PROJECT ----------------------------- */
export async function saveProject(fd: FormData) {
  const code = s(fd, "code");
  const name = s(fd, "name");
  if (!code || !name) throw new Error("Project code and name are required");

  // Uniqueness check
  const existing = await db.project.findUnique({ where: { code } });
  if (existing) throw new Error(`A project with code "${code}" already exists`);

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

  const { audit } = await import("@/app/(app)/admin/actions");
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

export async function updateProject(id: string, fd: FormData) {
  const code = s(fd, "code");
  const name = s(fd, "name");
  if (!code || !name) throw new Error("Project code and name are required");

  const existing = await db.project.findUnique({ where: { id } });
  if (!existing) throw new Error("Project not found");

  // Uniqueness check (skip self)
  const dup = await db.project.findUnique({ where: { code } });
  if (dup && dup.id !== id) throw new Error(`A project with code "${code}" already exists`);

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

  const { audit } = await import("@/app/(app)/admin/actions");
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

export async function deleteProject(id: string) {
  const project = await db.project.findUnique({ where: { id } });
  if (!project) throw new Error("Project not found");

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

  const { audit } = await import("@/app/(app)/admin/actions");
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

