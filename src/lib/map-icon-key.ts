/**
 * What a vehicle marker looks like, as a string.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The live console polls every fifteen seconds and each poll returns a fresh
 * array, so every marker object is new. Left alone that means a new Leaflet
 * icon per marker per poll, `setIcon()` called on all of them, and the whole
 * fleet's markers torn down and rebuilt four times a minute — for vehicles
 * that are mostly parked and unchanged. It also makes the registration plates
 * flicker while somebody is trying to read one.
 *
 * Equal keys mean a visually identical marker, so the built icon can be reused.
 * This lives apart from the map component because that file imports Leaflet,
 * which needs a browser; the rule deciding when a repaint is warranted should
 * be checkable without one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Headings are rounded into buckets of this many degrees.
 *
 * A stationary truck's reported course wanders a degree or two between samples.
 * At full precision that is a fresh icon — and a repaint — for a vehicle that
 * has not moved. Ten degrees is finer than anyone can read off a 32px chevron
 * and collapses that churn to nothing.
 */
export const HEADING_BUCKET_DEG = 10;

export function iconCacheKey(
  m: { status: string; label: string; headingDeg: number | null },
  active: boolean,
  showLabel: boolean,
): string {
  // A course of 0° is due north — a real bearing, and not the same thing as a
  // vehicle reporting no course at all, which draws a plain disc instead of a
  // chevron. Checking for null rather than falsiness keeps those apart.
  const known = m.headingDeg != null && Number.isFinite(m.headingDeg);
  const bucket = known
    ? Math.round((m.headingDeg as number) / HEADING_BUCKET_DEG) * HEADING_BUCKET_DEG
    : "none";
  return `${m.status}|${bucket}|${active ? 1 : 0}|${showLabel ? 1 : 0}|${m.label}`;
}
