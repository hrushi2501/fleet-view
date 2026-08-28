"use client";

/**
 * Every chart in the product, drawn to one set of rules.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The public shape of this file has not changed — the same eight components
 * with the same props — because seven screens draw from it and the point of
 * the change is how they look, not how they are called.
 *
 * What changed is everything inside:
 *
 *   colour     an eight-slot palette checked against colour-vision simulation
 *              rather than picked by eye (see `@/lib/viz`), and a hard fold to
 *              "Other" past six categories instead of a ninth hue that is a
 *              duplicate under CVD
 *   marks      bars capped at 24px so the band keeps some air, 2px gaps in the
 *              surface colour between stacked segments, 2px lines
 *   chrome     hairline solid gridlines, no vertical grid, muted axis ink —
 *              dashed grids read as "projection" when they are just a grid
 *   labels     a legend whenever there are two or more series and none when
 *              there is one, since a single swatch just restates the title
 *   tooltip    one shared component, so a number looks the same wherever the
 *              reader meets it
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LegendProps } from "recharts";

import { SERIES, INK, foldToOther, fmtNum, fmtCompact, formatValue, type ValueFormat } from "@/lib/viz";

export type ChartDataPoint = Record<string, unknown>;

/** Slot lookup. Never modulo — past eight, callers fold to "Other" instead. */
const slot = (i: number) => SERIES[i] ?? INK.mute;

const axisProps = {
  stroke: INK.muted,
  fontSize: 11,
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
} as const;

const gridProps = {
  stroke: INK.grid,
  vertical: false,
  strokeWidth: 1,
} as const;

const margin = { top: 8, right: 12, left: -8, bottom: 0 } as const;

/* ────────────────────────────── shared chrome ────────────────────────────── */

type TipEntry = { name?: string; value?: number | string; color?: string; dataKey?: string | number };

/**
 * One tooltip for every chart.
 *
 * Values are `tabular-nums` because they sit in a column and have to line up;
 * the swatch carries the series identity so the text can stay in ink and
 * remain legible for the light hues.
 */
function Tip({
  active,
  payload,
  label,
  format = fmtNum,
}: {
  active?: boolean;
  payload?: TipEntry[];
  label?: string | number;
  format?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;

  // Zero-valued series are noise in a nine-row tooltip — the reader is hovering
  // to find out what is there, not what is absent.
  const rows = payload.filter((p) => Number(p.value) !== 0);
  if (!rows.length) return null;

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/95 px-3 py-2 shadow-lg shadow-slate-900/5 backdrop-blur">
      {label != null && (
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      )}
      <div className="space-y-1">
        {rows.map((p, i) => (
          <div key={i} className="flex items-center gap-2.5 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: p.color ?? INK.mute }}
              aria-hidden
            />
            <span className="mr-auto text-slate-500">{p.name ?? p.dataKey}</span>
            <span className="font-semibold tabular-nums text-ink-900">{format(Number(p.value))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Dots rather than Recharts' default squares, and ink-coloured text. */
const legendContent: LegendProps["content"] = ({ payload }) => {
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-3">
      {payload.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
          {String(p.value)}
        </span>
      ))}
    </div>
  );
};

const legendProps = { content: legendContent, verticalAlign: "bottom" as const, height: 36 };

/* ─────────────────────────────── time series ─────────────────────────────── */

/**
 * A single measure over time.
 *
 * No legend: there is one colour, so the card's title already says what is
 * plotted and a one-swatch box would only restate it.
 */
export function TrendArea({
  data,
  dataKey,
  xKey = "label",
  color = SERIES[0],
  height = 260,
  format,
}: {
  data: ChartDataPoint[];
  dataKey: string;
  xKey?: string;
  color?: string;
  height?: number;
  format?: ValueFormat;
}) {
  const id = `fill-${dataKey.replace(/\W/g, "")}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={margin}>
        <defs>
          {/* A wash, not a saturated block — the line carries the value. */}
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.16} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={fmtCompact} width={48} />
        <Tooltip content={<Tip format={formatValue(format)} />} cursor={{ stroke: INK.axis, strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={`url(#${id})`}
          // The ring is surface-coloured so the marker stays readable where it
          // crosses the line, and it doubles the hover target.
          activeDot={{ r: 4, fill: color, stroke: INK.surface, strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ──────────────────────────────── bar family ─────────────────────────────── */

/**
 * Part-to-whole across a time axis.
 *
 * Folds past six categories rather than reaching for a seventh and eighth hue.
 * The dashboard's cost chart stacks nine heads; four of those are rounding
 * error next to fuel, and as separate colours they cost the reader more than
 * they tell them.
 */
export function MultiBar({
  data,
  keys,
  xKey = "label",
  height = 300,
  format,
}: {
  data: ChartDataPoint[];
  keys: string[];
  xKey?: string;
  height?: number;
  format?: ValueFormat;
}) {
  const folded = foldToOther(data, keys);
  const rows = folded.rows;
  const shown = folded.keys;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={rows} margin={margin}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={fmtCompact} width={48} />
        <Tooltip content={<Tip format={formatValue(format)} />} cursor={{ fill: INK.grid, fillOpacity: 0.6 }} />
        {shown.length > 1 && <Legend {...legendProps} />}
        {shown.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            stackId="a"
            fill={k === "Other" ? INK.mute : slot(i)}
            maxBarSize={28}
            // Surface-coloured stroke *is* the gap. A contrasting border would
            // add ink that is not data; this subtracts it.
            stroke={INK.surface}
            strokeWidth={2}
            radius={i === shown.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

/**
 * Magnitude across categories.
 *
 * `highlight` turns this into an emphasis chart: the named category keeps the
 * accent and every other bar goes grey. When one bar is the story — the site
 * that is losing diesel, the vehicle that is off the norm — that reads in a
 * glance where eight equal colours do not.
 */
export function SimpleBar({
  data,
  dataKey,
  xKey = "label",
  color,
  bars,
  height = 280,
  highlight,
  format,
}: {
  data: ChartDataPoint[];
  dataKey?: string;
  xKey?: string;
  color?: string;
  bars?: { key: string; color?: string; name?: string }[];
  height?: number;
  highlight?: string;
  format?: ValueFormat;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} margin={margin}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={fmtCompact} width={48} />
        <Tooltip content={<Tip format={formatValue(format)} />} cursor={{ fill: INK.grid, fillOpacity: 0.6 }} />
        {bars && bars.length > 1 && <Legend {...legendProps} />}
        {bars ? (
          bars.map((b, i) => (
            <Bar
              key={b.key}
              dataKey={b.key}
              name={b.name ?? b.key}
              fill={b.color ?? slot(i)}
              maxBarSize={24}
              stroke={INK.surface}
              strokeWidth={2}
              radius={[4, 4, 0, 0]}
            />
          ))
        ) : (
          <Bar dataKey={dataKey!} maxBarSize={24} radius={[4, 4, 0, 0]}>
            {data.map((row, i) => (
              <Cell
                key={i}
                fill={
                  highlight == null
                    ? color ?? SERIES[0]
                    : String(row[xKey]) === highlight
                      ? color ?? SERIES[0]
                      : INK.mute
                }
              />
            ))}
          </Bar>
        )}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

export function BarChart(props: Parameters<typeof SimpleBar>[0]) {
  return <SimpleBar {...props} />;
}

/* ─────────────────────────────────── donut ───────────────────────────────── */

/**
 * Part-to-whole at a glance.
 *
 * Only ever a rough shape — a donut cannot be read for close values, so the
 * total sits in the hole and the legend carries the actual numbers. Past six
 * segments the tail folds, for the same reason as the stack.
 */
export function Donut({
  data,
  height = 260,
  centerLabel,
  format,
}: {
  data: { name: string; value: number; color?: string }[];
  height?: number;
  centerLabel?: string;
  format?: ValueFormat;
}) {
  const ranked = [...data].sort((a, b) => b.value - a.value);
  const shown =
    ranked.length > 6
      ? [
          ...ranked.slice(0, 5),
          { name: "Other", value: ranked.slice(5).reduce((s, d) => s + d.value, 0), color: INK.mute },
        ]
      : ranked;

  const total = shown.reduce((s, d) => s + d.value, 0);

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={shown}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="92%"
            // The gap between segments is the surface showing through, the same
            // 2px used between stacked bars.
            paddingAngle={2}
            stroke={INK.surface}
            strokeWidth={2}
          >
            {shown.map((entry, i) => (
              <Cell key={i} fill={entry.color ?? slot(i)} />
            ))}
          </Pie>
          <Tooltip content={<Tip format={formatValue(format)} />} />
          {shown.length > 1 && <Legend {...legendProps} />}
        </PieChart>
      </ResponsiveContainer>

      {/* The total belongs in the hole: it is the one number a donut can state
          exactly, and without it the reader is left estimating from arcs. */}
      <div
        className="pointer-events-none absolute inset-x-0 flex flex-col items-center justify-center"
        style={{ top: 0, height: height - 36 }}
      >
        <p className="text-2xl font-bold tracking-tight text-ink-900">{formatValue(format)(total)}</p>
        {centerLabel && (
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{centerLabel}</p>
        )}
      </div>
    </div>
  );
}

export function DonutChart(props: Parameters<typeof Donut>[0]) {
  return <Donut {...props} />;
}

/* ─────────────────────────────────── lines ───────────────────────────────── */

export function DualLine({
  data,
  xKey = "label",
  lines,
  height = 280,
  format,
}: {
  data: ChartDataPoint[];
  xKey?: string;
  lines: { key: string; color?: string; name?: string }[];
  height?: number;
  format?: ValueFormat;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data} margin={margin}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={fmtCompact} width={48} />
        <Tooltip content={<Tip format={formatValue(format)} />} cursor={{ stroke: INK.axis, strokeWidth: 1 }} />
        {lines.length > 1 && <Legend {...legendProps} />}
        {lines.map((l, i) => (
          <Line
            key={l.key}
            name={l.name ?? l.key}
            type="monotone"
            dataKey={l.key}
            stroke={l.color ?? slot(i)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 4, stroke: INK.surface, strokeWidth: 2 }}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}

export function LineChart(props: Parameters<typeof DualLine>[0]) {
  return <DualLine {...props} />;
}

/** Re-exported so `@/components/charts` stays the one place charts come from.
 *  It lives apart because it is plain SVG — importing it must not drag recharts
 *  into a page that only wanted a sparkline in a stat tile. */
export { Sparkline } from "@/components/Sparkline";
