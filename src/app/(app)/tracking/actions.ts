"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import crypto from "crypto";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { decideGaugeReading, makeQrToken, staleSessions, reconstructPath, detectFuelEvents, PROVIDERS, type GaugeExtraction, type SessionLite, type ReadingLite } from "@/lib/telematics";
import { requireAction, ActionError, safe } from "@/lib/guard";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => Number(fd.get(k) ?? 0) || 0;

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
  await requireAction("fuel.receipt");
  const assets = await db.asset.findMany({ where: { qrToken: null }, select: { id: true } });
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
  await requireAction("admin.settings");
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

async function saveAssetTelematics__impl(assetId: string, fd: FormData) {
  await requireAction("admin.settings");
  await db.asset.update({
    where: { id: assetId },
    data: {
      telematicsProviderId: s(fd, "telematicsProviderId") || null,
      deviceId: s(fd, "deviceId") || null,
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
  await requireAction("fuel.receipt");
  const assetId = s(fd, "assetId");
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
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
      const blob = await put(`gauge/${asset.code}-${Date.now()}.${ext}`, f, { access: "public", addRandomSuffix: true });
      imageUrl = blob.url;
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
    gaugeType: s(fd, "gaugeType") || null,
    reasoning: s(fd, "reasoning") || null,
  };

  const decision = decideGaugeReading(
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
      verifiedBy: decision.status === "VERIFIED" ? "Auto (high confidence)" : null,
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
async function verifyGaugeReading__impl(id: string, fd: FormData) {
  await requireAction("fuel.approve");
  const session = await getSession();
  const verdict = s(fd, "verdict"); // VERIFIED | CORRECTED | REJECTED
  const corrected = s(fd, "correctedPct") ? n(fd, "correctedPct") : null;

  const reading = await db.fuelLevelReading.findUnique({ where: { id }, include: { asset: true } });
  if (!reading) throw new ActionError("Reading not found");

  const finalPct = verdict === "CORRECTED" ? corrected : verdict === "VERIFIED" ? reading.levelPct : null;

  await db.fuelLevelReading.update({
    where: { id },
    data: {
      status: verdict, correctedPct: verdict === "CORRECTED" ? corrected : null,
      verifiedBy: session?.name ?? null, verifiedAt: new Date(),
      note: s(fd, "note") || reading.note,
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
async function releaseSession__impl(id: string) {
  await requireAction("fuel.receipt");
  const auth = await getSession();
  const sess = await db.tripSession.findUnique({ where: { id } });
  if (!sess || sess.status !== "ACTIVE") return;

  const readings = await db.telemetryReading.findMany({ where: { sessionId: id }, orderBy: { recordedAt: "asc" } });
  const path = reconstructPath(readings.map((r): ReadingLite => ({
    id: r.id, recordedAt: r.recordedAt, lat: r.lat, lng: r.lng, speedKph: r.speedKph,
    odometerKm: r.odometerKm, fuelLevelPct: r.fuelLevelPct, ignitionOn: r.ignitionOn, source: r.source,
  })));

  await db.tripSession.update({
    where: { id },
    data: { status: "COMPLETED", endedAt: new Date(), endedBy: "ADMIN", distanceKm: path.distanceKm },
  });
  await audit({ action: "UPDATE", module: "OPERATIONS", entity: "TripSession", entityId: id, summary: `Session force-released by ${auth?.name ?? "admin"}` });
  refresh();
}

/** Close sessions a driver forgot to end. Safe to run on a schedule. */
async function closeStaleSessions__impl() {
  await requireAction("fuel.receipt");
  const open = await db.tripSession.findMany({ where: { status: "ACTIVE" } });
  const stale = staleSessions(open.map((x): SessionLite => ({ id: x.id, assetId: x.assetId, driverId: x.driverId, startedAt: x.startedAt, endedAt: x.endedAt, status: x.status })));
  for (const x of stale) {
    await db.tripSession.update({ where: { id: x.id }, data: { status: "ABANDONED", endedAt: new Date(), endedBy: "AUTO" } });
  }
  if (stale.length) await audit({ action: "UPDATE", module: "OPERATIONS", summary: `Closed ${stale.length} stale trip session(s)` });
  refresh();
  return { ok: true as const, closed: stale.length };
}

/** Scan the telemetry stream for fuel events worth investigating. */
async function scanFuelEvents__impl(assetId: string) {
  await requireAction("fuel.reconcile");
  const asset = await db.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new ActionError("Vehicle not found");
  const since = new Date(); since.setDate(since.getDate() - 30);

  const readings = await db.telemetryReading.findMany({
    where: { assetId, recordedAt: { gte: since }, fuelLevelPct: { not: null } },
    orderBy: { recordedAt: "asc" },
  });
  const events = detectFuelEvents(readings.map((r): ReadingLite => ({
    id: r.id, recordedAt: r.recordedAt, lat: r.lat, lng: r.lng, speedKph: r.speedKph,
    odometerKm: r.odometerKm, fuelLevelPct: r.fuelLevelPct, ignitionOn: r.ignitionOn, source: r.source,
  })), asset.fuelCapacity);

  const rate = 92.5;
  let raised = 0;
  for (const e of events.filter((x) => x.suspicious)) {
    const key = `FUEL_TELEMETRY:${assetId}:${e.at.toISOString()}`;
    const exists = await db.fuelAnomaly.findUnique({ where: { source_refId: { source: "ASSET_EFFICIENCY", refId: key } } });
    if (exists) continue;
    await db.fuelAnomaly.create({
      data: {
        source: "ASSET_EFFICIENCY", refId: key, assetId,
        severity: "HIGH", score: 80, litres: e.litres ?? 0,
        valueAtRisk: (e.litres ?? 0) * rate, reasons: e.reason,
      },
    });
    raised++;
  }
  refresh();
  return { ok: true as const, events: events.length, suspicious: events.filter((e) => e.suspicious).length, raised };
}

/** Manually trigger a pull from Tata Fleet Edge API and refresh views. */
async function triggerTataSync__impl() {
  await requireAction("admin.settings");
  const session = await getSession();
  if (!session) throw new ActionError("Unauthorized");

  const { syncTataFleetEdge } = await import("@/lib/tata-fleet-edge");
  const res = await syncTataFleetEdge();

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
