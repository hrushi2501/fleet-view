import { requirePage } from "@/lib/access";
import { PageTabs, resolveTab, type Tab } from "@/components/PageTabs";
import { Workforce } from "./_sections/Workforce";
import { PeopleRecords } from "./_sections/PeopleRecords";
import { DriverVehicleHistory } from "./_sections/DriverVehicleHistory";
import { Txt } from "@/components/Txt";
import { ModuleSectionLoading } from "@/components/ModuleLoading";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

/**
 * Everyone who works here.
 *
 * `/drivers` and `/master/people` were two lists of the same people: one about
 * how they drive, one about whether their licence is current. Keeping them
 * apart meant a supervisor checking a driver's record had to know which of the
 * two words — "drivers" or "personnel" — the answer had been filed under.
 *
 * `/drivers?tab=safety` still lands on the safety tab, because the tab key was
 * kept identical when the route moved.
 */
const TABS: Tab[] = [
  { key: "staff", label: "Staff & Drivers" },
  { key: "safety", label: "Safety & Competency" },
  { key: "records", label: "Documents & Attendance" },
  { key: "mapping", label: "Driver & Vehicle Records" },
];

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePage("people.view");
  const tab = resolveTab((await searchParams).tab, TABS);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900"><Txt text="People" /></h1>
        <p className="text-sm text-slate-500"><Txt text="Kaun kaam par hai, kiske paas kaunsa licence hai" /></p>
      </div>

      <PageTabs tabs={TABS} active={tab} basePath="/people" />

      <Suspense key={tab} fallback={<ModuleSectionLoading label="Loading people data" />}>
        {tab === "records" ? <PeopleRecords /> : tab === "mapping" ? <DriverVehicleHistory /> : <Workforce tab={tab} />}
      </Suspense>
    </div>
  );
}
