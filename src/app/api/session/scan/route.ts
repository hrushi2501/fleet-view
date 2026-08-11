import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { evaluateScan, type SessionLite } from "@/lib/telematics";
import { assetCompliance, DOC_LABEL, type DocLite } from "@/lib/compliance";
import { eligibility, safetyScore, type DriverLite, type CompetencyLite, type ViolationLite } from "@/lib/drivers";

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
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const token = String(body.token ?? "").trim();
  if (!token) return NextResponse.json({ error: "No QR token supplied" }, { status: 400 });

  const asset = await db.asset.findUnique({ where: { qrToken: token }, include: { compliance: true } });
  if (!asset) return NextResponse.json({ error: "This QR code does not match any vehicle." }, { status: 404 });

  // Resolve the login to a person record — the explicit link, then a name fallback.
  const account = await db.user.findUnique({ where: { id: session.id }, include: { driverRef: true } });
  const person = account?.driverRef ?? (await db.driver.findFirst({ where: { name: session.name } }));
  if (!person) {
    return NextResponse.json({
      error: "Your login is not linked to a driver record, so the trip cannot be attributed. Ask your supervisor to link it under Roles & Permissions.",
    }, { status: 409 });
  }

  const open = await db.tripSession.findMany({ where: { status: "ACTIVE" } });
  const outcome = evaluateScan(
    asset.id, person.id,
    open.map((s): SessionLite => ({ id: s.id, assetId: s.assetId, driverId: s.driverId, startedAt: s.startedAt, endedAt: s.endedAt, status: s.status }))
  );

  if (!outcome.ok) return NextResponse.json({ error: outcome.reason, blockingSessionId: outcome.blockingSessionId }, { status: 409 });

  // Close a session the driver left open on another machine.
  if (outcome.action === "START" && outcome.releaseSessionId) {
    await db.tripSession.update({
      where: { id: outcome.releaseSessionId },
      data: { status: "COMPLETED", endedAt: new Date(), endedBy: "AUTO" },
    });
  }

  const num = (k: string) => (body[k] != null && isFinite(Number(body[k])) ? Number(body[k]) : null);
  const lat = num("lat"), lng = num("lng");

  let tripSession;
  if (outcome.action === "RESUME") {
    tripSession = open.find((s) => s.assetId === asset.id && s.driverId === person.id)!;
  } else {
    tripSession = await db.tripSession.create({
      data: {
        assetId: asset.id, driverId: person.id, userId: session.id,
        projectId: asset.projectId,
        startLat: lat, startLng: lng,
        startOdometer: num("odometer") ?? asset.meterValue,
        // A vehicle with a device reports its own position; otherwise the phone does.
        trackingSource: asset.deviceId ? "GPS" : lat != null ? "MOBILE" : "NONE",
        scanMethod: "QR",
      },
    });
    await db.asset.update({ where: { id: asset.id }, data: { driverId: person.id } });
  }

  // --- advisory checks, returned not enforced ---
  const warnings: string[] = [];

  const comp = assetCompliance(asset.id, asset.category, asset.compliance.map((d): DocLite => ({
    id: d.id, docType: d.docType, number: d.number, issueDate: d.issueDate,
    expiryDate: d.expiryDate, reminderDays: d.reminderDays, documentUrl: d.documentUrl,
  })));
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
