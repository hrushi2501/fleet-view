import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role === "Driver") redirect("/driver"); // drivers use the limited portal

  // eslint-disable-next-line react-hooks/purity
  const soon = new Date(Date.now() + 15 * 86400000);
  const [alertCount, serviceDue, breakdowns] = await Promise.all([
    db.alert.count({ where: { status: "Open", severity: "Critical" } }),
    db.asset.count({ where: { serviceDueDate: { not: null, lte: soon } } }),
    db.workOrder.count({ where: { type: "BREAKDOWN", status: { in: ["Open", "In-Progress"] } } }),
  ]);
  const notifCount = serviceDue + breakdowns;

  return (
    <div className="min-h-screen">
      <Sidebar alertCount={alertCount} />
      <div className="lg:pl-64">
        <Topbar user={user} notifCount={notifCount} />
        <main className="mx-auto max-w-[1500px] px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
