import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { analyzeFleet } from "@/lib/fuel";
import { SpeakButton } from "@/components/SpeakButton";
import { inr, num } from "@/lib/utils";
import { Truck, Fuel, Wrench, ShieldAlert, ShieldCheck, IndianRupee, AlertTriangle, LayoutDashboard, ArrowRight } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

function BigCard({ icon, label, hindi, value, sub, color, href }: { icon: React.ReactNode; label: string; hindi: string; value: string; sub?: string; color: string; href: string }) {
  return (
    <Link href={href} className={`flex items-center gap-4 rounded-3xl border-2 bg-white p-5 shadow-sm active:scale-[0.99] ${color}`}>
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-50">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-500">{hindi}</p>
        <p className="text-xs text-slate-400">{label}</p>
        <p className="mt-0.5 text-3xl font-extrabold text-ink-900">{value}</p>
        {sub && <p className="text-xs text-slate-400">{sub}</p>}
      </div>
      <ArrowRight className="h-5 w-5 shrink-0 text-slate-300" />
    </Link>
  );
}

export default async function SimpleView() {
  const user = await getSession();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  // eslint-disable-next-line react-hooks/purity
  const soon = new Date(Date.now() + 15 * 86400000);

  const [assets, issues, serviceDue, breakdowns, expiringDocs, monthIssues] = await Promise.all([
    db.asset.findMany(),
    db.fuelTransaction.findMany({ where: { type: "ISSUE" }, include: { asset: true } }),
    db.asset.count({ where: { serviceDueDate: { not: null, lte: soon } } }),
    db.asset.count({ where: { status: "Breakdown" } }),
    db.complianceDoc.count({ where: { status: { in: ["Expiring", "Expired"] } } }),
    db.fuelTransaction.findMany({ where: { type: "ISSUE", date: { gte: monthStart } } }),
  ]);

  const working = assets.filter((a) => a.status === "Active").length;
  const monthSpend = monthIssues.reduce((s, t) => s + t.amount, 0);
  const fleet = analyzeFleet(
    assets.map((a) => ({ id: a.id, code: a.code, name: a.name, assetClass: a.assetClass, category: a.category, primaryMeter: a.primaryMeter, fuelCapacity: a.fuelCapacity })),
    issues.map((t) => ({ id: t.id, assetId: t.assetId, quantity: t.quantity, meterValue: t.meterValue, rate: t.rate, amount: t.amount, date: t.date, odometerPhoto: t.odometerPhoto, pumpPhoto: t.pumpPhoto, sensorRise: t.sensorRise, anomaly: t.anomaly, variancePct: t.variancePct, geofenceOk: t.geofenceOk, lat: t.lat, lng: t.lng }))
  );
  const theft = fleet.highFlags.length;
  const atRisk = fleet.highFlags.reduce((s, f) => s + f.quantity, 0) * 92.5;

  // plain-language "needs attention" list
  const todo: { icon: string; text: string; href: string; bad: boolean }[] = [];
  if (theft > 0) todo.push({ icon: "🚨", text: `${theft} diesel bharaai shaq waale — jaanch karein (${theft} suspicious diesel fills — check)`, href: "/fuel", bad: true });
  if (breakdowns > 0) todo.push({ icon: "🛑", text: `${breakdowns} gaadi kharab — marammat karwayein (${breakdowns} vehicles broken down)`, href: "/maintenance", bad: true });
  if (serviceDue > 0) todo.push({ icon: "🛠️", text: `${serviceDue} gaadi ki service chahiye (${serviceDue} vehicles need service)`, href: "/notifications", bad: serviceDue > 5 });
  if (expiringDocs > 0) todo.push({ icon: "📄", text: `${expiringDocs} kagaz expire ho rahe — renew karein (${expiringDocs} documents expiring)`, href: "/compliance", bad: expiringDocs > 10 });
  if (todo.length === 0) todo.push({ icon: "✅", text: "Sab theek hai! Koi zaroori kaam nahi. (All good — nothing urgent.)", href: "/", bad: false });

  const summary = `Namaste. Aaj ki report. ${working} gaadi chal rahi hai. Is mahine ${Math.round(monthSpend / 100000)} lakh rupaye ka diesel. ${theft} diesel bharaai shaq waale. ${breakdowns} gaadi kharab. ${serviceDue} gaadi ki service chahiye. ${expiringDocs} kagaz expire ho rahe hain.`;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Namaste, {user?.name.split(" ")[0]} 👋</h1>
          <p className="text-sm text-slate-500">Aaj ki report · Today’s summary</p>
        </div>
        <div className="flex gap-2">
          <SpeakButton text={summary} label="🔊 सुनें · Listen" />
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <LayoutDashboard className="h-4 w-4" /> Detailed
          </Link>
        </div>
      </div>

      {/* Needs attention */}
      <div className="rounded-3xl bg-ink-900 p-5 text-white">
        <p className="mb-3 text-sm font-semibold text-slate-300">⭐ Aaj ka zaroori kaam · Needs your attention</p>
        <div className="space-y-2">
          {todo.map((t, i) => (
            <Link key={i} href={t.href} className={`flex items-center gap-3 rounded-2xl p-3 ${t.bad ? "bg-rose-500/20 ring-1 ring-rose-400/30" : "bg-white/5"}`}>
              <span className="text-2xl">{t.icon}</span>
              <span className="flex-1 text-sm font-medium">{t.text}</span>
              <ArrowRight className="h-4 w-4 text-slate-400" />
            </Link>
          ))}
        </div>
      </div>

      {/* Big simple cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BigCard icon={<IndianRupee className="h-8 w-8 text-brand-600" />} hindi="Is mahine diesel kharch" label="Diesel spend this month" value={inr(monthSpend, { compact: true })} color="border-slate-200" href="/fuel" />
        <BigCard icon={<ShieldAlert className="h-8 w-8 text-rose-600" />} hindi="Diesel chori ka shaq" label="Suspicious diesel fills" value={String(theft)} sub={atRisk > 0 ? `${inr(atRisk, { compact: true })} at risk` : "Sab theek"} color={theft > 0 ? "border-rose-300" : "border-emerald-200"} href="/fuel" />
        <BigCard icon={<Wrench className="h-8 w-8 text-amber-600" />} hindi="Service chahiye" label="Vehicles needing service" value={String(serviceDue)} color={serviceDue > 5 ? "border-rose-300" : serviceDue > 0 ? "border-amber-300" : "border-emerald-200"} href="/notifications" />
        <BigCard icon={<AlertTriangle className="h-8 w-8 text-rose-600" />} hindi="Kharab gaadi" label="Broken-down vehicles" value={String(breakdowns)} color={breakdowns > 0 ? "border-rose-300" : "border-emerald-200"} href="/maintenance" />
        <BigCard icon={<ShieldCheck className="h-8 w-8 text-violet-600" />} hindi="Kagaz expire ho rahe" label="Documents expiring" value={String(expiringDocs)} color={expiringDocs > 10 ? "border-rose-300" : expiringDocs > 0 ? "border-amber-300" : "border-emerald-200"} href="/compliance" />
        <BigCard icon={<Truck className="h-8 w-8 text-emerald-600" />} hindi="Chal rahi gaadi" label="Vehicles working now" value={`${working} / ${assets.length}`} color="border-slate-200" href="/tracking" />
      </div>

      {/* Big shortcuts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: "/tracking", icon: "🗺️", label: "Gaadi kahan hai" },
          { href: "/fuel", icon: "⛽", label: "Diesel" },
          { href: "/maintenance", icon: "🛠️", label: "Marammat" },
          { href: "/compliance", icon: "📄", label: "Kagaz" },
        ].map((s) => (
          <Link key={s.href} href={s.href} className="flex flex-col items-center gap-1 rounded-2xl bg-white p-4 text-center shadow-sm active:scale-95">
            <span className="text-3xl">{s.icon}</span>
            <span className="text-xs font-semibold text-slate-600">{s.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
