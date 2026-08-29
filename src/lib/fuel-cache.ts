/**
 * The fuel level a vehicle page should show.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT SIMPLY THE LATEST READING
 *
 * RJ21GE1657's sender flickers. Inside a single hour, while the truck moved
 * three kilometres, it reported 227.8 L and 25.0 L and back again — a 200-litre
 * round trip on a 300-litre tank, repeatedly. Fuel does not come back, so the
 * low readings are noise, not measurement.
 *
 * Every one of them passes validation, because 25 L is a perfectly ordinary
 * level for a 300 L tank. Nothing about a single sample says it is wrong; only
 * its neighbours do. So the cached level took whichever sample happened to
 * arrive last, and the vehicle page showed a truck with 210 litres in it as
 * being down to 28%.
 *
 * A median over the recent samples fixes that without inventing a threshold
 * anyone has to defend: an isolated spike cannot move it, and a genuine change
 * moves it as soon as most of the window agrees. No rate limit, no guess about
 * how fast a tank "should" be able to drain — which matters, because guessing
 * that is exactly how you would end up suppressing a real siphon.
 *
 * The readings themselves are never altered. The full series, spikes included,
 * stays in the table for `analyseUsage`, which does its own noise rectification
 * across the window and needs to see everything. This governs one thing: the
 * number a person reads off the screen.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { db } from "@/lib/db";

/** Enough samples to see the shape of the recent trace. */
const WINDOW = 20;

/**
 * A swing this large, as a fraction of the tank, is not consumption.
 *
 * A tank cannot lose a fifth of its capacity and regain it within half an hour.
 * A refuel rises and stays; consumption falls and stays. Only a fault does both.
 */
const UNSTABLE_SWING_FRACTION = 0.2;

/** Beyond this the samples are too old to describe the tank now. */
const WINDOW_MS = 2 * 60 * 60_000;

export type CachedFuel = {
  pct: number | null;
  at: Date | null;
  /**
   * True when the sender contradicted itself inside the window — it both rose
   * and fell by more than a fifth of the tank. Callers should show "sender
   * unreliable" rather than any number.
   */
  unstable: boolean;
};

/**
 * Did this sender contradict itself across the series?
 *
 * Both a large rise and a large fall inside the same window. A genuine fill
 * only rises; genuine consumption only falls; a siphon only falls. Only a
 * faulty sender does both.
 *
 * Exported because the same question decides two different things: what level
 * to display, and whether this vehicle's "refuels" are real. Getting the second
 * one wrong is far more expensive — it puts fills nobody made in front of
 * somebody deciding whether a driver stole diesel.
 *
 * @param litres oldest → newest
 */
export function senderContradictsItself(litres: number[], tankL: number | null): boolean {
  if (!tankL || tankL <= 0 || litres.length < 3) return false;
  const limit = tankL * UNSTABLE_SWING_FRACTION;
  let maxRise = 0;
  let maxFall = 0;
  for (let i = 1; i < litres.length; i++) {
    const delta = litres[i]! - litres[i - 1]!;
    if (delta > maxRise) maxRise = delta;
    if (-delta > maxFall) maxFall = -delta;
  }
  return maxRise > limit && maxFall > limit;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * The level to cache on the asset, from its recent readings.
 *
 * Returns the newest reading's timestamp with the median's value: the figure is
 * "what the tank holds, as of now", and dating it to the middle sample would
 * make a live vehicle look stale.
 */
export async function cachedFuelFor(assetId: string, capacityL?: number | null): Promise<CachedFuel> {
  const rows = await db.telemetryReading.findMany({
    where: {
      assetId,
      fuelLevelPct: { not: null },
      recordedAt: { gte: new Date(Date.now() - WINDOW_MS) },
    },
    orderBy: { recordedAt: "desc" },
    take: WINDOW,
    select: { fuelLevelPct: true, fuelLevelL: true, recordedAt: true },
  });

  if (rows.length === 0) return { pct: null, at: null, unstable: false };

  // ───────────────────────────────────────────────────────────────────────────
  // Is the sender contradicting itself?
  //
  // RJ21GE1657 alternates between two stable states — around 210 L and around
  // 25 L on a 300 L tank — while the truck covers two kilometres. It holds each
  // for minutes at a time, so this is not an isolated spike a median can
  // outvote: whichever state happens to be winning decides the number.
  //
  // Both cannot be true, and there is no honest way to pick. The high state
  // moves in smooth 0.7 L steps and looks like measurement; the low state
  // repeats identical values and looks like a floor. That is a reasonable guess
  // and a guess is exactly what must not be printed as a fuel level, because
  // this figure is what a theft investigation starts from.
  //
  // So the level is withheld and the sender reported as unreliable — which is
  // both the truthful answer and an actionable one: that vehicle needs a
  // workshop, not an accusation.
  // ───────────────────────────────────────────────────────────────────────────
  const litres = rows.map((r) => r.fuelLevelL).filter((n): n is number => n != null);
  const tank = capacityL && capacityL > 0 ? capacityL : null;

  const unstable = senderContradictsItself([...litres].reverse(), tank);

  if (unstable) return { pct: null, at: rows[0]!.recordedAt, unstable: true };

  const pct = median(rows.slice(0, 5).map((r) => r.fuelLevelPct!).filter((n) => Number.isFinite(n)));
  return {
    pct: pct == null ? null : Math.round(pct * 10) / 10,
    at: rows[0]!.recordedAt,
    unstable: false,
  };
}
