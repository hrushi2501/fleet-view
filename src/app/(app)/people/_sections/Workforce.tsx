import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { StatCard, Card, SectionTitle, Badge, Progress } from "@/components/ui";
import { DriverEntry, DeleteButton } from "@/components/EntryForms";
import { CompetencyForm, ViolationForm, ViolationAction, DeleteRow } from "@/components/PeopleDocForms";
import {
  driverScorecard,
  eligibility,
  VIOLATION_LABEL,
  type DriverLite,
  type ViolationLite,
  type CompetencyLite,
} from "@/lib/drivers";
import { num, fmtDate, inr, ASSET_CLASS_LABEL } from "@/lib/utils";
import {
  Users,
  ShieldCheck,
  Award,
  TriangleAlert,
  IdCard,
  Ban,
  IndianRupee,
} from "lucide-react";
import Link from "next/link";
import { requirePage, assetScope, projectScope } from "@/lib/access";

// Row types derived from Prisma — keeps callback params fully typed without spreading `any`.
type DriverRow = Prisma.DriverGetPayload<Record<string, never>>;
type ViolationRow = Prisma.ViolationGetPayload<{ include: { driver: true; asset: true } }>;
type CompetencyRow = Prisma.CompetencyGetPayload<Record<string, never>>;
type AssetRow = Prisma.AssetGetPayload<Record<string, never>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreColor(s: number) {
  return s >= 80 ? "text-emerald-600" : s >= 65 ? "text-amber-600" : "text-rose-600";
}

const BAND: Record<string, string> = {
  excellent: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  good: "bg-brand-100 text-brand-700 ring-brand-600/20",
  watch: "bg-amber-100 text-amber-700 ring-amber-600/20",
  critical: "bg-rose-100 text-rose-700 ring-rose-600/20",
};

const SEV: Record<string, string> = {
  MINOR: "bg-slate-100 text-slate-600 ring-slate-500/20",
  MAJOR: "bg-amber-100 text-amber-700 ring-amber-600/20",
  CRITICAL: "bg-rose-100 text-rose-700 ring-rose-600/20",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * The workforce itself — who drives, what they are licensed for, how they drive.
 *
 * Was `/drivers`. It already carried its own two tabs; the module now owns the
 * tab strip, so this takes the active one as a prop instead of reading the URL
 * twice and drawing a second row of tabs under the first.
 */
export async function Workforce({ tab }: { tab: string }) {
  const access = await requirePage("people.view");
  // Rows, not just the page: a scoped supervisor sees their own sites.
  const visible = assetScope(access);
  const visibleProjects = projectScope(access);
  const activeTab = tab === "safety" ? "safety" : "overview";

  // Single data fetch for both tabs — avoids redundant DB round-trips on tab switch
  const [drivers, violations, competencies, assets]: [
    DriverRow[],
    ViolationRow[],
    CompetencyRow[],
    AssetRow[],
  ] = await Promise.all([
    db.driver.findMany({ orderBy: { safetyScore: "desc" } }),
    db.violation.findMany({
      include: { driver: true, asset: true },
      orderBy: { date: "desc" },
      take: 300,
    }),
    db.competency.findMany(),
    db.asset.findMany({ where: visible, orderBy: { code: "asc" } }),
  ]);

  // ---- Derived data used by Overview tab ----
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const operatorCount = drivers.filter((d) => d.type === "OPERATOR").length;
  const avgSafety =
    drivers.length > 0
      ? Math.round(drivers.reduce((s, d) => s + d.safetyScore, 0) / drivers.length)
      : 0;
  const avgPerf =
    drivers.length > 0
      ? Math.round(drivers.reduce((s, d) => s + d.performanceScore, 0) / drivers.length)
      : 0;
  const expiringSoon = drivers.filter(
    (d) => (new Date(d.licenseExpiry).getTime() - nowMs) / 86400000 < 30
  ).length;
  // drivers is already sorted by safetyScore desc from the DB query — slice is sufficient.
  const top = drivers.slice(0, 3);

  // ---- Derived data used by Safety & Competency tab ----
  const driverOpts = drivers.map((d) => ({ id: d.id, label: `${d.empCode} — ${d.name}` }));
  const assetOpts = assets.map((a) => ({
    id: a.id,
    label: `${a.code} — ${a.registrationNo ?? a.name}`,
  }));
  const classOpts = Object.entries(ASSET_CLASS_LABEL).map(([value, label]) => ({
    value,
    label,
  }));

  const vByDriver = new Map<string, ViolationLite[]>();
  for (const v of violations) {
    const arr = vByDriver.get(v.driverId) ?? [];
    arr.push({
      id: v.id,
      type: v.type,
      severity: v.severity,
      points: v.points,
      date: v.date,
      penalty: v.penalty,
      status: v.status,
    });
    vByDriver.set(v.driverId, arr);
  }

  const cByDriver = new Map<string, CompetencyLite[]>();
  for (const c of competencies) {
    const arr = cByDriver.get(c.driverId) ?? [];
    arr.push({ assetClass: c.assetClass, level: c.level, expiresOn: c.expiresOn });
    cByDriver.set(c.driverId, arr);
  }

  const scorecards = drivers
    .map((d) => {
      const lite: DriverLite = {
        id: d.id,
        empCode: d.empCode,
        name: d.name,
        type: d.type,
        licenseNo: d.licenseNo,
        licenseExpiry: d.licenseExpiry,
        status: d.status,
      };
      return driverScorecard(lite, vByDriver.get(d.id) ?? [], cByDriver.get(d.id) ?? []);
    })
    .sort((a, b) => a.score - b.score);

  // Drivers currently assigned to machines they aren't cleared for
  const ineligible = assets
    .filter((a) => a.driverId)
    .map((a) => {
      const d = drivers.find((x) => x.id === a.driverId);
      if (!d) return null;
      const lite: DriverLite = {
        id: d.id,
        empCode: d.empCode,
        name: d.name,
        type: d.type,
        licenseNo: d.licenseNo,
        licenseExpiry: d.licenseExpiry,
        status: d.status,
      };
      const card = scorecards.find((c) => c.driver.id === d.id);
      // Guard: if the driver record was deleted between the two queries, skip.
      if (!card) return null;
      const el = eligibility(lite, a.assetClass, cByDriver.get(d.id) ?? [], card.score);
      return el.eligible ? null : { asset: a, driver: d, result: el };
    })
    .filter(Boolean) as {
      asset: (typeof assets)[number];
      driver: (typeof drivers)[number];
      result: ReturnType<typeof eligibility>;
    }[];

  const expiredLic = scorecards.filter((c) => c.licenceState === "expired").length;
  const criticalScores = scorecards.filter((c) => c.band === "critical").length;
  const openViolations = violations.filter((v) => v.status === "OPEN").length;
  const totalPenalties = violations
    .filter((v) => v.status !== "DISMISSED")
    .reduce((s, v) => s + v.penalty, 0);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Drivers &amp; Operators</h2>
          <p className="text-sm text-slate-500">
            Profiles, licences, safety record and performance
          </p>
        </div>
        {/* Action buttons depend on active tab */}
        {activeTab === "overview" ? (
          <DriverEntry />
        ) : (
          <div className="flex flex-wrap gap-2">
            <CompetencyForm drivers={driverOpts} classes={classOpts} />
            <ViolationForm drivers={driverOpts} assets={assetOpts} />
          </div>
        )}
      </div>

      {/* ================================================================
          TAB: OVERVIEW
          ================================================================ */}
      {activeTab === "overview" && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Total Workforce"
              value={num(drivers.length)}
              sub={`${operatorCount} operators, ${drivers.length - operatorCount} drivers`}
              accent="brand"
              icon={<Users className="h-5 w-5" />}
            />
            <StatCard
              label="Avg Safety Score"
              value={`${avgSafety}`}
              sub="Fleet-wide"
              accent="emerald"
              icon={<ShieldCheck className="h-5 w-5" />}
            />
            <StatCard
              label="Avg Performance"
              value={`${avgPerf}`}
              sub="Fleet-wide"
              accent="violet"
              icon={<Award className="h-5 w-5" />}
            />
            <StatCard
              label="License Expiring"
              value={num(expiringSoon)}
              sub="Within 30 days"
              accent="amber"
              icon={<TriangleAlert className="h-5 w-5" />}
            />
          </div>

          {/* Top 3 performers */}
          <div className="grid gap-4 lg:grid-cols-3">
            {top.map((d, i) => (
              <Card key={d.id} className="relative overflow-hidden">
                <div className="absolute right-4 top-4 text-3xl">
                  {["🥇", "🥈", "🥉"][i]}
                </div>
                <p className="text-xs uppercase tracking-wider text-slate-400">
                  Top Performer #{i + 1}
                </p>
                <p className="mt-1 text-lg font-bold text-ink-900">{d.name}</p>
                <p className="text-xs text-slate-400">
                  {d.empCode} · {d.type}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-400">Safety</p>
                    <p className={`text-lg font-bold ${scoreColor(d.safetyScore)}`}>
                      {d.safetyScore}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Performance</p>
                    <p className={`text-lg font-bold ${scoreColor(d.performanceScore)}`}>
                      {d.performanceScore}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Workforce directory table */}
          <Card className="p-0">
            <div className="p-5 pb-3">
              <SectionTitle title="Workforce Directory" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Name</th>
                    <th className="px-5 py-3 font-medium">Code</th>
                    <th className="px-5 py-3 font-medium">Type</th>
                    <th className="px-5 py-3 font-medium">License Expiry</th>
                    <th className="px-5 py-3 font-medium">Attendance</th>
                    <th className="px-5 py-3 font-medium">Safety</th>
                    <th className="px-5 py-3 font-medium">Performance</th>
                    <th className="px-5 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d) => {
                    const days =
                      (new Date(d.licenseExpiry).getTime() - nowMs) / 86400000;
                    return (
                      <tr
                        key={d.id}
                        className="border-t border-slate-100 hover:bg-brand-50/30"
                      >
                        <td className="px-5 py-3 font-medium text-ink-900">{d.name}</td>
                        <td className="px-5 py-3 text-slate-500">{d.empCode}</td>
                        <td className="px-5 py-3">
                          <Badge
                            color={
                              d.type === "OPERATOR"
                                ? "bg-violet-50 text-violet-700 ring-violet-600/20"
                                : "bg-brand-50 text-brand-700 ring-brand-600/20"
                            }
                          >
                            {d.type}
                          </Badge>
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={
                              days < 0
                                ? "font-medium text-rose-600"
                                : days < 30
                                  ? "font-medium text-amber-600"
                                  : "text-slate-600"
                            }
                          >
                            {fmtDate(d.licenseExpiry)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <Progress value={d.attendance} className="w-14" />
                            <span className="text-xs text-slate-500">{d.attendance}%</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`font-bold ${scoreColor(d.safetyScore)}`}>
                            {d.safetyScore}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`font-bold ${scoreColor(d.performanceScore)}`}>
                            {d.performanceScore}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex gap-1.5">
                            <DriverEntry
                              driver={{
                                id: d.id,
                                empCode: d.empCode,
                                name: d.name,
                                phone: d.phone,
                                type: d.type,
                                licenseNo: d.licenseNo,
                                licenseExpiry: new Date(d.licenseExpiry).toISOString(),
                                certifications: d.certifications,
                                safetyScore: d.safetyScore,
                                performanceScore: d.performanceScore,
                                attendance: d.attendance,
                                status: d.status,
                              }}
                            />
                            <DeleteButton kind="driver" id={d.id} label={d.name} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {drivers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-10 text-center text-slate-400">
                        No drivers on record.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ================================================================
          TAB: SAFETY & COMPETENCY
          ================================================================ */}
      {activeTab === "safety" && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard
              label="People"
              value={num(drivers.length)}
              sub={`${num(competencies.length)} competencies`}
              accent="brand"
              icon={<IdCard className="h-5 w-5" />}
            />
            <StatCard
              label="Critical Scores"
              value={num(criticalScores)}
              sub="below 50"
              accent="rose"
              icon={<TriangleAlert className="h-5 w-5" />}
            />
            <StatCard
              label="Expired Licences"
              value={num(expiredLic)}
              sub="must not be assigned"
              accent="rose"
              icon={<Ban className="h-5 w-5" />}
            />
            <StatCard
              label="Open Violations"
              value={num(openViolations)}
              sub={`${num(violations.length)} total`}
              accent="amber"
              icon={<ShieldCheck className="h-5 w-5" />}
            />
            <StatCard
              label="Penalties"
              value={inr(totalPenalties, { compact: true })}
              sub="levied"
              accent="violet"
              icon={<IndianRupee className="h-5 w-5" />}
            />
          </div>

          {/* Eligibility warnings */}
          {ineligible.length > 0 && (
            <Card className="border-rose-200 p-0">
              <div className="flex items-center gap-2 p-5 pb-3">
                <Ban className="h-5 w-5 text-rose-600" />
                <SectionTitle
                  title="Assigned But Not Eligible"
                  subtitle="These people are currently on machines they are not cleared to operate"
                />
              </div>
              <div className="divide-y divide-slate-100">
                {ineligible.map(({ asset, driver, result }) => (
                  <div key={asset.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/fleet/${asset.id}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {asset.code}
                      </Link>
                      <span className="text-sm text-slate-500">
                        {ASSET_CLASS_LABEL[asset.assetClass] ?? asset.assetClass}
                      </span>
                      <span className="text-sm font-medium text-ink-900">
                        ← {driver.name}
                      </span>
                    </div>
                    <ul className="mt-1 list-inside list-disc text-sm text-rose-700">
                      {result.blockers.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Driver scorecards table */}
          <Card className="p-0">
            <div className="p-5 pb-3">
              <SectionTitle
                title="Driver Scorecards"
                subtitle="Lowest score first — points decay over a year so people can recover"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Person</th>
                    <th className="px-5 py-3 font-medium">Score</th>
                    <th className="px-5 py-3 font-medium">Licence</th>
                    <th className="px-5 py-3 font-medium">Cleared For</th>
                    <th className="px-5 py-3 text-right font-medium">Violations</th>
                    <th className="px-5 py-3 text-right font-medium">Penalties</th>
                    <th className="px-5 py-3 font-medium">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecards.map((c) => (
                    <tr
                      key={c.driver.id}
                      className="border-t border-slate-100 align-top hover:bg-brand-50/30"
                    >
                      <td className="px-5 py-3">
                        <span className="font-semibold text-ink-900">{c.driver.name}</span>
                        <p className="text-xs text-slate-400">
                          {c.driver.empCode} · {c.driver.type}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        <div className="w-24">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="text-lg font-bold text-ink-900">{c.score}</span>
                            <Badge color={BAND[c.band]}>{c.band}</Badge>
                          </div>
                          <Progress value={c.score} />
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={
                            c.licenceState === "expired"
                              ? "font-semibold text-rose-600"
                              : c.licenceState === "expiring"
                                ? "font-medium text-amber-600"
                                : "text-slate-600"
                          }
                        >
                          {c.licenceState === "expired"
                            ? `Expired ${Math.abs(c.licenceDays)}d ago`
                            : `${c.licenceDays}d left`}
                        </span>
                        <p className="text-xs text-slate-400">{c.driver.licenseNo}</p>
                      </td>
                      <td className="px-5 py-3">
                        {c.competencies.length ? (
                          <div className="flex max-w-xs flex-wrap gap-1">
                            {c.competencies.map((k) => (
                              <Badge
                                key={k.assetClass}
                                color="bg-slate-100 text-slate-600 ring-slate-500/20"
                              >
                                {ASSET_CLASS_LABEL[k.assetClass] ?? k.assetClass}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-rose-600">none recorded</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="font-medium text-ink-900">{c.violations}</span>
                        {c.recentViolations > 0 && (
                          <p className="text-xs text-amber-600">{c.recentViolations} in 90d</p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-600">
                        {c.penalties > 0 ? inr(c.penalties, { compact: true }) : "—"}
                      </td>
                      <td className="px-5 py-3">
                        {c.flags.length ? (
                          <ul className="max-w-xs list-inside list-disc text-xs text-slate-500">
                            {c.flags.map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        ) : (
                          <Badge color="bg-emerald-100 text-emerald-700 ring-emerald-600/20">
                            Clear
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                  {scorecards.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                        No drivers on record.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Violation log table */}
          <Card className="p-0">
            <div className="p-5 pb-3">
              <SectionTitle
                title="Violation Log"
                subtitle="Dismissed events stop counting toward the score"
              />
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Date</th>
                    <th className="px-5 py-2.5 font-medium">Person</th>
                    <th className="px-5 py-2.5 font-medium">Type</th>
                    <th className="px-5 py-2.5 font-medium">Severity</th>
                    <th className="px-5 py-2.5 text-right font-medium">Points</th>
                    <th className="px-5 py-2.5 font-medium">Machine</th>
                    <th className="px-5 py-2.5 text-right font-medium">Penalty</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {violations.map((v) => (
                    <tr
                      key={v.id}
                      className={`border-t border-slate-100 ${v.status === "DISMISSED" ? "opacity-50" : ""}`}
                    >
                      <td className="whitespace-nowrap px-5 py-2.5 text-slate-600">
                        {fmtDate(v.date)}
                      </td>
                      <td className="px-5 py-2.5 font-medium text-ink-900">
                        {v.driver.name}
                      </td>
                      <td className="px-5 py-2.5 text-slate-600">
                        {VIOLATION_LABEL[v.type] ?? v.type}
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge color={SEV[v.severity] ?? SEV.MINOR}>{v.severity}</Badge>
                      </td>
                      <td className="px-5 py-2.5 text-right font-medium text-slate-700">
                        {v.points}
                      </td>
                      <td className="px-5 py-2.5 text-slate-600">
                        {v.asset?.code ?? "—"}
                      </td>
                      <td className="px-5 py-2.5 text-right text-slate-600">
                        {v.penalty > 0 ? inr(v.penalty) : "—"}
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge
                          color={
                            v.status === "OPEN"
                              ? "bg-rose-100 text-rose-700 ring-rose-600/20"
                              : v.status === "ACTIONED"
                                ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20"
                                : "bg-slate-100 text-slate-500 ring-slate-400/20"
                          }
                        >
                          {v.status}
                        </Badge>
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <ViolationAction
                            v={{
                              id: v.id,
                              status: v.status,
                              actionTaken: v.actionTaken,
                              penalty: v.penalty,
                            }}
                          />
                          <DeleteRow id={v.id} kind="violation" />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {violations.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-5 py-10 text-center text-slate-400">
                        No violations recorded — every driver starts at 100.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
