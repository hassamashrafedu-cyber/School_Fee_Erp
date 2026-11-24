import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import ChartCard from "./ChartCard";
import { CHART_COLORS, axisTick, gridStroke, tooltipStyle } from "./chartTheme";

export default function StackedBarChartCard({ title, subtitle, data }) {
  const rows = useMemo(
    () =>
      (data || []).map((d) => ({
        name: d.class_name || d.name || "—",
        Male: Number(d.male_students || 0),
        Female: Number(d.female_students || 0),
        total: Number(d.total_students || 0),
      })),
    [data]
  );

  const height = Math.max(240, Math.min(420, 56 + rows.length * 36));

  return (
    <ChartCard title={title} subtitle={subtitle} empty={rows.length === 0 ? "No class strength data." : null}>
      <div className="dash-chart-card__body">
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid stroke={gridStroke} strokeDasharray="3 6" horizontal vertical={false} />
            <XAxis type="number" tick={axisTick} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={88} tick={axisTick} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12, color: "#475569" }} />
            <Bar dataKey="Male" stackId="a" fill={CHART_COLORS.blue} radius={[0, 0, 0, 0]} maxBarSize={22} />
            <Bar dataKey="Female" stackId="a" fill={CHART_COLORS.rose} radius={[0, 8, 8, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
