import { requirePage } from "@/lib/access";
import { PageTabs, resolveTab, type Tab } from "@/components/PageTabs";
import { Register } from "./_sections/Register";
import { VehicleRecords } from "./_sections/VehicleRecords";
import { Txt } from "@/components/Txt";
import { ModuleSectionLoading } from "@/components/ModuleLoading";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

/**
 * Everything the company runs, in one place.
 *
 * Two routes folded in here: the old `/fleet` register and `/master/assets`,
 * which held the identity numbers and meter history for the same machines.
 * Splitting them was a filing decision, not an operational one — the person
 * asking "is this tipper's registration on file?" is the person looking at the
 * tipper — so they are now two tabs over one list.
 */
const TABS: Tab[] = [
  { key: "register", label: "Vehicles & Equipment" },
  { key: "records", label: "Vehicle Details" },
];

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePage("fleet.view");
  const tab = resolveTab((await searchParams).tab, TABS);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900"><Txt text="Fleet" /></h1>
        <p className="text-sm text-slate-500"><Txt text="Gaadi aur machine — kaunsi hai, kahan hai, kiske paas hai" /></p>
      </div>

      <PageTabs tabs={TABS} active={tab} basePath="/fleet" />

      <Suspense key={tab} fallback={<ModuleSectionLoading label="Loading fleet data" />}>
        {tab === "register" ? <Register /> : <VehicleRecords />}
      </Suspense>
    </div>
  );
}
