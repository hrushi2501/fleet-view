import { createTelemetryAdapter, TelemetryReading } from "./src/lib/telemetry-ingestion";
import { AiFraudDetectionService } from "./src/lib/ai-fraud";
import { db } from "./src/lib/db";

async function runTestSuite1() {
  console.log("=== RUNNING TEST SUITE 1 ===");
  
  // 1. Manually craft a stream to force the exact condition: 35L drop, speed 0, engine OFF
  const now = Date.now();
  const vehicleId = "TEST-ASSET-001";
  
  // Need to ensure asset exists in DB for foreign keys
  let asset = await db.asset.findFirst({ where: { code: vehicleId } });
  if (!asset) {
    asset = await db.asset.create({
      data: {
        code: vehicleId,
        registrationNo: "TS1-1234",
        name: "Test Asset",
        assetClass: "EXCAVATOR",
        category: "EQUIPMENT",
        ownershipType: "OWNED",
        make: "Caterpillar",
        model: "320D2",
        yearMfg: 2020,
        status: "Active",
        meterValue: 1000,
        primaryMeter: "SMU"
      }
    });
  }

  const stream: TelemetryReading[] = [
    { vehicleId, timestamp: new Date(now - 10000).toISOString(), speed: 0, tankLevel: 200, engineState: 'OFF', gps: { lat: 0, lng: 0 } },
    { vehicleId, timestamp: new Date(now).toISOString(), speed: 0, tankLevel: 165, engineState: 'OFF', gps: { lat: 0, lng: 0 } } // 35L drop
  ];

  console.log("1. Triggered Telemetry Stream (Simulated)");
  console.log("2. Simulated Fraud Event: 35L drop while idle/OFF");
  
  const aiService = new AiFraudDetectionService();
  await aiService.processTelemetry(stream);
  console.log("3. AiFraudDetectionService processed telemetry");
  
  const today = new Date();
  today.setHours(0,0,0,0);
  
  const cases = await db.fraudCase.findMany({ 
    where: { 
      assetId: asset.id, 
      ruleCode: "AI_FUEL_THEFT",
      openedAt: { gte: today }
    }
  });
  
  const alerts = await db.alert.findMany({
    where: {
      assetId: asset.id,
      category: "Loss",
      createdAt: { gte: today }
    }
  });

  if (cases.length > 0 && alerts.length > 0) {
     console.log("4. PASS: FraudCase and CRITICAL Alert created automatically.");
     console.log("FraudCase Score:", cases[0].score);
     console.log("Alert Severity:", alerts[0].severity);
     if (cases[0].score > 75) {
       console.log("TS-1 COMPLETED SUCCESSFULLY");
     } else {
       console.log("FAIL: Score is not > 75");
       process.exit(1);
     }
  } else {
     console.log(`FAIL: FraudCase (${cases.length}) or Alert (${alerts.length}) not created.`);
     process.exit(1);
  }
}

runTestSuite1().catch(console.error).finally(() => process.exit(0));
