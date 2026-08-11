import { db } from "./db";

export async function getDieselRate(): Promise<number> {
  try {
    const s = await db.setting.findUnique({ where: { key: "dieselRate" } });
    const r = s ? Number(s.value) : NaN;
    return isFinite(r) && r > 0 ? r : 92.5;
  } catch {
    return 92.5;
  }
}
