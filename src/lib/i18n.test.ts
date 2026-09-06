/**
 * The Hindi mode is usable even where it is unfinished.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * There are close to a thousand strings in this app, translated in order of how
 * often they are read. So the important property is not coverage — it is that a
 * key nobody has reached yet still renders something a person can act on.
 *
 * A missing translation must show its English. A blank space, or a raw key like
 * "fuel.title" printed on a screen, turns an unfinished translation into a
 * broken product.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { translator, isLang, LANGUAGES, LANGUAGE_LABEL, translationCoverage } from "./i18n.ts";

describe("nothing is ever blank", () => {
  test("an untranslated key falls back to the English passed in", () => {
    const t = translator("hi");
    assert.equal(t("some.key.nobody.has.done", "Vendor Reconciliation"), "Vendor Reconciliation");
  });

  test("the key itself is never rendered", () => {
    const t = translator("hi");
    const out = t("totally.made.up", "Something Sensible");
    assert.ok(!out.includes("."), `a raw key leaked to the screen: ${out}`);
  });

  test("English mode returns the English unchanged", () => {
    const t = translator("en");
    assert.equal(t("nav.fuel", "Fuel"), "Fuel");
  });

  test("Hindi mode uses the translation where there is one", () => {
    const t = translator("hi");
    assert.equal(t("nav.fuel", "Fuel"), "Diesel");
  });
});

describe("the words are the ones people actually say", () => {
  const t = translator("hi");

  test("a vehicle is a gaadi, not a vaahan", () => {
    assert.match(t("common.vehicle", "Vehicle"), /gaadi/i);
  });

  test("attendance is haziri, not upasthiti", () => {
    assert.match(t("attendance.title", "Attendance"), /haziri/i);
  });

  test("words that entered site Hindi stay in English", () => {
    // "Diesel" and "driver" are what gets said on site. Replacing them with
    // pure Hindi would be less clear, which defeats the point.
    assert.equal(t("nav.fuel", "Fuel"), "Diesel");
    assert.equal(t("common.driver", "Driver"), "Driver");
  });

  test("it is roman letters, not Devanagari", () => {
    // The choice for this fleet: most read roman far faster than Devanagari.
    // The driver photo screens keep their Devanagari and are not covered here.
    for (const key of ["nav.fleet", "attendance.title", "payroll.title"]) {
      assert.ok(
        !/[ऀ-ॿ]/.test(t(key, "")),
        `${key} is in Devanagari; this dictionary is Hinglish`,
      );
    }
  });
});

describe("language codes", () => {
  test("only known languages are accepted", () => {
    assert.equal(isLang("hi"), true);
    assert.equal(isLang("en"), true);
    for (const bad of ["fr", "", null, undefined, 7, "HI"]) {
      assert.equal(isLang(bad), false, `${String(bad)} should be rejected`);
    }
  });

  test("every language has a label for the switcher", () => {
    for (const l of LANGUAGES) {
      assert.ok(LANGUAGE_LABEL[l]?.length > 0, `${l} has no label`);
    }
  });

  test("an unknown language does not crash the translator", () => {
    // Defence against a stale cookie or a hand-edited database row.
    const t = translator("xx" as never);
    assert.equal(t("nav.fuel", "Fuel"), "Fuel");
  });
});

describe("coverage is reported honestly", () => {
  test("the count reflects what is actually translated", () => {
    assert.ok(translationCoverage().translated > 50);
  });
});
