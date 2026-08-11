import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard } from "@/components/ui";
import { ReleaseSessionButton, CloseStaleButton, IssueQrButton, SeedProvidersButton, TelematicsForm, ScanFuelButton } from "@/components/TrackingForms";
import { SESSION_STALE_HOURS } from "@/lib/telematics";
import { num, fmtDate, timeAgo, ASSET_CLASS_LABEL } from "@/lib/utils";
import { Radio, QrCode, Satellite, Smartphone, TriangleAlert, ArrowLeft } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const SRC: Record<string, { label: string; cls: string }> = {
  GPS: { label: "GPS device", cls: "bg-emerald-100 text-emerald-700 ring-emerald-600/20" },
  MOBILE: { label: "Driver phone", cls: "bg-brand-100 text-brand-700 ring-brand-600/20" },
  NONE: { label: "No tracking", cls: "bg-slate-100 text-slate-600 ring-slate-500/20" },
};

export default async function SessionsPage() {
  const since = new Date(); since.setDate(since.getDate() - 30);
  const [sessions, assets, providers, readingCount] = await Promise.all([
    db.tripSession.findMany({ include: { asset: true, driver: true, _count: { select: { readings: true, fuelReadings: true } } }, orderBy: { startedAt: "desc" }, take: 100 }),
    db.asset.findMany({ include: { telematicsProvider: true }, orderBy: { code: "asc" } }),
    db.telematicsProvider.findMany({ orderBy: { name: "asc" } }),
    db.telemetryReading.count({ where: { recordedAt: { gte: since } } }),
  ]);

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const active = sessions.filter((s) => s.status === "ACTIVE");
  const stale = active.filter((s) => (nowMs - s.startedAt.getTime()) / 3.6e6 > SESSION_STALE_HOURS);
  const withQr = assets.filter((a) => a.qrToken).length;
  const withDevice = assets.filter((a) => a.deviceId).length;
  const withSensor = assets.filter((a) => a.hasFuelSensor).length;
  const providerOpts = providers.map((p) => ({ id: p.id, label: p.name }));

  return (
    <div className="space-y-6">
      <Link href="/tracking" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Live Tracking
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Trip Sessions &amp; Telematics</h1>
          <p className="text-sm text-slate-500">
            Who is on which machine right now, and where each vehicle&apos;s data comes from
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {providers.length === 0 && <SeedProvidersButton />}
          <CloseStaleButton />
          <Link href="/tracking/qr" className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
            <QrCode className="h-4 w-4" /> Print QR sheet
          </Link>
          <IssueQrButton />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Active Trips" value={num(active.length)} sub={`${num(sessions.length)} in 30 days`} accent="emerald" icon={<Radio className="h-5 w-5" />} />
        <StatCard label="Forgotten Checkouts" value={num(stale.length)} sub={`open over ${SESSION_STALE_HOURS}h`} accent={stale.length ? "rose" : "emerald"} icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="QR Codes Issued" value={`${num(withQr)}/${num(assets.length)}`} sub="cabin stickers" accent="brand" icon={<QrCode className="h-5 w-5" />} />
        <StatCard label="GPS Devices" value={`${num(withDevice)}/${num(assets.length)}`} sub={`${num(withSensor)} with fuel sensor`} accent="violet" icon={<Satellite className="h-5 w-5" />} />
        <StatCard label="Telemetry Points" value={num(readingCount)} sub="last 30 days" accent="brand" icon={<Smartphone className="h-5 w-5" />} />
      </div>

      <Card className="border-brand-200">
        <div className="flex items-start gap-3">
          <Satellite className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
          <div>
            <p className="text-sm font-semibold text-ink-900">How the two kinds of vehicle are handled</p>
            <p className="mt-0.5 text-sm text-slate-600">
              A machine with a GPS unit and a fuel sensor reports position and tank level on its own. A machine with
              neither still produces a full trip record: the driver scans the cabin QR to check in, their phone reports
              position while the trip runs, and fuel comes from a photo of the gauge read by the vision model. Both land
              in the same telemetry stream, tagged with their source, so reconciliation and cost-per-km never have to
              care which kind of vehicle they are looking at.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-0">
        <div className="p-5 pb-3"><SectionTitle title="Sessions" subtitle="Active first" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Vehicle</th>
                <th className="px-5 py-3 font-medium">Driver</th>
                <th className="px-5 py-3 font-medium">Started</th>
                <th className="px-5 py-3 font-medium">Ended</th>
                <th className="px-5 py-3 text-right font-medium">Distance</th>
                <th className="px-5 py-3 font-medium">Tracking</th>
                <th className="px-5 py-3 text-right font-medium">Points</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const isStale = s.status === "ACTIVE" && (nowMs - s.startedAt.getTime()) / 3.6e6 > SESSION_STALE_HOURS;
                return (
                  <tr key={s.id} className={`border-t border-slate-100 hover:bg-brand-50/30 ${isStale ? "bg-rose-50/40" : ""}`}>
                    <td className="px-5 py-3">
                      <Link href={`/fleet/${s.assetId}`} className="font-semibold text-brand-700 hover:underline">{s.asset.code}</Link>
                      <p className="text-xs text-slate-400">{ASSET_CLASS_LABEL[s.asset.assetClass] ?? s.asset.assetClass}</p>
                    </td>
                    <td className="px-5 py-3 font-medium text-ink-900">{s.driver.name}</td>
                    <td className="px-5 py-3 whitespace-nowrap text-slate-600">{fmtDate(s.startedAt)}<span className="block text-xs text-slate-400">{timeAgo(s.startedAt)}</span></td>
                    <td className="px-5 py-3 whitespace-nowrap text-slate-500">{s.endedAt ? fmtDate(s.endedAt) : "—"}</td>
                    <td className="px-5 py-3 text-right font-medium text-ink-900">{s.distanceKm > 0 ? `${s.distanceKm.toFixed(1)} km` : "—"}</td>
                    <td className="px-5 py-3"><Badge color={SRC[s.trackingSource]?.cls ?? SRC.NONE.cls}>{SRC[s.trackingSource]?.label ?? s.trackingSource}</Badge></td>
                    <td className="px-5 py-3 text-right text-slate-600">{s._count.readings}{s._count.fuelReadings > 0 && <span className="block text-xs text-slate-400">{s._count.fuelReadings} fuel</span>}</td>
                    <td className="px-5 py-3">
                      <Badge color={s.status === "ACTIVE" ? (isStale ? "bg-rose-100 text-rose-700 ring-rose-600/20" : "bg-emerald-100 text-emerald-700 ring-emerald-600/20") : s.status === "ABANDONED" ? "bg-amber-100 text-amber-700 ring-amber-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20"}>
                        {isStale ? "FORGOTTEN" : s.status}
                      </Badge>
                      {s.endedBy && <p className="mt-0.5 text-[11px] text-slate-400">by {s.endedBy.toLowerCase()}</p>}
                    </td>
                    <td className="px-5 py-3 text-right">{s.status === "ACTIVE" && <ReleaseSessionButton id={s.id} />}</td>
                  </tr>
                );
              })}
              {sessions.length === 0 && (
                <tr><td colSpan={9} className="px-5 py-10 text-center text-slate-400">
                  No trip sessions yet. Issue QR codes, put them in the cabins, and drivers scan to check in.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-0">
        <div className="p-5 pb-3"><SectionTitle title="Vehicle Data Sources" subtitle="Which machines have a tracker, and which fall back to gauge photos" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Vehicle</th>
                <th className="px-5 py-3 font-medium">QR Code</th>
                <th className="px-5 py-3 font-medium">GPS Provider</th>
                <th className="px-5 py-3 font-medium">Device ID</th>
                <th className="px-5 py-3 font-medium">Fuel Source</th>
                <th className="px-5 py-3 text-right font-medium">Tank Level</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {assets.slice(0, 80).map((a) => (
                <tr key={a.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                  <td className="px-5 py-3">
                    <Link href={`/fleet/${a.id}`} className="font-semibold text-brand-700 hover:underline">{a.code}</Link>
                    <p className="text-xs text-slate-400">{a.registrationNo ?? a.name}</p>
                  </td>
                  <td className="px-5 py-3">{a.qrToken ? <span className="font-mono text-xs text-slate-600">{a.qrToken}</span> : <span className="text-xs text-amber-600">not issued</span>}</td>
                  <td className="px-5 py-3 text-slate-600">{a.telematicsProvider?.name ?? <span className="text-slate-300">none</span>}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{a.deviceId ?? "—"}</td>
                  <td className="px-5 py-3">
                    <Badge color={a.hasFuelSensor ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : "bg-amber-100 text-amber-700 ring-amber-600/20"}>
                      {a.hasFuelSensor ? "Sensor" : "Gauge photo"}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {a.fuelLevelPct != null ? (
                      <>
                        <span className={`font-semibold ${a.fuelLevelPct < 20 ? "text-rose-600" : "text-ink-900"}`}>{a.fuelLevelPct.toFixed(0)}%</span>
                        <span className="block text-[11px] text-slate-400">{a.fuelLevelAt ? timeAgo(a.fuelLevelAt) : ""}</span>
                      </>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <ScanFuelButton assetId={a.id} />
                      <TelematicsForm asset={{ id: a.id, code: a.code, deviceId: a.deviceId, telematicsProviderId: a.telematicsProviderId, hasFuelSensor: a.hasFuelSensor }} providers={providerOpts} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
