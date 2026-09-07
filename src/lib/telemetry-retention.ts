/**
 * Shrinking old telemetry payloads without throwing away the evidence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY
 *
 * Every reading keeps the complete message Fleet Edge sent, exactly as it
 * arrived. That is 979 bytes a row and 85% of the table — 38 MB of 58 MB today,
 * growing about 2 MB a day and rising as vehicles are added.
 *
 * The obvious fix is to null `raw` once it is old. That is the wrong fix, and
 * this file exists because of what it would have cost: on 2 September the raw
 * payloads were what proved the three faulty fuel senders are faulty on Tata's
 * side and not in our parsing — `primaryFuelLevel` swinging 243 L on a
 * stationary truck, `noOfFuelTanks: 1` ruling out the innocent twin-tank
 * explanation. That complaint is still open. Deleting the payloads would delete
 * the proof, in the middle of the argument they settle.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES INSTEAD
 *
 * Old rows keep a small subset of the payload and lose the bulk. The kept
 * fields are the ones that have actually answered a question: identity, tank
 * configuration, the fuel figure as sent, and the few health signals a dispute
 * or a warranty claim turns on. What goes is the high-rate sensor noise —
 * accelerometer and gyroscope axes, GPS satellite counts, gear position — which
 * has never been read by anything in this system and is most of the bulk.
 *
 * Roughly 63% of the payload size goes; everything that has ever settled an
 * argument stays.
 *
 * Nothing derived is affected either way. Position, speed, odometer, fuel level
 * and ignition are already extracted into real columns at ingest, and every
 * screen and every calculation reads those, never `raw`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Fields kept when an old payload is slimmed.
 *
 * Each earns its place by having been needed:
 *
 *   imei, vehicleId, registrationNumber   which device and which vehicle sent
 *                                         it — the first thing asked when a
 *                                         reading is disputed
 *   primaryFuelLevel                      the fuel figure exactly as sent, so
 *                                         our stored value can be re-checked
 *                                         against the provider's own number
 *   primaryFuelTankCapacity,
 *   noOfFuelTanks                         the tank configuration; this is what
 *                                         ruled out "two tanks reported
 *                                         alternately" as an explanation for
 *                                         the sender faults
 *   defLevel                              AdBlue, which is a compliance matter
 *   vehicleBatteryVoltage                 a dying battery explains dropouts
 *   vehicleStatus, gpsFix                 whether the unit considered itself
 *                                         healthy and located at the time
 *   eventDateTime                         the provider's own timestamp, beside
 *                                         ours
 */
export const KEPT_RAW_FIELDS = [
  "imei",
  "vehicleId",
  "registrationNumber",
  "eventDateTime",
  "primaryFuelLevel",
  "primaryFuelTankCapacity",
  "noOfFuelTanks",
  "defLevel",
  "vehicleBatteryVoltage",
  "vehicleStatus",
  "gpsFix",
] as const;

/**
 * How long a payload is kept in full.
 *
 * Sixty days rather than thirty, deliberately. A dispute with a provider takes
 * weeks to answer, and the evidence has to outlive the argument — the open
 * sender-calibration complaint was raised on the second of September against
 * readings going back to the twentieth of August. Thirty days would have put
 * the oldest evidence out of reach before a reply arrived.
 */
export const FULL_PAYLOAD_DAYS = 60;

/**
 * Rows handled per pass.
 *
 * Small on purpose. This runs against the live database while vehicles are
 * reporting once a minute, and a single enormous UPDATE would hold locks and
 * bloat the write-ahead log. Several small passes are slower and bother nobody.
 */
export const RETENTION_BATCH = 2_000;

export type SlimResult = {
  /** The reduced payload. */
  slimmed: Record<string, unknown>;
  /** Field names dropped, for the audit line. */
  dropped: string[];
};

/**
 * Reduces one payload to the kept fields.
 *
 * A field that was absent stays absent rather than being written as null: the
 * difference between "the provider did not send DEF" and "the provider sent DEF
 * as null" is exactly the kind of thing these payloads get read for.
 */
export function slimPayload(raw: unknown): SlimResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { slimmed: {}, dropped: [] };
  }

  const source = raw as Record<string, unknown>;
  const slimmed: Record<string, unknown> = {};
  const kept = new Set<string>(KEPT_RAW_FIELDS);

  for (const field of KEPT_RAW_FIELDS) {
    if (field in source) slimmed[field] = source[field];
  }

  const dropped = Object.keys(source).filter((k) => !kept.has(k));
  return { slimmed, dropped };
}

/** True once a reading is old enough for its payload to be reduced. */
export function isDueForSlimming(recordedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - recordedAt.getTime() > FULL_PAYLOAD_DAYS * 86_400_000;
}

/**
 * Whether a payload has already been reduced.
 *
 * Checked so repeated runs do not rewrite rows that are already small, which
 * would be pure write amplification on a table that is mostly this column.
 */
export function alreadySlim(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return true;
  const kept = new Set<string>(KEPT_RAW_FIELDS);
  return Object.keys(raw as Record<string, unknown>).every((k) => kept.has(k));
}
