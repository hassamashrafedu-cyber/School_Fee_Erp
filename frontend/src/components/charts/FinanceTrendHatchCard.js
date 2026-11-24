import React, { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { toMoney } from "../../utils/money";

const COLLECTION = "#ff4d2d";
const EXPENSES = "#f0b5a0";

/**
 * 21st-style dark hatched area Finance trend (Collection + Expenses).
 * Uses existing finance_trend rows — no backend changes.
 */
export default function FinanceTrendHatchCard({
  data,
  rangeLabel = "",
  totalCollection = 0,
  className = "",
}) {
  const uid = useId().replace(/:/g, "");
  const hatchId = `finance-hatch-${uid}`;

  const rows = useMemo(
    () =>
      (data || []).map((d) => ({
        label: d.label,
        collection: Number(d.collection || 0),
        expenses: Number(d.expenses || 0),
      })),
    [data]
  );

  const { pctChange, rangeText } = useMemo(() => {
    if (!rows.length) {
      return { pctChange: null, rangeText: rangeLabel || "" };
    }
    const first = rows[0].collection;
    const last = rows[rows.length - 1].collection;
    let pct = null;
    if (first > 0) pct = Math.round(((last - first) / first) * 1000) / 10;
    else if (last > 0) pct = 100;
    else pct = 0;

    const autoRange =
      rows.length === 1 ? rows[0].label : `${rows[0].label} – ${rows[rows.length - 1].label}`;
    return { pctChange: pct, rangeText: rangeLabel || autoRange };
  }, [rows, rangeLabel]);

  const headline = Number(totalCollection || 0) || rows.reduce((s, r) => s + r.collection, 0);
  const empty = rows.length === 0;

  return (
    <article className={`dash-finance-hatch ${className}`.trim()}>
      <header className="dash-finance-hatch__head">
        <div className="dash-finance-hatch__meta">
          <p className="dash-finance-hatch__eyebrow">Collection</p>
          <div className="dash-finance-hatch__value-row">
            <strong className="dash-finance-hatch__value">{toMoney(headline)}</strong>
            {pctChange != null ? (
              <span className={`dash-finance-hatch__badge ${pctChange >= 0 ? "is-up" : "is-down"}`}>
                {pctChange >= 0 ? "▲" : "▼"} {Math.abs(pctChange)}%
              </span>
            ) : null}
          </div>
          {rangeText ? <p className="dash-finance-hatch__range">{rangeText}</p> : null}
        </div>
        <span className="dash-finance-hatch__icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 19V5" strokeLinecap="round" />
            <path d="M4 19h16" strokeLinecap="round" />
            <path d="M7 15l3.5-4.5 3 2.5L17 8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </header>

      {empty ? (
        <p className="dash-finance-hatch__empty">No finance trend for this range.</p>
      ) : (
        <>
          <div className="dash-finance-hatch__chart">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={rows} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <pattern id={hatchId} x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
                    <path d="M0,8 L8,0" stroke={COLLECTION} strokeWidth="1.1" opacity="0.55" />
                    <path d="M-2,2 L2,-2" stroke={COLLECTION} strokeWidth="1.1" opacity="0.35" />
                    <path d="M6,10 L10,6" stroke={COLLECTION} strokeWidth="1.1" opacity="0.35" />
                  </pattern>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 6" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#9ca3af", fontSize: 11, fontWeight: 600 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
                  tickMargin={8}
                />
                <YAxis
                  tick={{ fill: "#9ca3af", fontSize: 11, fontWeight: 600 }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(v) => {
                    const n = Number(v || 0);
                    if (Math.abs(n) >= 1000) return `${Math.round(n / 1000)}K`;
                    return String(n);
                  }}
                />
                <Tooltip content={<HatchTooltip />} cursor={{ stroke: "rgba(255,255,255,0.2)", strokeDasharray: "4 4" }} />
                <Area
                  type="monotone"
                  dataKey="collection"
                  name="Collection"
                  stroke={COLLECTION}
                  strokeWidth={2.4}
                  fill={`url(#${hatchId})`}
                  fillOpacity={1}
                  dot={false}
                  activeDot={{ r: 5, fill: COLLECTION, stroke: "#111", strokeWidth: 2 }}
                  isAnimationActive
                  animationDuration={520}
                />
                <Line
                  type="monotone"
                  dataKey="expenses"
                  name="Expenses"
                  stroke={EXPENSES}
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{ r: 4, fill: EXPENSES }}
                  isAnimationActive
                  animationDuration={520}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="dash-finance-hatch__legend">
            <span>
              <i style={{ background: COLLECTION }} /> Collection
            </span>
            <span>
              <i style={{ background: EXPENSES }} /> Expenses
            </span>
          </div>
        </>
      )}
    </article>
  );
}

function HatchTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dash-finance-hatch__tooltip">
      <div className="dash-finance-hatch__tooltip-label">{label}</div>
      {payload
        .filter((p) => p.type !== "none")
        .map((p) => (
          <div key={String(p.dataKey)} className="dash-finance-hatch__tooltip-row">
            <span style={{ color: p.color }}>{p.name}</span>
            <strong>{toMoney(p.value)}</strong>
          </div>
        ))}
    </div>
  );
}
