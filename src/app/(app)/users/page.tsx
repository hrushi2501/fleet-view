import { db } from "@/lib/db";
import { StatCard, Card, SectionTitle, Badge } from "@/components/ui";
import { UserEntry, DeleteButton } from "@/components/EntryForms";
import { ResetPwButton } from "@/components/AccountForms";
import { ROLE_LABEL } from "@/lib/auth";
import { num, fmtDate } from "@/lib/utils";
import { Users, Shield, Truck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });
  const admins = users.filter((u) => u.role === "Admin").length;
  const drivers = users.filter((u) => u.role === "Driver").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Users &amp; Access</h1>
          <p className="text-sm text-slate-500">Create login accounts — admins get full access, drivers get the fuel-entry portal only</p>
        </div>
        <UserEntry />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Total Users" value={num(users.length)} accent="brand" icon={<Users className="h-5 w-5" />} />
        <StatCard label="Administrators" value={num(admins)} accent="violet" icon={<Shield className="h-5 w-5" />} />
        <StatCard label="Truck Drivers" value={num(drivers)} accent="emerald" icon={<Truck className="h-5 w-5" />} />
      </div>

      <Card className="p-0">
        <div className="p-5 pb-3"><SectionTitle title="All Login Accounts" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Email (login)</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Created</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                  <td className="px-5 py-3 font-medium text-ink-900">{u.name}</td>
                  <td className="px-5 py-3 text-slate-600">{u.email}</td>
                  <td className="px-5 py-3">
                    <Badge color={u.role === "Admin" ? "bg-violet-50 text-violet-700 ring-violet-600/20" : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"}>
                      {ROLE_LABEL[u.role] ?? u.role}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-400">{fmtDate(u.createdAt)}</td>
                  <td className="px-5 py-3"><div className="flex gap-1.5"><ResetPwButton userId={u.id} name={u.name} /><DeleteButton kind="user" id={u.id} label={u.name} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
