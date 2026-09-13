/**
 * Remove all site diesel tanks and only tank-owned records.
 *
 * Dry run (default):
 *   node --env-file=.env.local prisma/remove-site-tanks.mjs
 * Apply after reviewing the counts:
 *   node --env-file=.env.local prisma/remove-site-tanks.mjs --apply
 *
 * Vehicle fuel transactions are retained. Their optional tankId is cleared so
 * deleting a tank cannot delete or orphan a vehicle's fuel history. Assets,
 * telemetry, trips and compliance are explicitly counted before and after.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const apply = process.argv.includes("--apply");

try {
  const tanks = await db.fuelTank.findMany({
    select: {
      id: true,
      name: true,
      location: true,
      recons: { select: { id: true } },
      _count: { select: { receipts: true, dips: true, issues: true, recons: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const tankIds = tanks.map((tank) => tank.id);
  const reconIds = tanks.flatMap((tank) => tank.recons.map((recon) => recon.id));

  const [tankAnomalies, unifiedAnomalies, tankFuelTransactions, tankConfigs, before] = await Promise.all([
    db.fuelAnomaly.count({ where: { OR: [{ tankId: { in: tankIds } }, { source: "TANK_RECON", refId: { in: reconIds } }] } }),
    db.unifiedAnomaly.count({ where: { tankId: { in: tankIds } } }),
    db.fuelTransaction.count({ where: { tankId: { in: tankIds } } }),
    db.fuelReconConfig.count({ where: { scope: "TANK", scopeId: { in: tankIds } } }),
    preservationCounts(),
  ]);

  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "DRY_RUN",
    tanks: tanks.map(({ id, name, location, _count }) => ({ id, name, location, ..._count })),
    dependent: { tankAnomalies, unifiedAnomalies, tankFuelTransactions, tankConfigs },
    preserveBefore: before,
  }, null, 2));

  if (!apply || tankIds.length === 0) {
    console.log(!apply ? "Dry run only. Re-run with --apply to remove these tanks." : "No site tanks found; nothing changed.");
    await db.$disconnect();
    process.exitCode = 0;
  } else {
    const result = await db.$transaction(async (tx) => {
      // These tables use scalar references rather than foreign keys, so clean
      // their tank-only rows explicitly before removing the tank records.
      const deletedFuelAnomalies = await tx.fuelAnomaly.deleteMany({
        where: { OR: [{ tankId: { in: tankIds } }, { source: "TANK_RECON", refId: { in: reconIds } }] },
      });
      const deletedUnifiedAnomalies = await tx.unifiedAnomaly.deleteMany({ where: { tankId: { in: tankIds } } });
      const deletedConfigs = await tx.fuelReconConfig.deleteMany({ where: { scope: "TANK", scopeId: { in: tankIds } } });
      const detachedFuelTransactions = await tx.fuelTransaction.updateMany({
        where: { tankId: { in: tankIds } },
        data: { tankId: null },
      });
      const deletedTanks = await tx.fuelTank.deleteMany({ where: { id: { in: tankIds } } });
      return { deletedTanks: deletedTanks.count, deletedFuelAnomalies: deletedFuelAnomalies.count, deletedUnifiedAnomalies: deletedUnifiedAnomalies.count, deletedConfigs: deletedConfigs.count, detachedFuelTransactions: detachedFuelTransactions.count };
    });

    const after = await preservationCounts();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(`Preservation check failed: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    }
    console.log(JSON.stringify({ applied: result, preserveAfter: after }, null, 2));
  }
} finally {
  await db.$disconnect();
}

async function preservationCounts() {
  const [assets, telemetry, trips, compliance] = await Promise.all([
    db.asset.count(),
    db.telemetryReading.count(),
    db.trip.count(),
    db.complianceDoc.count(),
  ]);
  return { assets, telemetry, trips, compliance };
}
