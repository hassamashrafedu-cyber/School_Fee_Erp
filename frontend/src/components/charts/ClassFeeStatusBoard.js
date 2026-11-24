import React, { useEffect, useMemo, useState } from "react";
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
import { CHART_COLORS, axisTick, gridStroke } from "./chartTheme";

function classSortKey(name) {
  const n = Number(String(name).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : String(name);
}

function pickLowestClassName(rows) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => {
    const ka = classSortKey(a.class_name);
    const kb = classSortKey(b.class_name);
    if (typeof ka === "number" && typeof kb === "number") return ka - kb;
    return String(a.class_name).localeCompare(String(b.class_name));
  });
  return sorted[0].class_name;
}

function rowFromEvent(item) {
  return item?.payload || item || null;
}

function ClassFeeTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="dash-class-fee-tooltip">
      <strong>Class {label}</strong>
      <div className="dash-class-fee-tooltip__row is-paid">
        <span>Paid students</span>
        <b>{row.paid}</b>
      </div>
      <div className="dash-class-fee-tooltip__sub">
        Male {row.male_paid} · Female {row.female_paid}
      </div>
      <div className="dash-class-fee-tooltip__row is-pending">
        <span>Pending fee students</span>
        <b>{row.pending}</b>
      </div>
      <div className="dash-class-fee-tooltip__sub">
        Male {row.male_pending} · Female {row.female_pending}
      </div>
      <div className="dash-class-fee-tooltip__hint">Click bar to keep this class open</div>
    </div>
  );
}

/**
 * Compact interactive chart: paid vs pending fee students per class.
 * Hover or click a bar to update the right panel. Defaults to lowest class.
 */
export default function ClassFeeStatusBoard({ title, subtitle, data }) {
  const rows = useMemo(
    () =>
      (Array.isArray(data) ? data : []).map((d) => ({
        class_name: d.class_name,
        paid: Number(d.paid || 0),
        pending: Number(d.partial || 0),
        male_paid: Number(d.male_paid || 0),
        female_paid: Number(d.female_paid || 0),
        male_pending: Number(d.male_partial || 0),
        female_pending: Number(d.female_partial || 0),
        total: Number(d.total_students || 0),
      })),
    [data]
  );

  const defaultClass = useMemo(() => pickLowestClassName(rows), [rows]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [hoveredClass, setHoveredClass] = useState(null);

  useEffect(() => {
    if (!rows.length) {
      setSelectedClass(null);
      return;
    }
    setSelectedClass((prev) => {
      if (prev && rows.some((r) => r.class_name === prev)) return prev;
      return defaultClass;
    });
  }, [rows, defaultClass]);

  const focusClass = hoveredClass || selectedClass || defaultClass;
  const active = useMemo(
    () => rows.find((r) => r.class_name === focusClass) || rows[0] || null,
    [rows, focusClass]
  );

  const chartHeight = Math.max(260, Math.min(420, 48 + rows.length * 42));

  const focusFromBar = (item) => {
    const row = rowFromEvent(item);
    if (row?.class_name) setHoveredClass(row.class_name);
  };

  const selectFromBar = (item) => {
    const row = rowFromEvent(item);
    if (row?.class_name) {
      setSelectedClass(row.class_name);
      setHoveredClass(row.class_name);
    }
  };

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className="dash-chart-card--span"
      empty={rows.length === 0 ? "No class fee status for this filter." : null}
    >
      <div className="dash-class-fee-chart">
        <div className="dash-class-fee-chart__plot">
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 8, right: 16, left: 4, bottom: 4 }}
              barCategoryGap="28%"
              barGap={4}
              onMouseMove={(state) => {
                const name = state?.activeLabel;
                if (name != null && name !== "") setHoveredClass(String(name));
              }}
              onMouseLeave={() => setHoveredClass(null)}
            >
              <CartesianGrid stroke={gridStroke} strokeDasharray="3 6" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={axisTick} />
              <YAxis type="category" dataKey="class_name" width={56} tick={axisTick} />
              <Tooltip content={<ClassFeeTooltip />} cursor={{ fill: "rgba(99, 102, 241, 0.06)" }} />
              <Legend
                wrapperStyle={{ fontSize: 12, color: "#475569", paddingTop: 8 }}
                formatter={(value) => (value === "paid" ? "Paid students" : "Pending fee students")}
              />
              <Bar
                dataKey="paid"
                name="paid"
                fill={CHART_COLORS.teal}
                radius={[0, 8, 8, 0]}
                maxBarSize={16}
                cursor="pointer"
                onMouseEnter={focusFromBar}
                onMouseLeave={() => setHoveredClass(null)}
                onClick={selectFromBar}
              />
              <Bar
                dataKey="pending"
                name="pending"
                fill={CHART_COLORS.amber}
                radius={[0, 8, 8, 0]}
                maxBarSize={16}
                cursor="pointer"
                onMouseEnter={focusFromBar}
                onMouseLeave={() => setHoveredClass(null)}
                onClick={selectFromBar}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {active ? (
          <aside className="dash-class-fee-chart__focus" aria-live="polite">
            <p className="dash-class-fee-chart__focus-title">Class {active.class_name}</p>
            <p className="dash-class-fee-chart__focus-note">
              {hoveredClass
                ? "Hovering · click bar to keep open"
                : selectedClass === active.class_name
                  ? "Selected class"
                  : "Default · lowest class"}
            </p>
            <div className="dash-class-fee-chart__focus-grid">
              <div className="is-paid">
                <span>Paid students</span>
                <strong>{active.paid}</strong>
                <em>
                  Male {active.male_paid} · Female {active.female_paid}
                </em>
              </div>
              <div className="is-pending">
                <span>Pending fee students</span>
                <strong>{active.pending}</strong>
                <em>
                  Male {active.male_pending} · Female {active.female_pending}
                </em>
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </ChartCard>
  );
}
