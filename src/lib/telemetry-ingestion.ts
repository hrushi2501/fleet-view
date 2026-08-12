import { fetchTataPings, isTataEnabled } from "@/lib/tata-fleet-edge";

export interface TelemetryReading {
  vehicleId: string;
  timestamp: string;
  /** Null when the provider did not report it — never zero. */
  speed: number | null;
  /**
   * Tank level in litres, or null when unknown.
   *
   * This must never be coerced to a number. The fraud scanner reads a fall in
   * this value as diesel leaving the tank, so a missing reading rendered as 0
   * is a full tank's worth of fabricated theft against a real driver.
   */
  tankLevel: number | null;
  engineState: 'ON' | 'OFF' | 'UNKNOWN';
  /** Null when there is no GPS fix. 0,0 is a place in the Atlantic, not a null. */
  gps: { lat: number; lng: number } | null;
}

export interface ITelemetryIngestionAdapter {
  /** True when the readings are fabricated and must not be shown as findings. */
  readonly simulated: boolean;
  fetchStream(assetId?: string): Promise<TelemetryReading[]>;
}

export class DummyDataGenerator implements ITelemetryIngestionAdapter {
  readonly simulated = true;

  async fetchStream(assetId?: string): Promise<TelemetryReading[]> {
    const assets = assetId ? [assetId] : ["TATA-2518-A01", "JCB-3DX-E04", "TATA-SIGNA-T08"];
    
    // Simulate some realistic readings with a high chance of a fuel siphoning event.
    const now = Date.now();
    const readings: TelemetryReading[] = [];
    
    for (const v of assets) {
      // 50% chance to simulate an anomaly per fetch to make it easy to trigger in demo
      const isAnomaly = Math.random() < 0.5; 
      
      const tankStart = 200 + Math.random() * 100; // 200-300L
      
      for (let i = 0; i < 5; i++) { // 5 readings spaced by 5 mins
        const t = new Date(now - (4 - i) * 300000);
        let speed = isAnomaly ? 0 : 20 + Math.random() * 40;
        let tankLevel = tankStart - (i * 2); // normal burn 2L per 5 mins
        
        if (isAnomaly && i >= 2) {
           tankLevel -= 50; // sudden drop of 50L while speed is 0
           speed = 0;
        }
        
        readings.push({
          vehicleId: v,
          timestamp: t.toISOString(),
          speed: speed,
          tankLevel: tankLevel,
          engineState: isAnomaly && i >= 2 ? 'OFF' : 'ON',
          gps: { lat: 26.9124 + (Math.random()*0.01), lng: 75.7873 + (Math.random()*0.01) } // Jaipur roughly
        });
      }
    }
    
    return readings;
  }
}

/**
 * Live Tata Fleet Edge pull. Reads the same normalised pings the cron sync
 * stores, so the fraud scanner sees exactly what the map and the fuel
 * reconciliation see.
 */
export class TataApiAdapter implements ITelemetryIngestionAdapter {
  readonly simulated = false;

  async fetchStream(assetId?: string): Promise<TelemetryReading[]> {
    const { pings } = await fetchTataPings();
    const scoped = assetId ? pings.filter((p) => p.externalDeviceId === assetId) : pings;

    return scoped.map((p) => ({
      vehicleId: p.externalDeviceId,
      timestamp: p.timestamp.toISOString(),
      speed: p.speedKph,
      // The scanner reasons in litres; percentage alone can't size a siphon.
      tankLevel: p.fuelLevelLitres,
      // Three states, not two: a vehicle that did not report its ignition is
      // not a vehicle with the ignition off, and only the latter makes a fuel
      // drop impossible to explain as combustion.
      engineState: p.ignitionState == null ? 'UNKNOWN' : p.ignitionState ? 'ON' : 'OFF',
      gps: p.latitude != null && p.longitude != null ? { lat: p.latitude, lng: p.longitude } : null,
    }));
  }
}

/**
 * Picks the data source.
 *
 * 'AUTO' (the default) uses the live OEM feed the moment Fleet Edge is
 * configured and switched on, and falls back to the generator otherwise.
 * Callers should surface `simulated` to the user — an invented fuel-theft case
 * shown as real is worse than showing nothing at all.
 */
export function createTelemetryAdapter(mode: 'A' | 'B' | 'AUTO' = 'AUTO'): ITelemetryIngestionAdapter {
  if (mode === 'A') return new DummyDataGenerator();
  if (mode === 'B') return new TataApiAdapter();
  return isTataEnabled() ? new TataApiAdapter() : new DummyDataGenerator();
}
