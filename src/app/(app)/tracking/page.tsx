import { db } from "@/lib/db";
import { LiveMap } from "@/components/LiveMap";

export const dynamic = "force-dynamic";

export default async function TrackingPage() {
  const assets = await db.asset.findMany({ include: { project: true }, orderBy: { code: "asc" } });
  const markers = assets.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    assetClass: a.assetClass,
    status: a.status,
    speed: a.speed,
    lat: a.lat,
    lng: a.lng,
    lastSeen: a.lastSeen.toISOString(),
    project: a.project?.code ?? "—",
    meterValue: a.meterValue,
    primaryMeter: a.primaryMeter,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Live Tracking</h1>
        <p className="text-sm text-slate-500">Real-time GPS positions, status &amp; geofencing across all project sites</p>
      </div>
      <LiveMap markers={markers} />
    </div>
  );
}
