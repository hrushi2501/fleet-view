/**
 * Fills the tank saw, against fills somebody wrote down.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * There are two records of a vehicle being fuelled and nothing joined them.
 *
 *   `FuelTransaction`  what a person keyed in — litres, rate, amount, photos.
 *   telemetry          what the tank sensor observed — a level rising.
 *
 * The Fuel Records screen read only the first, under the heading "Every fill
 * with its date, vehicle, site tank, location and photo evidence". It was not
 * every fill. On this fleet a 233 L fill — a near-empty 300 L tank taken to
 * full, about ₹23,000 of diesel — was detected by the sensor, correctly
 * classified as a refuel, located to six decimal places, and appeared on no
 * screen at all, because nobody had entered it.
 *
 * That is the exact shape of loss this product exists to catch, and it was
 * invisible. Not because the detection failed — it worked perfectly — but
 * because the two halves were never compared.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT AN UNLOGGED FILL IS AND IS NOT
 *
 * It is not an accusation. The ordinary explanations dominate: a receipt not
 * yet entered, or diesel drawn from a site tank and booked against the tank
 * rather than the vehicle. What it *is* is fuel that physically moved with no
 * paperwork behind it, which is a question worth someone answering while they
 * can still remember the day.
 *
 * The matched cases matter too. When both records exist, the difference between
 * litres invoiced and litres the tank actually gained is the shortfall that
 * `saveReceipt` already looks for on bulk deliveries — applied here to vehicle
 * fills, where it has never been checked.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { db } from "@/lib/db";
import { analyseUsage, type AnalyticsReading } from "@/lib/fleet-analytics";
import { senderContradictsItself } from "@/lib/fuel-cache";
import { serverCache } from "@/lib/cache";
import { createHash } from "node:crypto";

/**
 * How far apart a sensor event and a keyed entry may be and still be the same
 * fill. Entries are frequently written up at the end of a shift with the date
 * set to the day, so this is deliberately generous — a missed match reads as an
 * unlogged fill, and a false alarm is worse than a slightly loose window.
 */
const MATCH_WINDOW_HOURS = 12;

/** Below this a rise is sender noise or slosh, not a fill worth chasing. */
const MIN_FILL_LITRES = 20;

/**
 * The detector reads up to two weeks of the largest table in the application.
 * A short cache is long enough to make navigation between Fuel tabs cheap but
 * short enough that a newly arrived Fleet Edge reading appears on its next
 * normal polling cycle. The access scope and diesel rate are part of the key,
 * so neither rows nor estimated money can leak between users or go stale after
 * a rate change.
 */
const DETECTED_FILLS_CACHE_SECONDS = 60;

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function detectedFillsCacheKey(
  assetWhere: Record<string, unknown>,
  dieselRate: number,
  sinceDays: number,
): string {
  const scope = createHash("sha256").update(stableJson(assetWhere)).digest("hex");
  return `fuel:detected-fills:${sinceDays}:${dieselRate.toFixed(2)}:${scope}`;
}

type CachedDetectedFill = Omit<DetectedFill, "at" | "logged"> & {
  at: string;
  logged: (Omit<NonNullable<DetectedFill["logged"]>, "date"> & { date: string }) | null;
};

type CachedDetectFillsResult = {
  fills: CachedDetectedFill[];
  unreliable: UnreliableSender[];
};

function serializeDetectedFills(result: DetectFillsResult): CachedDetectFillsResult {
  return {
    unreliable: result.unreliable,
    fills: result.fills.map((fill) => ({
      ...fill,
      at: fill.at.toISOString(),
      logged: fill.logged ? { ...fill.logged, date: fill.logged.date.toISOString() } : null,
    })),
  };
}

function deserializeDetectedFills(result: CachedDetectFillsResult): DetectFillsResult {
  return {
    unreliable: result.unreliable,
    fills: result.fills.map((fill) => ({
      ...fill,
      at: new Date(fill.at),
      logged: fill.logged ? { ...fill.logged, date: new Date(fill.logged.date) } : null,
    })),
  };
}

export async function getDetectedFills(
  assetWhere: Record<string, unknown>,
  dieselRate: number,
  sinceDays = 7,
): Promise<DetectFillsResult> {
  const key = detectedFillsCacheKey(assetWhere, dieselRate, sinceDays);
  const cached = await serverCache.wrap(
    key,
    async () => serializeDetectedFills(await detectFills(assetWhere, dieselRate, sinceDays)),
    DETECTED_FILLS_CACHE_SECONDS,
  );
  return deserializeDetectedFills(cached);
}

/** A vehicle whose sender cannot be believed, so no fill is claimed for it. */
export type UnreliableSender = {
  assetId: string;
  assetCode: string;
  registrationNo: string | null;
};

export type DetectFillsResult = {
  fills: DetectedFill[];
  /** Excluded from `fills` — reported so the fault is visible, not silent. */
  unreliable: UnreliableSender[];
};

export type DetectedFill = {
  assetId: string;
  assetCode: string;
  registrationNo: string | null;
  at: Date;
  litresAdded: number;
  fromL: number | null;
  toL: number | null;
  lat: number | null;
  lng: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** Value at the current diesel rate. Indicative — the real price is on the bill. */
  estimatedValue: number;
  /** The keyed entry this was matched to, when there is one. */
  logged: { id: string; quantity: number; amount: number; date: Date } | null;
  /** Litres the sensor saw minus litres entered. Positive = more fuel than paperwork. */
  varianceL: number | null;
};

/**
 * Sensor-detected fills over a window, each matched to its entry if it has one.
 *
 * Reuses `analyseUsage` rather than re-deriving refuels, so what this reports
 * cannot drift from what the vehicle screen shows.
 */
export async function detectFills(
  assetWhere: Record<string, unknown>,
  dieselRate: number,
  sinceDays = 7,
): Promise<DetectFillsResult> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const assets = await db.asset.findMany({
    where: assetWhere,
    select: { id: true, code: true, registrationNo: true, fuelCapacity: true },
  });
  if (assets.length === 0) return { fills: [], unreliable: [] };

  const assetIds = assets.map((a) => a.id);

  // ───────────────────────────────────────────────────────────────────────────
  // Three queries for the whole fleet, not two per vehicle.
  //
  // This used to loop over the assets and query inside the loop. With the two
  // telematics vehicles that was four round trips and nobody noticed. Importing
  // the real register took it to fifty-three assets — a hundred and six round
  // trips — and the Fuel screen calls this twice per render, once for the
  // overview and once for the records tab. Two hundred and twelve sequential
  // queries to draw one page.
  //
  // The work per vehicle is unchanged; only the fetching moved. `fleetUsage`
  // already had this shape, which is why it stayed fast as the fleet grew.
  // ───────────────────────────────────────────────────────────────────────────
  const [readings, entries] = await Promise.all([
    db.telemetryReading.findMany({
      where: { assetId: { in: assetIds }, recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
      select: {
        assetId: true, recordedAt: true, lat: true, lng: true, speedKph: true,
        odometerKm: true, fuelLevelL: true, fuelLevelPct: true, ignitionOn: true,
      },
    }),
    db.fuelTransaction.findMany({
      where: {
        assetId: { in: assetIds },
        type: "ISSUE",
        date: { gte: new Date(since.getTime() - 86_400_000) },
      },
      select: { id: true, assetId: true, quantity: true, amount: true, date: true },
      orderBy: { date: "asc" },
    }),
  ]);

  const readingsBy = new Map<string, typeof readings>();
  for (const r of readings) {
    if (!r.assetId) continue;
    const list = readingsBy.get(r.assetId) ?? [];
    list.push(r);
    readingsBy.set(r.assetId, list);
  }

  const entriesBy = new Map<string, typeof entries>();
  for (const e of entries) {
    if (!e.assetId) continue;
    const list = entriesBy.get(e.assetId) ?? [];
    list.push(e);
    entriesBy.set(e.assetId, list);
  }

  const out: DetectedFill[] = [];
  const unreliable: UnreliableSender[] = [];

  for (const asset of assets) {
    const rows = readingsBy.get(asset.id) ?? [];
    if (rows.length < 2) continue;

    // ─────────────────────────────────────────────────────────────────────────
    // A sender that contradicts itself cannot be used to accuse anybody.
    //
    // RJ21GE1657 alternates between roughly 25 L and 210 L on a 300 L tank,
    // holding each state for minutes. Every upward leg looks exactly like a
    // refuel, so this function reported twenty "fills the tank saw but nobody
    // logged" for that one truck on a single day — 132 L, 179 L, 188 L, 190 L —
    // around two hundred thousand rupees of diesel that never moved.
    //
    // That is the worst failure this system can have. The screen is headed
    // "nobody logged", it names a vehicle and a driver's day, and it is read by
    // someone deciding whether fuel was stolen. Twenty fabricated entries do
    // not merely add noise; they manufacture a case.
    //
    // The same test that withholds the displayed level withholds the fills. The
    // vehicle is reported as having an unreliable sender instead — true, and
    // pointing at a workshop rather than at a person.
    // ─────────────────────────────────────────────────────────────────────────
    const litreSeries = rows
      .map((r) => r.fuelLevelL)
      .filter((n): n is number => n != null);
    if (senderContradictsItself(litreSeries, asset.fuelCapacity ?? null)) {
      unreliable.push({
        assetId: asset.id,
        assetCode: asset.code,
        registrationNo: asset.registrationNo,
      });
      continue;
    }

    const { usage } = analyseUsage(rows as AnalyticsReading[], null, asset.fuelCapacity ?? null);
    const assetEntries = entriesBy.get(asset.id) ?? [];

    // An entry may only be claimed once, so two sensor fills on one day cannot
    // both point at the same receipt and each look accounted for.
    const claimed = new Set<string>();

    for (const r of usage.diagnostics.fuel.refuels) {
      if (r.litresAdded < MIN_FILL_LITRES) continue;

      const at = new Date(r.at);
      const match = assetEntries.find(
        (e) =>
          !claimed.has(e.id) &&
          Math.abs(e.date.getTime() - at.getTime()) <= MATCH_WINDOW_HOURS * 3_600_000,
      );
      if (match) claimed.add(match.id);

      out.push({
        assetId: asset.id,
        assetCode: asset.code,
        registrationNo: asset.registrationNo,
        at,
        litresAdded: Math.round(r.litresAdded),
        fromL: r.fromL ?? null,
        toL: r.toL ?? null,
        lat: r.lat ?? null,
        lng: r.lng ?? null,
        confidence: r.confidence,
        estimatedValue: Math.round(r.litresAdded * dieselRate),
        logged: match ? { id: match.id, quantity: match.quantity, amount: match.amount, date: match.date } : null,
        varianceL: match ? Math.round((r.litresAdded - match.quantity) * 10) / 10 : null,
      });
    }
  }

  return { fills: out.sort((a, b) => b.at.getTime() - a.at.getTime()), unreliable };
}
