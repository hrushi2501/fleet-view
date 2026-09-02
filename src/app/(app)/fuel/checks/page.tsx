import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard } from "@/components/ui";
import { VerifyGaugeForm } from "@/components/TrackingForms";
import { AUTO_VERIFY_CONFIDENCE } from "@/lib/telematics";
import { num, fmtDate, timeAgo } from "@/lib/utils";
import { Camera, CheckCircle2, TriangleAlert, Gauge, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { requirePage } from "@/lib/access";
import { assetsWithFuelSensor } from "@/lib/fuel-sensor";

export const dynamic = "force-dynamic";

const ST: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700 ring-amber-600/20",
  VERIFIED: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  CORRECTED: "bg-brand-100 text-brand-700 ring-brand-600/20",
  REJECTED: "bg-slate-100 text-slate-500 ring-slate-400/20",
};

/**
 * Gauge photographs that still need a human eye.
 *
 * Was `/tracking/fuel-verification`, filed under tracking because that is where
 * the photo arrives from. Operationally it is a fuel job — a store-keeper
 * confirming what a tank actually held — so it now sits in Fuel.
 */
export default async function FuelChecksPage() {
  await requirePage("fuel.view");
  const readings = await db.fuelLevelReading.findMany({
    include: { asset: true, driver: true },
    orderBy: [{ status: "asc" }, { capturedAt: "desc" }],
    take: 200,
  });

  // A vehicle whose tank sender reports never belongs in this queue: the
  // instrument already gave litres, and asking somebody to confirm a model's
  // reading of a photographed needle against it can only make the number worse.
  // Decided from live telemetry rather than a flag, so a sender that dies puts
  // its vehicle back on the photo path by itself.
  const sensorEquipped = await assetsWithFuelSensor([...new Set(readings.map((r) => r.assetId))]);

  const pending = readings.filter((r) => r.status === "PENDING" && !sensorEquipped.has(r.assetId));
  // Held rows that no longer need a person, because the vehicle gained a sender
  // after the photo was taken. Surfaced rather than hidden — they would
  // otherwise sit in the table forever with nobody able to explain why.
  const supersededBySensor = readings.filter((r) => r.status === "PENDING" && sensorEquipped.has(r.assetId));
  const corrected = readings.filter((r) => r.status === "CORRECTED");
  const auto = readings.filter((r) => r.verifiedBy === "Auto (high confidence)");
  const autoSensor = readings.filter((r) => r.verifiedBy === "Auto (tank sender)");
  // How often the machine was wrong when a human actually checked.
  const humanChecked = readings.filter((r) => r.status === "CORRECTED" || (r.status === "VERIFIED" && r.verifiedBy !== "Auto (high confidence)"));
  const accuracy = humanChecked.length ? ((humanChecked.length - corrected.length) / humanChecked.length) * 100 : null;

  return (
    <div className="space-y-6">
      <Link href="/fleet/trips" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Trips
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Fuel Checks</h1>
        <p className="text-sm text-slate-500">
          Fuel levels read from a photo of the gauge, for vehicles with no fuel sensor. Anything unclear waits here for a person.
        </p>
        {supersededBySensor.length > 0 && (
          <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
            {num(supersededBySensor.length)} held reading{supersededBySensor.length === 1 ? "" : "s"} no longer need review — those
            vehicles now report their own fuel level, and the sender is taken as correct.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-4">
        <StatCard label="Awaiting Review" value={num(pending.length)} sub="held, not in the ledger" accent={pending.length ? "amber" : "emerald"} icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="Auto-Accepted" value={num(auto.length + autoSensor.length)} sub={autoSensor.length ? `${num(autoSensor.length)} from tank senders, ${num(auto.length)} from photos` : `${AUTO_VERIFY_CONFIDENCE * 100}%+ clear reading`} accent="emerald" icon={<CheckCircle2 className="h-5 w-5" />} />
        <StatCard label="Corrected by Staff" value={num(corrected.length)} sub="model was wrong" accent="brand" icon={<Gauge className="h-5 w-5" />} />
        <StatCard label="Photo Reading Accuracy" value={accuracy != null ? `${accuracy.toFixed(0)}%` : "—"} sub={accuracy != null ? `of ${humanChecked.length} checked by staff` : "koi review nahi hua abhi"} accent="violet" icon={<Camera className="h-5 w-5" />} />
      </div>

      <Card className="border-brand-200">
        <div className="flex items-start gap-3">
          <Camera className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
          <div>
            <p className="text-sm font-semibold text-ink-900">Why some readings wait here</p>
            <p className="mt-0.5 text-sm text-slate-600">
              Reading a needle through sun glare is guesswork, and a guess written into the fuel record as fact is worse
              than no reading at all. A clear reading — {AUTO_VERIFY_CONFIDENCE * 100}% or better — is accepted on its
              own; anything less clear, or that jumps impossibly from the last known level, waits here for a person to
              confirm. Only then does it change the vehicle&apos;s fuel level.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-0">
        <div className="p-5 pb-3"><SectionTitle title="Readings" subtitle="Pending first" /></div>
        <div className="divide-y divide-slate-100">
          {readings.map((r) => {
            const shown = r.correctedPct ?? r.levelPct;
            return (
              <div key={r.id} className="flex flex-wrap items-start gap-4 p-5">
                {r.imageUrl ? (
                  <a href={r.imageUrl} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={r.imageUrl} alt="gauge" className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200" />
                  </a>
                ) : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-300"><Camera className="h-7 w-7" /></div>}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/fleet/${r.assetId}`} className="font-semibold text-brand-700 hover:underline">{r.asset.code}</Link>
                    <Badge color={ST[r.status] ?? ST.PENDING}>{r.status}</Badge>
                    {r.gaugeType && <Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{r.gaugeType.replace(/_/g, " ").toLowerCase()}</Badge>}
                    <span className="text-xs text-slate-400">{timeAgo(r.capturedAt)}</span>
                    {r.driver && <span className="text-xs text-slate-500">by {r.driver.name}</span>}
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-baseline gap-4">
                    <span className="text-2xl font-bold text-ink-900">{shown != null ? `${shown.toFixed(0)}%` : "unread"}</span>
                    {r.correctedPct != null && r.levelPct != null && (
                      <span className="text-xs text-slate-500">machine read <span className="line-through">{r.levelPct.toFixed(0)}%</span></span>
                    )}
                    {r.levelL != null && <span className="text-sm text-slate-500">≈ {r.levelL.toFixed(0)} L</span>}
                    <span className={`text-xs font-medium ${r.confidence >= AUTO_VERIFY_CONFIDENCE ? "text-emerald-600" : "text-amber-600"}`}>
                      {(r.confidence * 100).toFixed(0)}% clear
                    </span>
                    {r.odometerKm != null && <span className="text-xs text-slate-500">odo {num(r.odometerKm)}</span>}
                  </div>

                  {r.reasoning && <p className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{r.reasoning}</p>}
                  {r.note && <p className="mt-1 text-xs text-amber-700">{r.note}</p>}
                  {r.verifiedBy && <p className="mt-1 text-[11px] text-slate-400">{r.status.toLowerCase()} by {r.verifiedBy}{r.verifiedAt ? ` · ${fmtDate(r.verifiedAt)}` : ""}</p>}
                </div>

                <div className="shrink-0">
                  {r.status === "PENDING" && <VerifyGaugeForm reading={{ id: r.id, levelPct: r.levelPct, confidence: r.confidence, assetCode: r.asset.code }} />}
                </div>
              </div>
            );
          })}
          {readings.length === 0 && (
            <div className="py-16 text-center">
              <Camera className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-ink-900">No gauge readings yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Mark a vehicle as having no fuel sensor under Trips, and its driver will be asked for a gauge photo.
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
