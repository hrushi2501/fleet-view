/**
 * Fleet-level rollups of telemetry-derived usage.
 *
 * One shared query and one shared calculation, so the Dashboard, Trips &
 * Telematics and the asset detail cannot quietly disagree about how far the
 * fleet drove or what it burned. The per-segment maths lives in
 * `fleet-analytics.ts`; this only groups it by vehicle and totals it.
 */
import { db } from "@/lib/db";
import { analyseReadings, summarise, type UsageSummary } from "@/lib/fleet-analytics";

export type AssetUsage = {
  assetId: string;
  code: string;
  name: string;
  registrationNo: string | null;
  assetClass: string;
  lastSeen: Date | null;
  fuelLevelPct: number | null;
  usage: UsageSummary;
  norm: { low: number; high: number } | null;
  /** True when measured efficiency is worse than the norm's lower bound. */
  belowNorm: boolean;
};

export type FleetUsage = {
  perAsset: AssetUsage[];
  totals: {
    vehiclesReporting: number;
    distanceKm: number;
    litresBurned: number;
    litresFilled: number;
    avgKmPerL: number | null;
    litresUnaccounted: number;
    valueUnaccounted: number;
    suspectSegments: number;
    worstGapHours: number;
  };
};

/**
 * @param sinceDays window to analyse. Readings outside it are ignored, so the
 *        figures track recent behaviour rather than being diluted by history.
 */
export async function fleetUsage(sinceDays = 30): Promise<FleetUsage> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const [assets, readings, norms, dieselSetting] = await Promise.all([
    db.asset.findMany({
      select: {
        id: true, code: true, name: true, registrationNo: true,
        assetClass: true, lastSeen: true, fuelLevelPct: true, fuelCapacity: true,
      },
    }),
    db.telemetryReading.findMany({
      where: { recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
      select: {
        assetId: true, recordedAt: true, lat: true, lng: true, speedKph: true,
        odometerKm: true, fuelLevelL: true, fuelLevelPct: true, ignitionOn: true,
      },
    }),
    db.consumptionNorm.findMany(),
    db.setting.findUnique({ where: { key: "dieselRate" } }),
  ]);

  const rate = Number(dieselSetting?.value) > 0 ? Number(dieselSetting?.value) : 95;

  const byAsset = new Map<string, typeof readings>();
  for (const r of readings) {
    if (!r.assetId) continue;
    const list = byAsset.get(r.assetId) ?? [];
    list.push(r);
    byAsset.set(r.assetId, list);
  }

  const kmplFor = (assetId: string, assetClass: string) =>
    norms.find((n) => n.assetId === assetId && n.unit === "KMPL") ??
    norms.find((n) => n.assetClass === assetClass && n.unit === "KMPL") ??
    null;
  const lphFor = (assetClass: string) =>
    norms.find((n) => n.assetClass === assetClass && n.unit === "LPH") ?? null;

  const perAsset: AssetUsage[] = [];

  for (const asset of assets) {
    const rows = byAsset.get(asset.id) ?? [];
    // A single reading describes a moment, not a journey — nothing to measure.
    if (rows.length < 2) continue;

    const norm = kmplFor(asset.id, asset.assetClass);
    const idle = lphFor(asset.assetClass);

    const segments = analyseReadings(
      rows.map((r) => ({
        recordedAt: r.recordedAt, lat: r.lat, lng: r.lng, speedKph: r.speedKph,
        odometerKm: r.odometerKm, fuelLevelL: r.fuelLevelL,
        fuelLevelPct: r.fuelLevelPct, ignitionOn: r.ignitionOn,
      })),
      norm,
      asset.fuelCapacity || null,
      idle?.normHigh ?? null,
    );

    const usage = summarise(segments);

    perAsset.push({
      assetId: asset.id,
      code: asset.code,
      name: asset.name,
      registrationNo: asset.registrationNo,
      assetClass: asset.assetClass,
      lastSeen: asset.lastSeen,
      fuelLevelPct: asset.fuelLevelPct,
      usage,
      norm: norm ? { low: norm.normLow, high: norm.normHigh } : null,
      belowNorm: !!(norm && usage.avgKmPerL != null && usage.avgKmPerL < norm.normLow),
    });
  }

  // Worst offenders first: unexplained litres, then poor efficiency.
  perAsset.sort((a, b) => {
    if (b.usage.litresUnaccounted !== a.usage.litresUnaccounted) {
      return b.usage.litresUnaccounted - a.usage.litresUnaccounted;
    }
    return (a.usage.avgKmPerL ?? 99) - (b.usage.avgKmPerL ?? 99);
  });

  const distanceKm = sum(perAsset.map((a) => a.usage.distanceKm));
  const litresBurned = sum(perAsset.map((a) => a.usage.litresBurned));
  const litresUnaccounted = sum(perAsset.map((a) => a.usage.litresUnaccounted));

  return {
    perAsset,
    totals: {
      vehiclesReporting: perAsset.length,
      distanceKm: round(distanceKm),
      litresBurned: round(litresBurned),
      litresFilled: round(sum(perAsset.map((a) => a.usage.litresFilled))),
      // Fleet efficiency is total distance over total burn — never an average
      // of per-vehicle figures, which would weigh a pickup like a tipper.
      avgKmPerL: litresBurned > 0 ? round(distanceKm / litresBurned) : null,
      litresUnaccounted: round(litresUnaccounted),
      valueUnaccounted: Math.round(litresUnaccounted * rate),
      suspectSegments: perAsset.reduce((s, a) => s + a.usage.suspectSegments, 0),
      worstGapHours: perAsset.reduce((m, a) => Math.max(m, a.usage.worstGapHours), 0),
    },
  };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const round = (n: number) => Math.round(n * 100) / 100;
