import React, { useMemo, useState } from "react";
import { Cell, Label, Pie, PieChart, ResponsiveContainer, Sector } from "recharts";

import { toMoney } from "../../utils/money";

/** Palette aligned to the 21st objections-style donut preview. */
const EXPENSE_DONUT_COLORS = ["#0d9488", "#059669", "#d97706", "#94a3b8", "#0891b2", "#14b8a6", "#e11d48", "#0f766e"];

function pctOf(value, total) {
  if (!total) return 0;
  return Math.round((Number(value) / total) * 1000) / 10;
}

/**
 * Interactive expense donut:
 * - Heading: Expenses breakdown
 * - Default center = Total Expenses
 * - Hover / click slice or legend → center + amount/% highlight
 */
export default function ExpenseCategoryDonutCard({ data, className = "" }) {
  const [selectedName, setSelectedName] = useState(null);
  const [hoveredName, setHoveredName] = useState(null);

  const rows = useMemo(
    () =>
      (data || [])
        .map((d, i) => ({
          name: d.name || d.category_name || "Category",
          value: Number(d.total ?? d.value ?? 0),
          fill: EXPENSE_DONUT_COLORS[i % EXPENSE_DONUT_COLORS.length],
        }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((d, i) => ({
          ...d,
          fill: EXPENSE_DONUT_COLORS[i % EXPENSE_DONUT_COLORS.length],
        })),
    [data]
  );

  const total = useMemo(() => rows.reduce((s, r) => s + r.value, 0), [rows]);

  const activeName = hoveredName || selectedName;
  const activeRow = activeName ? rows.find((r) => r.name === activeName) : null;
  const centerLabel = activeRow ? activeRow.name : "Total Expenses";
  const centerValue = activeRow ? activeRow.value : total;
  const centerPct = activeRow ? pctOf(activeRow.value, total) : 100;

  const selectCategory = (name) => {
    setSelectedName((prev) => (prev === name ? null : name));
  };

  const renderSlice = (props) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, index } = props;
    const row = rows[index];
    const isHighlighted = Boolean(activeName && row && activeName === row.name);
    const isDimmed = Boolean(activeName && row && activeName !== row.name);
    return (
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={isHighlighted ? outerRadius + 6 : outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        fillOpacity={isDimmed ? 0.28 : 1}
        stroke={isHighlighted ? "#fff" : "transparent"}
        strokeWidth={isHighlighted ? 1.5 : 0}
        cornerRadius={8}
        style={
          isHighlighted ? { filter: "drop-shadow(0 0 10px rgba(255,255,255,0.18))" } : undefined
        }
      />
    );
  };

  return (
    <article className={`dash-expense-donut ${className}`.trim()}>
      <header className="dash-expense-donut__head">
        <h3 className="dash-expense-donut__title">Expenses breakdown</h3>
        <p className="dash-expense-donut__hint">
          {activeRow ? "Click again to show total" : "Hover or click a category"}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="dash-expense-donut__empty">No expense categories in this range.</p>
      ) : (
        <>
          <div className="dash-expense-donut__chart">
            <ResponsiveContainer width="100%" height={176}>
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={2.5}
                  stroke="transparent"
                  isAnimationActive
                  animationDuration={420}
                  shape={renderSlice}
                  onClick={(_, index) => {
                    const row = rows[index];
                    if (row) selectCategory(row.name);
                  }}
                  onMouseEnter={(_, index) => {
                    const row = rows[index];
                    if (row) setHoveredName(row.name);
                  }}
                  onMouseLeave={() => setHoveredName(null)}
                  style={{ cursor: "pointer", outline: "none" }}
                >
                  {rows.map((row) => (
                    <Cell key={row.name} fill={row.fill} />
                  ))}
                  <Label
                    content={({ viewBox }) => {
                      if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
                      const { cx, cy } = viewBox;
                      const label =
                        String(centerLabel).length > 18
                          ? `${String(centerLabel).slice(0, 16)}…`
                          : centerLabel;
                      return (
                        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                          <tspan x={cx} y={cy - 14} fill="#94a3b8" fontSize="10" fontWeight="600">
                            {label}
                          </tspan>
                          <tspan x={cx} y={cy + 6} fill="#ffffff" fontSize="18" fontWeight="750">
                            {toMoney(centerValue)}
                          </tspan>
                          <tspan x={cx} y={cy + 24} fill="#64748b" fontSize="10" fontWeight="600">
                            {activeRow
                              ? `${centerPct}% of total`
                              : `${rows.length} categor${rows.length === 1 ? "y" : "ies"}`}
                          </tspan>
                        </text>
                      );
                    }}
                  />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="dash-expense-donut__divider" />

          <ul className="dash-expense-donut__legend" onMouseLeave={() => setHoveredName(null)}>
            {rows.map((row) => {
              const isActive = activeName === row.name;
              const pct = pctOf(row.value, total);
              return (
                <li key={row.name}>
                  <button
                    type="button"
                    className={`dash-expense-donut__legend-btn${isActive ? " is-active" : ""}`}
                    onClick={() => selectCategory(row.name)}
                    onMouseEnter={() => setHoveredName(row.name)}
                    aria-pressed={selectedName === row.name}
                  >
                    <span className="dash-expense-donut__legend-main">
                      <span className="dash-expense-donut__legend-name">
                        <i style={{ background: row.fill }} aria-hidden="true" />
                        {row.name}
                      </span>
                      <span className="dash-expense-donut__legend-meta">
                        <strong>{toMoney(row.value)}</strong>
                        <em>{pct}%</em>
                      </span>
                    </span>
                    <span className="dash-expense-donut__bar" aria-hidden="true">
                      <span
                        className="dash-expense-donut__bar-fill"
                        style={{ width: `${Math.max(pct, 2)}%`, background: row.fill }}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </article>
  );
}
