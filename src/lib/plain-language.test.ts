/**
 * The words on screen stay ones an ordinary user knows, and wide tables stay
 * reachable on a phone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A TEST AND NOT A STYLE GUIDE
 *
 * This software is used by supervisors, drivers and a fuel clerk on a phone at
 * a site — not by engineers. A screen that says "reconciliation against the
 * tolerance band" is worse than useless to them: they will guess, and a guess
 * on a diesel figure is how numbers stop being trusted.
 *
 * A style guide asking people to write simply gets read once. Every word here
 * was actually on a screen in this app, so the sweep that removed them is only
 * worth doing if it cannot quietly come back — which is what this file is for.
 *
 * The check is deliberately narrow: only the attributes a user reads
 * (`title`, `subtitle`, `label`, `placeholder`), never code identifiers.
 * `assetId` and `assetClass` are perfectly good variable names; "Asset Class"
 * as a form label is not.
 *
 * If a banned word is genuinely the clearest one for a new screen, the honest
 * fix is to argue it here and remove it from the list — not to phrase around
 * the test.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Words that were on real screens and that a site user would not know. */
const BANNED: { word: RegExp; instead: string }[] = [
  { word: /\breconcil\w*/i, instead: '"check" or "tank check"' },
  { word: /\btelemetry\b/i, instead: '"live data" or "the vehicle\'s own readings"' },
  { word: /\banomal\w*/i, instead: '"problem"' },
  { word: /\bgeofence\w*/i, instead: '"site boundary"' },
  { word: /\butilis\w*|\butiliz\w*/i, instead: '"usage" or "used"' },
  { word: /\btolerance band\b/i, instead: '"normal range"' },
  { word: /\bground truth\b/i, instead: '"the real reading"' },
  { word: /\basset class\b/i, instead: '"machine type"' },
  { word: /\bdownstream\b/i, instead: "naming what actually depends on it" },
  { word: /\bimmutable\b/i, instead: '"permanent"' },
  { word: /\bcascading\b/i, instead: "saying the order in plain words" },
  { word: /\bdiagnostics?\b/i, instead: '"checks"' },
];

/** Attributes whose value a user actually reads. */
const USER_FACING = /(?:title|subtitle|label|placeholder)="([^"]{2,})"/g;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const files = tsxFiles("src");

describe("the words on screen are ones a site user knows", () => {
  for (const { word, instead } of BANNED) {
    test(`no user-facing text says ${String(word)}`, () => {
      const offences: string[] = [];
      for (const file of files) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(USER_FACING)) {
          if (word.test(m[1]!)) offences.push(`${file}: ${m[0]}`);
        }
      }
      assert.deepEqual(
        offences,
        [],
        `Use ${instead} instead. Found:\n  ${offences.join("\n  ")}`,
      );
    });
  }

  test("headings stay short enough to read at a glance", () => {
    // A title is a name, not a sentence. Subtitles may explain; titles may not.
    const long: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?<![a-zA-Z])title="([^"]+)"/g)) {
        if (m[1]!.length > 60) long.push(`${file}: "${m[1]}"`);
      }
    }
    assert.deepEqual(long, [], `Titles over 60 characters:\n  ${long.join("\n  ")}`);
  });
});

describe("wide tables stay reachable on a small screen", () => {
  test("every table can be scrolled sideways", () => {
    // A table of ten columns will not fit a phone, and that is fine — as long
    // as it scrolls. Cut off is not fine, and is what happens when the
    // container never says so.
    const unreachable: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      let index = src.indexOf("<table");
      while (index !== -1) {
        const preceding = src.slice(Math.max(0, index - 500), index);
        if (!preceding.includes("overflow-x-auto") && !preceding.includes("overflow-auto")) {
          unreachable.push(`${file}:${src.slice(0, index).split("\n").length}`);
        }
        index = src.indexOf("<table", index + 1);
      }
    }
    assert.deepEqual(
      unreachable,
      [],
      `Wrap these tables in a container with overflow-x-auto:\n  ${unreachable.join("\n  ")}`,
    );
  });
});
