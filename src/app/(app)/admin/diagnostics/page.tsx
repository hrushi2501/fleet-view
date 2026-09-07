import { db } from "@/lib/db";
import { Card, SectionTitle, Badge, StatCard } from "@/components/ui";
import {
  detectSchemaDrift,
  describeDrift,
  FLEET_EDGE_KNOWN_FIELDS,
} from "@/lib/telemetry-normalization";
import { isTataEnabled, missingConfigKeys, TATA_PROVIDER_CODE } from "@/lib/tata-fleet-edge";
import { num, fmtDate, timeAgo } from "@/lib/utils";
import { Activity, Database, PlugZap, TriangleAlert, ShieldCheck, Server } from "lucide-react";
import { requireAdminPage } from "@/lib/access";
import { Txt } from "@/components/Txt";
import { auditSchemaAlignment, auditSupabaseSecurity, auditDatabaseHealth } from "@/lib/db-audit";
import { RunDatabaseAuditButton } from "@/components/RunDatabaseAuditButton";
import { serverCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

const SYNC_BADGE: Record<string, string> = {
  OK: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  SCHEMA_DRIFT: "bg-amber-100 text-amber-700 ring-amber-600/20",
  RATE_LIMITED: "bg-slate-100 text-slate-600 ring-slate-500/20",
  ERROR: "bg-rose-100 text-rose-700 ring-rose-600/20",
};

/**
 * The technical view of the data feed — deliberately the only one.
 *
 * The operational screens used to carry pieces of this: raw provider payloads,
 * confidence scores, sampling gaps, schema field lists. Every one of them was a
 * developer's debugging aid that had leaked onto a screen a store-keeper or a
 * site supervisor uses, where it did two kinds of harm — it crowded out the
 * numbers those people came for, and it invited them to interpret a diagnostic
 * as a business fact.
 *
 * So the vocabulary the rest of the app is not allowed to use lives here, in
 * full, unsoftened: telemetry, payloads, schema drift, ingestion. This page is
 * for whoever is asked "why does that vehicle show no mileage" — and it is
 * behind `admin.settings`, which no operational role holds.
 */
export default async function DiagnosticsPage() {
  await requireAdminPage("admin.settings");

  // Reading the clock is what makes "last 24 hours" mean anything here; this is
  // a force-dynamic server page, so there is no render to keep pure.
  // eslint-disable-next-line react-hooks/purity
  const dayAgo = new Date(Date.now() - 86400000);
  // eslint-disable-next-line react-hooks/purity
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const [
    providers,
    latest,
    last24h,
    lastWeek,
    bySource,
    assetsTracked,
    assetsTotal,
    schemaAudit,
    securityAudit,
    healthAudit,
    latestDbAudit,
  ] = await Promise.all([
    db.telematicsProvider.findMany({ orderBy: { name: "asc" } }),
    db.telemetryReading.findMany({
      include: { asset: { select: { code: true, registrationNo: true } } },
      orderBy: { recordedAt: "desc" },
      take: 25,
    }),
    db.telemetryReading.count({ where: { recordedAt: { gte: dayAgo } } }),
    db.telemetryReading.count({ where: { recordedAt: { gte: weekAgo } } }),
    db.telemetryReading.groupBy({ by: ["source"], _count: { _all: true } }),
    db.asset.count({ where: { deviceId: { not: null } } }),
    db.asset.count(),
    auditSchemaAlignment(),
    auditSupabaseSecurity(),
    auditDatabaseHealth(),
    db.auditEvent.findFirst({
      where: { entity: "DatabaseAudit" },
      orderBy: { at: "desc" },
    }),
  ]);


  // Drift is measured against the newest payload that actually carried one —
  // an empty `raw` tells you nothing about the provider's contract.
  const withRaw = latest.filter((r) => r.raw && typeof r.raw === "object");
  const newestRaw = withRaw[0];
  const drift = newestRaw ? detectSchemaDrift(newestRaw.raw as Record<string, unknown>) : null;
  const driftLine = drift ? describeDrift(drift) : null;

  // Vehicles that carry a tracker but have not spoken in a day. This is the
  // question this page exists to answer, so it is computed rather than left to
  // whoever is reading to notice.
  const silent = await db.asset.findMany({
    where: { deviceId: { not: null }, lastSeen: { lt: dayAgo } },
    select: { id: true, code: true, registrationNo: true, lastSeen: true },
    orderBy: { lastSeen: "asc" },
    take: 20,
  });

  const configMissing = missingConfigKeys();

  // "Configured" and "working" are different things, and the cache used to
  // report the first while meaning neither. Ask it.
  const cacheReachable = await serverCache.healthy();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900"><Txt text="Advanced Diagnostics" /></h1>
        <p className="text-sm text-slate-500">
          Provider sync state, raw telemetry payloads and data-quality checks. Technical detail lives here so the
          operational screens do not have to carry it.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-4">
        <StatCard label="Readings — 24h" value={num(last24h)} sub={`${num(lastWeek)} in 7 days`} accent="brand" icon={<Activity className="h-5 w-5" />} />
        <StatCard label="Tracked Vehicles" value={`${num(assetsTracked)}/${num(assetsTotal)}`} sub="have a device id" accent="violet" icon={<PlugZap className="h-5 w-5" />} />
        <StatCard label="Silent Over 24h" value={num(silent.length)} sub="tracker fitted, no data" accent={silent.length ? "rose" : "emerald"} icon={<TriangleAlert className="h-5 w-5" />} />
        <StatCard label="Payload Fields" value={num(FLEET_EDGE_KNOWN_FIELDS.length)} sub="in the recorded contract" accent="brand" icon={<Database className="h-5 w-5" />} />
        <StatCard
          label="Cache"
          value={serverCache.type === "redis" ? (cacheReachable ? "Redis" : "Redis — not answering") : "Memory only"}
          sub={
            serverCache.type === "redis"
              ? cacheReachable
                ? "Shared by every server"
                : "Falling back — pages still work, just slower"
              : "Each server keeps its own"
          }
          accent={serverCache.type === "redis" ? (cacheReachable ? "emerald" : "rose") : "amber"}
          icon={<Database className="h-5 w-5" />}
        />
      </div>

      {/* Database & Supabase Schema Uniformity */}
      <Card className="border-slate-200 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <SectionTitle
                title="Database & Supabase Schema Uniformity"
                subtitle="Live synchronization between Prisma schema, PostgreSQL, and Supabase PostgREST"
              />
              <Badge
                color={
                  schemaAudit.synced && securityAudit.isZeroExposure
                    ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20"
                    : "bg-amber-100 text-amber-700 ring-amber-600/20"
                }
              >
                {schemaAudit.synced && securityAudit.isZeroExposure ? "IN SYNC" : "ATTENTION NEEDED"}
              </Badge>
            </div>
          </div>
          <RunDatabaseAuditButton />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
          <div className="rounded-lg bg-slate-50 p-3.5 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <Server className="h-3.5 w-3.5 text-brand-600" />
              <span>Prisma ⟷ DB Models</span>
            </div>
            <div className="mt-1 text-lg font-bold text-ink-900">
              {schemaAudit.matchedModels} / {schemaAudit.totalModels}
            </div>
            <div className="text-[11px] text-slate-500">
              {schemaAudit.synced ? "100% column alignment" : `${schemaAudit.missingTables.length} tables / ${schemaAudit.missingColumns.length} cols missing`}
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-3.5 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <Activity className="h-3.5 w-3.5 text-violet-600" />
              <span>DB Ping Latency</span>
            </div>
            <div className="mt-1 text-lg font-bold text-ink-900">
              {healthAudit.latencyMs} ms
            </div>
            <div className="text-[11px] text-slate-500">
              PostgreSQL connection healthy
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-3.5 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              <span>Supabase PostgREST Security</span>
            </div>
            <div className="mt-1 text-lg font-bold text-ink-900">
              {securityAudit.isZeroExposure ? "Zero Exposure" : "Exposed Grants"}
            </div>
            <div className="text-[11px] text-slate-500">
              anon/auth grants: {securityAudit.anonGrants.length + securityAudit.authenticatedGrants.length}
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-3.5 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <Database className="h-3.5 w-3.5 text-amber-600" />
              <span>RLS Active State</span>
            </div>
            <div className="mt-1 text-lg font-bold text-ink-900">
              {securityAudit.rlsEnabledCount} / {securityAudit.totalTables}
            </div>
            <div className="text-[11px] text-slate-500">
              {securityAudit.policyCount > 0 ? `${securityAudit.policyCount} policies · ` : ""}
              {securityAudit.unsecuredTables.length === 0 ? "All tables guarded" : `${securityAudit.unsecuredTables.length} tables pending RLS`}
            </div>
          </div>
        </div>

        {latestDbAudit && (
          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-500">
            <span>
              Last Automated Audit: <strong className="text-ink-900 font-mono">{fmtDate(latestDbAudit.at)}</strong> ({timeAgo(latestDbAudit.at)})
            </span>
            <span className="font-mono text-[11px] text-slate-400">
              {latestDbAudit.summary}
            </span>
          </div>
        )}
      </Card>

      <Card className="p-0">

        <div className="p-5 pb-3">
          <SectionTitle title="Provider Sync Status" subtitle="Last run, and what it reported" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium"><Txt text="Provider" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Code" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Active" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Interval" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Last sync" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Status" /></th>
                <th className="px-5 py-3 font-medium"><Txt text="Last error" /></th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 align-top">
                  <td className="px-5 py-3 font-medium text-ink-900">{p.name}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{p.code}</td>
                  <td className="px-5 py-3">
                    <Badge color={p.active ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/20"}>
                      {p.active ? "active" : "off"}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{p.syncIntervalMin} min</td>
                  <td className="px-5 py-3 whitespace-nowrap text-slate-600">
                    {p.lastSyncAt ? <>{fmtDate(p.lastSyncAt)}<span className="block text-xs text-slate-400">{timeAgo(p.lastSyncAt)}</span></> : <span className="text-slate-300">never</span>}
                  </td>
                  <td className="px-5 py-3">
                    {p.lastSyncStatus
                      ? <Badge color={SYNC_BADGE[p.lastSyncStatus] ?? SYNC_BADGE.RATE_LIMITED}>{p.lastSyncStatus}</Badge>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-5 py-3 max-w-md wrap-break-word font-mono text-[11px] text-rose-600">{p.lastSyncError ?? ""}</td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">No telematics providers configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          Tata Fleet Edge ({TATA_PROVIDER_CODE}) is{" "}
          <strong className={isTataEnabled() ? "text-emerald-600" : "text-rose-600"}>
            {isTataEnabled() ? "configured" : "not configured"}
          </strong>
          {configMissing.length > 0 && <> — missing env: <span className="font-mono">{configMissing.join(", ")}</span></>}
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="Payload Schema Drift"
          subtitle="The latest data received, compared with the fields we expect"
        />
        <div className="mt-3 text-sm">
          {!newestRaw && <p className="text-slate-400">No payload with a stored `raw` object in the last 25 readings.</p>}
          {newestRaw && !driftLine && (
            <p className="text-emerald-700">
              Payload for {newestRaw.asset.code} matches the contract — all {FLEET_EDGE_KNOWN_FIELDS.length} known
              fields present, no unknown fields.
            </p>
          )}
          {driftLine && (
            <div className="space-y-2">
              <p className="font-mono text-xs text-amber-700">{driftLine}</p>
              {drift!.missingRequired.length > 0 && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  Required fields are absent. Anything derived from them — distance, burn, tank level — is being
                  computed from nothing and will read as zero rather than as unknown on the operational screens.
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Readings by Source" subtitle="Where the data is coming from" />
          <div className="mt-3 space-y-2 text-sm">
            {bySource.map((s) => (
              <div key={s.source} className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-mono text-xs text-slate-600">{s.source}</span>
                <span className="font-semibold text-ink-900">{num(s._count._all)}</span>
              </div>
            ))}
            {bySource.length === 0 && <p className="text-slate-400">No telemetry readings stored.</p>}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Silent Trackers" subtitle="Device fitted, nothing received in 24 hours" />
          <div className="mt-3 space-y-2 text-sm">
            {silent.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-medium text-ink-900">{a.code}<span className="ml-2 text-xs text-slate-400">{a.registrationNo ?? ""}</span></span>
                <span className="text-xs text-slate-500">last seen {timeAgo(a.lastSeen)}</span>
              </div>
            ))}
            {silent.length === 0 && <p className="text-emerald-700">Every tracked vehicle has reported in the last 24 hours.</p>}
          </div>
        </Card>
      </div>

      <Card className="p-0">
        <div className="p-5 pb-3">
          <SectionTitle title="Latest Raw Payloads" subtitle="Exactly what the provider sent, untouched" />
        </div>
        <div className="divide-y divide-slate-100">
          {latest.map((r) => (
            <details key={r.id} className="px-5 py-3">
              <summary className="cursor-pointer text-sm">
                <span className="font-semibold text-ink-900">{r.asset.code}</span>
                <span className="ml-2 font-mono text-xs text-slate-500">{r.source}</span>
                <span className="ml-2 text-xs text-slate-400">{fmtDate(r.recordedAt)} · {timeAgo(r.recordedAt)}</span>
                {r.raw == null && <span className="ml-2 text-xs text-amber-600">no raw payload stored</span>}
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-200">
{JSON.stringify(r.raw ?? { lat: r.lat, lng: r.lng, speedKph: r.speedKph, odometerKm: r.odometerKm, fuelLevelPct: r.fuelLevelPct, ignitionOn: r.ignitionOn }, null, 2)}
              </pre>
            </details>
          ))}
          {latest.length === 0 && (
            <p className="px-5 py-10 text-center text-slate-400">No telemetry readings stored yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
}