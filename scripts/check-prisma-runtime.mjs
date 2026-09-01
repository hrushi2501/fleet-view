/**
 * Fails before deployment when Prisma expects a table/column the database does
 * not have. Extra database columns are intentionally tolerated: they may be
 * owned by a staged migration and, unlike a missing column, cannot crash a
 * Prisma read.
 */
import { existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const { Prisma, PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

try {
  const rows = await db.$queryRawUnsafe(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'`,
  );

  const actual = new Map();
  for (const row of rows) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
    actual.get(row.table_name).add(row.column_name);
  }

  const missing = [];
  for (const model of Prisma.dmmf.datamodel.models) {
    const table = model.dbName ?? model.name;
    const columns = actual.get(table);
    if (!columns) {
      missing.push(`${table} (table)`);
      continue;
    }
    for (const field of model.fields) {
      if (field.kind !== "scalar" && field.kind !== "enum") continue;
      const column = field.dbName ?? field.name;
      if (!columns.has(column)) missing.push(`${table}.${column}`);
    }
  }

  if (missing.length) {
    console.error("Prisma runtime schema mismatch:");
    for (const item of missing) console.error(`  - missing ${item}`);
    process.exitCode = 1;
  } else {
    console.log(`Prisma runtime schema matches ${Prisma.dmmf.datamodel.models.length} application models.`);
  }
} finally {
  await db.$disconnect();
}
