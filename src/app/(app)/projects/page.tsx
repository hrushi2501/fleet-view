import { db } from "@/lib/db";
import { StatCard, Card, SectionTitle, Badge, Progress } from "@/components/ui";
import { ProjectEntry } from "@/components/EntryForms";
import { inr, num } from "@/lib/utils";
import { FolderKanban, Truck, IndianRupee, MapPin } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await db.project.findMany({ include: { _count: { select: { assets: true } } }, orderBy: { code: "asc" } });
  const totalBudget = projects.reduce((s, p) => s + p.budget, 0);
  const totalSpent = projects.reduce((s, p) => s + p.spent, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Projects</h1>
          <p className="text-sm text-slate-500">Project-wise asset deployment &amp; budget tracking</p>
        </div>
        <ProjectEntry />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active Projects" value={num(projects.length)} accent="brand" icon={<FolderKanban className="h-5 w-5" />} />
        <StatCard label="Total Budget" value={inr(totalBudget, { compact: true })} accent="violet" icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Total Spent" value={inr(totalSpent, { compact: true })} sub={`${((totalSpent / totalBudget) * 100).toFixed(0)}% utilized`} accent="amber" icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Deployed Assets" value={num(projects.reduce((s, p) => s + p._count.assets, 0))} accent="emerald" icon={<Truck className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {projects.map((p) => {
          const pct = (p.spent / p.budget) * 100;
          return (
            <Card key={p.id}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-ink-900">{p.code}</h3>
                    <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">{p.status}</Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-600">{p.name}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400"><MapPin className="h-3 w-3" />{p.location} · {p.client}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400">Assets</p>
                  <p className="text-xl font-bold text-brand-600">{p._count.assets}</p>
                </div>
              </div>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-slate-500">Budget Utilization</span>
                  <span className="font-medium text-ink-900">{inr(p.spent, { compact: true })} / {inr(p.budget, { compact: true })}</span>
                </div>
                <Progress value={pct} />
                <p className="mt-1 text-xs text-slate-400">{pct.toFixed(0)}% of budget spent</p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
