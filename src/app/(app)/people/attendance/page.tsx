import { requirePage } from "@/lib/access";
import { PageTabs, resolveTab, type Tab } from "@/components/PageTabs";
import { Register } from "./_sections/Register";
import { Approvals } from "./_sections/Approvals";
import { BatchSignOff } from "./_sections/BatchSignOff";
import { Txt } from "@/components/Txt";

export const dynamic = "force-dynamic";

/**
 * Who was on site, and which shifts still need signing off.
 */
const TABS: Tab[] = [
  { key: "matrix", label: "⚡ 1-Tap Daily Sign-Off" },
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
        <h1 className="text-2xl font-bold tracking-tight text-ink-900"><Txt text="Attendance" /></h1>
        <p className="text-sm text-slate-500"><Txt text="Fast 1-tap shift sign-offs and verified daily register" /></p>
      </div>

      <PageTabs tabs={TABS} active={tab} basePath="/people/attendance" />

      {tab === "approvals" ? (
        <Approvals />
      ) : tab === "register" ? (
        <Register />
      ) : (
        <BatchSignOff />
      )}
    </div>
  );
}