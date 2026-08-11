"use client";

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

const BRAND = "#3366ff";
const PALETTE = ["#3366ff", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316"];

const axisProps = { stroke: "#94a3b8", fontSize: 11, tickLine: false, axisLine: false };

export type ChartDataPoint = Record<string, unknown>;

function fmtTip(v: number) {
  return new Intl.NumberFormat("en-IN").format(Math.round(v));
}

export function TrendArea({ data, dataKey, xKey = "label" }: { data: ChartDataPoint[]; dataKey: string; xKey?: string }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={BRAND} stopOpacity={0.3} />
            <stop offset="95%" stopColor={BRAND} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => fmtTip(v)} />
        <Tooltip formatter={(v) => fmtTip(Number(v))} contentStyle={{ borderRadius: 12, border: "1px solid #e6ebf4" }} />
        <Area type="monotone" dataKey={dataKey} stroke={BRAND} strokeWidth={2} fill="url(#g1)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MultiBar({ data, keys, xKey = "label" }: { data: ChartDataPoint[]; keys: string[]; xKey?: string }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsBarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => fmtTip(v)} />
        <Tooltip formatter={(v) => fmtTip(Number(v))} contentStyle={{ borderRadius: 12, border: "1px solid #e6ebf4" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} stackId="a" fill={PALETTE[i % PALETTE.length]} radius={i === keys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

export function SimpleBar({
  data,
  dataKey,
  xKey = "label",
  color,
  bars,
}: {
  data: ChartDataPoint[];
  dataKey?: string;
  xKey?: string;
  color?: string;
  bars?: { key: string; color?: string; name?: string }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <RechartsBarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => fmtTip(v)} />
        <Tooltip formatter={(v) => fmtTip(Number(v))} contentStyle={{ borderRadius: 12, border: "1px solid #e6ebf4" }} />
        {bars ? (
          <>
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {bars.map((b, i) => (
              <Bar key={b.key} dataKey={b.key} name={b.name ?? b.key} fill={b.color ?? PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} />
            ))}
          </>
        ) : (
          <Bar dataKey={dataKey!} fill={color ?? BRAND} radius={[4, 4, 0, 0]} />
        )}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

export function BarChart({
  data,
  dataKey,
  xKey = "label",
  color,
  bars,
}: {
  data: ChartDataPoint[];
  dataKey?: string;
  xKey?: string;
  color?: string;
  bars?: { key: string; color?: string; name?: string }[];
}) {
  return <SimpleBar data={data} dataKey={dataKey} xKey={xKey} color={color} bars={bars} />;
}

export function Donut({ data }: { data: { name: string; value: number; color?: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color ?? PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => fmtTip(Number(v))} contentStyle={{ borderRadius: 12, border: "1px solid #e6ebf4" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data }: { data: { name: string; value: number; color?: string }[] }) {
  return <Donut data={data} />;
}

export function DualLine({
  data,
  xKey = "label",
  lines,
}: {
  data: ChartDataPoint[];
  xKey?: string;
  lines: { key: string; color?: string; name?: string }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <RechartsLineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} />
        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e6ebf4" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {lines.map((l, i) => (
          <Line key={l.key} name={l.name ?? l.key} type="monotone" dataKey={l.key} stroke={l.color ?? PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}

export function LineChart({
  data,
  xKey = "label",
  lines,
}: {
  data: ChartDataPoint[];
  xKey?: string;
  lines: { key: string; color?: string; name?: string }[];
}) {
  return <DualLine data={data} xKey={xKey} lines={lines} />;
}
