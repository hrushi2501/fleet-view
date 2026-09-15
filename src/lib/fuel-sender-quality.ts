/**
 * Pure fuel-sender quality rules shared by live display and analytics.
 *
 * A single sample can be physically valid while the series is impossible. A
 * large fall followed by a large rise (or vice versa) is not evidence of burn,
 * fill, or theft: the sender has contradicted itself and the window must remain
 * unassessed.
 */
const UNSTABLE_SWING_FRACTION = 0.2;

/** @param litres oldest to newest */
export function senderContradictsItself(litres: number[], tankL: number | null): boolean {
  if (!tankL || tankL <= 0 || litres.length < 3) return false;
  const limit = tankL * UNSTABLE_SWING_FRACTION;
  let maxRise = 0;
  let maxFall = 0;

  for (let i = 1; i < litres.length; i++) {
    const delta = litres[i]! - litres[i - 1]!;
    if (delta > maxRise) maxRise = delta;
    if (-delta > maxFall) maxFall = -delta;
  }

  return maxRise > limit && maxFall > limit;
}
