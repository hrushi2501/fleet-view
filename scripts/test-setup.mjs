/**
 * Registers the TypeScript path/extension resolver for `node --test`.
 *
 * Resolution hooks run on a separate thread, so they cannot simply be imported
 * — they have to be registered with `module.register`. This file is the
 * `--import` entry point that does that; `ts-resolve.mjs` is the hook itself.
 */
import { register } from "node:module";

register("./ts-resolve.mjs", import.meta.url);

/**
 * Database Isolation & Safety Shield:
 * Ensures unit, calculation, and mutation tests NEVER connect to or spoil
 * any live development, staging, or production database.
 * Only integration tests targeting an isolated localhost `*_test` database
 * are permitted to connect to a database.
 */
const isIntegrationTest = process.argv.some(
  (arg) => arg.includes("tests/integration") || arg.includes("hardening.test")
);

if (!isIntegrationTest) {
  // Strip ambient database credentials from non-integration test runs
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;
  delete process.env.DIRECT_URL;
  delete process.env.DATABASE_URL_OWNER;
}

