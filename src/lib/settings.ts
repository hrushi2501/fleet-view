import { db } from "./db";
import { serverCache } from "./cache";

export const FUEL_TYPES = ["DIESEL", "PETROL"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
export type FuelRates = Record<FuelType, number | null>;

export const FUEL_RATES_CACHE_KEY = "settings:fuel-rates";
export const DIESEL_RATE_CACHE_KEY = FUEL_RATES_CACHE_KEY;
const FUEL_RATES_CACHE_SECONDS = 300;

const SETTING_KEY: Record<FuelType, string> = {
  DIESEL: "fuelRate:DIESEL",
  PETROL: "fuelRate:PETROL",
};

/** Accept common vehicle-master names, but never infer fuel from size/class. */
export function normalizeFuelType(value: unknown): FuelType | null {
  const type = String(value ?? "").trim().toUpperCase();
  if (["DIESEL", "HSD", "HIGH SPEED DIESEL"].includes(type)) return "DIESEL";
  if (["PETROL", "GASOLINE", "MS", "MOTOR SPIRIT"].includes(type)) return "PETROL";
  return null;
}

export function parseFuelRate(value: unknown): number | null {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** Old name retained for compatibility; a missing rate now stays missing. */
export const parseDieselRate = parseFuelRate;

export async function getFuelRates(): Promise<FuelRates> {
  return serverCache.wrap(FUEL_RATES_CACHE_KEY, async () => {
    const rows = await db.setting.findMany({
      where: { key: { in: [...Object.values(SETTING_KEY), "dieselRate"] } },
      select: { key: true, value: true },
    });
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return {
      // Existing deployments keep the administrator-supplied legacy value.
      DIESEL: parseFuelRate(values.get(SETTING_KEY.DIESEL) ?? values.get("dieselRate")),
      PETROL: parseFuelRate(values.get(SETTING_KEY.PETROL)),
    };
  }, FUEL_RATES_CACHE_SECONDS);
}

export function fuelRateFor(fuelType: unknown, rates: FuelRates): number | null {
  const type = normalizeFuelType(fuelType);
  return type ? rates[type] : null;
}

export async function getFuelRate(fuelType: unknown): Promise<number | null> {
  return fuelRateFor(fuelType, await getFuelRates());
}

export async function getRequiredFuelRate(fuelType: unknown): Promise<number> {
  const type = normalizeFuelType(fuelType);
  if (!type) throw new Error("This asset has no supported fuel type configured.");
  const rate = (await getFuelRates())[type];
  if (rate == null) throw new Error(`${type === "DIESEL" ? "Diesel" : "Petrol"} rate is not configured.`);
  return rate;
}

/** Site tanks are diesel-only. Asset estimates must use its own fuel type. */
export async function getDieselRate(): Promise<number> {
  return getRequiredFuelRate("DIESEL");
}

export function fuelRateSettingKey(fuelType: FuelType): string {
  return SETTING_KEY[fuelType];
}
