import { requirePage } from "@/lib/access";
import { PageTabs, resolveTab, type Tab } from "@/components/PageTabs";
import { Overview } from "./_sections/Overview";
import { FuelRecords } from "./_sections/FuelRecords";
import { Txt } from "@/components/Txt";
import { FuelSectionLoading } from "@/components/ModuleLoading";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

/**
 * Fuel, top level.
 *
 * `/fuel/summary` folded in here as a tab. The old fuel area had six sub-pages
 * behind a strip of its own; four of them were views of the same diesel from a
 * different angle, and people opened all four to answer one question. What is
 * left is: the numbers, the raw records, the tanks, the checks and the
 * problems — five, across three routes.
 */
const TABS: Tab[] = [
  { key: "overview", label: "Fuel Use" },
  { key: "records", label: "Fuel Records" },
];

export default async function FuelPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await requirePage("fuel.view");
  const tab = resolveTab((await searchParams).tab, TABS);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900"><Txt text="Fuel" /></h1>
        <p className="text-sm text-slate-500"><Txt text="Kitna diesel gaya, kis gaadi mein, aur kya mila uske badle" /></p>
      </div>

      <PageTabs tabs={TABS} active={tab} basePath="/fuel" />

      <Suspense key={tab} fallback={<FuelSectionLoading compact={tab === "records"} />}>
        {tab === "overview" ? <Overview access={access} /> : <FuelRecords access={access} />}
      </Suspense>
    </div>
  );
}
