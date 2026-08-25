/**
 * The colours and number-shapes every chart in the product draws from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A FILE AND NOT A LITERAL IN EACH CHART
 *
 * The palette that was here before was nine hues picked by eye. Run against a
 * colour-vision simulation it fails: orange `#f97316` and lime `#84cc16` sit
 * ΔE 5.3 apart under deuteranopia — the most common form, roughly one man in
 * twelve — which is to say two of the nine cost heads on the dashboard's main
 * chart were the same colour for a meaningful share of the people reading it.
 * Five of the nine also sat below 3:1 contrast against the white card, so the
 * thin marks were faint even for readers with typical vision.
 *
 * None of that is visible to the person choosing the colours. It is only
 * visible to the person who cannot read the chart, and they generally assume
 * the fault is theirs. So the palette is fixed here, once, and checked with a
 * script rather than an opinion.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER IS THE SAFETY MECHANISM
 *
 * Slots are assigned top-down and never cycled. Adjacent slots are the pairs a
 * reader actually has to tell apart — neighbouring segments in a stack, lines
 * that cross — so the ordering is chosen so that every *adjacent* pair clears
 * the separation floor under protanopia, deuteranopia and tritanopia.
 *
 * Reordering these by taste silently breaks that. If you want a different
 * order, re-run the validator on the candidate and only adopt a passing one.
 *
 * Verified on the white card surface (#fff):
 *   lightness band  PASS · chroma floor PASS
 *   CVD separation  PASS  worst adjacent ΔE 9.1
 *   normal vision   PASS  worst adjacent ΔE 19.6
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EIGHT AND NOT NINE
 *
 * Eight is the ceiling at which hue can still carry identity. A ninth is not a
 * new colour, it is a duplicate of one of the eight under CVD. When a chart has
 * more than eight categories the answer is `foldToOther` below — never another
 * hue.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Categorical slots — identity. Assigned in order, never cycled. */
export const SERIES = [
  "#3366ff", // 1 · brand blue — the product's own hue, so charts sit with the UI
  "#eb6834", // 2 · orange
  "#1baf7a", // 3 · aqua
  "#eda100", // 4 · yellow
  "#e87ba4", // 5 · magenta
  "#008300", // 6 · green
  "#4a3aa7", // 7 · violet
  "#e34948", // 8 · red
] as const;

/**
 * Reserved for state, never for identity.
 *
 * A status colour means good/bad. Using one as "series 4" teaches the reader
 * that red means a category rather than a problem, and then a genuinely red
 * thing on the same screen stops registering. These four never appear in
 * `SERIES` and `SERIES` never appears here.
 *
 * `warning` and `serious` are below 3:1 on white on purpose — they are only
 * ever used alongside an icon and a word, so the colour is never load-bearing.
 */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

/**
 * Magnitude — one hue, light to dark. Never a rainbow: a multi-hue ramp asks
 * the reader to learn an arbitrary order, where lightness is already understood
 * by everyone without a legend.
 */
export const SEQUENTIAL = [
  "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#256abf", "#184f95",
] as const;

/** Chart chrome. Recessive by construction — the data is the only loud thing. */
export const INK = {
  /** The card the charts are drawn on. Also the colour of the gaps between marks. */
  surface: "#ffffff",
  primary: "#0b1220",
  secondary: "#52596b",
  /** Axis ticks and labels. */
  muted: "#8b93a5",
  /** Hairline, solid. Dashed grids read as "projection" when they are just a grid. */
  grid: "#eef1f6",
  axis: "#dfe4ed",
  /** For emphasis charts: every series that is not the point. */
  mute: "#cbd3e1",
} as const;

/** One series in the accent hue, the rest grey. The honest answer to most charts. */
export const emphasis = (isSubject: boolean, accent: string = SERIES[0]) =>
  isSubject ? accent : INK.mute;

/**
 * Collapses a long tail into a single "Other" so a chart never needs a ninth
 * hue.
 *
 * Ranked by total across the whole series rather than by the latest period, so
 * a category does not change colour when the reader changes the date range —
 * colour follows the thing, not its current rank.
 */
export function foldToOther<T extends Record<string, unknown>>(
  rows: T[],
  keys: string[],
  max = 6,
): { rows: T[]; keys: string[] } {
  if (keys.length <= max) return { rows, keys };

  const total = (k: string) =>
    rows.reduce((s, r) => s + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);

  const ranked = [...keys].sort((a, b) => total(b) - total(a));
  const kept = ranked.slice(0, max - 1);
  const folded = ranked.slice(max - 1);
  // Keys stay in their original order so the stack does not reshuffle itself.
  const keptInOrder = keys.filter((k) => kept.includes(k));

  return {
    rows: rows.map((r) => ({
      ...r,
      Other: folded.reduce((s, k) => s + (typeof r[k] === "number" ? (r[k] as number) : 0), 0),
    })),
    keys: [...keptInOrder, "Other"],
  };
}

/**
 * Axis and tooltip numbers.
 *
 * Indian digit grouping, because every figure in this product is rupees or
 * litres read by people who group in lakhs. `1,20,000` and `120,000` are the
 * same number but only one of them is read at a glance here.
 */
export const fmtNum = (v: number) =>
  Number.isFinite(v) ? new Intl.NumberFormat("en-IN").format(Math.round(v)) : "—";

/** Axis ticks only — keeps a long axis from getting wider than its chart. */
export function fmtCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(v));
}
