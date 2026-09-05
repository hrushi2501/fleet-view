import { NextResponse } from "next/server";
import { db } from "@/lib/db";
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
export async function POST(req: Request) {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (access.group !== "DRIVER") return NextResponse.json({ error: "Only a driver account can check in to a vehicle." }, { status: 403 });

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
    const result = await db.$transaction(async (tx) => {
      const now = new Date();
      const allOpen = await tx.tripSession.findMany({ where: { status: "ACTIVE" } });
      const rows = allOpen.map((s): SessionLite => ({ id: s.id, assetId: s.assetId, driverId: s.driverId, startedAt: s.startedAt, endedAt: s.endedAt, status: s.status }));
      const stale = staleSessions(rows, now);
      if (stale.length) {
        await tx.tripSession.updateMany({ where: { id: { in: stale.map((s) => s.id) }, status: "ACTIVE" }, data: { status: "ABANDONED", endedAt: now, endedBy: "AUTO" } });
        await tx.asset.updateMany({ where: { id: { in: stale.map((s) => s.assetId) } }, data: { driverId: null } });
      }
      const current = rows.filter((s) => !stale.some((old) => old.id === s.id));
      const decision = evaluateScan(asset.id, person.id, current, now);
      if (!decision.ok) return { outcome: decision, session: null };
      if (decision.action === "START" && decision.releaseSessionId) {
        const oldSession = await tx.tripSession.findUnique({
          where: { id: decision.releaseSessionId },
          select: { id: true, assetId: true, driverId: true, projectId: true, startedAt: true, startOdometer: true },
        });
        if (oldSession) {
          await tx.tripSession.update({
            where: { id: decision.releaseSessionId },
            data: { status: "COMPLETED", endedAt: now, endedBy: "AUTO" },
          });
          await tx.asset.update({
            where: { id: oldSession.assetId },
            data: { driverId: null },
          });
          await tx.trip.create({
            data: {
              assetId: oldSession.assetId,
              driverId: oldSession.driverId,
              projectId: oldSession.projectId,
              startTime: oldSession.startedAt,
              endTime: now,
              distanceKm: 0,
              status: "Completed",
              gpsVerified: false,
            },
          });
        }
      }
      if (decision.action === "RESUME") {
        return { outcome: decision, session: current.find((s) => s.assetId === asset.id && s.driverId === person.id)! };
      }
      const session = await tx.tripSession.create({ data: {
        assetId: asset.id, driverId: person.id, userId: access.session.id, projectId: asset.projectId,
        startLat: lat, startLng: lng, startOdometer: manualOdo ?? asset.meterValue,
        trackingSource: asset.deviceId ? "GPS" : lat != null ? "MOBILE" : "NONE", scanMethod: "QR",
      } });
      await tx.asset.update({ where: { id: asset.id }, data: { driverId: person.id } });
      return { outcome: decision, session };
    }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 });
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
