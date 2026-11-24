import React, { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";

import { toMoney } from "../../utils/money";

/** Colors close to the 21st browser-share pie preview. */
const PIE_COLORS = ["#14b8a6", "#22d3ee", "#d97706", "#0d9488", "#94a3b8", "#0891b2", "#34d399"];

function pctOf(value, total) {
  if (!total) return 0;
  return Math.round((Number(value) / total) * 1000) / 10;
}

/**
 * Classic solid pie for Collection distribution (Cash / Bank / Online).
 * Heading: Cash Distribution — hover/click shows amount + share.
 */
export default function CollectionDistributionPieCard({ data, className = "" }) {
  const [selectedName, setSelectedName] = useState(null);
  const [hoveredName, setHoveredName] = useState(null);

  const rows = useMemo(
    () =>
      (data || [])
        .map((d) => ({
          name: d.name || d.method || "Method",
          value: Number(d.total ?? d.value ?? 0),
        }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((d, i) => ({
          ...d,
          fill: PIE_COLORS[i % PIE_COLORS.length],
        })),
    [data]
  );

  const total = useMemo(() => rows.reduce((s, r) => s + r.value, 0), [rows]);
  const activeName = hoveredName || selectedName;
  const activeRow = activeName ? rows.find((r) => r.name === activeName) : null;
  const activePct = activeRow ? pctOf(activeRow.value, total) : 100;

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
        outerRadius={isHighlighted ? outerRadius + 8 : outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        fillOpacity={isDimmed ? 0.32 : 1}
        stroke={isHighlighted ? "#fff" : "#000"}
        strokeWidth={isHighlighted ? 2 : 1}
        style={
          isHighlighted ? { filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.45))" } : undefined
        }
      />
    );
  };

  return (
    <article className={`dash-collection-pie ${className}`.trim()}>
      <header className="dash-collection-pie__head">
        <h3 className="dash-collection-pie__title">Cash Distribution</h3>
        <p className="dash-collection-pie__hint">
          {activeRow ? "Click again to show total" : "Hover or click a method"}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="dash-collection-pie__empty">No collection methods in this range.</p>
      ) : (
        <>
          <div className="dash-collection-pie__chart">
            <ResponsiveContainer width="100%" height={188}>
              <PieChart>
                <Tooltip
                  cursor={false}
                  content={() => null}
                />
                <Pie
                  data={rows}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={78}
                  innerRadius={0}
                  paddingAngle={1.5}
                  stroke="#000"
                  strokeWidth={1}
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
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            <div
              className={`dash-collection-pie__center${activeRow ? " is-active" : ""}`}
              aria-live="polite"
            >
              {activeRow ? (
                <>
                  <span>{activeRow.name}</span>
                  <strong>{toMoney(activeRow.value)}</strong>
                  <em>{activePct}% of total</em>
                </>
              ) : (
                <>
                  <span>Total</span>
                  <strong>{toMoney(total)}</strong>
                  <em>
                    {rows.length} method{rows.length === 1 ? "" : "s"}
                  </em>
                </>
              )}
            </div>
          </div>

          <ul className="dash-collection-pie__legend" onMouseLeave={() => setHoveredName(null)}>
            {rows.map((row) => {
              const isActive = activeName === row.name;
              const pct = pctOf(row.value, total);
              return (
                <li key={row.name}>
                  <button
                    type="button"
                    className={`dash-collection-pie__legend-btn${isActive ? " is-active" : ""}`}
                    onClick={() => selectCategory(row.name)}
                    onMouseEnter={() => setHoveredName(row.name)}
                    aria-pressed={selectedName === row.name}
                    title={`${row.name}: ${toMoney(row.value)} (${pct}%)`}
                  >
                    <i style={{ background: row.fill }} aria-hidden="true" />
                    <span className="dash-collection-pie__legend-copy">
                      <span className="dash-collection-pie__legend-name">{row.name}</span>
                      <span className="dash-collection-pie__legend-meta">
                        {toMoney(row.value)} · {pct}%
                      </span>
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
