import React, { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { toMoney } from "../../utils/money";
import ChartCard from "./ChartCard";
import { CHART_COLORS, axisTick, gridStroke, tooltipStyle } from "./chartTheme";

export function AreaTrendChartCard({ title, subtitle, data, dataKey = "collection", color = CHART_COLORS.teal }) {
  const rows = useMemo(
    () =>
      (data || []).map((d) => ({
        label: d.label,
        value: Number(d[dataKey] || 0),
      })),
    [data, dataKey]
  );

  return (
    <ChartCard title={title} subtitle={subtitle} empty={rows.length === 0 ? "No trend data." : null}>
      <div className="dash-chart-card__body">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={gridStroke} strokeDasharray="3 6" />
            <XAxis dataKey="label" tick={axisTick} minTickGap={18} />
            <YAxis tick={axisTick} tickFormatter={(v) => toMoney(v)} width={64} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [toMoney(value), title]} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2.4}
              fill={`url(#grad-${dataKey})`}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function MultiSeriesTrendCard({ title, subtitle, data, className = "" }) {
  const rows = useMemo(
    () =>
      (data || []).map((d) => ({
        label: d.label,
        collection: Number(d.collection || 0),
        expenses: Number(d.expenses || 0),
        profit: Number(d.profit || 0),
      })),
    [data]
  );

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      empty={rows.length === 0 ? "No trend data." : null}
    >
      <div className="dash-chart-card__body">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="grad-collection-flow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.teal} stopOpacity={0.28} />
                <stop offset="100%" stopColor={CHART_COLORS.teal} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={gridStroke} strokeDasharray="3 6" />
            <XAxis dataKey="label" tick={axisTick} minTickGap={18} />
            <YAxis tick={axisTick} tickFormatter={(v) => toMoney(v)} width={64} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [toMoney(value), name]} />
            <Legend wrapperStyle={{ fontSize: 12, color: "#475569" }} />
            <Area
              type="monotone"
              dataKey="collection"
              name="Collection"
              stroke={CHART_COLORS.teal}
              strokeWidth={2.6}
              fill="url(#grad-collection-flow)"
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="expenses"
              name="Expenses"
              stroke={CHART_COLORS.amber}
              strokeWidth={2.4}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="profit"
              name="Profit"
              stroke={CHART_COLORS.indigo}
              strokeWidth={2.6}
              strokeDasharray="6 4"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function IncomeMixBarCard({ title, subtitle, data }) {
  const rows = useMemo(
    () =>
      (data || [])
        .map((d) => ({ name: d.name, value: Number(d.value || 0) }))
        .filter((d) => d.value > 0),
    [data]
  );

  const colorMap = {
    Collection: CHART_COLORS.teal,
    Additional: CHART_COLORS.blue,
    Expenses: CHART_COLORS.amber,
  };

  return (
    <ChartCard title={title} subtitle={subtitle} empty={rows.length === 0 ? "No income data." : null}>
      <div className="dash-chart-card__body">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid stroke={gridStroke} strokeDasharray="3 6" vertical={false} />
            <XAxis dataKey="name" tick={axisTick} />
            <YAxis tick={axisTick} tickFormatter={(v) => toMoney(v)} width={64} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [toMoney(value), "Amount"]} />
            <Bar dataKey="value" radius={[10, 10, 4, 4]} maxBarSize={56}>
              {rows.map((row) => (
                <Cell key={row.name} fill={colorMap[row.name] || CHART_COLORS.slate} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="dash-income-mix-legend">
          {rows.map((row) => (
            <span key={row.name} className="dash-income-mix-legend__item">
              <i style={{ background: colorMap[row.name] || CHART_COLORS.slate }} />
              {row.name}: <strong>{toMoney(row.value)}</strong>
            </span>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}
