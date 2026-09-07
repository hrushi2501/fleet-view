/**
 * The nightly question: did any diesel leave a tank without being burnt?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SCHEDULED SCAN AND NOT A SCREEN
 *
 * `analyseUsage` has always been able to answer this. Nothing asked it. The
 * only caller was a button on the tracking page, so a truck could be siphoned
 * on a Friday night and the system would say nothing until somebody happened to
 * open that screen and click Reconcile. Detection that waits to be asked is not
 * detection.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT WILL AND WILL NOT ACCUSE
 *
 * A fuel anomaly names a vehicle, a night, and by implication whoever had the
 * keys. That is close enough to naming a person that the bar has to be high,
 * and every one of these exclusions was earned by something this fleet actually
 * produced:
 *
 *   - a sender that contradicts itself is excluded entirely. RJ21GE1657 swings
 *     between 25 L and 210 L on a 300 L tank; its downward legs are perfect
 *     theft shapes and there were twenty of them in one day.
 *   - IMPLAUSIBLE_DROP is never raised. A fall too fast for any engine is a
 *     data fault, and the analyser already labels it as one.
 *   - a drop inside the sender's own noise band is not a drop.
 *   - idling is charged against time, not distance, so a loading bay does not
 *     read as a theft.
 *   - a vehicle whose telemetry is too sparse to measure is reported as NOT
 *     ASSESSED rather than passed. Silence about a vehicle nobody could check
 *     is the failure mode that lets theft through while the report looks clean.
 *
 * The last one matters most. It is easy to build a scan that finds nothing and
 * calls the fleet honest.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { db } from "@/lib/db";
import { analyseUsage, type AnalyticsReading, type Segment } from "@/lib/fleet-analytics";
import { senderContradictsItself } from "@/lib/fuel-cache";
import { getDieselRate } from "@/lib/settings";
import { recordSystemAudit } from "@/lib/audit-writer";

/** Events worth raising. IMPLAUSIBLE_DROP is deliberately absent — see above. */
const ACCUSABLE = new Set(["STATIONARY_DROP", "EXCESS_CONSUMPTION"]);

/**
 * Below this a flagged segment is not worth a person's morning.
 *
 * The analyser already clears the sender's noise band before calling anything
 * suspicious; this is a second, commercial filter — under about a thousand
 * rupees the investigation costs more than the diesel.
 */
const MIN_RAISEABLE_LITRES = 10;

/**
 * Fewest fuel readings that can support a comparison at all.
 *
 * Low on purpose. This is a floor against a vehicle that barely reported, not a
 * quality bar — the quality bar is the per-segment confidence, which already
 * refuses to raise anything scored LOW.
 */
const MIN_FUEL_SAMPLES = 6;

export type ScanOutcome = {
  scanned: number;
  raised: number;
  duplicates: number;
  /** Vehicles deliberately not judged, each with the reason. */
  notAssessed: { code: string; registrationNo: string | null; reason: string }[];
  findings: {
    code: string;
    registrationNo: string | null;
    litres: number;
    valueAtRisk: number;
    at: Date;
    kind: string;
    confidence: string;
  }[];
};

/**
 * @param sinceHours how far back to look. A nightly run wants a little more
 *        than twenty-four so a drop straddling midnight is not cut in half.
 */
export async function scanForFuelTheft(sinceHours = 30): Promise<ScanOutcome> {
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const rate = await getDieselRate();

  const assets = await db.asset.findMany({
    where: { status: { not: "Off-hired" } },
    select: { id: true, code: true, registrationNo: true, fuelCapacity: true },
  });

  const readings = await db.telemetryReading.findMany({
    where: { assetId: { in: assets.map((a) => a.id) }, recordedAt: { gte: since } },
    orderBy: { recordedAt: "asc" },
    select: {
      assetId: true, recordedAt: true, lat: true, lng: true, speedKph: true,
      odometerKm: true, fuelLevelL: true, fuelLevelPct: true, ignitionOn: true,
    },
  });

  const byAsset = new Map<string, typeof readings>();
  for (const r of readings) {
    if (!r.assetId) continue;
    const list = byAsset.get(r.assetId) ?? [];
    list.push(r);
    byAsset.set(r.assetId, list);
  }

  const out: ScanOutcome = { scanned: 0, raised: 0, duplicates: 0, notAssessed: [], findings: [] };

  for (const asset of assets) {
    const rows = byAsset.get(asset.id) ?? [];
    const note = (reason: string) =>
      out.notAssessed.push({ code: asset.code, registrationNo: asset.registrationNo, reason });

    if (rows.length < 2) {
      // Not an accusation and not a clean bill of health — simply unmeasured.
      if (rows.length === 0) note("no telemetry in the window");
      else note("only one reading — a moment, not an interval");
      continue;
    }

    if (!asset.fuelCapacity || asset.fuelCapacity <= 0) {
      note("tank size unknown, so a drop cannot be sized against it");
      continue;
    }

    const litreSeries = rows.map((r) => r.fuelLevelL).filter((n): n is number => n != null);
    if (senderContradictsItself(litreSeries, asset.fuelCapacity)) {
      note("fuel sender contradicts itself — readings cannot support a finding");
      continue;
    }

    const { segments, usage } = analyseUsage(rows as AnalyticsReading[], null, asset.fuelCapacity);

    // ─────────────────────────────────────────────────────────────────────────
    // Deliberately NOT gated on `usage.insufficientData`.
    //
    // That flag answers a different question: "can this vehicle's km/L be
    // trusted", which genuinely needs continuous sampling. Theft asks something
    // much narrower — did the level fall between two readings while the vehicle
    // stood still — and that needs two readings, not unbroken coverage.
    //
    // Using the efficiency gate here inverted the feature. A parked truck
    // reports roughly hourly, every gap over an hour counts as blind, and a
    // night in the yard therefore pushes coverage under the bar. On the night
    // of 2 September the scan examined ONE vehicle out of eleven and reported
    // "nothing found": TRU-053 was dropped for a 2.32 h gap, TRU-106 for 1.07 h,
    // TRU-111 for 1.06 h, and so on down the list. Standing still overnight —
    // exactly when diesel goes missing — was what disqualified a vehicle from
    // being watched.
    //
    // Sparse data still weakens a finding rather than being ignored: a segment
    // observed across a long gap is already scored LOW by `analyseUsage`, and
    // LOW findings are never raised. So the sampling quality still governs what
    // can be said — it just no longer silently excuses the whole vehicle.
    // ─────────────────────────────────────────────────────────────────────────
    const fuelSamples = litreSeries.length;
    if (fuelSamples < MIN_FUEL_SAMPLES) {
      note(`only ${fuelSamples} fuel readings — too few to compare`);
      continue;
    }

    out.scanned++;

    // ─────────────────────────────────────────────────────────────────────────
    // Never accuse anybody of losing less diesel than this sender routinely
    // invents.
    //
    // The analyser now measures each unit's own noise from the impossible
    // upward moves it reports, and on this fleet that runs to 8–12 L where the
    // assumed band was 4.5 L. A flat 10 L floor therefore sat *below* the noise
    // of four of the eight working senders: the first ordinary wobble past it
    // would have been raised as a case against a driver.
    //
    // Taking whichever is larger keeps the commercial floor for quiet senders
    // and defers to measurement on noisy ones.
    // ─────────────────────────────────────────────────────────────────────────
    const senderNoiseL = usage.diagnostics.fuel.noiseBandL ?? 0;
    const raiseFloorL = Math.max(MIN_RAISEABLE_LITRES, senderNoiseL);

    for (const seg of segments as Segment[]) {
      if (!ACCUSABLE.has(seg.event)) continue;
      if (seg.excessLitres < raiseFloorL) continue;
      // A LOW-confidence finding is a statement about the data, not the driver.
      if (seg.confidence === "LOW") continue;

      // Deterministic id: the same segment found again tomorrow updates rather
      // than raising a second case against the same night.
      const refId = `SCAN:${asset.id}:${seg.to.toISOString()}`;
      const existing = await db.fuelAnomaly.findUnique({
        where: { source_refId: { source: "ASSET_EFFICIENCY", refId } },
      });
      if (existing) {
        out.duplicates++;
        continue;
      }

      const litres = Math.round(seg.excessLitres * 10) / 10;
      const where =
        seg.parkedAt
          ? `\nParked at ${seg.parkedAt.lat.toFixed(5)}, ${seg.parkedAt.lng.toFixed(5)} for the whole interval.`
          : "";
      const endpoints =
        seg.fuelBeforeL != null && seg.fuelAfterL != null
          ? `\nTank went ${seg.fuelBeforeL} L → ${seg.fuelAfterL} L over ${seg.hours} h.`
          : "";

      await db.fuelAnomaly.create({
        data: {
          source: "ASSET_EFFICIENCY",
          refId,
          assetId: asset.id,
          severity: seg.confidence === "HIGH" ? "HIGH" : "MEDIUM",
          score: seg.confidence === "HIGH" ? 80 : 55,
          litres,
          valueAtRisk: Math.round(litres * rate),
          reasons:
            `${seg.event === "STATIONARY_DROP" ? "Fuel fell while the vehicle was stationary" : "Consumption beyond what the journey explains"}.` +
            endpoints +
            where +
            `\n${seg.reasons.join("\n")}` +
            `\nRaised by the nightly scan; ${seg.confidence.toLowerCase()} confidence.`,
        },
      });

      out.raised++;
      out.findings.push({
        code: asset.code,
        registrationNo: asset.registrationNo,
        litres,
        valueAtRisk: Math.round(litres * rate),
        at: seg.to,
        kind: seg.event,
        confidence: seg.confidence,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Say that the scan ran, even — especially — when it found nothing.
  //
  // A theft scan that finds nothing and a theft scan that never ran look
  // identical from the outside: an empty table. That is the worst possible
  // failure for this feature, because the empty screen reads as "all clear"
  // either way, and nobody goes looking. If the nightly job starts erroring,
  // the fleet would appear watched while nothing watched it.
  //
  // One audit row per run makes the difference visible: the Fuel screen can
  // show when the last check happened, and say so loudly when that was too
  // long ago. It is written whatever the outcome, and never allowed to fail
  // the scan itself.
  // ───────────────────────────────────────────────────────────────────────────
  await recordSystemAudit({
    action: "SCAN",
    module: "FUEL",
    summary:
      out.raised > 0
        ? `Fuel theft scan: ${out.raised} raised from ${out.scanned} vehicles`
        : `Fuel theft scan: nothing found across ${out.scanned} vehicles`,
    changes: JSON.stringify({
      scanned: out.scanned,
      raised: out.raised,
      duplicates: out.duplicates,
      notAssessed: out.notAssessed,
    }),
  }).catch(() => {});

  return out;
}
