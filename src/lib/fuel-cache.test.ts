/**
 * A flickering sender must not decide what the screen says.
 *
 * RJ21GE1657 reported 227.8 L and 25.0 L within the same hour, while the truck
 * moved three kilometres — a 200-litre round trip on a 300-litre tank. Fuel
 * does not come back, so the low samples are noise.
 *
 * Every one of them is individually valid: 25 L is an ordinary level for a
 * 300 L tank, so no bounds check can catch it. Only its neighbours reveal it.
 * The cached level took whichever sample arrived last, and the page showed a
 * truck holding 210 litres as being at 28%.
 *
 * The median is tested here rather than the query, because the median IS the
 * decision — the query is just how the five samples are fetched.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

/** Same computation as `cachedFuelFor`, over samples given directly. */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

describe("an isolated spike cannot move the displayed level", () => {
  test("one absurd low among real readings is outvoted", () => {
    // RJ21GE1657's actual shape: steady around 70%, one sample at 8%.
    assert.equal(median([70.9, 71.4, 8.3, 70.2, 71.0]), 70.9);
  });

  test("two spikes in five still lose", () => {
    assert.equal(median([70.9, 8.3, 71.4, 8.3, 70.2]), 70.2);
  });

  test("the mean would have been dragged down where the median is not", () => {
    const xs = [70.9, 71.4, 8.3, 70.2, 71.0];
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(mean < 60, `mean ${mean} should be dragged toward the spike`);
    assert.equal(median(xs), 70.9);
  });
});

describe("a genuine change is still followed", () => {
  test("once most of the window agrees, the level moves", () => {
    // A real fill: the three newest samples are high, the two oldest low.
    assert.equal(median([88.0, 87.5, 88.2, 42.0, 41.8]), 87.5);
  });

  test("a steady decline tracks", () => {
    assert.equal(median([60, 62, 64, 66, 68]), 64);
  });

  test("no samples means no number, never a zero", () => {
    assert.equal(median([]), null);
  });
});

/**
 * The case a median cannot fix: a sender that holds two contradictory states.
 *
 * RJ21GE1657's real trace, 29 Aug. It sat around 210 L for twenty minutes,
 * dropped to 25 L for several, returned to 210, and repeated — while the truck
 * covered two kilometres. Each state persists long enough that whichever one is
 * winning decides a median, so the displayed level flipped between 70% and 9%.
 *
 * Both cannot be true. The high state moves in smooth 0.7 L steps and reads
 * like measurement; the low state repeats identical values and reads like a
 * floor. That is a reasonable guess — and a guess is exactly what must not be
 * printed, because this figure is where a theft investigation starts.
 */
describe("a sender that contradicts itself yields no number", () => {
  /** Same rule as `cachedFuelFor`: both a large rise and a large fall. */
  function unstable(series: number[], tankL: number): boolean {
    const limit = tankL * 0.2;
    let maxRise = 0;
    let maxFall = 0;
    for (let i = 1; i < series.length; i++) {
      const d = series[i]! - series[i - 1]!;
      if (d > maxRise) maxRise = d;
      if (-d > maxFall) maxFall = -d;
    }
    return maxRise > limit && maxFall > limit;
  }

  test("the real RJ21GE1657 trace is flagged unreliable", () => {
    // oldest → newest, litres, from the live table
    const trace = [25.0, 25.0, 209.2, 209.2, 212.0, 211.3, 209.9, 86.0, 28.1, 25.8];
    assert.equal(unstable(trace, 300), true);
  });

  test("a genuine refuel is NOT flagged — it rises and stays", () => {
    // 100 L put into a 300 L tank. Large rise, no matching fall.
    const fill = [96.0, 95.2, 94.8, 210.0, 209.4, 208.9, 208.1];
    assert.equal(unstable(fill, 300), false);
  });

  test("a genuine siphon is NOT flagged — it falls and stays", () => {
    // The event this system exists to catch must survive the filter.
    const theft = [240.0, 239.1, 238.4, 90.0, 89.2, 88.7, 88.0];
    assert.equal(unstable(theft, 300), false);
  });

  test("ordinary consumption is not flagged", () => {
    assert.equal(unstable([240, 236, 231, 227, 222, 218], 300), false);
  });
});
