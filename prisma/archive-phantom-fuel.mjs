/**
 * Creates a reversible logical archive of the derived rows targeted by the
 * phantom-fuel cleanup. This is not a replacement for pg_dump; it is a small,
 * auditable safety copy for the exact records being sanitized.
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const db = new PrismaClient();

async function main() {
  const sensorFuel = await db.fuelTransaction.findMany({
    where: { captureMethod: "SENSOR" },
    orderBy: [{ assetId: "asc" }, { date: "asc" }],
  });
  const anomalies = await db.fuelAnomaly.findMany({
    where: { source: "ASSET_EFFICIENCY" },
    orderBy: [{ assetId: "asc" }, { detectedAt: "asc" }],
  });
  const archive = {
    format: 1,
    createdAt: new Date().toISOString(),
    purpose: "Fleet Edge phantom fuel cleanup",
    protectedData: "Telemetry, assets, trips, sessions, compliance, manual fuel, and audit history are not included or modified.",
    sensorFuelTransactions: sensorFuel,
    derivedFuelAnomalies: anomalies,
  };
  const body = JSON.stringify(archive, null, 2);
  const digest = createHash("sha256").update(body).digest("hex");
  const dir = path.resolve("backups");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `phantom-fuel-${stamp}.json`);
  await writeFile(file, body, { mode: 0o600 });
  await writeFile(`${file}.sha256`, `${digest}  ${path.basename(file)}\n`, { mode: 0o600 });
  console.log(`Archive OK: ${file}`);
  console.log(`SHA-256: ${digest}`);
  console.log(`Sensor transactions: ${sensorFuel.length}`);
  console.log(`Derived anomalies: ${anomalies.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
