/**
 * How often does the fuel figure come back LOW confidence, and why?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * A vehicle screen showed "Low confidence — only 41% of the window is covered
 * by regular sampling — 5.27 h of it is a blind spot". That banner is correct
 * and the analytics is behaving exactly as intended. The open question is
 * whether it is *rare* — a genuinely unobservable day worth flagging — or
 * whether it fires on most vehicles most nights, in which case it has become
 * wallpaper and people have learned to scroll past it.
 *
 * That distinction decides what to fix:
 *
 *   - fires rarely      -> the hardware is fine, the banner is doing its job
 *   - fires constantly, engine off  -> the TCU sleeps when parked. No API tier
 *     changes this; the thresholds are miscalibrated for equipment that
 *     legitimately sits idle overnight.
 *   - fires constantly, engine on   -> a real connectivity or TCU fault, worth
 *     raising with Tata.
 *
 * Nothing here writes. It reads telemetry and re-runs the same `analyseUsage`
 * the app uses, so the verdicts are identical to what the screens show rather
 * than a second implementation that could drift.
 *
 * Usage:
 *   node --env-file=.env.local --import ./scripts/test-setup.mjs \
 *        scripts/confidence-audit.mjs [--days 7]
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { PrismaClient } from "@prisma/client";
import { analyseUsage } from "../src/lib/fleet-analytics.ts";

const args = process.argv.slice(2);
const days = Number(args[args.indexOf("--days") + 1]) || 7;

const db = new PrismaClient();

/** Local calendar day, so a window matches how the business talks about "a day". */
function dayKey(d) {
  return new Date(d).toLocaleDateString("en-CA", { timeZone: process.env.BUSINESS_TIMEZONE || "Asia/Kolkata" });
}

function bar(n, total, width = 28) {
  const filled = total > 0 ? Math.round((n / total) * width) : 0;
  return "█".repeat(filled) + "·".repeat(width - filled);
}

async function main() {
  const since = new Date(Date.now() - days * 86_400_000);

  const assets = await db.asset.findMany({
    where: { telemetry: { some: { recordedAt: { gte: since } } } },
    select: { id: true, code: true, registrationNo: true, fuelCapacity: true },
  });

  if (assets.length === 0) {
    console.log(`No vehicle has telemetry in the last ${days} days. Nothing to audit.`);
    return;
  }

  console.log(`\nConfidence audit — ${assets.length} vehicle(s), last ${days} days\n`);

  const tally = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const reasonCounts = new Map();
  const perVehicle = [];
  let ignitionOffBlind = 0;
  let ignitionOnBlind = 0;

  for (const asset of assets) {
    const readings = await db.telemetryReading.findMany({
      where: { assetId: asset.id, recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
      select: {
        recordedAt: true, lat: true, lng: true, speedKph: true,
        odometerKm: true, fuelLevelL: true, fuelLevelPct: true, ignitionOn: true,
      },
    });

    // One window per calendar day, matching how the screens slice it.
    const byDay = new Map();
    for (const r of readings) {
      const k = dayKey(r.recordedAt);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(r);
    }

    const vehicleTally = { HIGH: 0, MEDIUM: 0, LOW: 0 };

    for (const [, dayReadings] of byDay) {
      if (dayReadings.length < 2) continue;
      const { usage } = analyseUsage(dayReadings, null, asset.fuelCapacity ?? null);

      tally[usage.confidence]++;
      vehicleTally[usage.confidence]++;
      for (const reason of usage.confidenceReasons) {
        // Collapse the varying numbers so reasons group into causes.
        const key = reason.replace(/[\d.]+/g, "N");
        reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
      }

      // Was the blind time engine-off (hardware asleep) or engine-on (a fault)?
      if (usage.diagnostics.gaps.blindHours > 0) {
        const offSamples = dayReadings.filter((r) => r.ignitionOn === false).length;
        const onSamples = dayReadings.filter((r) => r.ignitionOn === true).length;
        if (offSamples >= onSamples) ignitionOffBlind++;
        else ignitionOnBlind++;
      }
    }

    const total = vehicleTally.HIGH + vehicleTally.MEDIUM + vehicleTally.LOW;
    if (total > 0) {
      perVehicle.push({
        label: asset.registrationNo || asset.code,
        ...vehicleTally,
        total,
        lowPct: Math.round((vehicleTally.LOW / total) * 100),
      });
    }
  }

  const totalDays = tally.HIGH + tally.MEDIUM + tally.LOW;
  if (totalDays === 0) {
    console.log("No day had two or more samples. There is nothing to measure confidence against.");
    return;
  }

  console.log("Vehicle-days by confidence");
  for (const level of ["HIGH", "MEDIUM", "LOW"]) {
    const n = tally[level];
    console.log(
      `  ${level.padEnd(6)} ${String(n).padStart(4)}  ${bar(n, totalDays)}  ${Math.round((n / totalDays) * 100)}%`,
    );
  }

  console.log(`\nWorst vehicles by share of LOW days`);
  perVehicle.sort((a, b) => b.lowPct - a.lowPct);
  for (const v of perVehicle.slice(0, 10)) {
    console.log(`  ${String(v.label).padEnd(14)} ${String(v.lowPct).padStart(3)}% LOW   (${v.LOW}/${v.total} days)`);
  }

  console.log(`\nWhy confidence was demoted (most common first)`);
  for (const [reason, n] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${String(n).padStart(4)}x  ${reason}`);
  }

  console.log(`\nBlind windows, by what the engine was doing`);
  const blindTotal = ignitionOffBlind + ignitionOnBlind;
  if (blindTotal === 0) {
    console.log("  none");
  } else {
    console.log(`  mostly engine OFF  ${String(ignitionOffBlind).padStart(4)}  ${bar(ignitionOffBlind, blindTotal)}`);
    console.log(`  mostly engine ON   ${String(ignitionOnBlind).padStart(4)}  ${bar(ignitionOnBlind, blindTotal)}`);
    console.log(
      ignitionOffBlind >= ignitionOnBlind
        ? "\n  -> The TCU goes quiet when the engine is off. No API tier changes that.\n" +
            "     Either accept parked hours are unobservable, fit a fuel sensor with its own\n" +
            "     power, or relax warningGapHours for equipment that legitimately sits idle."
        : "\n  -> Gaps are happening while the engine is running, which is a connectivity or\n" +
            "     TCU fault rather than expected behaviour. Worth raising with Tata.",
    );
  }

  const lowShare = Math.round((tally.LOW / totalDays) * 100);
  console.log(
    lowShare >= 50
      ? `\nLOW fires on ${lowShare}% of vehicle-days. At that rate it is wallpaper — people stop\n` +
          `reading it, which is the alert-fatigue failure this product exists to avoid.\n` +
          `Recalibrate the thresholds against how this equipment is actually used.`
      : `\nLOW fires on ${lowShare}% of vehicle-days, which is rare enough to still carry meaning.\n` +
          `The banner is doing its job; leave the thresholds alone.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
