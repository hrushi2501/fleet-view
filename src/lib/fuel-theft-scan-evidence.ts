import { cleanSeries, type AnalyticsReading, type Norm } from "./fleet-analytics";
import { senderContradictsItself } from "./fuel-sender-quality";

/** Only the OEM feed has a calibrated fuel sender and event-time provenance. */
export const FUEL_SCAN_SOURCE = "GPS_API";
export const MIN_FUEL_SCAN_SAMPLES = 6;

export type FuelScanReading = AnalyticsReading & { source: string; providerId: string | null };
export type FuelScanNormRow = Norm & { assetId: string | null; assetClass: string | null };

/** A machine-specific consumption contract overrides the class-wide default. */
export function pickFuelScanNorm(
  norms: FuelScanNormRow[],
  assetId: string,
  assetClass: string,
): Norm | null {
  const row = norms.find((norm) => norm.assetId === assetId)
    ?? norms.find((norm) => norm.assetId == null && norm.assetClass === assetClass);
  return row
    ? { normLow: row.normLow, normHigh: row.normHigh, tolerancePct: row.tolerancePct }
    : null;
}

export function fuelScanProviderProblem(providerId: string | null | undefined, providerCode: string): string | null {
  return providerId
    ? null
    : `telemetry provider ${providerCode} is not registered, so OEM provenance cannot be verified`;
}

/**
 * Establish the evidence the nightly scan may judge. Count measurements after
 * source filtering, timestamp deduplication and physical tank bounds, so a
 * repeated or invalid sample cannot make an unmeasured vehicle look assessed.
 */
export function prepareFuelScanEvidence(
  readings: FuelScanReading[],
  tankCapacityL: number,
  providerId: string,
): {
  samples: AnalyticsReading[];
  fuelSamples: number;
  contradictorySender: boolean;
} {
  const oem = readings.filter(
    (reading) => reading.source === FUEL_SCAN_SOURCE && reading.providerId === providerId,
  );
  const { samples } = cleanSeries(oem, tankCapacityL);
  const litres = samples.map((sample) => sample.fuelLevelL).filter((n): n is number => n != null);
  return {
    samples,
    fuelSamples: litres.length,
    contradictorySender: senderContradictsItself(litres, tankCapacityL),
  };
}
