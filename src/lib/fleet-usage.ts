/**
 * Fleet-level rollups of telemetry-derived usage.
 *
 * One shared query and one shared calculation, so the Dashboard, Trips &
 * Telematics and the asset detail cannot quietly disagree about how far the
 * fleet drove or what it burned. The per-segment maths lives in
 * `fleet-analytics.ts`; this only groups it by vehicle and totals it.
 */
import { db } from "@/lib/db";
import { serverCache } from "@/lib/cache";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  analyseUsage,
  describeUsage,
  DEFAULT_FUEL_CONFIG,
  type Confidence,
  type UsageSummary,
} from "@/lib/fleet-analytics";

/** The only OEM feed allowed to contribute to the fleet efficiency KPI. */
export const FLEET_EFFICIENCY_PROVIDER = "TATA_FLEET_EDGE";

export type AssetUsage = {
  assetId: string;
  code: string;
  name: string;
  registrationNo: string | null;
  assetClass: string;
  category: string;
  lastSeen: Date | null;
  fuelLevelPct: number | null;
  usage: UsageSummary;
  norm: { low: number; high: number } | null;
  /**
   * True when measured efficiency is worse than the norm's lower bound *and*
   * the measurement is good enough to say so. A LOW-confidence figure is not
   * evidence of a badly performing vehicle, it is evidence of thin telemetry.
   */
  belowNorm: boolean;
};

export type FleetUsage = {
  perAsset: AssetUsage[];
  totals: {
    /** Source rows actually processed for this window. */
    readingsAnalyzed: number;
    vehiclesReporting: number;
    /** Tata road vehicles that actually travelled and have a credible km/L window. */
    activeVehicles: number;
    distanceKm: number;
    litresBurned: number;
    litresFilled: number;
    avgKmPerL: number | null;
    litresUnaccounted: number;
    valueUnaccounted: number;
    suspectSegments: number;
    worstGapHours: number;
    /** The weakest confidence among the vehicles rolled up here. */
    confidence: Confidence;
    /** Vehicles whose telemetry cannot support a fuel figure at all. */
    vehiclesWithInsufficientData: number;
    /** Parked or otherwise non-working Tata road vehicles are not efficiency inputs. */
    vehiclesNotWorking: number;
  };
};

/**
 * A fleet km/L is meaningful only for a road vehicle that actually worked in
 * the analysis window.  Equipment may consume fuel while stationary, and a
 * registered-but-parked vehicle must never lower the truck mileage figure.
 */
export function countsTowardFleetEfficiency(
  asset: Pick<AssetUsage, "category">,
  usage: Pick<UsageSummary, "distanceKm" | "litresBurned" | "avgKmPerL" | "insufficientData">,
): boolean {
  return (
    asset.category === "VEHICLE" &&
    !usage.insufficientData &&
    usage.avgKmPerL != null &&
    usage.litresBurned > 0 &&
    usage.distanceKm > DEFAULT_FUEL_CONFIG.stationaryKm
  );
}

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function fleetUsageCacheKey(
  sinceDays: number,
  assetWhere: Prisma.AssetWhereInput,
): string {
  const scope = createHash("sha256").update(stableJson(assetWhere)).digest("hex");
  return `telemetry:fleet-usage:${sinceDays}:${scope}`;
}

type CachedAssetUsage = Omit<AssetUsage, "lastSeen"> & {
  lastSeen: string | null;
};

type CachedFleetUsage = Omit<FleetUsage, "perAsset"> & {
  perAsset: CachedAssetUsage[];
};

function serializeFleetUsage(result: FleetUsage): CachedFleetUsage {
  return {
    ...result,
    perAsset: result.perAsset.map((a) => ({
      ...a,
      lastSeen: a.lastSeen ? a.lastSeen.toISOString() : null,
    })),
  };
}

function deserializeFleetUsage(cached: CachedFleetUsage): FleetUsage {
  return {
    ...cached,
    perAsset: cached.perAsset.map((a) => ({
      ...a,
      lastSeen: a.lastSeen ? new Date(a.lastSeen) : null,
    })),
  };
}

const FLEET_USAGE_CACHE_SECONDS = 60;

/**
 * @param sinceDays window to analyse. Readings outside it are ignored, so the
 *        figures track recent behaviour rather than being diluted by history.
 */
export async function fleetUsage(
  sinceDays = 30,
  assetWhere: Prisma.AssetWhereInput = {},
): Promise<FleetUsage> {
  const key = fleetUsageCacheKey(sinceDays, assetWhere);
  const cached = await serverCache.wrap(
    key,
    async () => serializeFleetUsage(await computeFleetUsage(sinceDays, assetWhere)),
    FLEET_USAGE_CACHE_SECONDS,
  );
  return deserializeFleetUsage(cached);
}

async function computeFleetUsage(
  sinceDays = 30,
  assetWhere: Prisma.AssetWhereInput = {},
): Promise<FleetUsage> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  // Do not infer OEM provenance from a generic GPS-looking payload. The KPI
  // is expressly a Tata Fleet Edge metric, so every included asset must have
  // a Tata-attributed GPS reading inside this window. `providerId` on the
  // reading is the source of truth: legacy imports can have valid Tata history
  // before `Asset.telematicsProviderId` is backfilled.
  // Concurrently fetch provider metadata, the candidate assets, norms, and diesel rate.
  // Overlapping these round trips keeps the transaction pool slots free.
  const [provider, assets, norms, dieselSetting] = await Promise.all([
    db.telematicsProvider.findUnique({
      where: { code: FLEET_EFFICIENCY_PROVIDER },
      select: { id: true },
    }),
    db.asset.findMany({
      // Read the small scoped asset register directly. Filtering assets through
      // `telemetry: { some: ... }` made PostgreSQL run a correlated telemetry
      // existence check before the indexed readings query below.
      where: assetWhere,
      select: {
        id: true, code: true, name: true, registrationNo: true,
        assetClass: true, category: true, lastSeen: true, fuelLevelPct: true, fuelCapacity: true,
      },
    }),
    db.consumptionNorm.findMany(),
    db.setting.findUnique({ where: { key: "dieselRate" } }),
  ]);

  if (!provider || assets.length === 0) {
    return {
      perAsset: [],
      totals: {
        readingsAnalyzed: 0,
        vehiclesReporting: 0,
        activeVehicles: 0,
        distanceKm: 0,
        litresBurned: 0,
        litresFilled: 0,
        avgKmPerL: null,
        litresUnaccounted: 0,
        valueUnaccounted: 0,
        suspectSegments: 0,
        worstGapHours: 0,
        confidence: "LOW",
        vehiclesWithInsufficientData: 0,
        vehiclesNotWorking: 0,
      },
    };
  }

  const assetIds = assets.map((a) => a.id);

  // Filter explicitly by the resolved assetIds and providerId.
  // This allows PostgreSQL to use the existing indexes on
  // TelemetryReading directly rather than running an expensive correlated
  // subquery across 200,000+ historical rows.
  const readings = await db.telemetryReading.findMany({
    where: {
      assetId: { in: assetIds },
      recordedAt: { gte: since },
      source: "GPS_API",
      providerId: provider.id,
    },
    orderBy: { recordedAt: "asc" },
    select: {
      assetId: true, recordedAt: true, lat: true, lng: true, speedKph: true,
      odometerKm: true, fuelLevelL: true, fuelLevelPct: true, ignitionOn: true,
    },
  });

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

    const { usage } = analyseUsage(
      rows.map((r) => ({
        recordedAt: r.recordedAt, lat: r.lat, lng: r.lng, speedKph: r.speedKph,
        odometerKm: r.odometerKm, fuelLevelL: r.fuelLevelL,
        fuelLevelPct: r.fuelLevelPct, ignitionOn: r.ignitionOn,
      })),
      norm,
      asset.fuelCapacity || null,
      idle?.normHigh ?? null,
    );

    // Opt-in trace of exactly how each vehicle's figure was reached. Off by
    // default because it is several lines per vehicle per request.
    if (process.env.FUEL_ANALYSIS_DEBUG === "true") {
      console.info(describeUsage(`${asset.code} (${asset.registrationNo ?? "no reg"})`, usage));
    }

    perAsset.push({
      assetId: asset.id,
      code: asset.code,
      name: asset.name,
      registrationNo: asset.registrationNo,
      assetClass: asset.assetClass,
      category: asset.category,
      lastSeen: asset.lastSeen,
      fuelLevelPct: asset.fuelLevelPct,
      usage,
      norm: norm ? { low: norm.normLow, high: norm.normHigh } : null,
      belowNorm: !!(
        norm &&
        usage.avgKmPerL != null &&
        usage.avgKmPerL < norm.normLow &&
        usage.confidence !== "LOW"
      ),
    });
  }

  // Worst offenders first: unexplained litres, then poor efficiency.
  perAsset.sort((a, b) => {
    if (b.usage.litresUnaccounted !== a.usage.litresUnaccounted) {
      return b.usage.litresUnaccounted - a.usage.litresUnaccounted;
    }
    return (a.usage.avgKmPerL ?? 99) - (b.usage.avgKmPerL ?? 99);
  });

  const roadVehicles = perAsset.filter((asset) => asset.category === "VEHICLE");
  // Never allow a parked asset, an equipment item, an untrusted window, or a
  // non-Tata reading to dilute this number.  The numerator and denominator
  // come from this same eligible set, which prevents the old mixed-fleet
  // 0.31 km/L artefact.
  const measurable = perAsset.filter((asset) => countsTowardFleetEfficiency(asset, asset.usage));

  const distanceKm = sum(measurable.map((a) => a.usage.distanceKm));
  const litresBurned = sum(measurable.map((a) => a.usage.litresBurned));
  const litresUnaccounted = sum(measurable.map((a) => a.usage.litresUnaccounted));

  return {
    perAsset,
    totals: {
      readingsAnalyzed: readings.length,
      vehiclesReporting: perAsset.length,
      activeVehicles: measurable.length,
      distanceKm: round(distanceKm),
      litresBurned: round(litresBurned),
      litresFilled: round(sum(measurable.map((a) => a.usage.litresFilled))),
      // Fleet efficiency is total distance over total burn — never an average
      // of per-vehicle figures, which would weigh a pickup like a tipper.
      avgKmPerL: litresBurned > 0 && distanceKm > 0 ? round(distanceKm / litresBurned) : null,
      litresUnaccounted: round(litresUnaccounted),
      valueUnaccounted: Math.round(litresUnaccounted * rate),
      suspectSegments: measurable.reduce((s, a) => s + a.usage.suspectSegments, 0),
      worstGapHours: measurable.reduce((m, a) => Math.max(m, a.usage.worstGapHours), 0),
      confidence: weakest(measurable.map((a) => a.usage.confidence)),
      vehiclesWithInsufficientData: roadVehicles.filter((a) => a.usage.insufficientData).length,
      vehiclesNotWorking: roadVehicles.filter((a) => !a.usage.insufficientData && !countsTowardFleetEfficiency(a, a.usage)).length,
    },
  };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const round = (n: number) => Math.round(n * 100) / 100;

/** A rollup is only as trustworthy as its weakest input. */
function weakest(levels: Confidence[]): Confidence {
  if (levels.length === 0) return "LOW";
  if (levels.includes("LOW")) return "LOW";
  if (levels.includes("MEDIUM")) return "MEDIUM";
  return "HIGH";
}
