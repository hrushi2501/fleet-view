import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard } from "@/components/ui";
import { SeedRolesButton, RoleForm, AssignRoleSelect, DeleteRoleButton, LinkDriverSelect } from "@/components/AdminWeighForms";
import { sodViolations, PERMISSIONS, ALL_CODES, type RoleLite } from "@/lib/rbac";
import { inr, num } from "@/lib/utils";
import { ShieldCheck, TriangleAlert, Users, KeyRound } from "lucide-react";
import Link from "next/link";
import { requireAdminPage } from "@/lib/access";
import { Txt } from "@/components/Txt";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  await requireAdminPage("admin.roles");
  const [roles, users] = await Promise.all([
    db.role.findMany({ include: { _count: { select: { users: true } } }, orderBy: { name: "asc" } }),
    db.user.findMany({ include: { roleRef: true }, orderBy: { name: "asc" } }),
  ]);
  const people = await db.driver.findMany({ orderBy: { name: "asc" } });
  const driverOpts = people.map((d) => ({ id: d.id, label: `${d.empCode} — ${d.name}` }));

  const lites: RoleLite[] = roles.map((r) => ({
    name: r.name, label: r.label,
    permissions: r.permissions.split("\n").filter(Boolean),
    approvalLimit: r.approvalLimit,
  }));
  const sod = sodViolations(lites);
  const roleOpts = roles.map((r) => ({ id: r.id, label: r.label }));
  const unassigned = users.filter((u) => !u.roleId).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900"><Txt text="Roles &amp; Permissions" /></h1>
          <p className="text-sm text-slate-500">
            Who may do what, and what they may approve — stored as data, so no redeploy to re-cut
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/audit" className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
            <KeyRound className="h-4 w-4" /> Audit Log
          </Link>
          {roles.length === 0 && <SeedRolesButton />}
          <RoleForm />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-4">
        <StatCard label="Roles" value={num(roles.length)} sub={`${num(PERMISSIONS.length)} permissions available`} accent="brand" icon={<ShieldCheck className="h-5 w-5" />} />
        <StatCard label="Users" value={num(users.length)} sub={`${num(unassigned)} without a role`} accent={unassigned > 0 ? "amber" : "emerald"} icon={<Users className="h-5 w-5" />} />
        <StatCard label="SoD Conflicts" value={num(sod.length)} sub="segregation-of-duties" accent={sod.length > 0 ? "rose" : "emerald"} icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="Highest Limit" value={inr(Math.max(0, ...roles.map((r) => r.approvalLimit)), { compact: true })} sub="single approval ceiling" accent="violet" icon={<KeyRound className="h-5 w-5" />} />
      </div>

      {roles.length === 0 && (
        <Card>
          <div className="py-12 text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-ink-900">No roles installed</p>
            <p className="mt-1 text-sm text-slate-500">
              Press <strong>Install Role Set</strong> to create the eight standard roles and link existing users by their current role name.
            </p>
          </div>
        </Card>
      )}

      {sod.length > 0 && (
        <Card className="border-rose-200 p-0">
          <div className="flex items-center gap-2 p-5 pb-3">
            <TriangleAlert className="h-5 w-5 text-rose-600" />
            <SectionTitle title="Segregation of Duties Conflicts" subtitle="One role that can both do a thing and approve it — this should not happen" />
          </div>
          <div className="divide-y divide-slate-100">
            {sod.map((c, i) => (
              <div key={i} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color="bg-rose-100 text-rose-700 ring-rose-600/20">{c.role}</Badge>
                  <code className="text-xs text-slate-500">{c.a}</code>
                  <span className="text-xs text-slate-400">+</span>
                  <code className="text-xs text-slate-500">{c.b}</code>
                </div>
                <p className="mt-1 text-sm text-slate-700">{c.risk}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {roles.length > 0 && (
        <Card className="p-0">
          <div className="p-5 pb-3"><SectionTitle title="Roles" subtitle="A * means full access to everything" /></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 text-right font-medium">Users</th>
                  <th className="px-5 py-3 text-right font-medium">Permissions</th>
                  <th className="px-5 py-3 text-right font-medium">Approval Limit</th>
                  <th className="px-5 py-3 font-medium">Sensitive Grants</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => {
                  const perms = r.permissions.split("\n").filter(Boolean);
                  const full = perms.includes("*");
                  const effective = full ? ALL_CODES : perms;
                  const sensitive = PERMISSIONS.filter((p) => p.sensitive && effective.includes(p.code));
                  return (
                    <tr key={r.id} className="border-t border-slate-100 align-top hover:bg-brand-50/30">
                      <td className="px-5 py-3">
                        <span className="font-semibold text-ink-900">{r.label}</span>
                        {r.isSystem && <Badge color="bg-slate-100 text-slate-500 ring-slate-400/20">system</Badge>}
                        <p className="mt-0.5 max-w-md text-xs text-slate-500">{r.description}</p>
                        <p className="font-mono text-[10px] text-slate-400">{r.name}</p>
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-ink-900">{r._count.users}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{full ? "all" : effective.length}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{r.approvalLimit > 0 ? inr(r.approvalLimit, { compact: true }) : <span className="text-slate-300">none</span>}</td>
                      <td className="px-5 py-3">
                        {sensitive.length ? (
                          <div className="flex max-w-xs flex-wrap gap-1">
                            {sensitive.slice(0, 5).map((p) => <Badge key={p.code} color="bg-amber-100 text-amber-700 ring-amber-600/20">{p.label}</Badge>)}
                            {sensitive.length > 5 && <span className="text-xs text-slate-400">+{sensitive.length - 5}</span>}
                          </div>
                        ) : <span className="text-xs text-slate-400">none</span>}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <RoleForm role={{ id: r.id, name: r.name, label: r.label, description: r.description, permissions: perms, approvalLimit: r.approvalLimit, isSystem: r.isSystem }} />
                          <DeleteRoleButton id={r.id} isSystem={r.isSystem} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-0">
        <div className="p-5 pb-3"><SectionTitle title="User Assignments" subtitle="Any role change here is recorded, with who changed it" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">User</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Legacy Role</th>
                <th className="px-5 py-3 font-medium">Assigned Role</th>
                <th className="px-5 py-3 font-medium">Driver</th>
                <th className="px-5 py-3 text-right font-medium">Approval Limit</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                  <td className="px-5 py-3 font-medium text-ink-900">{u.name}</td>
                  <td className="px-5 py-3 text-slate-600">{u.email}</td>
                  <td className="px-5 py-3"><Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{u.role}</Badge></td>
                  <td className="px-5 py-3">
                    {roles.length > 0 ? <AssignRoleSelect userId={u.id} roleId={u.roleId} roles={roleOpts} /> : <span className="text-xs text-slate-400">install roles first</span>}
                  </td>
                  <td className="px-5 py-3">
                    <LinkDriverSelect userId={u.id} driverId={u.driverId} drivers={driverOpts} />
                  </td>
                  <td className="px-5 py-3 text-right text-slate-600">{u.roleRef?.approvalLimit ? inr(u.roleRef.approvalLimit, { compact: true }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}