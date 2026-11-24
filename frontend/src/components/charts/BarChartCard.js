import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { toMoney } from "../../utils/money";
import ChartCard from "./ChartCard";
import { CHART_COLORS, axisTick, gridStroke, tooltipStyle } from "./chartTheme";

export default function BarChartCard({
  title,
  subtitle,
  data,
  nameKey = "name",
  valueKey = "total",
  color = CHART_COLORS.teal,
  layout = "horizontal",
  money = true,
  valueLabel = "Amount",
}) {
  const rows = useMemo(
    () =>
      (data || [])
        .map((d) => ({
          name: d[nameKey] || d.class_name || d.name || "—",
          value: Number(d[valueKey] || d.total || d.value || 0),
        }))
        .filter((d) => d.value > 0)
        .slice(0, 12),
    [data, nameKey, valueKey]
  );

  const height = Math.max(240, Math.min(420, 56 + rows.length * 36));

  return (
    <ChartCard title={title} subtitle={subtitle} empty={rows.length === 0 ? "No data for this range." : null}>
      <div className="dash-chart-card__body">
        <ResponsiveContainer width="100%" height={layout === "vertical" ? 260 : height}>
          <BarChart
            data={rows}
            layout={layout === "horizontal" ? "vertical" : "horizontal"}
            margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
          >
            <CartesianGrid stroke={gridStroke} strokeDasharray="3 6" horizontal vertical={false} />
            {layout === "horizontal" ? (
              <>
                <XAxis type="number" tick={axisTick} tickFormatter={(v) => (money ? toMoney(v) : v)} />
                <YAxis type="category" dataKey="name" width={88} tick={axisTick} />
              </>
            ) : (
              <>
                <XAxis dataKey="name" tick={axisTick} interval={0} angle={-20} textAnchor="end" height={52} />
                <YAxis tick={axisTick} tickFormatter={(v) => (money ? toMoney(v) : v)} width={64} />
              </>
            )}
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => [money ? toMoney(value) : String(value), valueLabel]}
              labelFormatter={(label) => String(label)}
            />
            <Bar dataKey="value" fill={color} radius={[8, 8, 8, 8]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
