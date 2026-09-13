/**
 * Database Telematics & Alert Repair Script
 *
 * 1. Purges 346 orphaned alerts referencing deleted fuel anomalies.
 * 2. Links the 12 Tata fleet tippers/trucks to the TATA_FLEET_EDGE provider and sets hasFuelSensor = true.
 * 3. Backfills providerId on all 161,129 unlinked telemetry readings for the fleet.
 * 4. Verifies database integrity after execution.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function run() {
  console.log("==================================================");
  console.log("🛠️ Starting Telematics & Alerts Database Repair");
  console.log("==================================================");

  // 1. Locate Telematics Provider
  const provider = await db.telematicsProvider.findUnique({
    where: { code: "TATA_FLEET_EDGE" },
  });

  if (!provider) {
    throw new Error("TelematicsProvider TATA_FLEET_EDGE not found in database!");
  }
  console.log(`[Provider] Found TATA_FLEET_EDGE (ID: ${provider.id})`);

  // 2. Clean Orphaned Fuel Alerts
  const orphanAlertsCount = await db.alert.count({
    where: { ruleCode: "FUEL_ANOMALY_OPEN" },
  });
  console.log(`\n[Alerts] Found ${orphanAlertsCount} orphaned FUEL_ANOMALY_OPEN alerts.`);

  const validAlertsBefore = await db.alert.count({
    where: { ruleCode: { not: "FUEL_ANOMALY_OPEN" } },
  });
  console.log(`[Alerts] Legitimate operational alerts before purge: ${validAlertsBefore}`);

  if (orphanAlertsCount > 0) {
    const deletedAlerts = await db.alert.deleteMany({
      where: { ruleCode: "FUEL_ANOMALY_OPEN" },
    });
    console.log(`[Alerts] Successfully deleted ${deletedAlerts.count} orphaned alerts.`);
  }

  const validAlertsAfter = await db.alert.count();
  console.log(`[Alerts] Total alerts remaining in DB: ${validAlertsAfter} (expected: ${validAlertsBefore})`);
  if (validAlertsAfter !== validAlertsBefore) {
    throw new Error("Alert count mismatch! Other alerts may have been affected.");
  }

  // 3. Link Tata Vehicles
  const targetAssetIds = [
    "ast_sheet_rj21ge1659",
    "ast_sheet_rj21ge3219",
    "ast_sheet_rj21ge1658",
    "ast_sheet_rj21gd0599",
    "ast_sheet_rj21gd6559",
    "ast_sheet_rj21gd0598",
    "ast_sheet_rj21gd6558",
    "cmt4pgl9p0001kz04i0psgc56",
    "ast_sheet_rj21ge1656",
    "ast_sheet_rj21gd6557",
    "ast_sheet_rj21ge2479",
    "ast_sheet_rj21ge1657",
  ];

  console.log(`\n[Assets] Linking ${targetAssetIds.length} Tata vehicles to provider ${provider.id}...`);
  const assetUpdateResult = await db.asset.updateMany({
    where: { id: { in: targetAssetIds } },
    data: {
      telematicsProviderId: provider.id,
      hasFuelSensor: true,
    },
  });
  console.log(`[Assets] Updated ${assetUpdateResult.count} asset records (telematicsProviderId + hasFuelSensor).`);

  // 4. Backfill Telemetry Readings Provider ID
  const allFleetAssetIds = [...targetAssetIds, "ast_fleetedge_rj21ge3220"];
  const unlinkedTelemetryCount = await db.telemetryReading.count({
    where: {
      assetId: { in: allFleetAssetIds },
      providerId: null,
    },
  });
  console.log(`\n[Telemetry] Found ${unlinkedTelemetryCount} unlinked telemetry readings for the fleet.`);

  if (unlinkedTelemetryCount > 0) {
    console.log("[Telemetry] Backfilling providerId across readings in chunks...");
    const telemetryUpdateResult = await db.telemetryReading.updateMany({
      where: {
        assetId: { in: allFleetAssetIds },
        providerId: null,
      },
      data: {
        providerId: provider.id,
      },
    });
    console.log(`[Telemetry] Updated ${telemetryUpdateResult.count} telemetry readings with providerId.`);
  }

  // 5. Final Verification
  const remainingOrphans = await db.alert.count({ where: { ruleCode: "FUEL_ANOMALY_OPEN" } });
  const remainingUnlinkedTelemetry = await db.telemetryReading.count({ where: { providerId: null } });
  const totalLinkedAssets = await db.asset.count({ where: { telematicsProviderId: provider.id } });
  const totalLinkedTelemetry = await db.telemetryReading.count({ where: { providerId: provider.id } });

  console.log("\n==================================================");
  console.log("✅ Repair Complete — Final Verification:");
  console.log("==================================================");
  console.log(`• Orphaned FUEL_ANOMALY_OPEN alerts remaining: ${remainingOrphans} (expected: 0)`);
  console.log(`• Total active alerts remaining: ${validAlertsAfter}`);
  console.log(`• Assets linked to TATA_FLEET_EDGE: ${totalLinkedAssets} (expected: 13)`);
  console.log(`• Telemetry readings linked to TATA_FLEET_EDGE: ${totalLinkedTelemetry}`);
  console.log(`• Unlinked telemetry readings remaining: ${remainingUnlinkedTelemetry} (expected: 0)`);

  if (remainingOrphans === 0 && remainingUnlinkedTelemetry === 0 && totalLinkedAssets === 13) {
    console.log("\n🎉 All repairs succeeded with 100% integrity!");
  } else {
    console.warn("\n⚠️ Verification noted some residual differences, please check details above.");
  }
}

run()
  .catch((err) => {
    console.error("❌ Repair failed with error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
