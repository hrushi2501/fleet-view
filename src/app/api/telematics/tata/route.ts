import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkSharedSecret } from "@/lib/auth";
import { normaliseReading, assetCacheUpdate } from "@/lib/telemetry-normalization";
import { TataFleetEdgeAdapter } from "@/lib/telematics-adapters";
import type { TelemetryPing } from "@/lib/telematics-adapters";

export const dynamic = "force-dynamic";
// A push may carry the whole fleet in one body; allow room for a slow write.
export const maxDuration = 120;

/**
 * Tata Fleet Edge push receiver.
 *
 * Verified against "FleetEdge Basic Push(Web hook) API" (4pp, v1.6).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE SPEC PINS DOWN
 *
 *   - The path is ours to choose. The spec's `/api/endpoint` is explicitly "for
 *     illustration purpose"; Fleet Edge posts to whatever URL was supplied at
 *     subscription time.
 *   - The body is one `VehicleTelemetry` object — the same model the Basic Pull
 *     API returns, which is why `TataFleetEdgeAdapter` parses both. It reads a
 *     bare object as readily as a `{ vehicles: [...] }` batch.
 *   - `PrimaryFuelLevel` and `SecondaryFuelLevel1` are documented with leading
 *     capitals while the live pull sends them lowercase. Both spellings are
 *     read; see `interpretFleetEdgeFuel`.
 *   - Documented responses are 200 and 404 "No vehicle registered".
 *   - **The spec defines no authentication.** No key, no token, no header, no
 *     signature. The only access control it names is the source address:
 *     "if the endpoint has restricted access please make sure you allow access
 *     to the this IP 3.6.12.131". See `authorisePush` for what follows from
 *     that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE URL TO GIVE TATA
 *
 *   https://fleetview-erp-indol.vercel.app/api/telematics/tata
 *
 * The subscription flow asks for the endpoint before anything is sent, so this
 * route answers a credential-free CHECK probe. Real telemetry is gated by
 * `authorisePush`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SEPARATE ROUTE FROM /api/telematics
 *
 * Two reasons, one of each kind.
 *
 * Shape: the generic route expects this application's vocabulary — `lat`,
 * `fuelLevelL`, `odometer`. Fleet Edge speaks its own — `primaryFuelLevel`,
 * `registrationNumber`, and an `engineRunHour` that actually carries the
 * odometer. The mapping already exists in `TataFleetEdgeAdapter`, verified
 * against live responses rather than the PDF, so this route reuses it instead
 * of asking Tata to rename their fields.
 *
 * Trust: `/api/telematics` requires `FLEET_INGEST_KEY`, a secret that can write
 * telemetry for any vehicle. Fleet Edge cannot present it — it sends no
 * credential at all — so pushing them through that route would mean either
 * publishing that secret or rejecting every reading. A separate route lets this
 * one feed be admitted on its own terms without weakening the other.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `source: "GPS_API"` AND NOT A NEW SOURCE
 *
 * The unique key on `TelemetryReading` is (assetId, recordedAt, source), and
 * `source` is part of it so that the same instant seen by two independent
 * providers stays two observations.
 *
 * Push and pull here are not independent — they are the same TCU reading
 * delivered twice. Tagging push differently would keep both rows, and every
 * distance and fuel figure is measured across a series of readings, so the
 * journey would be counted twice. Sharing the pull's tag makes the dedupe
 * collapse them, which is what lets push and pull run side by side during a
 * cutover without corrupting the numbers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SOURCE = "GPS_API";

/** Normalises an identifier the way the pull path does before matching. */
const key = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/[\s-]/g, "");

async function resolveAsset(ping: TelemetryPing) {
  const ids = ping.identifiers ?? {};
  const candidates = [ids.registrationNo, ids.chassisNo, ids.imei, ping.externalDeviceId]
    .map(key)
    .filter(Boolean);
  if (candidates.length === 0) return null;

  // Registration and chassis are the identifiers Fleet Edge actually sends;
  // `deviceId` is matched too so an aftermarket unit on the same account works.
  const assets = await db.asset.findMany({
    where: {
      OR: [
        { registrationNo: { in: candidates, mode: "insensitive" } },
        { chassisNo: { in: candidates, mode: "insensitive" } },
        { code: { in: candidates, mode: "insensitive" } },
        { deviceId: { in: candidates, mode: "insensitive" } },
      ],
    },
    select: {
      id: true, code: true, fuelCapacity: true, registrationNo: true,
      chassisNo: true, deviceId: true, telematicsProviderId: true,
      // Required by `assetCacheUpdate` to decide which meter a reading advances.
      meterValue: true, hourMeterValue: true, primaryMeter: true,
    },
  });

  if (assets.length === 0) return null;
  // Prefer an exact match on the strongest identifier available.
  for (const c of candidates) {
    const hit = assets.find(
      (a) =>
        key(a.registrationNo) === c ||
        key(a.chassisNo) === c ||
        key(a.deviceId) === c ||
        key(a.code) === c,
    );
    if (hit) return hit;
  }
  return assets[0]!;
}

/**
 * Reachability probe.
 *
 * Fleet Edge's subscription form has a CHECK button that must go green before
 * the endpoint can be submitted, and it carries no credential. Answering 200 is
 * safe because this handler writes nothing and discloses nothing.
 *
 * `accepts` states how a real push will be authorised, so the setup can be
 * verified without sending telemetry. It previously reported readiness purely
 * on whether a shared secret existed, which was misleading once it emerged that
 * the provider issues none — it read "not ready" on a correctly configured
 * deployment.
 */
export async function GET() {
  const secret = Boolean(process.env.TATA_PUSH_KEY?.trim());
  return NextResponse.json({
    ok: true,
    service: "fleetview-erp",
    endpoint: "tata-fleet-edge-push",
    ready: true,
    accepts: secret
      ? "shared-secret"
      : process.env.TATA_PUSH_TRUST_ANY === "true"
        ? "any-source (debug)"
        : `source-ip: ${allowedIps().join(", ")}`,
  });
}

/** Some checkers probe with HEAD. Next derives it from GET, but be explicit. */
export async function HEAD() {
  return new Response(null, { status: 200 });
}

/**
 * Fleet Edge's published egress address.
 *
 * The spec names exactly one: "if the endpoint has restricted access please
 * make sure you allow access to the this IP 3.6.12.131". Overridable because a
 * provider changing an IP without notice must not need a code change —
 * `TATA_PUSH_ALLOWED_IPS` takes a comma-separated list.
 */
const DEFAULT_TATA_IPS = ["3.6.12.131"];

function allowedIps(): string[] {
  const configured = process.env.TATA_PUSH_ALLOWED_IPS?.trim();
  if (!configured) return DEFAULT_TATA_IPS;
  return configured.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * The caller's address, as Vercel reports it.
 *
 * Behind the platform proxy the socket peer is Vercel, so the left-most entry
 * of `x-forwarded-for` is the originating client. Vercel sets this header
 * itself rather than passing through whatever the client sent, which is what
 * makes it usable as a control here — on a self-hosted deployment without a
 * trusted proxy in front, it would not be.
 */
function callerIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || null;
  return req.headers.get("x-real-ip");
}

/**
 * Decides whether a push carrying telemetry may be accepted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A SHARED SECRET
 *
 * This endpoint originally demanded `TATA_PUSH_KEY` and failed closed without
 * it, on the assumption that subscribing would issue a credential. Reading the
 * webhook specification showed otherwise: it defines no authentication at all —
 * no key, no token, no header, no signature. The only access control it
 * describes is the source address.
 *
 * So the original design could never have worked. Fleet Edge would post real
 * readings, this route would answer 503, and every one would be discarded —
 * silently, because a provider that gets an error does not tell the customer.
 *
 * The security model is therefore what the provider actually implements:
 *
 *   1. If `TATA_PUSH_KEY` is set, require it. Kept because Tata may add
 *      authentication later, and a deployment that has a secret should use it.
 *   2. Otherwise accept only from Fleet Edge's published egress address.
 *   3. `TATA_PUSH_TRUST_ANY=true` disables the address check, for debugging a
 *      feed that is failing for the wrong reason. It is deliberately awkward to
 *      set and never the default.
 *
 * The residual risk is that anyone who learns this URL *and* can present that
 * source address could write telemetry. That is the exposure Fleet Edge's own
 * design accepts, and it is bounded: readings pass the same validation as every
 * other path, and a payload naming a vehicle outside this fleet is rejected.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function authorisePush(
  req: Request,
  body: unknown,
): { ok: true } | { ok: false; status: 401 | 403 | 503; error: string } {
  // 1. A configured secret is the strongest control available, so it wins.
  const secret = process.env.TATA_PUSH_KEY?.trim();
  if (secret) {
    const bodyKey = body && typeof body === "object" ? (body as Record<string, unknown>).key : undefined;
    const auth = checkSharedSecret(req, "TATA_PUSH_KEY", { bodyKey });
    return auth.ok ? { ok: true } : { ok: false, status: auth.status as 401 | 503, error: auth.error };
  }

  // 3. Explicit escape hatch, for diagnosing a feed in the wrong shape.
  if (process.env.TATA_PUSH_TRUST_ANY === "true") return { ok: true };

  // 2. The address is the control the provider's own spec relies on.
  const ip = callerIp(req);
  const permitted = allowedIps();
  if (ip && permitted.includes(ip)) return { ok: true };

  return {
    ok: false,
    status: 403,
    error:
      `Pushes are accepted only from Fleet Edge (${permitted.join(", ")}). ` +
      `This request came from ${ip ?? "an unknown address"}. ` +
      `Set TATA_PUSH_KEY to authenticate by shared secret instead, or ` +
      `TATA_PUSH_ALLOWED_IPS if the provider's address has changed.`,
  };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // A probe may POST an empty body with no content type at all. Nothing is
    // written on this path, so acknowledging it cannot be abused.
    return NextResponse.json({ ok: true, probe: true, accepted: 0 });
  }

  // Same reasoning as GET: an empty body carries no telemetry, so treat it as a
  // reachability check rather than demanding a key that has not been issued.
  const isEmpty =
    body == null ||
    (typeof body === "object" && Object.keys(body as Record<string, unknown>).length === 0);
  if (isEmpty) {
    return NextResponse.json({
      ok: true,
      probe: true,
      accepted: 0,
      ready: true,
    });
  }

  const gate = authorisePush(req, body);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const pings = await new TataFleetEdgeAdapter().parsePayload(body);

  if (pings.length === 0) {
    // The first real push is the first time this shape is seen. Log the body so
    // the mapping can be corrected against what Tata actually sends, and answer
    // 422 rather than 200 — a success would tell them to stop retrying and the
    // readings would be lost while the mapper is wrong.
    console.error("[tata-push] payload produced no readings:", JSON.stringify(body).slice(0, 4000));
    return NextResponse.json(
      { error: "No readings could be read from this payload.", accepted: 0 },
      { status: 422 },
    );
  }

  let accepted = 0;
  let duplicates = 0;
  const unmatched: string[] = [];

  for (const ping of pings) {
    const asset = await resolveAsset(ping);
    if (!asset) {
      unmatched.push(ping.identifiers?.registrationNo ?? ping.externalDeviceId ?? "unknown");
      continue;
    }

    // Same instant, same vehicle, same source — already held, whether it
    // arrived by push, by the pull cron, or by a retry of this very call.
    const already = await db.telemetryReading.findFirst({
      where: { assetId: asset.id, recordedAt: ping.timestamp, source: SOURCE },
      select: { id: true },
    });
    if (already) {
      duplicates++;
      continue;
    }

    const previous = await db.telemetryReading.findFirst({
      where: { assetId: asset.id, recordedAt: { lt: ping.timestamp } },
      orderBy: { recordedAt: "desc" },
      select: { odometerKm: true, engineHours: true },
    });

    // The same validator the pull and the device route use, so a number
    // refused on one path cannot enter through another.
    const result = normaliseReading(ping, {
      fuelCapacityL: asset.fuelCapacity,
      lastOdometerKm: previous?.odometerKm ?? null,
      lastEngineHours: previous?.engineHours ?? null,
    });
    if (!result.accepted || !result.reading) {
      unmatched.push(`${asset.code}: ${result.issues.map((i) => i.field).join(", ")}`);
      continue;
    }
    const r = result.reading;

    const session = await db.tripSession.findFirst({
      where: { assetId: asset.id, status: "ACTIVE" },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });

    try {
      await db.telemetryReading.create({
        data: {
          assetId: asset.id,
          recordedAt: r.recordedAt,
          lat: r.lat, lng: r.lng,
          speedKph: r.speedKph,
          headingDeg: r.headingDeg,
          odometerKm: r.odometerKm,
          engineHours: r.engineHours,
          fuelLevelPct: r.fuelLevelPct,
          fuelLevelL: r.fuelLevelL,
          ignitionOn: r.ignitionOn,
          source: SOURCE,
          providerId: asset.telematicsProviderId,
          sessionId: session?.id ?? null,
          raw: ping.rawPayload as never,
        },
      });
      accepted++;
    } catch {
      // The unique index is the real guard against a concurrent pull writing
      // the same instant between the check above and this insert.
      duplicates++;
      continue;
    }

    await db.asset.update({
      where: { id: asset.id },
      data: assetCacheUpdate(r, asset),
    });
  }

  // The spec documents 404 as "No vehicle registered". Honour it: when nothing
  // in the payload matched a vehicle in this fleet, that is the answer Fleet
  // Edge is written to expect, and a 200 would tell it the readings landed.
  //
  // Only when *nothing* matched. A batch where one vehicle is unknown and the
  // rest stored fine is a success with a note, not a failure — answering 404
  // there could make the sender retry or disable a feed that is mostly working.
  if (accepted === 0 && duplicates === 0 && unmatched.length > 0) {
    return NextResponse.json(
      { error: "No vehicle registered", unmatched, accepted: 0 },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, accepted, duplicates, unmatched });
}
