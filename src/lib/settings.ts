import { db } from "./db";
import { serverCache } from "./cache";

export const DIESEL_RATE_CACHE_KEY = "settings:diesel-rate";
const DIESEL_RATE_CACHE_SECONDS = 300;

export function parseDieselRate(value: unknown): number {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : 92.5;
}

export async function getDieselRate(): Promise<number> {
  try {
    return await serverCache.wrap(DIESEL_RATE_CACHE_KEY, async () => {
      const setting = await db.setting.findUnique({ where: { key: "dieselRate" } });
      return parseDieselRate(setting?.value);
    }, DIESEL_RATE_CACHE_SECONDS);
  } catch {
    return 92.5;
  }
}
