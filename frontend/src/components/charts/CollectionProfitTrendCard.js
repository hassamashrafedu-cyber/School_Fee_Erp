import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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

const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * 21st-style dual series chart (collection + profit) for month bars / year lines.
 * Uses existing dashboard API rows — no backend changes.
 */
export default function CollectionProfitTrendCard({ title, subtitle, data, mode = "month" }) {
  const rows = useMemo(() => {
    if (mode === "year") {
      return (data || []).map((d) => ({
        label: String(d.year),
        collection: Number(d.collection || 0),
        profit: Number(d.profit || 0),
      }));
    }
    return (data || []).map((d) => ({
      label: MONTH_SHORT[Number(d.month)] || String(d.month),
      collection: Number(d.collection || 0),
      profit: Number(d.profit || 0),
    }));
  }, [data, mode]);

  const empty = rows.length === 0 ? "No trend data." : null;

  return (
    <ChartCard title={title} subtitle={subtitle} empty={empty}>
      <div className="dash-chart-card__body dash-collection-profit-trend">
        <ResponsiveContainer width="100%" height={280}>
          {mode === "year" ? (
            <LineChart accessibilityLayer data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={gridStroke} strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} tickMargin={10} />
              <YAxis tick={axisTick} tickFormatter={(v) => toMoney(v)} width={68} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ stroke: "rgba(148, 163, 184, 0.35)", strokeDasharray: "4 4" }}
                content={<DualSeriesTooltip mode={mode} />}
              />
              <Legend content={<DualSeriesLegend />} />
              <Line
                type="monotone"
                dataKey="collection"
                name="Collection"
                stroke={CHART_COLORS.teal}
                strokeWidth={2.6}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive
                animationDuration={480}
                animationEasing="ease-out"
              />
              <Line
                type="monotone"
                dataKey="profit"
                name="Profit"
                stroke={CHART_COLORS.indigo}
                strokeWidth={2.6}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive
                animationDuration={480}
                animationEasing="ease-out"
              />
            </LineChart>
          ) : (
            <BarChart accessibilityLayer data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={gridStroke} strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} tickMargin={10} />
              <YAxis tick={axisTick} tickFormatter={(v) => toMoney(v)} width={68} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: "rgba(99, 102, 241, 0.06)" }}
                content={<DualSeriesTooltip mode={mode} />}
              />
              <Legend content={<DualSeriesLegend />} />
              <Bar
                dataKey="collection"
                name="Collection"
                fill={CHART_COLORS.teal}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
                isAnimationActive
                animationDuration={480}
                animationEasing="ease-out"
                animationBegin={0}
              />
              <Bar
                dataKey="profit"
                name="Profit"
                fill={CHART_COLORS.indigo}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
                isAnimationActive
                animationDuration={480}
                animationEasing="ease-out"
                animationBegin={32}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function DualSeriesLegend({ payload }) {
  if (!payload?.length) return null;
  return (
    <div className="dash-collection-profit-trend__legend">
      {payload
        .filter((item) => item.type !== "none")
        .map((item) => (
          <span key={String(item.dataKey || item.value)} className="dash-collection-profit-trend__legend-item">
            <i style={{ background: item.color }} />
            {item.value}
          </span>
        ))}
    </div>
  );
}

function DualSeriesTooltip({ active, payload, label, mode }) {
  if (!active || !payload?.length) return null;
  const title = mode === "year" ? `Year ${label}` : label;
  return (
    <div style={{ ...tooltipStyle, padding: "10px 12px", minWidth: 148 }}>
      <div style={{ color: "#cbd5e1", fontWeight: 650, marginBottom: 6 }}>{title}</div>
      {payload
        .filter((item) => item.type !== "none")
        .map((item) => (
          <div
            key={String(item.dataKey)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              color: item.color || "#f1f5f9",
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            <span>{item.name}</span>
            <span>{toMoney(item.value)}</span>
          </div>
        ))}
    </div>
  );
}
