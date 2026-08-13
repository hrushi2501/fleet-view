import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { getAccess, assetScope } from "@/lib/access";
import { navFor } from "@/lib/navigation";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

/**
 * Resolves who the caller is once, and hands the navigation their own menu.
 *
 * The menu is computed on the server from the same `Access` the page guards
 * use, so it can only ever offer what the server would allow. It is a
 * convenience, not the control: every page underneath calls `requirePage`
 * for itself, because a menu that omits a link does nothing to stop someone
 * typing the URL.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccess();
  if (!access) redirect("/login");

  const items = navFor(access);
  const isDriver = access.group === "DRIVER";

  // The office counters mean nothing on a driver's phone, and querying
  // company-wide totals for someone who may not see them is the wrong shape.
  const counts = isDriver
    ? { notifCount: 0 }
    : await (async () => {
        // eslint-disable-next-line react-hooks/purity
        const soon = new Date(Date.now() + 15 * 86400000);
        const [serviceDue, breakdowns] = await Promise.all([
          db.asset.count({ where: { serviceDueDate: { not: null, lte: soon }, ...assetScope(access) } }),
          db.workOrder.count({ where: { type: "BREAKDOWN", status: { in: ["Open", "In-Progress"] }, asset: assetScope(access) } }),
        ]);
        return { notifCount: serviceDue + breakdowns };
      })();

  return (
    <div className="min-h-screen">
      <Sidebar items={items} isDriver={isDriver} />
      <div className="lg:pl-64">
        <Topbar user={access.session} notifCount={counts.notifCount} isDriver={isDriver} />
        <main className="mx-auto max-w-[1500px] px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
