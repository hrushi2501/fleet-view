import { requirePage } from "@/lib/access";
import { PageTabs, resolveTab, type Tab } from "@/components/PageTabs";
import { ProblemQueue } from "./_sections/ProblemQueue";
import { LossCases } from "./_sections/LossCases";
import { FuelInsights } from "./_sections/FuelInsights";

export const dynamic = "force-dynamic";

/**
 * Everything that says diesel went missing.
 *
 * Three former routes: `/fuel/anomalies` (the scored queue), `/loss-prevention`
 * (formal cases with evidence and recovery) and `/fuel/intelligence` (the
 * patterns across both). They were one workflow spread over three menu entries
 * — spot it, chase it, see where it keeps happening — so they are now three
 * tabs read left to right in that order.
 *
 * Cases carry more than fuel (hire, meters, compliance) and are gated by
 * `loss.view`, which not every fuel viewer holds; that tab appears only when
 * the permission does.
 */
export default async function FuelProblemsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await requirePage("fuel.view");

  const tabs: Tab[] = [{ key: "queue", label: "Problem Queue" }];
  if (access.can("loss.view")) tabs.push({ key: "cases", label: "Fuel Loss Check" });
  tabs.push({ key: "patterns", label: "Patterns" });

  const tab = resolveTab((await searchParams).tab, tabs);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Fuel Problems</h1>
        <p className="text-sm text-slate-500">
          Diesel jo hisaab mein nahi aaya — kahan gaya, kisne dekha, kitna wapas mila
        </p>
      </div>

      <PageTabs tabs={tabs} active={tab} basePath="/fuel/problems" />

      {tab === "cases" ? <LossCases /> : tab === "patterns" ? <FuelInsights /> : <ProblemQueue />}
    </div>
  );
}
