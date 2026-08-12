/**
 * Removes the fuel findings that the pre-fix analytics fabricated from sensor
 * noise. Raw telemetry is never touched — only derived records.
 *
 * WHY THESE EXIST
 *
 * Before the fuel-analysis fix, `analyseSegment` treated any tank fall as
 * consumption and any rise above 2% of capacity as a fill. A 300 L tank's
 * sender swings by several litres while the vehicle idles, so on 2-minute
 * polling that produced, for RJ21GE3220:
 *
 *   - FuelAnomaly rows accusing the vehicle of losing 9.6 L, 5.1 L and 7.5 L
 *     in 60-second windows. That is 576 L/h, 306 L/h and 450 L/h — no engine
 *     burns fuel at those rates and no siphon works that fast either. Each was
 *     filed at "Confidence HIGH" with a rupee value at risk against it.
 *   - A SENSOR-captured FuelTransaction booking a 9 L "fill" four minutes
 *     after one of those drops: the same slosh, counted a second time, this
 *     time into the fuel ledger and the cost reports.
 *
 * The fixed code cannot produce either — impossible rates are flagged as
 * sensor faults rather than thefts, and a fill must clear 15 L and persist —
 * but the rows already written stay until they are removed.
 *
 * WHAT THIS TOUCHES
 *
 *   FuelAnomaly       source=ASSET_EFFICIENCY, still OPEN, whose window is
 *                     short enough that the implied burn rate is impossible.
 *   FuelTransaction   captureMethod=SENSOR only. Anything a human entered is
 *                     left alone, whatever it says.
 *
 * Nothing is deleted without --apply. Run it once to read the report, then
 * again with --apply if you agree with what it lists. Take a backup first —
 * `npm run backup`.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** Matches the fixed analytics: above this, a fall cannot be combustion. */
const MAX_BURN_RATE_LPH = 120;
/** Matches the fixed analytics: a fill below this is slosh, not diesel. */
const MIN_CREDIBLE_FILL_L = 15;

async function main() {
  const suspectAnomalies = [];

  const anomalies = await db.fuelAnomaly.findMany({
    where: { source: "ASSET_EFFICIENCY", status: "OPEN" },
  });

  for (const a of anomalies) {
    // The window is recorded in the reasons text the old code wrote:
    // "Window <iso> → <iso> (<n> h)."
    const m = a.reasons.match(/\((\d+(?:\.\d+)?) h\)/);
    if (!m) continue;
    const hours = Number(m[1]);
    if (!(hours > 0)) {
      // A zero-length window cannot support any consumption claim at all.
      suspectAnomalies.push({ a, hours, rate: Infinity });
      continue;
    }
    const rate = a.litres / hours;
    if (rate > MAX_BURN_RATE_LPH) suspectAnomalies.push({ a, hours, rate });
  }

  const suspectFills = await db.fuelTransaction.findMany({
    where: { captureMethod: "SENSOR", quantity: { lt: MIN_CREDIBLE_FILL_L } },
    select: { id: true, date: true, quantity: true, assetId: true, amount: true },
  });

  console.log(`\nFuel anomalies implying an impossible burn rate: ${suspectAnomalies.length}`);
  for (const { a, hours, rate } of suspectAnomalies) {
    console.log(
      `  ${a.id}  ${a.litres} L over ${hours} h = ${Number.isFinite(rate) ? rate.toFixed(0) : "∞"} L/h` +
        `  (severity ${a.severity}, ₹${a.valueAtRisk} at risk)`,
    );
  }

  console.log(`\nSensor-detected fills below ${MIN_CREDIBLE_FILL_L} L: ${suspectFills.length}`);
  for (const f of suspectFills) {
    console.log(`  ${f.id}  ${f.date.toISOString()}  ${f.quantity} L  ₹${f.amount}`);
  }

  if (!APPLY) {
    console.log("\nDry run — nothing deleted. Re-run with --apply to remove the rows listed above.\n");
    return;
  }

  if (suspectAnomalies.length) {
    await db.fuelAnomaly.deleteMany({ where: { id: { in: suspectAnomalies.map((x) => x.a.id) } } });
  }
  if (suspectFills.length) {
    await db.fuelTransaction.deleteMany({ where: { id: { in: suspectFills.map((f) => f.id) } } });
  }

  console.log(
    `\nRemoved ${suspectAnomalies.length} phantom anomal${suspectAnomalies.length === 1 ? "y" : "ies"} ` +
      `and ${suspectFills.length} phantom fill(s). Telemetry left untouched.\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
