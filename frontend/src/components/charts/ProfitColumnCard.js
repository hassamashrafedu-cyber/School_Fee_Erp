import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { toMoney } from "../../utils/money";
import ChartCard from "./ChartCard";
import { CHART_COLORS, axisTick, gridStroke, tooltipStyle } from "./chartTheme";

const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function ProfitColumnCard({ title, subtitle, data, mode = "month" }) {
  const rows = useMemo(() => {
    if (mode === "year") {
      return (data || []).map((d) => ({
        label: String(d.year),
        profit: Number(d.profit || 0),
      }));
    }
    return (data || []).map((d) => ({
      label: MONTH_SHORT[Number(d.month)] || String(d.month),
      profit: Number(d.profit || 0),
    }));
  }, [data, mode]);

  return (
    <ChartCard title={title} subtitle={subtitle} empty={rows.length === 0 ? "No profit data." : null}>
      <div className="dash-chart-card__body">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={rows} margin={{ top: 10, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={gridStroke} strokeDasharray="3 6" vertical={false} />
            <XAxis dataKey="label" tick={axisTick} />
            <YAxis tick={axisTick} tickFormatter={(v) => toMoney(v)} width={64} />
            <Tooltip
              cursor={{ fill: "rgba(99, 102, 241, 0.08)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const profit = Number(payload[0]?.value || 0);
                const profitColor = profit >= 0 ? CHART_COLORS.indigo : CHART_COLORS.rose;
                const title = mode === "year" ? `Year ${label}` : label;
                return (
                  <div style={{ ...tooltipStyle, padding: "10px 12px" }}>
                    <div style={{ color: "#cbd5e1", fontWeight: 650, marginBottom: 4 }}>{title}</div>
                    <div style={{ color: profitColor, fontWeight: 750 }}>
                      Profit: {toMoney(profit)}
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="profit" radius={[8, 8, 2, 2]} maxBarSize={36}>
              {rows.map((row) => (
                <Cell
                  key={row.label}
                  fill={row.profit >= 0 ? CHART_COLORS.indigo : CHART_COLORS.rose}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
