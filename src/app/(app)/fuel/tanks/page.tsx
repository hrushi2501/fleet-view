import { requirePage } from "@/lib/access";
import { PageTabs, resolveTab, type Tab } from "@/components/PageTabs";
import { Tanks } from "./_sections/Tanks";
import { Reconciliation } from "./_sections/Reconciliation";
import { Txt } from "@/components/Txt";

export const dynamic = "force-dynamic";

/**
 * Site tanks, and the stock check that keeps them honest.
 *
 * `/fuel/reconciliation` moved in here. The stock check reads the same tanks,
 * the same deliveries and the same dips as the tank list does; the only reason
 * it was a separate page was that it was built later.
 *
 * The check is a permitted action, not a view — it needs `fuel.reconcile` —
 * so its tab only appears for people who hold that, and the section guards
 * itself again underneath.
 */
export default async function TanksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await requirePage("fuel.view");

  const tabs: Tab[] = [{ key: "tanks", label: "Site Tanks" }];
  if (access.can("fuel.reconcile")) tabs.push({ key: "stock", label: "Stock Check" });

  const tab = resolveTab((await searchParams).tab, tabs);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900"><Txt text="Site Tanks" /></h1>
        <p className="text-sm text-slate-500"><Txt text="Har site ke tank mein kitna diesel hai, aur hisaab milta hai ya nahi" /></p>
      </div>

      <PageTabs tabs={tabs} active={tab} basePath="/fuel/tanks" />

      {tab === "stock" ? <Reconciliation /> : <Tanks />}
    </div>
  );
}