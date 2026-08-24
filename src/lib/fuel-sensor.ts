/**
 * Which vehicles have a working fuel sensor, and what it currently reads.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Two ways a fuel level gets into this system:
 *
 *   the tank sender   litres, arriving on its own every couple of minutes
 *   a gauge photo     a driver photographs the dashboard, a model reads the
 *                     needle, and anything under 85% confidence waits for a
 *                     person to confirm it
 *
 * The photo path exists because most of this fleet has no sender. On a vehicle
 * that *does* have one, asking an administrator to confirm a model's guess at a
 * needle is worse than pointless: the sender already reported the number, to
 * the litre, without being asked. Review there adds delay and invites somebody
 * to overrule an instrument with an estimate.
 *
 * So the rule is: where a sender reports, it is the source of truth and nothing
 * is queued. Review is reserved for vehicles that have no sender, which is the
 * only place a human eye adds anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS HAVING A SENSOR
 *
 * Not a flag somebody sets on the vehicle record — a flag would go stale the
 * first time a sender failed, and the system would keep trusting an instrument
 * that stopped reporting. It is decided from the data: has this vehicle
 * actually reported a fuel level recently, from a machine source.
 *
 * That way a sender that dies simply stops qualifying, and the vehicle falls
 * back to the photo-and-review path on its own.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { db } from "@/lib/db";

/**
 * How recently a sender must have reported to count as working.
 *
 * Generous: a truck parked over a weekend in a GSM dead spot has not lost its
 * sender. Short enough that a genuinely dead one stops being trusted within a
 * shift or two.
 */
const SENSOR_FRESH_HOURS = 24;

/** Sources that are an instrument reporting, rather than a person or a model. */
const MACHINE_SOURCES = ["GPS_API", "DEVICE"];

export type SensorState = {
  hasSensor: boolean;
  /** Litres, as last reported by the sender. */
  levelL: number | null;
  levelPct: number | null;
  at: Date | null;
};

/**
 * Whether this vehicle's tank sender is reporting, and its latest reading.
 *
 * A reading with a null `fuelLevelL` does not count: plenty of vehicles report
 * position and odometer without a fuel sender fitted, and treating those as
 * sensor-equipped would silence the review queue for trucks that need it.
 */
export async function fuelSensorState(assetId: string): Promise<SensorState> {
  const since = new Date(Date.now() - SENSOR_FRESH_HOURS * 3_600_000);

  const latest = await db.telemetryReading.findFirst({
    where: {
      assetId,
      recordedAt: { gte: since },
      fuelLevelL: { not: null },
      source: { in: MACHINE_SOURCES },
    },
    orderBy: { recordedAt: "desc" },
    select: { fuelLevelL: true, fuelLevelPct: true, recordedAt: true },
  });

  if (!latest) return { hasSensor: false, levelL: null, levelPct: null, at: null };

  return {
    hasSensor: true,
    levelL: latest.fuelLevelL,
    levelPct: latest.fuelLevelPct,
    at: latest.recordedAt,
  };
}

/**
 * The same question for many vehicles at once.
 *
 * One grouped query rather than one per vehicle — the review queue and the
 * fleet screens both need this for every asset they list, and asking per row
 * turns a page render into dozens of round trips.
 */
export async function assetsWithFuelSensor(assetIds: string[]): Promise<Set<string>> {
  if (assetIds.length === 0) return new Set();
  const since = new Date(Date.now() - SENSOR_FRESH_HOURS * 3_600_000);

  const rows = await db.telemetryReading.groupBy({
    by: ["assetId"],
    where: {
      assetId: { in: assetIds },
      recordedAt: { gte: since },
      fuelLevelL: { not: null },
      source: { in: MACHINE_SOURCES },
    },
  });

  return new Set(rows.map((r) => r.assetId));
}
