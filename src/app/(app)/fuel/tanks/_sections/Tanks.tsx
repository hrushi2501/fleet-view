import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, Progress, StatCard } from "@/components/ui";
import { TankForm, ReceiptForm, DipForm, RunReconButton, DeleteRow } from "@/components/FuelForms";
import { tankLedger, type LedgerRow } from "@/lib/fuel-recon";
import { inr, num, fmtDate } from "@/lib/utils";
import { getDieselRate } from "@/lib/settings";
import { Droplets, TriangleAlert, ArrowDownToLine, ArrowUpFromLine, Ruler, IndianRupee } from "lucide-react";
import Link from "next/link";

import { requirePage, assetScope, projectScope } from "@/lib/access";

/**
 * The site tanks themselves: what is in each one and what has moved through it.
 */
export async function Tanks() {
  const access = await requirePage("fuel.view");
  // Rows, not just the page: a scoped supervisor sees their own sites.
  const visible = assetScope(access);
  const visibleProjects = projectScope(access);
  const [tanks, projects, assets, dieselRate] = await Promise.all([
    db.fuelTank.findMany({
      include: {
        receipts: { orderBy: { date: "desc" } },
        dips: { orderBy: { date: "desc" } },
        issues: { where: { type: "ISSUE" }, orderBy: { date: "desc" } },
        project: true,
      },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({ where: visibleProjects, orderBy: { code: "asc" } }),
    db.asset.findMany({ where: visible, select: { id: true, code: true, registrationNo: true, name: true } }),
    getDieselRate(),
  ]);

  const projOpts = projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));
  const tankOpts = tanks.map((t) => ({ id: t.id, label: `${t.name} — ${t.location}` }));
  const assetName = new Map(assets.map((a) => [a.id, a.code]));
  const label = (id: string | null) => (id ? assetName.get(id) ?? "Unknown asset" : "Unlinked issue");

  const totalCapacity = tanks.reduce((s, t) => s + t.capacity, 0);
  const totalStock = tanks.reduce((s, t) => s + t.currentLevel, 0);
  const totalShortfall = tanks.reduce((s, t) => s + t.receipts.reduce((x, r) => x + r.shortfall, 0), 0);
  const belowReorder = tanks.filter((t) => t.minLevel > 0 && t.currentLevel < t.minLevel);

  return (
    <div className="space-y-6">

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Site Diesel Tanks</h2>
          <p className="text-sm text-slate-500">
            Every litre in and out, with the book balance checked against physical dips
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DipForm tanks={tankOpts} />
          <ReceiptForm tanks={tankOpts} defaultRate={dieselRate} />
          <TankForm projects={projOpts} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-4">
        <StatCard label="Tanks" value={num(tanks.length)} sub={`${num(totalCapacity)} L capacity`} accent="brand" icon={<Droplets className="h-5 w-5" />} />
        <StatCard label="Diesel in Stock" value={`${num(totalStock)} L`} sub={inr(totalStock * dieselRate, { compact: true })} accent="violet" icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Short Deliveries" value={`${num(totalShortfall)} L`} sub={inr(totalShortfall * dieselRate, { compact: true })} accent="rose" icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="Below Reorder" value={num(belowReorder.length)} sub={belowReorder.map((t) => t.name).join(", ") || "all healthy"} accent="amber" icon={<Ruler className="h-5 w-5" />} />
      </div>

      {tanks.length === 0 && (
        <Card>
          <div className="py-12 text-center">
            <Droplets className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-ink-900">No site tanks yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Add a tank to start the closed loop: deliveries in, issues out, dips to verify.
            </p>
          </div>
        </Card>
      )}

      {tanks.map((t) => {
        const ledger = tankLedger(
          t.openingLevel,
          t.receipts.map((r) => ({ id: r.id, date: r.date, qtyInvoiced: r.qtyInvoiced, qtyReceived: r.qtyReceived, amount: r.amount, supplier: r.supplier, shortfall: r.shortfall })),
          t.issues.map((i) => ({ id: i.id, date: i.date, quantity: i.quantity, assetId: i.assetId, amount: i.amount })),
          t.dips.map((p) => ({ id: p.id, date: p.date, level: p.level })),
          label
        );
        const pct = t.capacity > 0 ? (t.currentLevel / t.capacity) * 100 : 0;
        const shortfall = t.receipts.reduce((s, r) => s + r.shortfall, 0);
        const lastDip = t.dips[0] ?? null;
        const drift = ledger.find((r) => r.kind === "DIP")?.drift ?? null;

        return (
          <Card key={t.id} className="p-0">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-ink-900">{t.name}</h2>
                  {t.code && <Badge color="bg-slate-100 text-slate-600 ring-slate-500/20">{t.code}</Badge>}
                  {t.status !== "Active" && <Badge color="bg-slate-100 text-slate-500 ring-slate-400/20">Inactive</Badge>}
                  {t.minLevel > 0 && t.currentLevel < t.minLevel && (
                    <Badge color="bg-amber-100 text-amber-700 ring-amber-600/20">Below reorder</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-slate-500">
                  {t.location}
                  {t.project ? ` · ${t.project.code} ${t.project.name}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <RunReconButton tankId={t.id} tankName={t.name} />
                <TankForm
                  projects={projOpts}
                  tank={{ id: t.id, name: t.name, location: t.location, capacity: t.capacity, minLevel: t.minLevel, openingLevel: t.openingLevel, projectId: t.projectId, code: t.code }}
                />
              </div>
            </div>

            <div className="grid gap-5 p-5 lg:grid-cols-4">
              <div className="lg:col-span-1">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium text-ink-900">Current stock</span>
                  <span className="text-slate-500">{num(t.currentLevel)} / {num(t.capacity)} L</span>
                </div>
                <Progress value={pct} />
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Opening level</dt>
                    <dd className="font-medium text-ink-900">{num(t.openingLevel)} L</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Total received</dt>
                    <dd className="font-medium text-emerald-600">{num(t.receipts.reduce((s, r) => s + r.qtyReceived, 0))} L</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Total issued</dt>
                    <dd className="font-medium text-brand-700">{num(t.issues.reduce((s, i) => s + i.quantity, 0))} L</dd>
                  </div>
                  {shortfall > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Short delivered</dt>
                      <dd className="font-medium text-rose-600">{num(shortfall)} L</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Last dip</dt>
                    <dd className="font-medium text-ink-900">{lastDip ? `${num(lastDip.level)} L · ${fmtDate(lastDip.date)}` : "—"}</dd>
                  </div>
                  {drift != null && Math.abs(drift) >= 1 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Drift at last dip</dt>
                      <dd className={`font-bold ${drift < 0 ? "text-rose-600" : "text-amber-600"}`}>
                        {drift > 0 ? "+" : ""}{num(drift)} L
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="lg:col-span-3">
                <SectionTitle title="Tank In &amp; Out" subtitle="Newest first — a dipstick reading resets the book to the real amount" />
                <div className="mt-2 max-h-80 overflow-x-auto overflow-y-auto rounded-lg ring-1 ring-slate-100">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Date</th>
                        <th className="px-4 py-2.5 font-medium">Event</th>
                        <th className="px-4 py-2.5 font-medium">Detail</th>
                        <th className="px-4 py-2.5 text-right font-medium">In</th>
                        <th className="px-4 py-2.5 text-right font-medium">Out</th>
                        <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                        <th className="px-4 py-2.5 text-right font-medium">Drift</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.slice(0, 60).map((r: LedgerRow, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{fmtDate(r.date)}</td>
                          <td className="px-4 py-2.5">
                            {r.kind === "RECEIPT" && <span className="inline-flex items-center gap-1 text-emerald-600"><ArrowDownToLine className="h-3.5 w-3.5" /> In</span>}
                            {r.kind === "ISSUE" && <span className="inline-flex items-center gap-1 text-brand-700"><ArrowUpFromLine className="h-3.5 w-3.5" /> Issue</span>}
                            {r.kind === "DIP" && <span className="inline-flex items-center gap-1 text-slate-600"><Ruler className="h-3.5 w-3.5" /> Dip</span>}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{r.label}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-emerald-600">{r.inL ? num(r.inL) : ""}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-brand-700">{r.outL ? num(r.outL) : ""}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-ink-900">{num(r.balance)}</td>
                          <td className="px-4 py-2.5 text-right">
                            {r.drift == null ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              <span className={`font-bold ${r.drift < -5 ? "text-rose-600" : Math.abs(r.drift) <= 5 ? "text-emerald-600" : "text-amber-600"}`}>
                                {r.drift > 0 ? "+" : ""}{num(r.drift)} L
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {ledger.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No movements yet. Record a delivery or a dip to start the ledger.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {t.receipts.length > 0 && (
              <div className="border-t border-slate-100 p-5">
                <SectionTitle title="Deliveries" subtitle="Invoiced vs actually received — the short-delivery control" />
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Date</th>
                        <th className="px-4 py-2.5 font-medium">Supplier</th>
                        <th className="px-4 py-2.5 font-medium">Invoice</th>
                        <th className="px-4 py-2.5 font-medium">Tanker</th>
                        <th className="px-4 py-2.5 text-right font-medium">Invoiced</th>
                        <th className="px-4 py-2.5 text-right font-medium">Received</th>
                        <th className="px-4 py-2.5 text-right font-medium">Shortfall</th>
                        <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                        <th className="px-4 py-2.5 font-medium">Doc</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.receipts.slice(0, 25).map((r) => (
                        <tr key={r.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{fmtDate(r.date)}</td>
                          <td className="px-4 py-2.5 font-medium text-ink-900">{r.supplier}</td>
                          <td className="px-4 py-2.5 text-slate-600">{r.invoiceNo ?? "—"}</td>
                          <td className="px-4 py-2.5 text-slate-600">{r.tankerNo ?? "—"}</td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{num(r.qtyInvoiced)} L</td>
                          <td className="px-4 py-2.5 text-right font-medium text-ink-900">{num(r.qtyReceived)} L</td>
                          <td className="px-4 py-2.5 text-right">
                            {r.shortfall > 0 ? <span className="font-bold text-rose-600">{num(r.shortfall)} L</span> : <span className="text-emerald-600">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{inr(r.amount, { compact: true })}</td>
                          <td className="px-4 py-2.5">
                            {r.invoicePhoto ? (
                              <a href={r.invoicePhoto} target="_blank" rel="noreferrer">
                                <img src={r.invoicePhoto} alt="invoice" className="h-9 w-9 rounded object-cover ring-1 ring-slate-200" />
                              </a>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right"><DeleteRow id={r.id} kind="receipt" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {t.dips.length > 0 && (
              <div className="border-t border-slate-100 p-5">
                <SectionTitle title="Dip Readings" subtitle="Real measurements taken by hand — the books are checked against these" />
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Date</th>
                        <th className="px-4 py-2.5 text-right font-medium">Level</th>
                        <th className="px-4 py-2.5 font-medium">Read By</th>
                        <th className="px-4 py-2.5 font-medium">Note</th>
                        <th className="px-4 py-2.5 font-medium">Photo</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.dips.slice(0, 25).map((p) => (
                        <tr key={p.id} className="border-t border-slate-100 hover:bg-brand-50/30">
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{fmtDate(p.date)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-ink-900">{num(p.level)} L</td>
                          <td className="px-4 py-2.5 text-slate-600">{p.readBy ?? "—"}</td>
                          <td className="px-4 py-2.5 text-slate-500">{p.note ?? "—"}</td>
                          <td className="px-4 py-2.5">
                            {p.photo ? (
                              <a href={p.photo} target="_blank" rel="noreferrer">
                                <img src={p.photo} alt="dip" className="h-9 w-9 rounded object-cover ring-1 ring-slate-200" />
                              </a>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right"><DeleteRow id={p.id} kind="dip" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        );
      })}

      <p className="text-center text-xs text-slate-400">
        Reconciliation results appear in the{" "}
        <Link href="/fuel/tanks?tab=stock" className="font-medium text-brand-600 hover:underline">Stock Check</Link>
        {" · "}
        Flagged gaps go to the{" "}
        <Link href="/fuel/problems" className="font-medium text-brand-600 hover:underline">Fuel Problems</Link>
      </p>
    </div>
  );
}
