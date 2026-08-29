import { db } from "@/lib/db";
import { Card, SectionTitle, StatCard, Badge } from "@/components/ui";
import { inr, num, fmtDate, distanceKm } from "@/lib/utils";
import { getDieselRate } from "@/lib/settings";
import { Fuel, Truck, MapPin, IndianRupee, Clock, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { requirePage, assetScope } from "@/lib/access";
import { detectFills } from "@/lib/fuel-fill-reconcile";

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

  // What the tanks actually saw, matched against what was written down. The
  // screen claimed to show "every fill" while reading only the keyed table, so
  // a fill nobody entered could not appear on it at all.
  const { fills: detected, unreliable: unreliableSenders } = await detectFills(visible, dieselRate, 7);
  const unlogged = detected.filter((f) => !f.logged);
  const unloggedValue = unlogged.reduce((s, f) => s + f.estimatedValue, 0);
  // Litres the tanks received with no entry behind them. Added to the headline
  // rather than left out of it: "how much diesel went into the trucks" is
  // answered by what the tanks actually took, and a total that silently omits a
  // 235 L fill is wrong in the direction that matters.
  const unloggedLitres = unlogged.reduce((s, f) => s + f.litresAdded, 0);

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
        <StatCard
          label="Recent Fuel Spend"
          value={inr(totalSpend, { compact: true })}
          sub={unloggedLitres > 0 ? `logged fills only · ${num(unloggedLitres)} L unpriced` : undefined}
          accent="brand"
          icon={<IndianRupee className="h-5 w-5" />}
        />
        <StatCard
          label="Total Diesel Issued"
          value={`${num(totalLitres + unloggedLitres)} L`}
          sub={
            unloggedLitres > 0
              ? `${num(totalLitres)} L logged + ${num(unloggedLitres)} L sensor-only`
              : "all from logged entries"
          }
          accent="violet"
          icon={<Fuel className="h-5 w-5" />}
        />
        <StatCard label="Active Fleet Vehicles" value={num(assets.length)} accent="emerald" icon={<Truck className="h-5 w-5" />} />
        <StatCard label="Site Diesel Tanks" value={num(tanks.length)} accent="amber" icon={<MapPin className="h-5 w-5" />} />
      </div>

      {unlogged.length > 0 && (
        <Card className="p-0 ring-1 ring-amber-200">
          <div className="p-5 pb-3">
            <SectionTitle
              title={`${unlogged.length} fill${unlogged.length === 1 ? "" : "s"} the tank saw but nobody logged`}
              subtitle={
                "Detected from the fuel sensor over the last 7 days, with no matching entry in Fill History. " +
                "Usually a receipt not yet entered, or diesel drawn from a site tank — worth confirming while the day is still fresh." +
                (unreliableSenders.length > 0
                  ? ` ${unreliableSenders.map((u) => u.assetCode).join(", ")} ${unreliableSenders.length === 1 ? "is" : "are"} excluded: the tank sender contradicts itself, so no fill it appears to show can be believed.`
                  : "")
              }
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-amber-50/60 text-left text-xs uppercase tracking-wider text-amber-800">
                <tr>
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-5 py-3 font-medium">Vehicle</th>
                  <th className="px-5 py-3 font-medium">Litres</th>
                  <th className="px-5 py-3 font-medium">Tank went</th>
                  <th className="px-5 py-3 font-medium">Approx. value</th>
                  <th className="px-5 py-3 font-medium">Where</th>
                  <th className="px-5 py-3 font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {unlogged.map((f) => (
                  <tr key={`${f.assetId}-${f.at.toISOString()}`} className="border-t border-amber-100 hover:bg-amber-50/40">
                    <td className="px-5 py-3 whitespace-nowrap text-xs text-slate-600">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        {fmtDate(f.at)}
                      </div>
                    </td>
                    <td className="px-5 py-3 font-semibold text-brand-700">
                      <Link href={`/fleet/${f.assetId}`} className="hover:underline">
                        {f.assetCode} ({f.registrationNo ?? "—"})
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-bold text-ink-900">{num(f.litresAdded)} L</td>
                    <td className="px-5 py-3 text-slate-600">
                      {f.fromL != null && f.toL != null ? `${num(f.fromL)} → ${num(f.toL)} L` : "—"}
                    </td>
                    <td className="px-5 py-3 font-medium text-ink-900">
                      {inr(f.estimatedValue, { compact: true })}
                    </td>
                    <td className="px-5 py-3">
                      {f.lat != null && f.lng != null ? (
                        <a href={`https://www.google.com/maps?q=${f.lat},${f.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                          <MapPin className="h-3.5 w-3.5" /> Map
                        </a>
                      ) : (
                        <span className="text-slate-300">No GPS</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge
                        color={
                          f.confidence === "HIGH"
                            ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20"
                            : f.confidence === "MEDIUM"
                              ? "bg-amber-100 text-amber-700 ring-amber-600/20"
                              : "bg-slate-100 text-slate-600 ring-slate-500/20"
                        }
                      >
                        {f.confidence}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-amber-100 bg-amber-50/40 px-5 py-3 text-xs text-amber-900">
            <ShieldAlert className="mr-1 inline h-3.5 w-3.5" />
            About {inr(unloggedValue, { compact: true })} of diesel at the current rate. This is fuel that
            physically moved without paperwork behind it — not evidence of loss, but a question worth answering.
          </div>
        </Card>
      )}

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
