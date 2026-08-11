// Seeds M23 production targets so the module ships configured rather than empty.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const NORMS = [
  { assetClass: "DUMPER", unit: "TRIPS_PER_DAY", targetLow: 6, targetHigh: 12 },
  { assetClass: "TIPPER", unit: "TRIPS_PER_DAY", targetLow: 6, targetHigh: 14 },
  { assetClass: "TRUCK", unit: "TRIPS_PER_DAY", targetLow: 4, targetHigh: 10 },
  { assetClass: "TRANSIT_MIXER", unit: "TRIPS_PER_DAY", targetLow: 5, targetHigh: 12 },
  { assetClass: "EXCAVATOR", unit: "M3_PER_HOUR", targetLow: 40, targetHigh: 90 },
  { assetClass: "BACKHOE", unit: "M3_PER_HOUR", targetLow: 15, targetHigh: 40 },
  { assetClass: "GRADER", unit: "M3_PER_HOUR", targetLow: 30, targetHigh: 70 },
  { assetClass: "CRUSHER", unit: "TONNES_PER_DAY", targetLow: 150, targetHigh: 400 },
  { assetClass: "PLANT", unit: "TONNES_PER_DAY", targetLow: 100, targetHigh: 350 },
  { assetClass: "ROLLER", unit: "CYCLES_PER_HOUR", targetLow: 4, targetHigh: 12 },
  { assetClass: "CRANE", unit: "CYCLES_PER_HOUR", targetLow: 2, targetHigh: 8 },
];
for (const n of NORMS) {
  await db.productionNorm.upsert({ where: { assetClass_unit: { assetClass: n.assetClass, unit: n.unit } }, create: n, update: {} });
}
console.log(`Seeded ${NORMS.length} production targets.`);
await db.$disconnect();
