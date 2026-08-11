import { fetchTataPings, isTataEnabled } from "@/lib/tata-fleet-edge";

export interface TelemetryReading {
  vehicleId: string;
  timestamp: string;
  speed: number;
  tankLevel: number;
  engineState: 'ON' | 'OFF';
  gps: { lat: number; lng: number };
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
      speed: p.speedKph ?? 0,
      // The scanner reasons in litres; percentage alone can't size a siphon.
      tankLevel: p.fuelLevelLitres ?? 0,
      engineState: p.ignitionState ? 'ON' : 'OFF',
      gps: { lat: p.latitude ?? 0, lng: p.longitude ?? 0 },
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
