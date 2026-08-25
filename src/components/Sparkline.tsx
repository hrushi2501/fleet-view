"use client";

import { fmtNum, SERIES } from "@/lib/viz";

/**
 * The shape of a number's recent history, at the size of a line of text.
 *
 * No axes, no grid, no tooltip: it is not read for values — the stat tile it
 * sits in carries the value. It answers "is this going up or down", which a
 * bare number cannot, and it costs almost nothing to show.
 */
export function Sparkline({
  data,
  color = SERIES[0],
  height = 32,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = 100 / (data.length - 1);

  const pts = data.map((v, i) => [i * step, 100 - ((v - min) / span) * 100] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const [lastX, lastY] = pts[pts.length - 1];

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      height={height}
      className="w-full"
      role="img"
      aria-label={`Trend: ${data.length} points, latest ${fmtNum(data[data.length - 1])}`}
    >
      <path
        d={`${line} L100,100 L0,100 Z`}
        fill={color}
        fillOpacity={0.1}
        stroke="none"
        // The area is decorative here; without this it skews under non-uniform
        // scaling, which `preserveAspectRatio="none"` guarantees.
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
