/**
 * The Fuel page has two different kinds of truth:
 *
 * - recorded: persisted ledger entries that may be totalled as issued fuel
 * - sensorOnly: an observation that still needs human confirmation/paperwork
 *
 * Keep them in separate namespaces and deliberately expose no combined total.
 * A sensor observation must never silently change a recorded ledger headline.
 */
export type RecordedFuelHeadline = Readonly<{
  litres: number;
  spend: number;
  entries: number;
}>;

export type SensorOnlyFuelHeadline = Readonly<{
  litres: number;
  fills: number;
}>;

export type FuelHeadline = Readonly<{
  recorded: RecordedFuelHeadline;
  sensorOnly: SensorOnlyFuelHeadline;
}>;

export function fuelHeadline(
  recorded: RecordedFuelHeadline,
  sensorOnly: SensorOnlyFuelHeadline,
): FuelHeadline {
  return Object.freeze({
    recorded: Object.freeze({ ...recorded }),
    sensorOnly: Object.freeze({ ...sensorOnly }),
  });
}
