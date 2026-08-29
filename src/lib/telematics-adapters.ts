/** A record of which tanks were read, which were ignored, and why. */
export interface FuelInterpretation {
  primaryLitres: number | null;
  primaryCapacityL: number | null;
  /** What the vehicle claims it has fitted. */
  tanksReported: number | null;
  secondaryLitres: number | null;
  secondaryCapacityL: number | null;
  /** False when the secondary reading was rejected as implausible. */
  secondaryIncluded: boolean;
  notes: string[];
}

/**
 * Normalized telemetry payload structure across all GPS / CAN-bus / OEM providers
 */
export interface TelemetryPing {
  externalDeviceId: string;
  timestamp: Date;
  latitude: number | null;
  longitude: number | null;
  speedKph: number | null;
  /** Course over ground, degrees from north. */
  headingDeg?: number | null;
  odometerKm: number | null;
  engineHours: number | null;
  fuelLevelPct: number | null;
  fuelLevelLitres: number | null;
  /**
   * Tank size as the vehicle itself reports it, litres.
   *
   * Carried because the register frequently does not have it. Fifty-three
   * assets were imported from a compliance spreadsheet that records document
   * expiry and nothing about tanks, so every one arrived with a capacity of
   * zero — while the vehicles were reporting 300 L, or 160 L for the smaller
   * ones, in every single payload. Without it, estimated range cannot be
   * computed and the refuel detector has no threshold to work against.
   */
  fuelCapacityLitres?: number | null;
  ignitionState: boolean | null;
  /**
   * How the fuel figure above was arrived at. Fuel numbers drive theft
   * accusations, so which tank was read — and which was deliberately ignored —
   * must be inspectable rather than buried in the adapter.
   */
  fuelInterpretation?: FuelInterpretation;
  rawPayload: Record<string, unknown>;
  /**
   * Every provider-side identifier the payload carried. Fleet Edge returns
   * chassis, registration *and* IMEI; matching on a single one would miss
   * assets whose register row happens to hold a different key.
   */
  identifiers?: {
    registrationNo?: string | null;
    chassisNo?: string | null;
    imei?: string | null;
  };
}

/**
 * Hexagonal Port interface for telematics provider integration
 */
export interface ITelemetryProviderAdapter {
  readonly providerCode: string; // e.g. "GENERIC", "LOCONAV", "MAPMYINDIA", "TATA_FLEET_EDGE"
  readonly providerName: string;

  parsePayload(rawBody: unknown): Promise<TelemetryPing[]>;
  verifyWebhookSignature?(headers: Record<string, string>, rawBody: string): boolean;
  fetchHistoricalPings?(deviceId: string, from: Date, to: Date): Promise<TelemetryPing[]>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawPingItem = Record<string, any>;

/**
 * Adapter 1: Generic HTTP Push / Low-Cost GPS Trackers
 */
export class GenericHttpAdapter implements ITelemetryProviderAdapter {
  readonly providerCode = "GENERIC";
  readonly providerName = "Generic Device Push";

  async parsePayload(rawBody: unknown): Promise<TelemetryPing[]> {
    if (!rawBody || typeof rawBody !== "object") return [];
    const payload = rawBody as Record<string, unknown>;
    const items = (Array.isArray(payload.data) ? payload.data : [payload]) as RawPingItem[];

    return items.map((item) => ({
      externalDeviceId: String(item.deviceId || item.imei || item.id || "GENERIC_DEV"),
      timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
      latitude: item.lat != null ? Number(item.lat) : null,
      longitude: item.lng != null ? Number(item.lng) : null,
      speedKph: item.speed != null ? Number(item.speed) : null,
      odometerKm: item.odometer != null ? Number(item.odometer) : null,
      engineHours: item.engineHours != null ? Number(item.engineHours) : null,
      fuelLevelPct: item.fuelPct != null ? Number(item.fuelPct) : null,
      fuelLevelLitres: item.fuelLitres != null ? Number(item.fuelLitres) : null,
      ignitionState: item.ignition != null ? Boolean(item.ignition) : null,
      rawPayload: item as Record<string, unknown>,
    }));
  }
}

/**
 * Adapter 2: LocoNav Telematics API / Webhook
 */
export class LocoNavAdapter implements ITelemetryProviderAdapter {
  readonly providerCode = "LOCONAV";
  readonly providerName = "LocoNav Telematics";

  async parsePayload(rawBody: unknown): Promise<TelemetryPing[]> {
    if (!rawBody || typeof rawBody !== "object") return [];
    const body = rawBody as Record<string, unknown>;
    const pings = (Array.isArray(body.loconav_pings) ? body.loconav_pings : [body]) as RawPingItem[];

    return pings.map((p) => ({
      externalDeviceId: String(p.vehicle_number || p.device_id || "LOCONAV_DEV"),
      timestamp: p.gps_time ? new Date(p.gps_time) : new Date(),
      latitude: p.latitude != null ? Number(p.latitude) : null,
      longitude: p.longitude != null ? Number(p.longitude) : null,
      speedKph: p.speed != null ? Number(p.speed) : null,
      odometerKm: p.odometer_reading != null ? Number(p.odometer_reading) : null,
      engineHours: p.cumulative_engine_hours != null ? Number(p.cumulative_engine_hours) : null,
      fuelLevelPct: p.fuel_percentage != null ? Number(p.fuel_percentage) : null,
      fuelLevelLitres: p.fuel_litre != null ? Number(p.fuel_litre) : null,
      ignitionState: p.ignition_status != null ? p.ignition_status === "ON" || p.ignition_status === true : null,
      rawPayload: p as Record<string, unknown>,
    }));
  }
}

/**
 * Adapter 3: MapMyIndia (Mappls) Telematics API / Webhook
 */
export class MapMyIndiaAdapter implements ITelemetryProviderAdapter {
  readonly providerCode = "MAPMYINDIA";
  readonly providerName = "MapmyIndia Mappls";

  async parsePayload(rawBody: unknown): Promise<TelemetryPing[]> {
    if (!rawBody || typeof rawBody !== "object") return [];
    const body = rawBody as Record<string, unknown>;
    const list = (Array.isArray(body.positions) ? body.positions : [body]) as RawPingItem[];

    return list.map((item) => ({
      externalDeviceId: String(item.device_id || item.vehicle_id || "MMI_DEV"),
      timestamp: item.fix_time ? new Date(item.fix_time) : new Date(),
      latitude: item.lat != null ? Number(item.lat) : null,
      longitude: item.lng != null ? Number(item.lng) : null,
      speedKph: item.speed_kph != null ? Number(item.speed_kph) : null,
      odometerKm: item.odo_km != null ? Number(item.odo_km) : null,
      engineHours: item.hrs != null ? Number(item.hrs) : null,
      fuelLevelPct: item.fuel_pct != null ? Number(item.fuel_pct) : null,
      fuelLevelLitres: item.fuel_l != null ? Number(item.fuel_l) : null,
      ignitionState: item.acc != null ? Boolean(item.acc) : null,
      rawPayload: item as Record<string, unknown>,
    }));
  }
}

/**
 * Adapter 4: Tata Fleet Edge API / Webhook (OEM Integration)
 */
/** Finite number or null — Fleet Edge omits fields that a model does not report. */
function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fleet Edge sends nanosecond precision and *no* UTC offset
 * ("2026-08-10T16:17:59.000000981"). `new Date()` would read that as the
 * server's local time, so the identical payload would land 5.5 hours apart on
 * a laptop in IST and on Vercel in UTC. Truncate to milliseconds and pin to UTC.
 */
export function parseFleetEdgeTimestamp(raw: unknown): Date {
  if (typeof raw !== "string" || !raw.trim()) return new Date();
  const m = raw.trim().match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (!m) {
    const loose = new Date(raw);
    return Number.isNaN(loose.getTime()) ? new Date() : loose;
  }
  const [, stamp, frac, offset] = m;
  const ms = (frac ?? "").slice(0, 3).padEnd(3, "0");
  const parsed = new Date(`${stamp}.${ms}${offset ?? "Z"}`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Plausible range for a road vehicle's fuel tank, litres. A tank outside this
 * is not a tank, it is a placeholder — Fleet Edge fills unused slots with
 * sentinel values rather than omitting them.
 */
const MIN_CREDIBLE_TANK_L = 20;
const MAX_CREDIBLE_TANK_L = 2000;

/**
 * Decides what the vehicle's fuel level actually is.
 *
 * The live payload for RJ21GE3220 reports, on every single sample:
 *
 *   noOfFuelTanks              1
 *   primaryFuelLevel           214 – 276      primaryFuelTankCapacity     300
 *   secondaryFuelLevel1        1500           secondaryFuelTankCapacity1  55555
 *
 * The secondary pair never varies, describes a 55,555 L tank holding 1,500 L,
 * and contradicts the vehicle's own statement that it has one tank. Those are
 * unused-slot sentinels, not a measurement. Adding them to the primary level
 * would put a constant 1,500 L into every fuel calculation in the ERP.
 *
 * A second tank is therefore only counted when the vehicle says it has one,
 * the capacity is credible for a road vehicle, and the level fits inside it.
 */
export function interpretFleetEdgeFuel(e: RawPingItem): FuelInterpretation {
  const notes: string[] = [];

  const primaryLitres = toNum(e.primaryFuelLevel ?? e.PrimaryFuelLevel);
  const primaryCapacityL = toNum(e.primaryFuelTankCapacity);
  const tanksReported = toNum(e.noOfFuelTanks);
  const secondaryLitres = toNum(e.secondaryFuelLevel1 ?? e.SecondaryFuelLevel1);
  const secondaryCapacityL = toNum(e.secondaryFuelTankCapacity1 ?? e.SecondaryFuelTankCapacity1);

  let secondaryIncluded = false;

  if (secondaryLitres != null || secondaryCapacityL != null) {
    const capacityCredible =
      secondaryCapacityL != null &&
      secondaryCapacityL >= MIN_CREDIBLE_TANK_L &&
      secondaryCapacityL <= MAX_CREDIBLE_TANK_L;
    const fitsInTank =
      secondaryLitres != null && secondaryCapacityL != null && secondaryLitres <= secondaryCapacityL;
    const vehicleClaimsTwo = tanksReported != null && tanksReported >= 2;

    if (vehicleClaimsTwo && capacityCredible && fitsInTank) {
      secondaryIncluded = true;
      notes.push(
        `Second tank included: ${secondaryLitres} L of ${secondaryCapacityL} L, ` +
          `and the vehicle reports ${tanksReported} tanks.`,
      );
    } else {
      const why: string[] = [];
      if (!vehicleClaimsTwo) why.push(`vehicle reports ${tanksReported ?? "no"} fuel tank(s)`);
      if (!capacityCredible) why.push(`capacity ${secondaryCapacityL} L is outside ${MIN_CREDIBLE_TANK_L}–${MAX_CREDIBLE_TANK_L} L`);
      if (!fitsInTank) why.push(`level ${secondaryLitres} L does not fit capacity ${secondaryCapacityL} L`);
      notes.push(
        `Second tank ignored (${why.join("; ")}). Its raw values are preserved in the payload ` +
          `but excluded from every fuel figure until the unit is verified with Fleet Edge.`,
      );
    }
  }

  if (primaryLitres != null && primaryCapacityL != null && primaryLitres > primaryCapacityL * 1.05) {
    notes.push(`Primary level ${primaryLitres} L exceeds the ${primaryCapacityL} L tank — treated as unusable.`);
  }

  return {
    primaryLitres,
    primaryCapacityL,
    tanksReported,
    secondaryLitres,
    secondaryCapacityL,
    secondaryIncluded,
    notes,
  };
}

/**
 * An `engineRunHour` at least this close to the odometer is the odometer
 * echoed into the wrong field, not a running total.
 *
 * The live fleet returns 89,513.6 "hours" against 89,513 km. Ten years of
 * continuous running would be 87,600 h, and a vehicle averaging 1 km per engine
 * hour has not been driven anywhere. Anything above half the odometer implies a
 * lifetime average below 2 km/h and cannot be a real hour meter.
 */
const ENGINE_HOUR_ECHO_RATIO = 0.5;

export class TataFleetEdgeAdapter implements ITelemetryProviderAdapter {
  readonly providerCode = "TATA_FLEET_EDGE";
  readonly providerName = "Tata Fleet Edge";

  /**
   * Maps the Basic Pull API's `VehicleTelemetry` model. Field names are taken
   * from a verified live response, not from the PDF alone — the spec writes
   * `PrimaryFuelLevel` where the API sends `primaryFuelLevel`, so both are read.
   */
  async parsePayload(rawBody: unknown): Promise<TelemetryPing[]> {
    if (!rawBody || typeof rawBody !== "object") return [];
    const body = rawBody as Record<string, unknown>;
    // getAllVehicleSnapshot returns { vehicles, failures, pageable };
    // getVehicleSnapshot returns a bare VehicleTelemetry object.
    const events = (Array.isArray(body.vehicles) ? body.vehicles : [body]) as RawPingItem[];

    return events
      .filter((e): e is RawPingItem => !!e && typeof e === "object")
      .map((e) => {
        const registrationNo = e.registrationNumber ? String(e.registrationNumber).trim() : null;
        const chassisNo = e.vehicleId ? String(e.vehicleId).trim() : null;
        const imei = e.imei ? String(e.imei).trim() : null;

        // A stale fix reports its last known point, which on a map is
        // indistinguishable from the vehicle actually being there — and it
        // would feed false distances into fuel-theft detection.
        const hasFix = e.gpsFix !== false;

        // Fleet Edge reports tank levels in litres, not percent and not a raw
        // sensor count: primaryFuelLevel tracks primaryFuelTankCapacity (300)
        // and moves between 214 and 276 on a tank the register also holds as
        // 300 L. Percentage is derived from it, never the other way round.
        const fuel = interpretFleetEdgeFuel(e);
        const capacity =
          fuel.primaryCapacityL != null && fuel.secondaryIncluded && fuel.secondaryCapacityL != null
            ? fuel.primaryCapacityL + fuel.secondaryCapacityL
            : fuel.primaryCapacityL;
        const litres =
          fuel.primaryLitres != null && fuel.secondaryIncluded && fuel.secondaryLitres != null
            ? fuel.primaryLitres + fuel.secondaryLitres
            : fuel.primaryLitres;

        const fuelLevelPct =
          toNum(e.fuelLevelPercent) ??
          (litres != null && capacity != null && capacity > 0
            ? Math.round((litres / capacity) * 1000) / 10
            : null);

        const odometerKm = toNum(e.odometer);
        const rawEngineHours = toNum(e.engineRunHour);
        // Fleet Edge echoes the odometer into engineRunHour on this
        // subscription. Storing it would make every hour-based service schedule
        // read as wildly overdue, and would put a nonsense denominator into any
        // litres-per-hour figure. The original value stays in rawPayload for
        // anyone auditing this later.
        const engineHours =
          rawEngineHours != null && odometerKm != null && odometerKm > 0 &&
          rawEngineHours >= odometerKm * ENGINE_HOUR_ECHO_RATIO
            ? null
            : rawEngineHours;

        return {
          // Registration first: the fleet register was loaded from the client's
          // own spreadsheet, which is keyed on registration number.
          externalDeviceId: registrationNo || chassisNo || imei || "TATA_DEV",
          timestamp: parseFleetEdgeTimestamp(e.eventDateTime),
          latitude: hasFix ? toNum(e.gpsLatitude) : null,
          longitude: hasFix ? toNum(e.gpsLongitude) : null,
          speedKph: toNum(e.speed),
          headingDeg: hasFix ? toNum(e.gpsCourseInDegrees) : null,
          odometerKm,
          engineHours,
          fuelLevelPct,
          fuelLevelLitres: litres,
          fuelCapacityLitres: capacity ?? null,
          ignitionState: typeof e.ignitionOn === "boolean" ? e.ignitionOn : null,
          fuelInterpretation: fuel,
          rawPayload: e as Record<string, unknown>,
          identifiers: { registrationNo, chassisNo, imei },
        };
      });
  }
}


/**
 * Registry mapping provider codes to adapter instances
 */
export const TELEMETRY_ADAPTERS: Record<string, ITelemetryProviderAdapter> = {
  GENERIC: new GenericHttpAdapter(),
  LOCONAV: new LocoNavAdapter(),
  MAPMYINDIA: new MapMyIndiaAdapter(),
  TATA_FLEET_EDGE: new TataFleetEdgeAdapter(),
};

export function getTelemetryAdapter(providerCode: string): ITelemetryProviderAdapter {
  return TELEMETRY_ADAPTERS[providerCode.toUpperCase()] || TELEMETRY_ADAPTERS.GENERIC;
}
