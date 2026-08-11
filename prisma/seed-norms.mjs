// Seeds M5 consumption norms from the benchmarks that were previously hard-coded
// in src/lib/fuel.ts, so the norms are configurable per client from day one.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const KMPL = {
  DUMPER: [2.2, 4.0], TIPPER: [2.2, 3.8], TRUCK: [3.0, 5.5], WATER_TANKER: [3.0, 5.5],
  TRANSIT_MIXER: [2.2, 4.0], PICKUP: [8, 15], CAR: [9, 18], BIKE: [35, 65], TRACTOR: [3, 6],
};
const LPH = {
  EXCAVATOR: [10, 20], GRADER: [12, 25], ROLLER: [5, 12], BACKHOE: [4, 9], CRANE: [6, 16],
  PLANT: [15, 40], CRUSHER: [20, 50],
};

let n = 0;
for (const [unit, table] of [["KMPL", KMPL], ["LPH", LPH]]) {
  for (const [assetClass, [normLow, normHigh]] of Object.entries(table)) {
    await db.consumptionNorm.upsert({
      where: { assetClass_unit: { assetClass, unit } },
      create: { assetClass, unit, normLow, normHigh, tolerancePct: 15 },
      update: { normLow, normHigh },
    });
    n++;
  }
}
console.log(`Seeded ${n} consumption norms.`);
await db.$disconnect();
