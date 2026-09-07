/**
 * The fleet is not repainted every time it reports.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The live console polls every fifteen seconds and each poll returns a fresh
 * array, so every marker object is new. Without a cache that means a new
 * `L.DivIcon` per marker per poll, react-leaflet calling `setIcon()` on all of
 * them, and the whole fleet's DOM torn down and rebuilt four times a minute —
 * for vehicles that are, mostly, parked and unchanged. It also makes the
 * registration plates flicker while somebody is reading them.
 *
 * The cache turns on this key, so the key is what is pinned here. It has to be
 * stable when nothing visible changed, and it has to change when something did.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { iconCacheKey } from "./map-icon-key.ts";

const truck = { status: "MOVING" as const, label: "RJ21GE3220", headingDeg: 91 };

describe("an unchanged vehicle reuses its icon", () => {
  test("the same vehicle produces the same key", () => {
    assert.equal(iconCacheKey(truck, false, true), iconCacheKey({ ...truck }, false, true));
  });

  test("a degree or two of heading jitter does not force a repaint", () => {
    // A stationary truck's reported course wanders between samples. At full
    // precision every sample is a new icon for a vehicle that has not moved.
    const a = iconCacheKey(truck, false, true);
    for (const heading of [89, 90, 92, 94]) {
      assert.equal(iconCacheKey({ ...truck, headingDeg: heading }, false, true), a,
        `heading ${heading} should share a bucket with 91`);
    }
  });

  test("a vehicle with no reported heading is stable too", () => {
    const a = iconCacheKey({ ...truck, headingDeg: null }, false, true);
    const b = iconCacheKey({ ...truck, headingDeg: null }, false, true);
    assert.equal(a, b);
  });
});

describe("anything a person would see is in the key", () => {
  test("a real turn changes the icon", () => {
    assert.notEqual(
      iconCacheKey(truck, false, true),
      iconCacheKey({ ...truck, headingDeg: 140 }, false, true),
    );
  });

  test("changing status changes the icon", () => {
    assert.notEqual(
      iconCacheKey(truck, false, true),
      iconCacheKey({ ...truck, status: "OFFLINE" as const }, false, true),
    );
  });

  test("selecting a vehicle changes the icon", () => {
    assert.notEqual(iconCacheKey(truck, false, true), iconCacheKey(truck, true, true));
  });

  test("hiding the plate at low zoom changes the icon", () => {
    assert.notEqual(iconCacheKey(truck, false, true), iconCacheKey(truck, false, false));
  });

  test("two different vehicles never share an icon", () => {
    assert.notEqual(
      iconCacheKey(truck, false, true),
      iconCacheKey({ ...truck, label: "RJ21GE2479" }, false, true),
    );
  });

  test("a heading of zero is a real bearing, not a missing one", () => {
    // Due north must not be confused with "no course reported", which draws a
    // plain disc instead of a chevron.
    assert.notEqual(
      iconCacheKey({ ...truck, headingDeg: 0 }, false, true),
      iconCacheKey({ ...truck, headingDeg: null }, false, true),
    );
  });
});

describe("a handover repaints the marker", () => {
  test("the same vehicle with a new driver is not a cache hit", () => {
    const base = { status: "MOVING", label: "TRU-053", headingDeg: 90 };
    assert.notEqual(
      iconCacheKey({ ...base, driverName: "Ramesh" }, false, true),
      iconCacheKey({ ...base, driverName: "Suresh" }, false, true),
    );
  });

  test("a vehicle with no driver still has a stable key", () => {
    const m = { status: "IDLE", label: "TRU-109", headingDeg: null, driverName: null };
    assert.equal(iconCacheKey(m, false, true), iconCacheKey(m, false, true));
  });
});
