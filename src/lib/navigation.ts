/**
 * The nine modules, and who sees each one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE MENU IS DERIVED, NOT WRITTEN
 *
 * The old sidebar was a hand-maintained list of thirty links across five
 * groups, with no reference to permissions at all. Two problems followed: it
 * showed everyone everything, and it drifted — links stayed in the menu after
 * the page behind them moved.
 *
 * Every entry here names the permission the page itself enforces, and the menu
 * is filtered by the same `Access` the page guard uses. A link cannot appear
 * unless the server would honour it, and a page cannot be reached just because
 * a link was missed.
 *
 * NAMING
 *
 * Labels are what a site supervisor would say out loud. The domain language
 * stays in the code — `TelemetryReading`, `FuelAnomaly`, `assetClass` are all
 * still there in the database and the calculations — but "Telematics",
 * "Anomaly" and "TCO" do not belong on a screen used by someone whose job is
 * running trucks. See `TERMS` at the foot of this file for the mapping.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Access, UserGroup } from "@/lib/access";

export type NavChild = {
  href: string;
  label: string;
  /** Permission the destination page enforces. Null = any signed-in user. */
  permission: string | null;
  /** Restrict to particular bands, when permission alone is too coarse. */
  groups?: UserGroup[];
};

export type NavItem = {
  href: string;
  label: string;
  /** One line under the heading, in plain language. */
  hint: string;
  icon: string;
  permission: string | null;
  groups?: UserGroup[];
  children?: NavChild[];
};

/**
 * The office navigation — Admin and Supervisor.
 *
 * Nine entries, deliberately. Everything the old menu carried still exists; it
 * now lives as a tab or a section inside the module it belongs to, which is
 * what keeps this list short enough to scan.
 */
export const MODULES: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    hint: "Kya chal raha hai",
    icon: "LayoutDashboard",
    permission: null,
  },
  {
    href: "/fleet",
    label: "Fleet",
    hint: "Gaadi kahan hai",
    icon: "Truck",
    permission: "fleet.view",
    children: [
      { href: "/fleet", label: "Vehicles & Equipment", permission: "fleet.view" },
      { href: "/fleet/tracking", label: "Vehicle Tracking", permission: "fleet.view" },
      { href: "/fleet/trips", label: "Trips", permission: "fleet.view" },
    ],
  },
  {
    href: "/fuel",
    label: "Fuel",
    hint: "Kitna diesel use hua",
    icon: "Fuel",
    permission: "fuel.view",
    children: [
      { href: "/fuel", label: "Fuel Overview", permission: "fuel.view" },
      { href: "/fuel/tanks", label: "Site Tanks", permission: "fuel.view" },
      { href: "/fuel/checks", label: "Fuel Checks", permission: "fuel.view" },
      { href: "/fuel/problems", label: "Fuel Problems", permission: "fuel.view" },
    ],
  },
  {
    href: "/people",
    label: "People",
    hint: "Kaun kaam par hai",
    icon: "Users",
    permission: "people.view",
    children: [
      { href: "/people", label: "Staff & Drivers", permission: "people.view" },
      { href: "/people/attendance", label: "Attendance", permission: "people.view" },
      { href: "/people/contractors", label: "Contractors", permission: "hire.view" },
    ],
  },
  {
    href: "/sites",
    label: "Sites & Work",
    hint: "Site par kya kaam chal raha hai",
    icon: "MapPin",
    permission: "production.view",
    children: [
      { href: "/sites", label: "Sites", permission: "production.view" },
      { href: "/sites/work", label: "Work & Production", permission: "production.view" },
      { href: "/sites/materials", label: "Material Weighing", permission: "weighbridge.view" },
    ],
  },
  {
    href: "/maintenance",
    label: "Maintenance",
    hint: "Kiski service karni hai",
    icon: "Wrench",
    permission: "maintenance.view",
    children: [
      { href: "/maintenance", label: "Service & Repairs", permission: "maintenance.view" },
      { href: "/maintenance/inventory", label: "Parts & Stores", permission: "maintenance.view" },
      { href: "/maintenance/tyres", label: "Tyres & Parts", permission: "maintenance.view" },
      { href: "/maintenance/reminders", label: "Service Due", permission: "maintenance.view" },
    ],
  },
  {
    href: "/compliance",
    label: "Compliance",
    hint: "Kaunse documents expire ho rahe hain",
    icon: "ShieldCheck",
    permission: "compliance.view",
    children: [
      { href: "/compliance", label: "Documents", permission: "compliance.view" },
      { href: "/compliance/checks", label: "Documents & Checks", permission: "compliance.view" },
    ],
  },
  {
    href: "/reports",
    label: "Reports",
    hint: "Business kaisa chal raha hai",
    icon: "BarChart3",
    permission: "reports.view",
    children: [
      { href: "/reports", label: "Reports", permission: "reports.view" },
      { href: "/reports/notifications", label: "Notification Log", permission: "reports.view" },
      { href: "/reports/summary", label: "Management Summary", permission: "cost.view" },
      { href: "/reports/costs", label: "Total Cost & Profit", permission: "cost.view" },
    ],
  },
  {
    href: "/admin",
    label: "Admin",
    hint: "System management",
    icon: "Settings",
    // Kept out of the operational list entirely rather than merely filtered, so
    // a supervisor never sees that a system area exists.
    permission: null,
    groups: ["ADMIN"],
    children: [
      { href: "/admin", label: "Users & Access", permission: "admin.users", groups: ["ADMIN"] },
      { href: "/admin/roles", label: "Roles & Permissions", permission: "admin.roles", groups: ["ADMIN"] },
      { href: "/admin/audit", label: "Audit Log", permission: "admin.audit", groups: ["ADMIN"] },
      { href: "/admin/diagnostics", label: "Advanced Diagnostics", permission: "admin.settings", groups: ["ADMIN"] },
    ],
  },
];

/**
 * The driver's app. A separate list, not a filtered version of the one above —
 * a driver's mental model is "my vehicle, my trips, my documents", not a
 * cut-down fleet manager.
 */
export const DRIVER_MODULES: NavItem[] = [
  { href: "/my", label: "My Work", hint: "Aaj ka kaam", icon: "LayoutDashboard", permission: null },
  { href: "/my/vehicle", label: "My Vehicle", hint: "Meri gaadi", icon: "Truck", permission: null },
  { href: "/my/report", label: "Report", hint: "Problem ya accident", icon: "AlertTriangle", permission: null },
  { href: "/my/trips", label: "My Trips", hint: "Trip history", icon: "Route", permission: null },
  { href: "/my/fuel", label: "Fuel", hint: "Diesel bharna", icon: "Fuel", permission: null },
  { href: "/my/service", label: "Service", hint: "Service aur problem", icon: "Wrench", permission: null },
  { href: "/my/documents", label: "My Documents", hint: "Licence aur papers", icon: "ShieldCheck", permission: null },
  { href: "/my/help", label: "Help", hint: "Kaise karein", icon: "CircleHelp", permission: null },
  { href: "/my/policies", label: "Policies", hint: "Rules aur privacy", icon: "FileText", permission: null },
];

/** The menu this particular person should see. */
export function navFor(access: Pick<Access, "group" | "can">): NavItem[] {
  if (access.group === "DRIVER") return DRIVER_MODULES;

  const visible = (groups: UserGroup[] | undefined, permission: string | null) => {
    if (groups && !groups.includes(access.group)) return false;
    return permission === null || access.can(permission);
  };

  return MODULES.filter((m) => {
    if (!visible(m.groups, m.permission)) return false;
    // A parent with children but none reachable is a dead end; drop it.
    if (m.children?.length) {
      const reachable = m.children.filter((c) => visible(c.groups, c.permission));
      return reachable.length > 0 || m.permission !== null;
    }
    return true;
  }).map((m) => ({
    ...m,
    children: m.children?.filter((c) => visible(c.groups, c.permission)),
  }));
}

/**
 * Plain-language replacements for the domain vocabulary.
 *
 * Kept as data so the wording can be corrected in one place, and so a reviewer
 * can see at a glance which technical terms are meant never to reach a screen.
 * The left-hand side stays in the code, the database and the calculations.
 */
export const TERMS: Record<string, string> = {
  Telematics: "Vehicle Tracking",
  Telemetry: "Vehicle Data",
  TCO: "Total Cost",
  KPI: "Performance",
  "Asset Master": "Vehicle & Equipment Details",
  Asset: "Vehicle / Equipment",
  "Anomaly Detection": "Unusual Activity",
  "Fuel Anomaly": "Fuel Problem",
  "Fuel Delta": "Fuel Change",
  "Data Quality": "Data Check",
  "Confidence Score": "Data Accuracy",
  "Low Confidence": "Data may be incomplete",
  "Refuelling Event": "Fuel Filled",
  "Fuel Consumption": "Fuel Used",
  "Fuel Efficiency": "Mileage",
  "Vehicle Utilization": "Vehicle Usage",
  "Maintenance Due": "Service Due",
  "Compliance Audit": "Documents & Checks",
  "Executive Dashboard": "Management Summary",
  "Loss Prevention": "Fuel Loss Check",
  "Sampling Gap": "Data Missing",
  "GPS Diagnostics": "Location Details",
};

/** How a data-accuracy level should read on screen. */
export const CONFIDENCE_LABEL: Record<string, string> = {
  HIGH: "Data accuracy: good",
  MEDIUM: "Data accuracy: partial",
  LOW: "Data may be incomplete",
};

/**
 * Routes that moved. Kept so existing links, bookmarks and the driver app's
 * saved shortcuts keep working instead of 404ing after the restructure.
 */
export const ROUTE_MOVES: Record<string, string> = {
  "/simple": "/",
  "/reports/executive": "/reports/summary",
  "/costs": "/reports/costs",
  "/master/assets": "/fleet",
  "/tracking": "/fleet/tracking",
  "/tracking/sessions": "/fleet/trips",
  "/tracking/fuel-verification": "/fuel/checks",
  "/tracking/qr": "/fleet/tracking",
  "/fuel/anomalies": "/fuel/problems",
  "/fuel/intelligence": "/fuel/problems",
  "/fuel/reconciliation": "/fuel/tanks",
  "/fuel/summary": "/fuel",
  "/loss-prevention": "/fuel/problems",
  "/drivers": "/people",
  "/master/people": "/people",
  "/attendance": "/people/attendance",
  "/attendance/approvals": "/people/attendance",
  "/hire": "/people/contractors",
  "/production": "/sites/work",
  "/production/entry": "/sites/work",
  "/projects": "/sites",
  "/operations": "/sites",
  "/weighbridge": "/sites/materials",
  "/tyres": "/maintenance/tyres",
  "/notifications": "/maintenance/reminders",
  "/compliance/audit": "/compliance/checks",
  "/users": "/admin",
  "/alerts": "/",
  "/driver": "/my",
  "/driver/checkin": "/my",
};
