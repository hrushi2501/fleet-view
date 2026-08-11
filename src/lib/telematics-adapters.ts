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
  ignitionState: boolean | null;
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

        const litres = toNum(e.primaryFuelLevel ?? e.PrimaryFuelLevel);
        const capacity = toNum(e.primaryFuelTankCapacity);
        const fuelLevelPct =
          toNum(e.fuelLevelPercent) ??
          (litres != null && capacity != null && capacity > 0
            ? Math.round((litres / capacity) * 1000) / 10
            : null);

        const odometerKm = toNum(e.odometer);
        const rawEngineHours = toNum(e.engineRunHour);
        // The live fleet returns engineRunHour identical to odometer (89399 for
        // both) — 89,399 hours is ten years of continuous running, so it is the
        // odometer echoed into the wrong field. Storing it would make every
        // hour-based service schedule read as wildly overdue. The original
        // value stays in rawPayload for anyone auditing this later.
        const engineHours =
          rawEngineHours != null && odometerKm != null && Math.round(rawEngineHours) === Math.round(odometerKm)
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
          ignitionState: typeof e.ignitionOn === "boolean" ? e.ignitionOn : null,
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
