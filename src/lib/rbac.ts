// M0 — Roles, permissions, approval limits and segregation of duties.
//
// The demo had a role string on the user and checked it inline. That is fine
// until a client asks "who can approve a fuel issue, and who signed off on this
// one?" — which is exactly the question an auditor asks first.
//
// Permissions are stored as data on the role, so the client can create roles and
// re-cut who-does-what without a redeploy.

export type Permission = { code: string; module: string; action: string; label: string; sensitive?: boolean };

/** The full permission catalogue. `module.action`. */
export const PERMISSIONS: Permission[] = [
  { code: "fleet.view", module: "Fleet", action: "view", label: "View assets & equipment" },
  { code: "fleet.edit", module: "Fleet", action: "edit", label: "Add / edit assets" },
  { code: "fleet.delete", module: "Fleet", action: "delete", label: "Delete assets", sensitive: true },

  { code: "fuel.view", module: "Fuel", action: "view", label: "View fuel data" },
  { code: "fuel.issue", module: "Fuel", action: "issue", label: "Issue diesel" },
  { code: "fuel.receipt", module: "Fuel", action: "receipt", label: "Record deliveries & dips" },
  { code: "fuel.approve", module: "Fuel", action: "approve", label: "Approve fuel issues", sensitive: true },
  { code: "fuel.reconcile", module: "Fuel", action: "reconcile", label: "Run reconciliation", sensitive: true },

  { code: "hire.view", module: "Hire", action: "view", label: "View hire contracts" },
  { code: "hire.edit", module: "Hire", action: "edit", label: "Manage contracts & logs" },
  { code: "hire.approve", module: "Hire", action: "approve", label: "Approve vendor invoices", sensitive: true },

  { code: "maintenance.view", module: "Maintenance", action: "view", label: "View work orders" },
  { code: "maintenance.edit", module: "Maintenance", action: "edit", label: "Raise & update work orders" },
  { code: "maintenance.approve", module: "Maintenance", action: "approve", label: "Approve maintenance spend", sensitive: true },

  { code: "production.view", module: "Production", action: "view", label: "View production" },
  { code: "production.edit", module: "Production", action: "edit", label: "Log production" },

  { code: "compliance.view", module: "Compliance", action: "view", label: "View documents" },
  { code: "compliance.edit", module: "Compliance", action: "edit", label: "Add / renew documents" },

  { code: "people.view", module: "People", action: "view", label: "View drivers & operators" },
  { code: "people.edit", module: "People", action: "edit", label: "Manage people & competencies" },
  { code: "people.discipline", module: "People", action: "discipline", label: "Record violations & penalties", sensitive: true },

  { code: "cost.view", module: "Cost", action: "view", label: "View costs & profitability" },
  { code: "cost.edit", module: "Cost", action: "edit", label: "Enter costs & revenue" },

  { code: "loss.view", module: "LossPrevention", action: "view", label: "View cases" },
  { code: "loss.investigate", module: "LossPrevention", action: "investigate", label: "Investigate & triage cases" },
  { code: "loss.close", module: "LossPrevention", action: "close", label: "Close cases & record recovery", sensitive: true },

  { code: "weighbridge.view", module: "Weighbridge", action: "view", label: "View tickets" },
  { code: "weighbridge.edit", module: "Weighbridge", action: "edit", label: "Record tickets" },

  { code: "reports.view", module: "Reports", action: "view", label: "View reports" },
  { code: "reports.export", module: "Reports", action: "export", label: "Export data", sensitive: true },

  { code: "admin.users", module: "Admin", action: "users", label: "Manage users", sensitive: true },
  { code: "admin.roles", module: "Admin", action: "roles", label: "Manage roles & permissions", sensitive: true },
  { code: "admin.settings", module: "Admin", action: "settings", label: "Change system settings", sensitive: true },
  { code: "admin.audit", module: "Admin", action: "audit", label: "View the audit log", sensitive: true },
];

export const ALL_CODES = PERMISSIONS.map((p) => p.code);

/**
 * Pairs that should not sit with one person. Someone who both issues diesel and
 * approves the issue can move fuel unchecked; the same logic applies to raising
 * and approving spend. This is the control an auditor looks for by name.
 */
export const SOD_CONFLICTS: { a: string; b: string; risk: string }[] = [
  { a: "fuel.issue", b: "fuel.approve", risk: "Can issue diesel and approve their own issue." },
  { a: "fuel.issue", b: "fuel.reconcile", risk: "Can issue diesel and sign off the reconciliation that would expose a gap." },
  { a: "hire.edit", b: "hire.approve", risk: "Can create hire logs and approve the invoice they support." },
  { a: "maintenance.edit", b: "maintenance.approve", risk: "Can raise a work order and approve its cost." },
  { a: "loss.investigate", b: "loss.close", risk: "Can investigate a case and close it without review." },
  { a: "admin.users", b: "admin.audit", risk: "Can change users and view (or notice gaps in) the audit trail." },
];

export type RoleLite = { name: string; label: string; permissions: string[]; approvalLimit: number };

export function can(role: RoleLite | null | undefined, code: string): boolean {
  if (!role) return false;
  // Full access is expressed explicitly rather than special-cased on a name.
  if (role.permissions.includes("*")) return true;
  return role.permissions.includes(code);
}

/** Can this role approve this rupee amount without escalation? */
export function canApprove(role: RoleLite | null | undefined, code: string, amount: number): { ok: boolean; reason?: string } {
  if (!can(role, code)) return { ok: false, reason: "Role does not hold this approval permission." };
  if (!role) return { ok: false, reason: "No role." };
  if (role.approvalLimit <= 0) return { ok: false, reason: "Role has no approval limit set." };
  if (amount > role.approvalLimit) {
    return { ok: false, reason: `₹${Math.round(amount).toLocaleString("en-IN")} exceeds the ₹${Math.round(role.approvalLimit).toLocaleString("en-IN")} limit — needs escalation.` };
  }
  return { ok: true };
}

export type SodFinding = { role: string; a: string; b: string; risk: string };

/** Roles holding both halves of a conflicting pair. */
export function sodViolations(roles: RoleLite[]): SodFinding[] {
  const out: SodFinding[] = [];
  for (const r of roles) {
    const held = r.permissions.includes("*") ? ALL_CODES : r.permissions;
    for (const c of SOD_CONFLICTS) {
      if (held.includes(c.a) && held.includes(c.b)) {
        out.push({ role: r.label || r.name, a: c.a, b: c.b, risk: c.risk });
      }
    }
  }
  return out;
}

/** Roles shipped with the product, mapped onto the demo's existing role strings. */
export const DEFAULT_ROLES: { name: string; label: string; description: string; permissions: string[]; approvalLimit: number; isSystem: boolean }[] = [
  {
    name: "Admin", label: "Administrator", description: "Full access to every module and setting.",
    permissions: ["*"], approvalLimit: 10000000, isSystem: true,
  },
  {
    name: "FleetManager", label: "Fleet Manager",
    description:
      "Runs the fleet day to day: contracts, work orders, production. Deliberately cannot approve the hire and maintenance spend it creates — that sits with Finance.",
    permissions: [
      // Holds fuel.approve and fuel.reconcile but NOT fuel.issue, so approval stays independent of issuing.
      "fleet.view", "fleet.edit", "fuel.view", "fuel.approve", "fuel.reconcile",
      "hire.view", "hire.edit", "maintenance.view", "maintenance.edit",
      "production.view", "production.edit", "compliance.view", "compliance.edit",
      "people.view", "people.edit", "cost.view", "loss.view", "loss.investigate",
      "weighbridge.view", "weighbridge.edit", "reports.view", "reports.export",
    ],
    approvalLimit: 500000, isSystem: true,
  },
  {
    name: "Finance", label: "Finance Controller",
    description:
      "Owns cost, revenue and payment. Approves hire and maintenance spend precisely because it does not create it — reads operations, does not run them.",
    permissions: [
      "fleet.view", "fuel.view", "hire.view", "hire.approve", "maintenance.view", "maintenance.approve",
      "production.view", "compliance.view", "people.view", "cost.view", "cost.edit",
      "loss.view", "loss.close", "weighbridge.view", "reports.view", "reports.export",
    ],
    approvalLimit: 2000000, isSystem: true,
  },
  {
    name: "SiteManager", label: "Site Supervisor",
    description: "Runs one or more sites. Logs production and hire days; cannot approve invoices.",
    permissions: [
      "fleet.view", "fuel.view", "fuel.receipt", "hire.view", "hire.edit",
      "maintenance.view", "maintenance.edit", "production.view", "production.edit",
      "compliance.view", "people.view", "weighbridge.view", "weighbridge.edit", "reports.view",
    ],
    approvalLimit: 50000, isSystem: true,
  },
  {
    name: "FuelClerk", label: "Fuel Clerk",
    description: "Issues diesel and records deliveries and dips. Deliberately cannot approve or reconcile.",
    permissions: ["fleet.view", "fuel.view", "fuel.issue", "fuel.receipt", "weighbridge.view", "weighbridge.edit"],
    approvalLimit: 0, isSystem: true,
  },
  {
    name: "Workshop", label: "Workshop Manager",
    description: "Runs the workshop. Raises and completes work orders; approval sits elsewhere.",
    permissions: ["fleet.view", "maintenance.view", "maintenance.edit", "compliance.view", "people.view", "reports.view"],
    approvalLimit: 25000, isSystem: true,
  },
  {
    name: "Auditor", label: "Auditor",
    description: "Read-only across everything, including the audit log. Changes nothing.",
    permissions: [
      "fleet.view", "fuel.view", "hire.view", "maintenance.view", "production.view",
      "compliance.view", "people.view", "cost.view", "loss.view", "weighbridge.view",
      "reports.view", "reports.export", "admin.audit",
    ],
    approvalLimit: 0, isSystem: true,
  },
  {
    name: "Driver", label: "Driver / Operator",
    description: "Mobile app only — logs fuel fills and repair photos for their own machine.",
    permissions: ["fuel.issue"], approvalLimit: 0, isSystem: true,
  },
];

/** Group the catalogue for rendering a permission matrix. */
export function permissionsByModule(): { module: string; items: Permission[] }[] {
  const m = new Map<string, Permission[]>();
  for (const p of PERMISSIONS) {
    const arr = m.get(p.module) ?? [];
    arr.push(p);
    m.set(p.module, arr);
  }
  return [...m.entries()].map(([module, items]) => ({ module, items }));
}
