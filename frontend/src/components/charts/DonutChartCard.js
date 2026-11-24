import React, { useMemo } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { toMoney } from "../../utils/money";
import ChartCard from "./ChartCard";
import { DONUT_PALETTE, tooltipStyle } from "./chartTheme";

export default function DonutChartCard({ title, subtitle, data, valueKey = "value", nameKey = "name", money = true }) {
  const rows = useMemo(
    () =>
      (data || [])
        .map((d) => ({
          name: d[nameKey],
          value: Number(d[valueKey] || d.total || 0),
        }))
        .filter((d) => d.value > 0),
    [data, nameKey, valueKey]
  );

  const total = useMemo(() => rows.reduce((s, r) => s + r.value, 0), [rows]);

  return (
    <ChartCard title={title} subtitle={subtitle} empty={rows.length === 0 ? "No data for this range." : null}>
      <div className="dash-chart-card__body dash-chart-card__body--donut">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="48%"
              innerRadius={58}
              outerRadius={88}
              paddingAngle={2}
              stroke="#0b1220"
              strokeWidth={2}
            >
              {rows.map((_, i) => (
                <Cell key={`c-${i}`} fill={DONUT_PALETTE[i % DONUT_PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value, name) => [
                money ? toMoney(value) : String(value),
                name,
              ]}
            />
            <Legend
              verticalAlign="bottom"
              height={42}
              iconType="circle"
              wrapperStyle={{ fontSize: 12, color: "#475569" }}
            />
          </PieChart>
        </ResponsiveContainer>
        {total > 0 ? (
          <div className="dash-donut-center" aria-hidden="true">
            <span className="dash-donut-center__label">Total</span>
            <strong className="dash-donut-center__value">{money ? toMoney(total) : total}</strong>
          </div>
        ) : null}
      </div>
    </ChartCard>
  );
}
