import { requirePage } from "@/lib/access";
import { PageTabs, resolveTab, type Tab } from "@/components/PageTabs";
import { Register } from "./_sections/Register";
import { Approvals } from "./_sections/Approvals";

export const dynamic = "force-dynamic";

/**
 * Who was on site, and which shifts still need signing off.
 *
 * `/attendance` and `/attendance/approvals` read the same loader and answered
 * the same question from two directions, so the approvals queue is now the
 * second tab of the register rather than a route a supervisor had to be told
 * about.
 */
const TABS: Tab[] = [
  { key: "register", label: "Attendance Register" },
  { key: "approvals", label: "Approvals" },
];

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePage("people.view");
  const tab = resolveTab((await searchParams).tab, TABS);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">Attendance</h1>
        <p className="text-sm text-slate-500">Aaj kaun aaya, kaunsi shift abhi tak sign nahi hui</p>
      </div>

      <PageTabs tabs={TABS} active={tab} basePath="/people/attendance" />

      {tab === "approvals" ? <Approvals /> : <Register />}
    </div>
  );
}
