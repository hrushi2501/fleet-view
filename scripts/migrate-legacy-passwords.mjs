/**
 * One-time migration for user rows written before passwords were bcrypt-only.
 *
 * Run against the intended database with environment variables supplied by the
 * deployment platform:
 *
 *   CONFIRM_PASSWORD_MIGRATION=true npm run db:migrate-passwords
 *
 * The script intentionally logs counts only, never user IDs, emails, or
 * password values. Reset any account that previously used a known/shared
 * default immediately after this migration through the admin UI.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

async function main() {
  if (process.env.CONFIRM_PASSWORD_MIGRATION !== "true") {
    throw new Error(
      "Refusing to change user credentials. Re-run with CONFIRM_PASSWORD_MIGRATION=true after backing up the target database.",
    );
  }

  const users = await db.user.findMany({ select: { id: true, password: true } });
  const legacyUsers = users.filter((user) => !BCRYPT_HASH.test(user.password));

  for (const user of legacyUsers) {
    await db.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(user.password, 10) },
    });
  }

  console.log(`Migrated ${legacyUsers.length} legacy password hash${legacyUsers.length === 1 ? "" : "es"}.`);
}

main()
  .catch((error) => {
    console.error("Legacy password migration failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
