/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

async function main() {
  const tables = [
    "inventoryTransaction",
    "inventoryStock",
    "inventoryItem",
    "inventoryWarehouse",
    "tyreEvent",
    "tyre",
    "majorComponent",
    "costTransaction",
    "alert",
    "complianceDoc",
    "workOrder",
    "fuelTransaction",
    "fuelTank",
    "trip",
    "asset",
    "driver",
    "project",
    "user"
  ];

  for (const table of tables) {
    console.log(`Clearing ${table}...`);
    try {
      const result = await db[table].deleteMany();
      console.log(`Cleared ${table}:`, result);
    } catch (e) {
      console.error(`Error clearing ${table}:`, e.message);
    }
  }

  await db.$disconnect();
}

main();
