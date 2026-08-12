/**
 * Clears the odometer values that Fleet Edge echoed into the engine-hour field.
 *
 * WHY THESE EXIST
 *
 * Fleet Edge reports `engineRunHour` carrying the odometer, not hours — the
 * live truck sends 89,449.5 "hours" against 89,449 km. Ten years of continuous
 * running is 87,600 h, and a machine averaging 1 km per engine hour has not
 * been driven anywhere.
 *
 * The original adapter guard compared `Math.round(engineRunHour)` with
 * `Math.round(odometer)`, which only catches the echo when the two happen to
 * round to the same integer. Whenever they differed by more than half a unit
 * the echo passed straight through, which is why some stored readings carry the
 * value and some do not. The adapter now rejects on a ratio instead, so nothing
 * new is written — but the rows already stored keep their value, and so does
 * `Asset.hourMeterValue`, which is a single mutable number with no history
 * behind it.
 *
 * WHY IT MATTERS
 *
 * `hourMeterValue` is a service-schedule denominator. Left at ~89,500 it makes
 * every hour-based preventive task read as tens of thousands of hours overdue,
 * which is how a maintenance screen becomes noise that people stop reading.
 *
 * WHAT THIS TOUCHES
 *
 * Only derived columns. `TelemetryReading.raw` keeps every original payload
 * untouched, so the provider's real `engineRunHour` remains auditable and this
 * is reversible from raw at any time.
 *
 * A reading is treated as an echo when its engine hours are at least half its
 * odometer, i.e. a lifetime average below 2 km/h — the same test the adapter
 * applies. Genuine hour meters on this fleet sit orders of magnitude lower.
 *
 * Resetting `hourMeterValue` to 0 restores it to the schema's "never recorded"
 * default. That is now the honest value: `pmDue` treats a zero meter as
 * unassessable and says so, rather than certifying a machine it cannot judge.
 *
 * Nothing is written without --apply. Safe to run repeatedly.
 *
 * NOTE: run this *after* deploying the adapter fix. Until the new code is live,
 * the running cron can write a fresh echo within minutes of a reset.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** Engine hours at or above this share of the odometer are the odometer. */
const ECHO_RATIO = 0.5;

async function main() {
  const rows = await db.telemetryReading.findMany({
    where: { engineHours: { not: null } },
    select: { id: true, engineHours: true, odometerKm: true },
  });

  const echoes = rows.filter(
    (r) => r.odometerKm != null && r.odometerKm > 0 && r.engineHours >= r.odometerKm * ECHO_RATIO,
  );
  const genuine = rows.filter((r) => !echoes.includes(r));

  console.log(`\nReadings carrying engine hours : ${rows.length}`);
  console.log(`  odometer echoes (to clear)   : ${echoes.length}`);
  console.log(`  plausible hour meters (keep) : ${genuine.length}`);
  for (const r of genuine.slice(0, 10)) {
    console.log(`    keeping ${r.id}: ${r.engineHours} h against ${r.odometerKm} km`);
  }

  const assets = await db.asset.findMany({
    where: { hourMeterValue: { gt: 0 } },
    select: { id: true, code: true, hourMeterValue: true, meterValue: true, primaryMeter: true },
  });
  const polluted = assets.filter(
    (a) => a.meterValue > 0 && a.hourMeterValue >= a.meterValue * ECHO_RATIO,
  );

  console.log(`\nAssets whose hour meter mirrors their odometer: ${polluted.length}`);
  for (const a of polluted) {
    console.log(`  ${a.code}: ${a.hourMeterValue} h against ${a.meterValue} km (primary: ${a.primaryMeter})`);
  }

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to clear the values above.\n");
    return;
  }

  if (echoes.length) {
    await db.telemetryReading.updateMany({
      where: { id: { in: echoes.map((r) => r.id) } },
      data: { engineHours: null },
    });
  }
  for (const a of polluted) {
    await db.asset.update({ where: { id: a.id }, data: { hourMeterValue: 0 } });
  }

  console.log(
    `\nCleared engine hours on ${echoes.length} reading(s) and reset ${polluted.length} asset hour meter(s) ` +
      `to 0 (= not recorded). Raw payloads untouched.\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
