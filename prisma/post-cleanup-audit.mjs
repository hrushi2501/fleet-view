/**
 * Read-only verification after phantom-fuel cleanup.
 * Reports table counts and fails only on integrity conditions that should never
 * exist. It performs no inserts, updates, deletes, or maintenance commands.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const scalar = async (sql) => {
  const rows = await db.$queryRawUnsafe(sql);
  return Number(rows[0]?.count ?? 0);
};

async function main() {
  const tableCounts = await db.$queryRawUnsafe(`
    SELECT schemaname, relname AS table_name, n_live_tup::bigint AS estimated_rows
      FROM pg_stat_user_tables
     WHERE schemaname = 'public'
     ORDER BY relname
  `);

  const cleanupAudit = await db.auditEvent.findFirst({
    where: { entity: "FuelTransaction,FuelAnomaly", action: "DELETE" },
    orderBy: { at: "desc" },
    select: { id: true, at: true, summary: true },
  });

  const checks = {
    sensorFuelTransactions: await db.fuelTransaction.count({ where: { captureMethod: "SENSOR" } }),
    sensorFuelCost: (await db.fuelTransaction.aggregate({
      where: { captureMethod: "SENSOR" },
      _sum: { amount: true },
    }))._sum.amount ?? 0,
    derivedFuelAnomaliesTotal: await db.fuelAnomaly.count({ where: { source: "ASSET_EFFICIENCY" } }),
    derivedFuelAnomaliesBeforeCleanup: cleanupAudit ? await db.fuelAnomaly.count({
      where: { source: "ASSET_EFFICIENCY", detectedAt: { lte: cleanupAudit.at } },
    }) : null,
    derivedFuelAnomaliesAfterCleanup: cleanupAudit ? await db.fuelAnomaly.count({
      where: { source: "ASSET_EFFICIENCY", detectedAt: { gt: cleanupAudit.at } },
    }) : null,
    duplicateTelemetryGroups: await scalar(`
      SELECT count(*) FROM (
        SELECT 1 FROM "TelemetryReading"
         GROUP BY "assetId", "recordedAt", source HAVING count(*) > 1
      ) d
    `),
    duplicateFuelAnomalyGroups: await scalar(`
      SELECT count(*) FROM (
        SELECT 1 FROM "FuelAnomaly"
         WHERE "refId" IS NOT NULL
         GROUP BY source, "refId" HAVING count(*) > 1
      ) d
    `),
    orphanTelemetryAssets: await scalar(`
      SELECT count(*) FROM "TelemetryReading" t
       LEFT JOIN "Asset" a ON a.id = t."assetId" WHERE a.id IS NULL
    `),
    orphanFuelAssets: await scalar(`
      SELECT count(*) FROM "FuelTransaction" f
       LEFT JOIN "Asset" a ON a.id = f."assetId"
       WHERE f."assetId" IS NOT NULL AND a.id IS NULL
    `),
    orphanComplianceAssets: await scalar(`
      SELECT count(*) FROM "ComplianceDoc" c
       LEFT JOIN "Asset" a ON a.id = c."assetId" WHERE a.id IS NULL
    `),
    invalidFuelTransactions: await scalar(`
      SELECT count(*) FROM "FuelTransaction"
       WHERE quantity <= 0 OR rate < 0 OR amount < 0
    `),
    invalidTelemetryMeasurements: await scalar(`
      SELECT count(*) FROM "TelemetryReading"
       WHERE ("fuelLevelL" IS NOT NULL AND "fuelLevelL" < 0)
          OR ("fuelLevelPct" IS NOT NULL AND ("fuelLevelPct" < 0 OR "fuelLevelPct" > 100))
          OR ("speedKph" IS NOT NULL AND "speedKph" < 0)
          OR (lat IS NOT NULL AND (lat < -90 OR lat > 90))
          OR (lng IS NOT NULL AND (lng < -180 OR lng > 180))
    `),
    futureTelemetry: await scalar(`
      SELECT count(*) FROM "TelemetryReading"
       WHERE "recordedAt" > now() + interval '5 minutes'
    `),
  };

  const protectedCounts = {
    assets: await db.asset.count(),
    compliance: await db.complianceDoc.count(),
    telemetry: await db.telemetryReading.count(),
    trips: await db.trip.count(),
    tripSessions: await db.tripSession.count(),
    fuelReceipts: await db.fuelReceipt.count(),
    tankDips: await db.tankDip.count(),
    fuelReconciliations: await db.fuelReconciliation.count(),
    auditEvents: await db.auditEvent.count(),
  };

  const failures = Object.entries(checks)
    .filter(([name, value]) =>
      !["futureTelemetry", "derivedFuelAnomaliesTotal", "derivedFuelAnomaliesAfterCleanup"].includes(name) &&
      Number(value) !== 0
    )
    .map(([name, value]) => `${name}=${value}`);

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    protectedCounts,
    checks,
    cleanupAudit,
    publicTables: tableCounts.length,
    tableCounts,
    status: failures.length === 0 ? "PASS" : "ATTENTION_REQUIRED",
    failures,
  }, (_key, value) => typeof value === "bigint" ? Number(value) : value, 2));

  if (failures.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
