/**
 * Diesel filled per day, per vehicle — from both sources at once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The Fuel screen's per-vehicle table is built from `FuelTransaction` — the
 * fills somebody typed in. On this fleet that is one truck. Eleven others have
 * a tank sender that watched diesel go in and reported it to the litre, and
 * none of that reached a screen that answers "what did we fill yesterday, and
 * into what".
 *
 * So the honest answer needs both:
 *
 *   logged fills    a receipt exists, so litres AND rupees are real
 *   sensor fills    the tank rose; litres are measured, the value is an
 *                   estimate at today's rate and is labelled as one
 *
 * A fill seen by both must be counted once. `detectFills` already matches a
 * sensor rise to a receipt within a time window, so that pairing is reused here
 * rather than re-derived: where a match exists this reports the logged
 * quantity, because that is the number the business paid for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DELIBERATELY LEAVES OUT
 *
 * Vehicles whose sender contradicts itself are excluded by `detectFills`, and
 * that exclusion is honoured: an unbelievable fill is worse than a missing one,
 * because it puts litres and rupees on the screen that never moved. Those
 * vehicles are named in `excluded` so the page can say so out loud rather than
 * quietly showing a short day.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { db } from "@/lib/db";
import { businessDay } from "@/lib/business-time";
import { detectFills, type DetectFillsResult } from "@/lib/fuel-fill-reconcile";
import { serverCache } from "@/lib/cache";
import { createHash } from "node:crypto";
import type { FuelRates } from "@/lib/settings";

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function dailyFillsCacheKey(
  assetWhere: Record<string, unknown>,
  fuelRates: FuelRates,
  days: number,
): string {
  const scope = createHash("sha256").update(stableJson(assetWhere)).digest("hex");
  return `fuel:daily-fills:${days}:${stableJson(fuelRates)}:${scope}`;
}

const DAILY_FILLS_CACHE_SECONDS = 60;

export type FillSource = "LOGGED" | "SENSOR";

export type VehicleDayFill = {
  assetId: string;
  assetCode: string;
  registrationNo: string | null;
  litres: number;
  /** Rupees. Exact for a logged fill, estimated at the current rate otherwise. */
  value: number | null;
  /** How many separate fills made up the day's total for this vehicle. */
  fills: number;
  source: FillSource;
  /** True when every fill in the day's total for this vehicle has a receipt. */
  priced: boolean;
};

export type DayFills = {
  /** `YYYY-MM-DD` in the business timezone. */
  day: string;
  litres: number;
  value: number | null;
  vehicles: VehicleDayFill[];
};

export type DailyFillsResult = {
  days: DayFills[];
  /** Senders whose readings cannot be believed, so their fills are not shown. */
  excluded: { assetCode: string; registrationNo: string | null }[];
  totals: { litres: number; value: number; vehicles: number; loggedLitres: number; sensorLitres: number; unpricedLitres: number };
};

/**
 * Every fill in the window, grouped by business day and then by vehicle.
 *
 * Days with no fill at all are omitted rather than rendered as a zero row: an
 * empty day on this fleet usually means nobody filled, and a column of zeroes
 * buries the days that matter.
 */
export async function dailyFillsByVehicle(
  assetWhere: Record<string, unknown>,
  fuelRates: FuelRates,
  days = 14,
  detectedResult?: DetectFillsResult | Promise<DetectFillsResult>,
): Promise<DailyFillsResult> {
  const key = dailyFillsCacheKey(assetWhere, fuelRates, days);
  return serverCache.wrap(
    key,
    () => computeDailyFillsByVehicle(assetWhere, fuelRates, days, detectedResult),
    DAILY_FILLS_CACHE_SECONDS,
  );
}

async function computeDailyFillsByVehicle(
  assetWhere: Record<string, unknown>,
  fuelRates: FuelRates,
  days = 14,
  detectedResult?: DetectFillsResult | Promise<DetectFillsResult>,
): Promise<DailyFillsResult> {
  const since = new Date(Date.now() - days * 86_400_000);

  const [{ fills: detected, unreliable }, logged] = await Promise.all([
    detectedResult ?? detectFills(assetWhere, fuelRates, days),
    db.fuelTransaction.findMany({
      where: { type: "ISSUE", asset: assetWhere, date: { gte: since } },
      select: {
        id: true, assetId: true, quantity: true, amount: true, date: true,
        asset: { select: { code: true, registrationNo: true } },
      },
      orderBy: { date: "asc" },
    }),
  ]);

  // A receipt already paired with a sensor rise is reported through that rise,
  // so it must not also be counted on its own.
  const pairedEntryIds = new Set(detected.map((f) => f.logged?.id).filter((id): id is string => Boolean(id)));

  type Row = {
    day: string; assetId: string; assetCode: string; registrationNo: string | null;
    litres: number; value: number | null; priced: boolean;
  };
  const rows: Row[] = [];

  for (const f of detected) {
    rows.push({
      day: businessDay(f.at),
      assetId: f.assetId,
      assetCode: f.assetCode,
      registrationNo: f.registrationNo,
      // The receipt is what was paid for; the sender is what arrived. Where
      // both exist the receipt wins, so litres and rupees describe one event.
      litres: f.logged ? f.logged.quantity : f.litresAdded,
      value: f.logged ? f.logged.amount : f.estimatedValue,
      priced: Boolean(f.logged),
    });
  }

  for (const e of logged) {
    if (pairedEntryIds.has(e.id) || !e.assetId) continue;
    rows.push({
      day: businessDay(e.date),
      assetId: e.assetId,
      assetCode: e.asset?.code ?? "—",
      registrationNo: e.asset?.registrationNo ?? null,
      litres: e.quantity,
      value: e.amount,
      priced: true,
    });
  }

  const byDay = new Map<string, Map<string, VehicleDayFill>>();
  for (const r of rows) {
    if (r.litres <= 0) continue;
    const perVehicle = byDay.get(r.day) ?? new Map<string, VehicleDayFill>();
    const cur = perVehicle.get(r.assetId);
    if (cur) {
      cur.litres += r.litres;
      cur.value = cur.value == null || r.value == null ? null : cur.value + r.value;
      cur.fills += 1;
      cur.priced = cur.priced && r.priced;
      if (!r.priced) cur.source = "SENSOR";
    } else {
      perVehicle.set(r.assetId, {
        assetId: r.assetId,
        assetCode: r.assetCode,
        registrationNo: r.registrationNo,
        litres: r.litres,
        value: r.value,
        fills: 1,
        source: r.priced ? "LOGGED" : "SENSOR",
        priced: r.priced,
      });
    }
    byDay.set(r.day, perVehicle);
  }

  const out: DayFills[] = [...byDay.entries()]
    .map(([day, perVehicle]) => {
      const vehicles = [...perVehicle.values()]
        .map((v) => ({ ...v, litres: Math.round(v.litres), value: v.value == null ? null : Math.round(v.value) }))
        .sort((a, b) => b.litres - a.litres);
      return {
        day,
        litres: vehicles.reduce((s, v) => s + v.litres, 0),
        value: vehicles.every((v) => v.value != null) ? vehicles.reduce((s, v) => s + (v.value ?? 0), 0) : null,
        vehicles,
      };
    })
    // Newest first: the question is almost always about yesterday, not a
    // fortnight ago.
    .sort((a, b) => b.day.localeCompare(a.day));

  const seen = new Set<string>();
  let loggedLitres = 0;
  let sensorLitres = 0;
  let unpricedLitres = 0;
  for (const d of out) {
    for (const v of d.vehicles) {
      seen.add(v.assetId);
      if (v.priced) loggedLitres += v.litres;
      else sensorLitres += v.litres;
      if (v.value == null) unpricedLitres += v.litres;
    }
  }

  return {
    days: out,
    excluded: unreliable.map((u) => ({ assetCode: u.assetCode, registrationNo: u.registrationNo })),
    totals: {
      litres: out.reduce((s, d) => s + d.litres, 0),
      value: out.every((d) => d.value != null) ? out.reduce((s, d) => s + (d.value ?? 0), 0) : 0,
      vehicles: seen.size,
      loggedLitres,
      sensorLitres,
      unpricedLitres,
    },
  };
}
