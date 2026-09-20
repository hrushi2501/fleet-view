import type { Access } from "@/lib/access";

export type QuickActionIcon =
  | "Users" | "Truck" | "Fuel" | "Droplets" | "Wrench"
  | "Boxes" | "Scale" | "CalendarCheck2" | "IndianRupee" | "FileDown";

export type QuickAction = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  icon: QuickActionIcon;
  color: string;
  badge?: string;
  /** All required so the page opens and the intended work can actually be done. */
  permissions: string[];
};

const ACTIONS: QuickAction[] = [
  {
    id: "manage_users", title: "Manage Users", subtitle: "Create or update login access",
    href: "/admin", icon: "Users", color: "bg-indigo-600 text-white shadow-indigo-600/25", badge: "Admin",
    permissions: ["admin.users"],
  },
  {
    id: "add_vehicle", title: "Add Vehicle / Machine", subtitle: "Register truck, tipper or plant",
    href: "/fleet", icon: "Truck", color: "bg-indigo-600 text-white shadow-indigo-600/25",
    permissions: ["fleet.view", "fleet.edit"],
  },
  {
    id: "issue_diesel", title: "Issue Fuel", subtitle: "Log fuel issued to a vehicle or tank",
    href: "/fuel", icon: "Fuel", color: "bg-amber-500 text-white shadow-amber-500/25", badge: "Fuel",
    permissions: ["fuel.view", "fuel.issue"],
  },
  {
    id: "receive_diesel", title: "Receive Diesel", subtitle: "Record a delivery into a site tank",
    href: "/fuel", icon: "Droplets", color: "bg-sky-600 text-white shadow-sky-600/25", badge: "Fuel",
    permissions: ["fuel.view", "fuel.receipt"],
  },
  {
    id: "report_breakdown", title: "Report Breakdown", subtitle: "Create an urgent repair work order",
    href: "/maintenance", icon: "Wrench", color: "bg-rose-500 text-white shadow-rose-500/25", badge: "Urgent",
    permissions: ["maintenance.view", "maintenance.edit"],
  },
  {
    id: "log_production", title: "Log Site Work", subtitle: "Record today’s production and shifts",
    href: "/sites/work", icon: "Boxes", color: "bg-brand-600 text-white shadow-brand-600/25", badge: "Daily",
    permissions: ["production.view", "production.edit"],
  },
  {
    id: "weighbridge_ticket", title: "Weighbridge Ticket", subtitle: "Log gross or tare material weight",
    href: "/sites/materials", icon: "Scale", color: "bg-violet-600 text-white shadow-violet-600/25", badge: "Site",
    permissions: ["weighbridge.view", "weighbridge.edit"],
  },
  {
    id: "mark_attendance", title: "Mark Attendance", subtitle: "Update the daily staff register",
    href: "/people/attendance", icon: "CalendarCheck2", color: "bg-emerald-600 text-white shadow-emerald-600/25", badge: "Daily",
    permissions: ["people.view", "people.edit"],
  },
  {
    id: "record_cost", title: "Record Cost / Revenue", subtitle: "Add an approved business entry",
    href: "/reports/costs", icon: "IndianRupee", color: "bg-emerald-600 text-white shadow-emerald-600/25", badge: "Finance",
    permissions: ["cost.view", "cost.edit"],
  },
  {
    id: "export_reports", title: "Export Report", subtitle: "Download permitted operational data",
    href: "/reports", icon: "FileDown", color: "bg-slate-700 text-white shadow-slate-700/25", badge: "Reports",
    permissions: ["reports.view", "reports.export"],
  },
];

/**
 * A quick action is an affordance, not an authorization check. It is still
 * derived on the server from the same `Access.can` function that page and API
 * guards use, so a role never receives a shortcut to work it cannot complete.
 */
export function quickActionsFor(access: Pick<Access, "group" | "can">): QuickAction[] {
  if (access.group === "DRIVER") return [];
  return ACTIONS.filter((action) => action.permissions.every(access.can));
}
