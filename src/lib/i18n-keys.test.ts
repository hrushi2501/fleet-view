/**
 * Every dictionary key must be a string the app really renders.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This dictionary is keyed on the English text itself, which makes a translation
 * silently useless if the key is off by a capital letter, a stray space, or an
 * `&` where the JSX actually writes `&amp;`. Nothing fails, nothing warns — the
 * screen just stays English, and the only way to find out is to read every page
 * in Hindi and notice what did not change.
 *
 * That is exactly what happened on the first pass: twelve of the first hundred
 * and seventy-nine entries matched nothing at all. So the check is a test rather
 * than a habit. It reads the source the way the browser does — decoding the
 * entities JSX decodes — and fails on any key no screen can produce.
 *
 * A key that stops matching because its screen was reworded is a real failure
 * worth seeing: the Hindi has quietly reverted to English there.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { HI_KEYS } from "./i18n.ts";

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (path.endsWith(".tsx") || path.endsWith(".ts")) found.push(path);
  }
  return found;
}

/** JSX decodes these before rendering, so the dictionary key is the decoded form. */
function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

const corpus = decode(
  sourceFiles("src")
    .filter((f) => !f.endsWith("i18n.ts") && !f.includes(".test."))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n"),
);

describe("every translation is attached to something real", () => {
  test("no key is missing from the app's own source", () => {
    const orphans = HI_KEYS.filter((key) => !corpus.includes(key));
    assert.deepEqual(
      orphans,
      [],
      `${orphans.length} translations match no string in the app, so they will ` +
        `never appear. Usually a capital letter or an "&" that the JSX writes ` +
        `as "&amp;":\n  ${orphans.slice(0, 20).join("\n  ")}`,
    );
  });

  test("no key is blank or padded, which would never match", () => {
    for (const key of HI_KEYS) {
      assert.equal(key, key.trim(), `"${key}" has whitespace around it`);
      assert.ok(key.length > 0, "there is an empty key in the dictionary");
    }
  });
});
