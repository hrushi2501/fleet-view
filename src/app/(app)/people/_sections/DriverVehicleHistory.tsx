import Link from "next/link";
import { Link2 } from "lucide-react";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { db } from "@/lib/db";
import { fmtDate, timeAgo } from "@/lib/utils";

/**
 * The operational record of who drove what. `Asset.driverId` is the current
 * handover; `TripSession` is the durable, scanned record of what actually
 * happened. Keeping both views here makes the mapping inspectable in either
 * direction without rewriting history when the next shift starts.
 */
export async function DriverVehicleHistory() {
  const [drivers, assets, sessions] = await Promise.all([
    db.driver.findMany({
      orderBy: { name: "asc" },
      select: { id: true, empCode: true, name: true, type: true, status: true, assets: { select: { id: true, code: true, registrationNo: true } } },
    }),
    db.asset.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, registrationNo: true, assetClass: true, driver: { select: { id: true, empCode: true, name: true } } },
    }),
    db.tripSession.findMany({
      orderBy: { startedAt: "desc" },
      take: 250,
      select: {
        id: true, startedAt: true, endedAt: true, status: true, scanMethod: true, endedBy: true, distanceKm: true,
        driver: { select: { id: true, empCode: true, name: true } },
        asset: { select: { id: true, code: true, registrationNo: true } },
      },
    }),
  ]);

  const activeByDriver = new Map(sessions.filter((s) => s.status === "ACTIVE").map((s) => [s.driver.id, s]));
  const activeByAsset = new Map(sessions.filter((s) => s.status === "ACTIVE").map((s) => [s.asset.id, s]));

  return <div className="space-y-6">
    <Card className="border-brand-200 bg-brand-50/30">
      <div className="flex gap-3"><Link2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" /><div><h2 className="text-base font-bold text-ink-900">Driver ↔ vehicle records</h2><p className="mt-1 text-sm text-slate-600">Current allocation tells you who is responsible now. Each QR start and QR end becomes an immutable trip-session record below, so a later reassignment never erases the operational history.</p></div></div>
    </Card>

    <Card className="p-0"><div className="p-5 pb-3"><SectionTitle title="Driver → Current vehicle" subtitle="Who each driver is currently assigned to, plus any live QR trip" /></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 font-medium">Driver</th><th className="px-5 py-3 font-medium">Current vehicle</th><th className="px-5 py-3 font-medium">Live trip</th><th className="px-5 py-3 font-medium">Record status</th></tr></thead><tbody>{drivers.map((driver) => { const live = activeByDriver.get(driver.id); return <tr key={driver.id} className="border-t border-slate-100 hover:bg-brand-50/30"><td className="px-5 py-3"><p className="font-semibold text-ink-900">{driver.name}</p><p className="text-xs text-slate-500">{driver.empCode} · {driver.type}</p></td><td className="px-5 py-3">{driver.assets.length ? <div className="space-y-1">{driver.assets.map((asset) => <Link key={asset.id} href={`/fleet/${asset.id}`} className="block font-semibold text-brand-700 hover:underline">{asset.code}<span className="ml-1 font-normal text-slate-400">{asset.registrationNo ?? ""}</span></Link>)}</div> : <span className="text-slate-400">No current allocation</span>}</td><td className="px-5 py-3">{live ? <><Link href={`/fleet/${live.asset.id}`} className="font-semibold text-emerald-700 hover:underline">{live.asset.code}</Link><p className="text-xs text-slate-500">Started {timeAgo(live.startedAt)}</p></> : <span className="text-slate-400">No active QR trip</span>}</td><td className="px-5 py-3"><Badge color={driver.status === "Active" ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20"}>{driver.status}</Badge></td></tr>; })}{drivers.length === 0 && <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">No drivers on record.</td></tr>}</tbody></table></div></Card>

    <Card className="p-0"><div className="p-5 pb-3"><SectionTitle title="Vehicle → Current driver" subtitle="The same allocation viewed from the vehicle side" /></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 font-medium">Vehicle</th><th className="px-5 py-3 font-medium">Assigned driver</th><th className="px-5 py-3 font-medium">Live trip</th><th className="px-5 py-3 font-medium">Class</th></tr></thead><tbody>{assets.map((asset) => { const live = activeByAsset.get(asset.id); return <tr key={asset.id} className="border-t border-slate-100 hover:bg-brand-50/30"><td className="px-5 py-3"><Link href={`/fleet/${asset.id}`} className="font-semibold text-brand-700 hover:underline">{asset.code}</Link><p className="text-xs text-slate-500">{asset.registrationNo ?? "No registration recorded"}</p></td><td className="px-5 py-3">{asset.driver ? <><p className="font-semibold text-ink-900">{asset.driver.name}</p><p className="text-xs text-slate-500">{asset.driver.empCode}</p></> : <span className="text-slate-400">Unassigned</span>}</td><td className="px-5 py-3">{live ? <><p className="font-semibold text-emerald-700">{live.driver.name}</p><p className="text-xs text-slate-500">Started {timeAgo(live.startedAt)}</p></> : <span className="text-slate-400">No active QR trip</span>}</td><td className="px-5 py-3 text-slate-600">{asset.assetClass}</td></tr>; })}</tbody></table></div></Card>

    <Card className="p-0"><div className="p-5 pb-3"><SectionTitle title="QR trip record" subtitle="Latest 250 start/end records — this is the permanent driver and vehicle history" /></div><div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 font-medium">Driver</th><th className="px-5 py-3 font-medium">Vehicle</th><th className="px-5 py-3 font-medium">Started by QR</th><th className="px-5 py-3 font-medium">Ended by QR</th><th className="px-5 py-3 text-right font-medium">Distance</th><th className="px-5 py-3 font-medium">Status</th></tr></thead><tbody>{sessions.map((session) => <tr key={session.id} className="border-t border-slate-100 hover:bg-brand-50/30"><td className="px-5 py-3"><p className="font-semibold text-ink-900">{session.driver.name}</p><p className="text-xs text-slate-500">{session.driver.empCode}</p></td><td className="px-5 py-3"><Link href={`/fleet/${session.asset.id}`} className="font-semibold text-brand-700 hover:underline">{session.asset.code}</Link><p className="text-xs text-slate-500">{session.asset.registrationNo ?? ""}</p></td><td className="px-5 py-3 whitespace-nowrap text-slate-600">{fmtDate(session.startedAt)}<p className="text-xs text-slate-400">{session.scanMethod}</p></td><td className="px-5 py-3 whitespace-nowrap text-slate-600">{session.endedAt ? fmtDate(session.endedAt) : "—"}<p className="text-xs text-slate-400">{session.endedBy ? `by ${session.endedBy.toLowerCase()}` : "still active"}</p></td><td className="px-5 py-3 text-right font-medium text-ink-900">{session.distanceKm ? `${session.distanceKm.toFixed(1)} km` : "—"}</td><td className="px-5 py-3"><Badge color={session.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : session.status === "COMPLETED" ? "bg-slate-100 text-slate-600 ring-slate-500/20" : "bg-amber-100 text-amber-700 ring-amber-600/20"}>{session.status}</Badge></td></tr>)}{sessions.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">No QR trip records yet.</td></tr>}</tbody></table></div></Card>
  </div>;
}
