import { db } from "@/lib/db";
import { LiveMap } from "@/components/LiveMap";
import { assetScope, requirePage } from "@/lib/access";
import { PageTabs, resolveTab, type Tab } from "@/components/PageTabs";
import { QrStickers } from "./_sections/QrStickers";

export const dynamic = "force-dynamic";

/**
 * Where every vehicle is, plus the cabin stickers that put drivers on the map.
 *
 * Two former routes live here — `/tracking` (the map) and `/tracking/qr` (the
 * printable sticker sheet). They belong together because they answer one
 * question between them: a machine missing from the map is usually a machine
 * whose driver has no sticker to scan, and the fix is one tab away instead of
 * one menu hunt away.
 *
 * The heading says "Vehicle Tracking", not "Telematics". The word telematics
 * is still all over the database and the ingestion code, which is the right
 * place for it; nobody running trucks has to learn it to read this screen.
 */
const TABS: Tab[] = [
  { key: "map", label: "Live Map" },
  { key: "qr", label: "Cabin QR Stickers" },
];

export default async function VehicleTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await requirePage("fleet.view");
  const tab = resolveTab((await searchParams).tab, TABS);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Vehicle Tracking</h1>
        <p className="text-sm text-slate-500">
          Live position and status of every vehicle and machine across all sites
        </p>
      </div>

      <div className="print:hidden">
        <PageTabs tabs={TABS} active={tab} basePath="/fleet/tracking" />
      </div>

      {/* Only the open tab queries. The map pulls the whole fleet and the
          sticker sheet renders a QR image per vehicle — running both on every
          visit would double the cost of a screen people leave open all day. */}
      {tab === "map" ? <LiveMapSection access={access} /> : <QrStickers />}
    </div>
  );
}

async function LiveMapSection({ access }: { access: Awaited<ReturnType<typeof requirePage>> }) {
  // Scoped, so a supervisor limited to a site sees that site's machines rather
  // than the company's — the map used to fetch everything for everybody.
  const assets = await db.asset.findMany({
    where: assetScope(access),
    include: { project: true },
    orderBy: { code: "asc" },
  });

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

  const stopped = assets.filter((a) => a.status !== "Active").length;

  return (
    <div className="space-y-3">
      <LiveMap markers={markers} />
      {markers.length > 0 && (
        <p className="text-xs text-slate-500">
          {stopped > 0
            ? `${stopped} vehicle abhi stopped hai — tap a marker for its last reported position and meter.`
            : "Tap a marker for the vehicle's last reported position and meter."}
        </p>
      )}
    </div>
  );
}
