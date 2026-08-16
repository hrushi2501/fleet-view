/**
 * Clean Dummy Data & Sync Tata Fleet Edge
 *
 * 1. Clears all dummy transactional and master data.
 * 2. Retains system configuration (Admin users, roles, permissions, detection rules, norms).
 * 3. Sets up the real tracked vehicle: TRU-053 / RJ21GE3220 (Chassis: MAT567005R3C08725).
 * 4. Syncs live telemetry from Tata Fleet Edge API.
 */
import { PrismaClient } from "@prisma/client";
import { syncTataFleetEdge } from "../src/lib/tata-fleet-edge.ts";

const db = new PrismaClient();

async function main() {
  console.log("=================================================");
  console.log("🧹 1. Cleaning dummy records from database...");
  console.log("=================================================");

  // Delete dependent transactional and operational records in dependency order
  await db.unifiedAnomaly.deleteMany();
  await db.fuelAnomaly.deleteMany();
  await db.caseRecovery.deleteMany();
  await db.caseEvidence.deleteMany();
  await db.caseAction.deleteMany();
  await db.fraudCase.deleteMany();
  await db.alert.deleteMany();
  await db.tripSession.deleteMany();
  await db.trip.deleteMany();
  await db.fuelLevelReading.deleteMany();
  await db.fuelTransaction.deleteMany();
  await db.fuelReconciliation.deleteMany();
  await db.fuelReceipt.deleteMany();
  await db.tankDip.deleteMany();
  await db.fuelTank.deleteMany();
  await db.productionLog.deleteMany();
  await db.weighbridgeTicket.deleteMany();
  await db.costTransaction.deleteMany();
  await db.projectRevenue.deleteMany();
  await db.jobCardItem.deleteMany();
  await db.workOrderLine.deleteMany();
  await db.workOrder.deleteMany();
  await db.maintenanceSchedule.deleteMany();
  await db.complianceDoc.deleteMany();
  await db.inventoryTransaction.deleteMany();
  await db.inventoryStock.deleteMany();
  await db.inventoryItem.deleteMany();
  await db.inventoryWarehouse.deleteMany();
  await db.tyreEvent.deleteMany();
  await db.tyre.deleteMany();
  await db.majorComponent.deleteMany();
  await db.hireInvoice.deleteMany();
  await db.hireLog.deleteMany();
  await db.hireContract.deleteMany();
  await db.equipmentPlan.deleteMany();
  await db.mobilizationOrder.deleteMany();
  await db.allocation.deleteMany();
  await db.attendance.deleteMany();
  await db.violation.deleteMany();
  await db.competency.deleteMany();
  await db.personDocument.deleteMany();
  await db.driver.deleteMany();
  await db.site.deleteMany();
  await db.project.deleteMany();

  // Delete dummy assets (keep only RJ21GE3220)
  await db.asset.deleteMany({
    where: {
      registrationNo: { not: "RJ21GE3220" },
    },
  });

  // Delete unused dummy telematics providers (keep TATA_FLEET_EDGE)
  await db.telematicsProvider.deleteMany({
    where: {
      code: { not: "TATA_FLEET_EDGE" },
    },
  });

  console.log("✓ All dummy transactional and fleet records deleted.");

  console.log("\n=================================================");
  console.log("🚛 2. Ensuring Tata Vehicle TRU-053 is registered...");
  console.log("=================================================");

  const asset = await db.asset.upsert({
    where: { code: "TRU-053" },
    update: {
      registrationNo: "RJ21GE3220",
      name: "Tata Truck RJ21GE3220 (Fleet Edge)",
      assetClass: "TRUCK",
      category: "VEHICLE",
      ownershipType: "OWNED",
      make: "Tata Motors",
      model: "Signa 2830.TK",
      yearMfg: 2023,
      primaryMeter: "ODOMETER",
      fuelCapacity: 300,
      status: "Active",
    },
    create: {
      id: "ast_fleetedge_rj21ge3220",
      code: "TRU-053",
      name: "Tata Truck RJ21GE3220 (Fleet Edge)",
      registrationNo: "RJ21GE3220",
      assetClass: "TRUCK",
      category: "VEHICLE",
      ownershipType: "OWNED",
      make: "Tata Motors",
      model: "Signa 2830.TK",
      yearMfg: 2023,
      primaryMeter: "ODOMETER",
      fuelCapacity: 300,
      status: "Active",
      lat: 27.9690272,
      lng: 73.8014272,
      meterValue: 89802,
    },
  });
  console.log(`✓ Vehicle configured: ${asset.code} (${asset.registrationNo})`);

  console.log("\n=================================================");
  console.log("🔄 3. Triggering Live Sync with Tata Fleet Edge API...");
  console.log("=================================================");

  const syncResult = await syncTataFleetEdge();
  console.log("Sync Result:", JSON.stringify(syncResult, null, 2));

  // Verify updated asset telemetry state
  const updated = await db.asset.findUnique({
    where: { id: asset.id },
    select: {
      id: true,
      code: true,
      registrationNo: true,
      name: true,
      lat: true,
      lng: true,
      speed: true,
      meterValue: true,
      status: true,
      lastSeen: true,
    },
  });
  console.log("\nLive Asset Telemetry in DB:", updated);

  const readingsCount = await db.telemetryReading.count({
    where: { assetId: asset.id },
  });
  console.log(`Total live telemetry readings for ${asset.code} in DB: ${readingsCount}`);

  console.log("\n=================================================");
  console.log("✅ Database cleaned and synced with live Tata Fleet Edge API!");
  console.log("=================================================");
}

main()
  .catch((e) => {
    console.error("Cleanup & sync error:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
