"use server";

import { businessTransaction } from "@/lib/business-transaction";
import { completeDuty } from "@/lib/trip-service";
import { db } from "@/lib/db";
import {
  formNumber,
  boundedNumber,
  sanitizeString,
  sanitizeOptionalString,
  sanitizeId,
  oneOf,
} from "@/lib/input-validation";
import { assertGlobalAccess, assertFormAccess, assertRecordAccess, recordScope } from "@/lib/record-access";
import { revalidatePath } from "next/cache";
import crypto from "crypto";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { decideGaugeReading, sensorGaugeDecision, makeQrToken, staleSessions, PROVIDERS, type GaugeExtraction, type SessionLite } from "@/lib/telematics";
import { requireAction, ActionError, safe } from "@/lib/guard";
import { scanForFuelTheft } from "@/lib/fuel-theft-scan";
import { fuelSensorState } from "@/lib/fuel-sensor";
import { uploadPrivateFile } from "@/lib/private-upload";
import { assetScope } from "@/lib/access";

const s = (fd: FormData, k: string) => sanitizeString(fd.get(k), k);
const sOrNull = (fd: FormData, k: string) => sanitizeOptionalString(fd.get(k), k);
const n = formNumber;

function refresh() {
  revalidatePath("/tracking");
  revalidatePath("/tracking/sessions");
  revalidatePath("/tracking/fuel-verification");
  revalidatePath("/fleet");
}

/* ------------------------------- QR codes ------------------------------- */

/** Issue permanent cabin QR tokens. Existing tokens are never regenerated —
 *  a sticker already on a windscreen must keep working. */
async function issueQrTokens__impl() {
  const access = await requireAction("fleet.edit");
  assertGlobalAccess(access);
  const assets = await db.asset.findMany({ where: { qrToken: null, ...assetScope(access) }, select: { id: true } });
  for (const a of assets) {
    let token = makeQrToken(crypto.randomFillSync(new Uint8Array(10)));
    // Collisions are vanishingly unlikely but cheap to rule out.
    while (await db.asset.findUnique({ where: { qrToken: token } })) {
      token = makeQrToken(crypto.randomFillSync(new Uint8Array(10)));
    }
    await db.asset.update({ where: { id: a.id }, data: { qrToken: token } });
  }
  if (assets.length) await audit({ action: "CREATE", module: "FLEET", summary: `Issued QR tokens for ${assets.length} vehicles` });
  refresh();
  return { ok: true as const, issued: assets.length };
}

/* --------------------------- telematics providers --------------------------- */

async function seedProviders__impl() {
  const scopeAccess = await requireAction("admin.settings");
  assertGlobalAccess(scopeAccess);
  for (const p of PROVIDERS) {
    await db.telematicsProvider.upsert({
      where: { code: p.code },
      create: { code: p.code, name: p.name, apiBaseUrl: p.apiBaseUrl || null, apiKeyEnv: p.apiKeyEnv || null },
      update: { name: p.name },
    });
  }
  refresh();
  return { ok: true as const, count: PROVIDERS.length };
}

async function saveAssetTelematics__impl(rawAssetId: string, fd: FormData) {
  const assetId = sanitizeId(rawAssetId, "Asset ID");
  const scopeAccess = await requireAction("admin.settings");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "asset", assetId);
  await db.asset.update({
    where: { id: assetId },
    data: {
      telematicsProviderId: sOrNull(fd, "telematicsProviderId"),
      deviceId: sOrNull(fd, "deviceId"),
      hasFuelSensor: fd.get("hasFuelSensor") === "on" || fd.get("hasFuelSensor") === "true",
    },
  });
  await audit({ action: "UPDATE", module: "FLEET", entity: "Asset", entityId: assetId, summary: "Telematics configuration updated" });
  refresh();
}

/* --------------------------- image fuel readings --------------------------- */

/**
 * Store a fuel-gauge photo reading. The model's output is judged, not accepted:
 * anything under the confidence threshold, or implausible against the previous
 * reading, is held PENDING for a human rather than written into the ledger.
 */
async function saveGaugeReading__impl(fd: FormData) {
  const scopeAccess = await requireAction("fuel.receipt");
  await assertFormAccess(scopeAccess, fd);
  const assetId = sanitizeId(s(fd, "assetId"), "Vehicle ID");
  if (!assetId) throw new ActionError("Vehicle is required");

  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ActionError("Vehicle not found");

  const session = await getSession();
  const account = session ? await db.user.findUnique({ where: { id: session.id }, include: { driverRef: true } }) : null;
  const person = account?.driverRef ?? null;

  let imageUrl: string | null = null;
  const file = fd.get("image");
  if (file && typeof file !== "string") {
    const f = file as File;
    if (f.size) {
      imageUrl = await uploadPrivateFile(f, { folder: "gauge", kind: "image" });
    }
  }

  const previous = await db.fuelLevelReading.findFirst({
    where: { assetId, status: { in: ["VERIFIED", "CORRECTED"] } },
    orderBy: { capturedAt: "desc" },
  });
  const hoursSince = previous ? (Date.now() - previous.capturedAt.getTime()) / 3.6e6 : 0;

  const extraction: GaugeExtraction = {
    levelPct: fd.get("levelPct") != null && s(fd, "levelPct") !== "" ? n(fd, "levelPct") : null,
    odometerKm: s(fd, "odometerKm") ? n(fd, "odometerKm") : null,
    confidence: n(fd, "confidence"),
    gaugeType: sOrNull(fd, "gaugeType"),
    reasoning: sOrNull(fd, "reasoning"),
  };

  // A vehicle whose tank sender is reporting does not need a person to confirm
  // a model's reading of a photographed needle — the instrument already gave
  // the number, in litres, unprompted. Review is for vehicles with no sender,
  // which is the only place a human eye adds anything.
  const sensor = await fuelSensorState(assetId);

  const decision = sensor.hasSensor
    ? sensorGaugeDecision(sensor, asset.fuelCapacity)
    : decideGaugeReading(
        extraction, asset.fuelCapacity,
        previous ? (previous.correctedPct ?? previous.levelPct) : null,
        hoursSince
      );

  const activeSession = person
    ? await db.tripSession.findFirst({ where: { driverId: person.id, assetId, status: "ACTIVE" } })
    : null;

  const reading = await db.fuelLevelReading.create({
    data: {
      assetId, driverId: person?.id ?? null, sessionId: activeSession?.id ?? null,
      levelPct: decision.levelPct, levelL: decision.litres,
      odometerKm: extraction.odometerKm, confidence: extraction.confidence,
      reasoning: extraction.reasoning, gaugeType: extraction.gaugeType, imageUrl,
      lat: s(fd, "lat") ? n(fd, "lat") : null, lng: s(fd, "lng") ? n(fd, "lng") : null,
      status: decision.status,
      note: decision.reasons.join(" ") || null,
      verifiedBy:
        decision.status !== "VERIFIED"
          ? null
          : sensor.hasSensor
            ? "Auto (tank sender)"
            : "Auto (high confidence)",
      verifiedAt: decision.status === "VERIFIED" ? new Date() : null,
    },
  });

  // Only a trusted reading is allowed to move the vehicle's fuel level and enter
  // the telemetry stream. A pending one waits for a human.
  if (decision.status === "VERIFIED" && decision.levelPct != null) {
    await db.asset.update({ where: { id: assetId }, data: { fuelLevelPct: decision.levelPct, fuelLevelAt: new Date() } });
    await db.telemetryReading.create({
      data: {
        assetId, sessionId: activeSession?.id ?? null, fuelLevelPct: decision.levelPct,
        fuelLevelL: decision.litres, odometerKm: extraction.odometerKm,
        lat: s(fd, "lat") ? n(fd, "lat") : null, lng: s(fd, "lng") ? n(fd, "lng") : null,
        source: "IMAGE",
      },
    });
  }

  refresh();
  return { ok: true as const, id: reading.id, status: decision.status, levelPct: decision.levelPct, reasons: decision.reasons };
}

/** Human verdict on a held reading. A correction is recorded as the truth. */
async function verifyGaugeReading__impl(rawId: string, fd: FormData) {
  const id = sanitizeId(rawId, "Reading ID");
  const scopeAccess = await requireAction("fuel.approve");
  await assertFormAccess(scopeAccess, fd);
  await assertRecordAccess(scopeAccess, "fuelLevelReading", id);
  const session = await getSession();
  const verdict = oneOf(s(fd, "verdict"), ["VERIFIED", "CORRECTED", "REJECTED"], "Verdict");
  const corrected = s(fd, "correctedPct") ? boundedNumber(fd.get("correctedPct"), "Corrected fuel percentage", { min: 0, max: 100 }) : null;

  const reading = await db.fuelLevelReading.findUnique({ where: { id }, include: { asset: true } });
  if (!reading) throw new ActionError("Reading not found");

  const finalPct = verdict === "CORRECTED" ? corrected : verdict === "VERIFIED" ? reading.levelPct : null;

  await db.fuelLevelReading.update({
    where: { id },
    data: {
      status: verdict, correctedPct: verdict === "CORRECTED" ? corrected : null,
      verifiedBy: session?.name ?? null, verifiedAt: new Date(),
      note: sOrNull(fd, "note") || reading.note,
    },
  });

  if (verdict !== "REJECTED" && finalPct != null) {
    const litres = reading.asset.fuelCapacity > 0 ? (finalPct / 100) * reading.asset.fuelCapacity : null;
    await db.asset.update({ where: { id: reading.assetId }, data: { fuelLevelPct: finalPct, fuelLevelAt: new Date() } });
    await db.telemetryReading.create({
      data: {
        assetId: reading.assetId, sessionId: reading.sessionId, fuelLevelPct: finalPct,
        fuelLevelL: litres, odometerKm: reading.odometerKm, lat: reading.lat, lng: reading.lng, source: "IMAGE",
      },
    });
  }

  await audit({
    action: "APPROVE", module: "FUEL", entity: "FuelLevelReading", entityId: id,
    summary: `Gauge reading ${verdict.toLowerCase()}${verdict === "CORRECTED" ? ` to ${corrected}%` : ""} for ${reading.asset.code}`,
  });
  refresh();
}

/* ------------------------------- sessions ------------------------------- */

/** Force-release a session — the supervisor override for a forgotten checkout. */
async function releaseSession__impl(rawId: string) {
  const id = sanitizeId(rawId, "Session ID");
  const access = await requireAction("fleet.edit");
  await businessTransaction(access.session, async tx => {
    await assertRecordAccess(access, "tripSession", id, tx);
    await completeDuty(tx, id, access.session, { endedBy: "ADMIN" });
  });
  refresh();
}

/** Mark stale duties abandoned without clearing a newer driver's claim. */
async function closeStaleSessions__impl() {
  const access = await requireAction("fleet.edit");
  const closed = await businessTransaction(access.session, async tx => {
    const open = await tx.tripSession.findMany({ where: { status: "ACTIVE", ...recordScope("tripSession", access) } });
    const stale = staleSessions(open.map((x): SessionLite => ({ id: x.id, assetId: x.assetId, driverId: x.driverId, startedAt: x.startedAt, endedAt: x.endedAt, status: x.status })));
    let count = 0;
    for (const row of stale) {
      const result = await tx.tripSession.updateMany({ where: { id: row.id, status: "ACTIVE" }, data: { status: "ABANDONED", endedAt: new Date(), endedBy: "AUTO" } });
      if (!result.count) continue;
      count++;
      const another = await tx.tripSession.count({ where: { assetId: row.assetId, status: "ACTIVE" } });
      if (!another) await tx.asset.updateMany({ where: { id: row.assetId, driverId: row.driverId }, data: { driverId: null } });
    }
    return count;
  });
  refresh();
  return { ok: true as const, closed };
}

/** Run the same evidence gate as the nightly scan for one accessible vehicle. */
async function scanFuelEvents__impl(rawAssetId: string) {
  const assetId = sanitizeId(rawAssetId, "Asset ID");
  const scopeAccess = await requireAction("fuel.reconcile");
  await assertRecordAccess(scopeAccess, "asset", assetId);
  const asset = await db.asset.findUnique({ where: { id: assetId }, select: { id: true } });
  if (!asset) throw new ActionError("Vehicle not found");
  const result = await scanForFuelTheft(30, { assetId, trigger: "manual" });
  refresh();
  return {
    ok: true as const,
    scanned: result.scanned,
    raised: result.raised,
    duplicates: result.duplicates,
    notAssessed: result.notAssessed.map((item) => item.reason),
  };
}

/** Manually trigger a pull from Tata Fleet Edge API and refresh views. */
async function triggerTataSync__impl() {
  await requireAction("admin.settings");
  const session = await getSession();
  if (!session) throw new ActionError("Unauthorized");

  const { syncTataFleetEdge } = await import("@/lib/tata-fleet-edge");
  const res = await syncTataFleetEdge("manual");

  await audit({
    action: "UPDATE",
    module: "FLEET",
    summary: res.ok
      ? `Manual Tata Fleet Edge sync: fetched ${res.fetched}, stored ${res.stored} reading(s)`
      : `Manual Tata Fleet Edge sync failed: ${res.error ?? res.skipped}`,
  });

  refresh();
  revalidatePath("/fleet/tracking");
  revalidatePath("/fleet/trips");
  return res;
}

/* ---------------------------------------------------------------------------
 * Exported actions.
 *
 * Wrapped in `safe()` so an `ActionError` comes back as `{ error }` instead of
 * being thrown — Next redacts thrown messages in production builds, which made
 * every validation message in this file invisible to the person who triggered
 * it. Return values are passed through untouched.
 * ------------------------------------------------------------------------- */
export const issueQrTokens = safe(issueQrTokens__impl);
export const seedProviders = safe(seedProviders__impl);
export const saveAssetTelematics = safe(saveAssetTelematics__impl);
export const saveGaugeReading = safe(saveGaugeReading__impl);
export const verifyGaugeReading = safe(verifyGaugeReading__impl);
export const releaseSession = safe(releaseSession__impl);
export const closeStaleSessions = safe(closeStaleSessions__impl);
export const scanFuelEvents = safe(scanFuelEvents__impl);
export const triggerTataSync = safe(triggerTataSync__impl);
