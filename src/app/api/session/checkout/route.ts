import { withApiErrors } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAccess } from "@/lib/access";
import { completeDuty, matchesActiveVehicleConfirmation } from "@/lib/trip-service";
import { businessTransaction } from "@/lib/business-transaction";
import { finiteNumber, sanitizeId, sanitizeOptionalString } from "@/lib/input-validation";
import { ActionError } from "@/lib/action-error";
import { invalidateLiveFleetCache } from "@/lib/fleet-edge-live";
import { reserveRateLimit, rateLimitResponse } from "@/lib/request-rate-limit";
import { requireSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * End a trip session. POST { token?, confirmVehicle?, lat?, lng?, odometer?, notes? }
 *
 * Distance comes from the recorded path where positions exist, and falls back to
 * the odometer difference where they do not — a vehicle with no GPS still
 * produces a usable trip record, just a coarser one.
 */
async function handlePost(req: Request) {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (access.group !== "DRIVER") return NextResponse.json({ error: "Only a driver account can end a vehicle trip." }, { status: 403 });
  requireSameOrigin(req);

  const limit = await reserveRateLimit({
    scope: "session-checkout",
    subject: access.session.id,
    limit: 20,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return rateLimitResponse(limit.retryInSeconds, "Too many checkout attempts. Please wait before retrying.");
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "A cabin QR code is required to end the trip." }, { status: 400 }); }
  const token = String(body.token ?? "").trim();
  const confirmation = String(body.confirmVehicle ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (token.length > 48) return NextResponse.json({ error: "The cabin code is not valid." }, { status: 400 });
  if (!token && confirmation.length < 4) return NextResponse.json({ error: "Scan the cabin QR code, or confirm the last 4 characters of the assigned vehicle number." }, { status: 400 });


  const account = await db.user.findUnique({ where: { id: access.session.id }, include: { driverRef: true } });
  // A trip belongs to the administrator-assigned driver, never to whichever
  // record happens to share this login's display name.
  const person = account?.driverRef;
  if (!person || person.id !== access.driverId || person.status !== "Active") {
    return NextResponse.json({ error: "An administrator must add this driver before a trip can be checked out." }, { status: 409 });
  }

  const result = await businessTransaction(access.session, async tx => {
    const requestedSessionId = body.sessionId == null || body.sessionId === "" ? null : sanitizeId(body.sessionId, "Session ID");
    const active = await tx.tripSession.findFirst({
      where: { driverId: person.id, userId: access.session.id,
        ...(requestedSessionId ? { id: requestedSessionId, status: "ACTIVE" } : { status: "ACTIVE" }),
      },
      orderBy: { startedAt: "desc" },
      include: { asset: { select: { qrToken: true, registrationNo: true, code: true } } },
    });
    if (!active) return null;
    if (token && active.asset.qrToken !== token) return null;
    if (!token) {
      // The fallback is not a general checkout override: it is bound to the
      // signed-in driver and their active session, then checks a plate suffix.
      if (!matchesActiveVehicleConfirmation(confirmation, active.asset.registrationNo, active.asset.code)) {
        throw new ActionError("The vehicle confirmation does not match your active duty.");
      }
    }
    const optional = (key: string, min: number, max?: number) => body[key] == null || body[key] === "" ? null : finiteNumber(body[key], key, { min, max });
    return completeDuty(tx, active.id, access.session, {
      odometer: optional("odometer", 0), lat: optional("lat", -90, 90), lng: optional("lng", -180, 180),
      endedBy: "DRIVER", notes: sanitizeOptionalString(body.notes, "Notes", { maxLength: 2000 }) ?? undefined,
    });
  });
  if (!result) return NextResponse.json({ error: "No matching duty was found. Check the cabin code and reload." }, { status: 404 });
  await invalidateLiveFleetCache();
  return NextResponse.json({ ok: true, ...result });
}

export const POST = withApiErrors(handlePost);
