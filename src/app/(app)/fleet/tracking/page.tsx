import { assetScope, requirePage } from "@/lib/access";
import { PageTabs, resolveTab, type Tab } from "@/components/PageTabs";
import { QrStickers } from "./_sections/QrStickers";
import { TelematicsSyncBanner } from "@/components/TelematicsSyncBanner";
import { getTataSyncStatus } from "@/lib/tata-fleet-edge";
import { FleetEdgeConsole } from "@/components/FleetEdgeConsole";
import { getLiveFleet } from "@/lib/fleet-edge-live";
import { Txt } from "@/components/Txt";
import { LiveTrackingLoading, StatusLoading } from "@/components/ModuleLoading";
import { Suspense } from "react";

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
        <h1 className="text-2xl font-bold tracking-tight text-ink-900"><Txt text="Vehicle Tracking" /></h1>
        <p className="text-sm text-slate-500">
          Live position and status of every vehicle and machine across all sites
        </p>
      </div>

      <Suspense fallback={<StatusLoading label="Checking live connection" />}>
        <SyncStatusSection />
      </Suspense>

      <div className="print:hidden">
        <PageTabs tabs={TABS} active={tab} basePath="/fleet/tracking" />
      </div>

      {/* Only the open tab queries. The map pulls the whole fleet and the
          sticker sheet renders a QR image per vehicle — running both on every
          visit would double the cost of a screen people leave open all day. */}
      <Suspense key={tab} fallback={tab === "map" ? <LiveTrackingLoading /> : <StatusLoading label="Preparing QR stickers" />}>
        {tab === "map" ? <LiveMapSection access={access} /> : <QrStickers />}
      </Suspense>
    </div>
  );
}

async function SyncStatusSection() {
  const syncStatus = await getTataSyncStatus();
  return <TelematicsSyncBanner status={syncStatus} />;
}

/**
 * The live console.
 *
 * Rendered on the server so the first frame carries real positions — a
 * dispatcher opening this on a site tablet sees the fleet before any JavaScript
 * has run. The client component then polls `/api/telematics/live` to keep it
 * fresh, under the same scope.
 */
async function LiveMapSection({ access }: { access: Awaited<ReturnType<typeof requirePage>> }) {
  // Scoped, so a supervisor limited to a site sees that site's machines rather
  // than the company's — the map used to fetch everything for everybody.
  const fleet = await getLiveFleet(assetScope(access));
  return <FleetEdgeConsole initial={fleet} />;
}
