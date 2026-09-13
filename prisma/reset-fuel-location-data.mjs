/**
 * Remove verified phantom Fleet Edge fuel records while preserving all vehicle
 * and location history. This is deliberately narrower than a database reset.
 *
 * Dry-run by default. Pass --apply only after reviewing the counts.
 * Telemetry, trips, sessions, image readings, tank receipts/dips, manual fuel
 * entries, costs, alerts, and audit history are never deleted by this script.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const targets = {
  sensorFuelTransactions: () => db.fuelTransaction.count({ where: { captureMethod: "SENSOR" } }),
  sensorFuelTransactionCost: async () => (await db.fuelTransaction.aggregate({ where: { captureMethod: "SENSOR" }, _sum: { amount: true } }))._sum.amount ?? 0,
  derivedFuelAnomalies: () => db.fuelAnomaly.count({ where: { source: "ASSET_EFFICIENCY" } }),
  telemetryReadings: () => db.telemetryReading.count(),
  tripSessions: () => db.tripSession.count(),
  assets: () => db.asset.count(),
  compliance: () => db.complianceDoc.count(),
  trips: () => db.trip.count(),
};

async function snapshot() {
  const rows = await Promise.all(Object.entries(targets).map(async ([name, fn]) => [name, await fn()]));
  return Object.fromEntries(rows);
}

async function main() {
  const before = await snapshot();
  console.log(APPLY ? "\nApplying phantom-fuel cleanup:" : "\nDry-run phantom-fuel cleanup:");
  for (const [name, count] of Object.entries(before)) console.log(`  ${name}: ${count}`);

  if (!APPLY) {
    console.log("\nNothing deleted. Re-run with --apply after reviewing the scope.\n");
    return;
  }

  await db.$transaction(async (tx) => {
    await tx.fuelTransaction.deleteMany({ where: { captureMethod: "SENSOR" } });
    await tx.fuelAnomaly.deleteMany({ where: { source: "ASSET_EFFICIENCY" } });

    // AuditEvent is append-only by design. Keep the historical trail and add
    // one explicit reset entry so the destructive operation is accountable.
    await tx.auditEvent.create({
      data: {
        actorName: "Fuel/location reset",
        action: "DELETE",
        module: "ADMIN",
        entity: "FuelTransaction,FuelAnomaly",
        summary: "Removed Fleet Edge sensor-derived phantom fuel records; preserved all vehicle, location, trip, compliance, manual fuel, and audit data.",
      },
    });
  });

  const after = await snapshot();
  console.log("\nReset complete. Preserved invariants:");
  console.log(`  assets: ${before.assets} -> ${after.assets}`);
  console.log(`  compliance: ${before.compliance} -> ${after.compliance}`);
  console.log(`  trips: ${before.trips} -> ${after.trips}`);
  console.log(`  sensor fuel cost in total-cost inputs: ${before.sensorFuelTransactionCost} -> ${after.sensorFuelTransactionCost}`);
  console.log(`  audit history: preserved (plus reset entry)`);
  const protectedKeys = ["telemetryReadings", "tripSessions", "fuelLevelReadings", "fuelReceipts", "tankDips", "fuelReconciliations", "fuelCosts", "assets", "compliance", "trips"];
  // A live sync may legitimately add telemetry while this transaction runs;
  // only a decrease indicates that the cleanup touched protected data.
  const changed = protectedKeys.filter((key) =>
    typeof before[key] === "number" && typeof after[key] === "number" && after[key] < before[key]
  );
  if (changed.length) {
    throw new Error(`Protected data changed unexpectedly: ${changed.join(", ")}`);
  }
  console.log("\nProtected vehicle/location data was unchanged. Only sensor-derived phantom fuel rows were removed.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
