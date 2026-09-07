import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { businessTransaction } from "@/lib/business-transaction";
import { completeDuty } from "@/lib/trip-service";
import { ActionError } from "@/lib/action-error";
import { getAccess } from "@/lib/access";
import {
  evaluateScan,
  staleSessions,
  isAssetCheckinAllowed,
  validateOdometerAtScan,
  type SessionLite,
} from "@/lib/telematics";
import { assetCompliance, DOC_LABEL, type DocLite } from "@/lib/compliance";
import { eligibility, safetyScore, type DriverLite, type CompetencyLite, type ViolationLite } from "@/lib/drivers";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";
import { requireSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * QR check-in. POST { token, lat?, lng?, odometer? }
 *
 * The scan binds the authenticated driver to the vehicle. It also runs the
 * checks that exist precisely for this moment — is this person licensed and
 * cleared for this class of machine, and is the vehicle legal to take out — and
 * returns them as warnings rather than refusing, because a system that blocks a
 * driver at 6am with no override just gets worked around.
 */
async function handlePost(req: Request) {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (access.group !== "DRIVER") return NextResponse.json({ error: "Only a driver account can check in to a vehicle." }, { status: 403 });
  if (!access.driverId) {
    return NextResponse.json({ error: "An administrator must link this login to a driver before check-in." }, { status: 409 });
  }
  requireSameOrigin(req);

  const limit = await reserveRateLimit({
    scope: "qr-scan",
    subject: access.session.id,
    limit: 30,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return rateLimitResponse(limit.retryInSeconds, "Too many scan attempts. Please wait before trying again.");
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const token = String(body.token ?? "").trim();
  if (!token) return NextResponse.json({ error: "No QR token supplied" }, { status: 400 });
  if (token.length > 48 || /[\r\n\t\0]/.test(token)) return NextResponse.json({ error: "This is not a valid cabin sticker code." }, { status: 400 });


  const asset = await db.asset.findUnique({ where: { qrToken: token }, include: { compliance: true } });
  if (!asset) return NextResponse.json({ error: "This QR code does not match any vehicle." }, { status: 404 });

  const checkinCheck = isAssetCheckinAllowed(asset.status, asset.decommissionedOn);
  if (!checkinCheck.allowed) {
    return NextResponse.json({ error: checkinCheck.reason }, { status: 409 });
  }

  // Only an administrator's explicit driver assignment can attribute a trip.
  const account = await db.user.findUnique({ where: { id: access.session.id }, include: { driverRef: true } });
  const person = account?.driverRef;
  if (!person || person.id !== access.driverId || person.status !== "Active") {
    return NextResponse.json({
      error: "An administrator must add this driver before a trip can be attributed to this login.",
    }, { status: 409 });
  }

  const num = (k: string) => (body[k] != null && isFinite(Number(body[k])) ? Number(body[k]) : null);
  const lat = num("lat"), lng = num("lng");
  if ((lat != null && (lat < -90 || lat > 90)) || (lng != null && (lng < -180 || lng > 180))) {
    return NextResponse.json({ error: "Coordinates are outside physical bounds." }, { status: 400 });
  }
  const manualOdo = num("odometer");
  const odoCheck = validateOdometerAtScan(manualOdo, asset.meterValue);
  if (!odoCheck.valid) {
    return NextResponse.json({ error: odoCheck.error }, { status: 400 });
  }

  // Session ownership is decided and written together. Two simultaneous scans
  // cannot quietly create duplicate active trips for one vehicle.
  let tripSession: { id: string };
  let outcome: ReturnType<typeof evaluateScan>;
  try {
    const result = await businessTransaction(access.session, async (tx) => {
      const freshAsset = await tx.asset.findUniqueOrThrow({ where: { id: asset.id } });
      const eligibility = isAssetCheckinAllowed(freshAsset.status, freshAsset.decommissionedOn);
      if (!eligibility.allowed) throw new ActionError(eligibility.reason!);
      const meterCheck = validateOdometerAtScan(manualOdo, freshAsset.meterValue);
      if (!meterCheck.valid) throw new ActionError(meterCheck.error!);
      const now = new Date();
      // A check-in decision can only be affected by a session on this vehicle
      // or by another vehicle held by this driver. Reading every active session
      // in the fleet made a single QR scan slower as the fleet grew, despite
      // those unrelated rows having no bearing on this decision.
      const allOpen = await tx.tripSession.findMany({
        where: {
          status: "ACTIVE",
          OR: [{ assetId: asset.id }, { driverId: person.id }],
        },
      });
      const rows = allOpen.map((s): SessionLite => ({ id: s.id, assetId: s.assetId, driverId: s.driverId, startedAt: s.startedAt, endedAt: s.endedAt, status: s.status }));
      const stale = staleSessions(rows, now);
      if (stale.length) {
        await tx.tripSession.updateMany({ where: { id: { in: stale.map((s) => s.id) }, status: "ACTIVE" }, data: { status: "ABANDONED", endedAt: now, endedBy: "AUTO" } });
        for (const old of stale) await tx.asset.updateMany({ where: { id: old.assetId, driverId: old.driverId }, data: { driverId: null } });
      }
      const current = rows.filter((s) => !stale.some((old) => old.id === s.id));
      const decision = evaluateScan(asset.id, person.id, current, now);
      if (!decision.ok) return { outcome: decision, session: null };
      if (decision.action === "START" && decision.releaseSessionId) {
        const previous = allOpen.find((s) => s.id === decision.releaseSessionId);
        // A driver record is linked to one User, but do not silently close a
        // duty started by a different account if historical data was relinked.
        if (previous?.userId && previous.userId !== access.session.id) {
          throw new ActionError("Your previous duty belongs to another login. Ask a supervisor to close it safely.");
        }
        await completeDuty(tx, decision.releaseSessionId, access.session, { endedBy: "AUTO" });
      }
      if (decision.action === "RESUME") {
        const resumed = allOpen.find((s) => s.assetId === asset.id && s.driverId === person.id && s.status === "ACTIVE");
        if (!resumed) throw new ActionError("The active duty changed. Please scan again.");
        if (resumed.userId && resumed.userId !== access.session.id) {
          throw new ActionError("This duty was started by another login. Ask a supervisor to close it safely.");
        }
        // Sessions made before account binding existed have no userId. The
        // matching active driver has just physically re-scanned the cabin QR,
        // so attach the account now and let checkout/mobile tracking work.
        if (!resumed.userId) {
          await tx.tripSession.update({ where: { id: resumed.id }, data: { userId: access.session.id } });
        }
        return { outcome: decision, session: resumed };
      }
      const session = await tx.tripSession.create({ data: {
        assetId: asset.id, driverId: person.id, userId: access.session.id, projectId: freshAsset.projectId,
        startLat: lat, startLng: lng, startOdometer: manualOdo ?? freshAsset.meterValue,
        trackingSource: asset.deviceId ? "GPS" : lat != null ? "MOBILE" : "NONE", scanMethod: "QR",
      } });
      await tx.asset.update({ where: { id: asset.id }, data: { driverId: person.id } });
      return { outcome: decision, session };
    });
    outcome = result.outcome;
    if (!outcome.ok || !result.session) return NextResponse.json({ error: outcome.ok ? "Vehicle check-in could not be completed." : outcome.reason, blockingSessionId: outcome.ok ? undefined : outcome.blockingSessionId }, { status: 409 });
    tripSession = result.session;
  } catch (error: unknown) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "P2034") return NextResponse.json({ error: "Another check-in was processed at the same time. Please scan once more." }, { status: 409 });
    throw error;
  }

  // --- advisory checks, returned not enforced ---
  const warnings: string[] = [];

  const comp = assetCompliance(asset.id, asset.category, asset.compliance.map((d): DocLite => ({
    id: d.id, docType: d.docType, number: d.number, issueDate: d.issueDate,
    expiryDate: d.expiryDate, reminderDays: d.reminderDays, documentUrl: d.documentUrl,
  })), new Date(), asset.assetClass);
  for (const f of comp.findings.filter((x) => x.blocking && (x.state === "expired" || x.state === "missing"))) {
    warnings.push(`${DOC_LABEL[f.docType] ?? f.docType}: ${f.state === "missing" ? "not on record" : "expired"}`);
  }

  const [violations, competencies] = await Promise.all([
    db.violation.findMany({ where: { driverId: person.id } }),
    db.competency.findMany({ where: { driverId: person.id } }),
  ]);
  const { score } = safetyScore(violations.map((v): ViolationLite => ({ id: v.id, type: v.type, severity: v.severity, points: v.points, date: v.date, penalty: v.penalty, status: v.status })));
  const el = eligibility(
    { id: person.id, empCode: person.empCode, name: person.name, type: person.type, licenseNo: person.licenseNo, licenseExpiry: person.licenseExpiry, status: person.status } as DriverLite,
    asset.assetClass,
    competencies.map((c): CompetencyLite => ({ assetClass: c.assetClass, level: c.level, expiresOn: c.expiresOn })),
    score
  );

  return NextResponse.json({
    ok: true,
    action: outcome.action,
    message: outcome.message,
    sessionId: tripSession.id,
    vehicle: { id: asset.id, code: asset.code, registrationNo: asset.registrationNo, assetClass: asset.assetClass, hasFuelSensor: asset.hasFuelSensor, tracking: asset.deviceId ? "GPS" : lat != null ? "MOBILE" : "NONE" },
    driver: { id: person.id, name: person.name, safetyScore: score },
    operable: comp.operable,
    documentWarnings: warnings,
    eligible: el.eligible,
    blockers: el.blockers,
    cautions: el.warnings,
  });
}

export const POST = withApiErrors(handlePost);
