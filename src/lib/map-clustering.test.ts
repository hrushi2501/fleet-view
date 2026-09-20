import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  projectLatLngToPixel,
  unprojectPixelToLatLng,
  resolveOverlappingFleet,
  type ClusterableMarker,
} from "./map-clustering";

describe("Direct-view map overlap resolution", () => {
  test("projection and unprojection round trip accurately", () => {
    const lat = 26.9124;
    const lng = 75.7873;
    const zoom = 12;

    const pixel = projectLatLngToPixel(lat, lng, zoom);
    const back = unprojectPixelToLatLng(pixel.x, pixel.y, zoom);

    assert.ok(Math.abs(back.lat - lat) < 1e-5);
    assert.ok(Math.abs(back.lng - lng) < 1e-5);
  });

  test("single marker renders at its exact coordinates without offset", () => {
    const markers: ClusterableMarker[] = [
      { id: "v1", lat: 26.9124, lng: 75.7873, status: "MOVING" },
    ];
    const { placed, groups } = resolveOverlappingFleet(markers, 11);

    assert.equal(placed.length, 1);
    assert.equal(placed[0].displayLat, 26.9124);
    assert.equal(placed[0].displayLng, 75.7873);
    assert.equal(placed[0].isOffset, false);
    assert.equal(placed[0].groupCount, 1);
    assert.equal(groups.length, 1);
  });

  test("distant markers remain completely individual without any clustering", () => {
    const markers: ClusterableMarker[] = [
      { id: "v1", lat: 26.9124, lng: 75.7873, status: "MOVING" }, // Jaipur
      { id: "v2", lat: 24.5854, lng: 73.7125, status: "STOPPED" }, // Udaipur (~300km)
      { id: "v3", lat: 26.2389, lng: 73.0243, status: "IDLING" }, // Jodhpur (~300km)
    ];
    const { placed } = resolveOverlappingFleet(markers, 8);

    assert.equal(placed.length, 3);
    // All 3 markers are placed directly at their real coordinates
    assert.equal(placed[0].displayLat, 26.9124);
    assert.equal(placed[1].displayLat, 24.5854);
    assert.equal(placed[2].displayLat, 26.2389);
    assert.equal(placed.every((p) => !p.isOffset), true);
  });

  test("2-4 overlapping markers receive micro-offsets so all are visible and clickable", () => {
    const markers: ClusterableMarker[] = [
      { id: "v1", lat: 26.90000, lng: 75.80000, status: "MOVING" },
      { id: "v2", lat: 26.90000, lng: 75.80000, status: "STOPPED" },
    ];
    const { placed, groups } = resolveOverlappingFleet(markers, 12);

    assert.equal(placed.length, 2);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 2);

    // Real coordinates are preserved
    assert.equal(placed[0].realLat, 26.90000);
    assert.equal(placed[1].realLat, 26.90000);

    // Display coordinates are separated so both are visible and clickable
    assert.equal(placed[0].isOffset, true);
    assert.equal(placed[1].isOffset, true);
    assert.notEqual(placed[0].displayLat, placed[1].displayLat);
  });

  test("spiderfying an overlapping group expands them with connector lines", () => {
    const markers: ClusterableMarker[] = [
      { id: "v1", lat: 26.90000, lng: 75.80000, status: "MOVING" },
      { id: "v2", lat: 26.90000, lng: 75.80000, status: "STOPPED" },
      { id: "v3", lat: 26.90000, lng: 75.80000, status: "IDLING" },
    ];
    const { groups } = resolveOverlappingFleet(markers, 12);
    const groupId = groups[0].id;

    const { placed } = resolveOverlappingFleet(markers, 12, groupId);
    assert.equal(placed.length, 3);
    for (const p of placed) {
      assert.equal(p.isSpiderfied, true);
      assert.ok(p.spiderLine != null);
      assert.deepEqual(p.spiderLine[0], [26.90000, 75.80000]);
    }
  });
});
