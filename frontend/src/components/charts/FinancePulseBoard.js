import React, { useMemo, useState } from "react";
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip } from "recharts";

import { toMoney } from "../../utils/money";
import ChartCard from "./ChartCard";
import { CHART_COLORS, tooltipStyle } from "./chartTheme";

function pctOf(part, whole) {
  const w = Number(whole || 0);
  if (w <= 0) return 0;
  return Math.round((Number(part || 0) / w) * 1000) / 10;
}

function explainMetric(key, value, collection) {
  const pct = pctOf(Math.abs(value), collection);
  switch (key) {
    case "collection":
      return "100% collected amount";
    case "expenses":
      return collection > 0 ? `${pct}% of collection` : "No collection in this filter";
    case "additional":
      return collection > 0 ? `${pct}% added to profit` : "Extra income (no collection base)";
    case "profit":
      return collection > 0 ? `${pct}% of collection` : "Net result for this filter";
    default:
      return "";
  }
}

/**
 * Modern radial comparison graph — clear size differences for
 * Collection, Expenses, Additional, Profit (filter-aware, offline).
 */
export default function FinancePulseBoard({ title, subtitle, metrics }) {
  const [activeKey, setActiveKey] = useState(null);

  const { items, peak } = useMemo(() => {
    const collectionAmt = Math.round(Number(metrics?.total_collection || 0));
    const expenses = Math.round(Number(metrics?.expenses || 0));
    const additional = Math.round(Number(metrics?.additional_amount || 0));
    const profit = Math.round(Number(metrics?.net_profit || 0));
    const maxAbs = Math.max(collectionAmt, expenses, additional, Math.abs(profit), 1);
    const list = [
      {
        key: "collection",
        name: "Collection",
        value: collectionAmt,
        fill: CHART_COLORS.teal,
      },
      {
        key: "expenses",
        name: "Expenses",
        value: expenses,
        fill: CHART_COLORS.amber,
      },
      {
        key: "additional",
        name: "Additional",
        value: additional,
        fill: CHART_COLORS.blue,
      },
      {
        key: "profit",
        name: "Profit",
        value: profit,
        fill: profit >= 0 ? CHART_COLORS.indigo : CHART_COLORS.rose,
      },
    ].map((row) => ({
      ...row,
      detail: explainMetric(row.key, row.value, collectionAmt),
      score: Math.round((Math.abs(row.value) / maxAbs) * 100),
    }));
    return { items: list, peak: maxAbs };
  }, [metrics]);

  const hasAny = items.some((i) => i.value !== 0);
  const active = items.find((i) => i.key === activeKey) || items[0];

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className="dash-chart-card--span"
      empty={!hasAny ? "No finance totals for this filter." : null}
    >
      <div className="dash-finance-modern">
        <div className="dash-finance-modern__viz">
          <ResponsiveContainer width="100%" height={340}>
            <RadialBarChart
              cx="50%"
              cy="50%"
              innerRadius="32%"
              outerRadius="98%"
              barSize={18}
              data={[...items].reverse()}
              startAngle={90}
              endAngle={-270}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar
                background={{ fill: "#eef2f7" }}
                dataKey="score"
                cornerRadius={10}
                onMouseEnter={(_, index) => {
                  const ordered = [...items].reverse();
                  setActiveKey(ordered[index]?.key || null);
                }}
                onMouseLeave={() => setActiveKey(null)}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                content={({ active: tipActive, payload }) => {
                  if (!tipActive || !payload?.length) return null;
                  const row = payload[0]?.payload;
                  if (!row) return null;
                  return (
                    <div className="dash-finance-tooltip">
                      <strong>
                        {row.name}: {toMoney(row.value)}
                      </strong>
                      <span>{row.detail}</span>
                    </div>
                  );
                }}
              />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="dash-finance-modern__center" aria-hidden="true">
            <strong>{toMoney(active?.value || 0)}</strong>
          </div>
        </div>

        <ul className="dash-finance-modern__legend">
          {items.map((item) => {
            const share = peak > 0 ? Math.round((Math.abs(item.value) / peak) * 100) : 0;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  className={`dash-finance-modern__item${activeKey === item.key ? " is-active" : ""}`}
                  title={`${item.name}: ${toMoney(item.value)} · ${item.detail}`}
                  onMouseEnter={() => setActiveKey(item.key)}
                  onMouseLeave={() => setActiveKey(null)}
                  onFocus={() => setActiveKey(item.key)}
                  onBlur={() => setActiveKey(null)}
                >
                  <span className="dash-finance-modern__dot" style={{ background: item.fill }} />
                  <span className="dash-finance-modern__meta">
                    <span className="dash-finance-modern__name">{item.name}</span>
                    <span className="dash-finance-modern__hint">{item.detail}</span>
                  </span>
                  <span className="dash-finance-modern__amount">{toMoney(item.value)}</span>
                  <span className="dash-finance-modern__bar" aria-hidden="true">
                    <i style={{ width: `${share}%`, background: item.fill }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </ChartCard>
  );
}
