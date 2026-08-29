import { NextResponse } from "next/server";
import { checkSharedSecret } from "@/lib/auth";
import { scanForFuelTheft } from "@/lib/fuel-theft-scan";
import { sendPushToAll } from "@/lib/push";
import { inr, num } from "@/lib/utils";

export const dynamic = "force-dynamic";
/** A fleet-wide analysis over a day of telemetry; give it room. */
export const maxDuration = 300;

/**
 * The nightly fuel-theft scan.
 *
 * Called by Vercel Cron with `Authorization: Bearer ${CRON_SECRET}`, or by hand
 * with `?key=`. Fails closed when CRON_SECRET is unset: this route writes
 * anomaly records that name a vehicle and a night, and an unauthenticated
 * trigger could be used to bury a real finding under noise, or simply to run it
 * repeatedly against the database.
 *
 * Runs at 02:30 IST — after the day's driving has settled into the table and
 * before anyone is reading the screen in the morning.
 */
export async function GET(req: Request) {
  const auth = checkSharedSecret(req, "CRON_SECRET");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const result = await scanForFuelTheft(30);

  // Only wake people for something they can act on. A scan that found nothing
  // is the normal case and does not warrant a notification — a nightly "all
  // clear" is the fastest way to teach everyone to swipe these away.
  if (result.raised > 0) {
    const litres = result.findings.reduce((s, f) => s + f.litres, 0);
    const value = result.findings.reduce((s, f) => s + f.valueAtRisk, 0);
    const worst = [...result.findings].sort((a, b) => b.litres - a.litres)[0]!;

    await sendPushToAll({
      title: `Fuel: ${result.raised} unexplained ${result.raised === 1 ? "drop" : "drops"} overnight`,
      body:
        `${num(litres)} L · ${inr(value, { compact: true })} at risk. ` +
        `Largest ${worst.code}, ${num(worst.litres)} L.`,
      url: "/fuel/problems",
    });
  }

  return NextResponse.json({
    ok: true,
    scanned: result.scanned,
    raised: result.raised,
    duplicates: result.duplicates,
    // Returned rather than dropped: a vehicle nobody could check is not a
    // vehicle that passed, and the difference has to survive into the log.
    notAssessed: result.notAssessed,
    findings: result.findings,
  });
}
