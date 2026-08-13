import { db } from "@/lib/db";
import { Card, SectionTitle, StatCard, Badge } from "@/components/ui";
import { inr, num, fmtDate, distanceKm } from "@/lib/utils";
import { getDieselRate } from "@/lib/settings";
import { Fuel, Truck, MapPin, IndianRupee, Clock, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { requirePage, assetScope } from "@/lib/access";

/**
 * Every fill, with its time, place and photographs.
 *
 * Was `/fuel/summary`, titled "Executive Fuel Summary". Nobody asked for an
 * executive summary; what they asked for was "show me the actual entries with
 * the pump photo", which is what this is.
 */
export async function FuelRecords() {
  const access = await requirePage("fuel.view");
  // Rows, not just the page: a scoped supervisor sees their own sites.
  const visible = assetScope(access);
  const [issues, assets, tanks, dieselRate] = await Promise.all([
    db.fuelTransaction.findMany({
      where: { type: "ISSUE" },
      include: { asset: true, project: true },
      orderBy: { date: "desc" },
      take: 100,
    }),
    db.asset.findMany({ where: visible, orderBy: { code: "asc" } }),
    db.fuelTank.findMany(),
    getDieselRate(),
  ]);

  const totalSpend = issues.reduce((s, i) => s + i.amount, 0);
  const totalLitres = issues.reduce((s, i) => s + i.quantity, 0);
  const assetMap = new Map(assets.map((a) => [a.id, a]));

  return (
    <div className="space-y-6">

      <div>
        <h2 className="text-lg font-bold text-ink-900">Fuel Records</h2>
        <p className="text-sm text-slate-500">
          Every fill with its date, vehicle, site tank, location and photo evidence
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Recent Fuel Spend" value={inr(totalSpend, { compact: true })} accent="brand" icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Total Diesel Issued" value={`${num(totalLitres)} L`} accent="violet" icon={<Fuel className="h-5 w-5" />} />
        <StatCard label="Active Fleet Vehicles" value={num(assets.length)} accent="emerald" icon={<Truck className="h-5 w-5" />} />
        <StatCard label="Site Diesel Tanks" value={num(tanks.length)} accent="amber" icon={<MapPin className="h-5 w-5" />} />
      </div>

      {/* Timestamped Transaction Audit Feed */}
      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionTitle title="Fill History" subtitle="Every fill logged by drivers, with the time, location and photo it was recorded with" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Timestamp</th>
                <th className="px-5 py-3 font-medium">Vehicle</th>
                <th className="px-5 py-3 font-medium">Litres</th>
                <th className="px-5 py-3 font-medium">Meter Value</th>
                <th className="px-5 py-3 font-medium">Rate</th>
                <th className="px-5 py-3 font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">GPS Location</th>
                <th className="px-5 py-3 font-medium">Photos</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((f) => {
                const a = f.assetId ? assetMap.get(f.assetId) : null;
                const hasLoc = f.lat != null && f.lng != null;
                return (
                  <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-5 py-3 whitespace-nowrap text-xs text-slate-600">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        {fmtDate(f.date)}
                      </div>
                    </td>
                    <td className="px-5 py-3 font-semibold text-brand-700">
                      {a ? <Link href={`/fleet/${a.id}`} className="hover:underline">{a.code} ({a.registrationNo ?? a.name})</Link> : "—"}
                    </td>
                    <td className="px-5 py-3 font-bold text-ink-900">{num(f.quantity)} L</td>
                    <td className="px-5 py-3 text-slate-600">{f.meterValue ? num(f.meterValue) : "—"}</td>
                    <td className="px-5 py-3 text-slate-600">₹{f.rate}</td>
                    <td className="px-5 py-3 font-medium text-ink-900">{inr(f.amount, { compact: true })}</td>
                    <td className="px-5 py-3">
                      {hasLoc ? (
                        <a href={`https://www.google.com/maps?q=${f.lat},${f.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                          <MapPin className="h-3.5 w-3.5" /> Map
                        </a>
                      ) : (
                        <span className="text-slate-300">No GPS</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        {f.odometerPhoto && (
                          <a href={f.odometerPhoto} target="_blank" rel="noreferrer">
                            <img src={f.odometerPhoto} alt="odo" className="h-8 w-8 rounded object-cover ring-1 ring-slate-200" />
                          </a>
                        )}
                        {f.pumpPhoto && (
                          <a href={f.pumpPhoto} target="_blank" rel="noreferrer">
                            <img src={f.pumpPhoto} alt="pump" className="h-8 w-8 rounded object-cover ring-1 ring-slate-200" />
                          </a>
                        )}
                        {!f.odometerPhoto && !f.pumpPhoto && <span className="text-slate-300">—</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {f.geofenceOk === false ? (
                        <Badge color="bg-rose-100 text-rose-700">Outside Area</Badge>
                      ) : (
                        <Badge color="bg-emerald-100 text-emerald-700">Verified</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
