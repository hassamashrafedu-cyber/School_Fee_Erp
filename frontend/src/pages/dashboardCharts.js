import React, { useMemo, useState } from "react";

import { toMoney } from "../utils/money";

const CHART_PALETTE = [
  "#14b8a6",
  "#0d9488",
  "#d97706",
  "#e11d48",
  "#0891b2",
  "#06b6d4",
  "#059669",
  "#64748b",
  "#22c55e",
  "#0f766e",
];

export function ChartCard({ title, subtitle, hint, children, wide }) {
  return (
    <article className={`dash-chart-card${wide ? " dash-chart-card--wide" : ""}`}>
      <header className="dash-chart-card__head">
        <div>
          <h3 className="dash-chart-card__title">{title}</h3>
          {subtitle ? <p className="dash-chart-card__subtitle">{subtitle}</p> : null}
        </div>
        {hint ? <span className="dash-chart-card__hint">{hint}</span> : null}
      </header>
      <div className="dash-chart-card__body">{children}</div>
    </article>
  );
}

export function EmptyChart({ message = "No data for this range." }) {
  return <p className="dash-chart-empty">{message}</p>;
}

function formatPeriodLabel(iso, bucket) {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  if (bucket === "month") {
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  if (bucket === "week") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Smooth collection area + line trend */
export function CollectionTrendChart({ series, bucket }) {
  const [hover, setHover] = useState(-1);
  const width = 560;
  const height = 220;
  const pad = { t: 16, r: 16, b: 36, l: 48 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  const points = useMemo(() => {
    const rows = Array.isArray(series) ? series : [];
    const max = Math.max(...rows.map((r) => Number(r.collection || 0)), 1);
    return rows.map((row, i) => {
      const x = rows.length <= 1 ? pad.l + innerW / 2 : pad.l + (i / (rows.length - 1)) * innerW;
      const y = pad.t + innerH - (Number(row.collection || 0) / max) * innerH;
      return { ...row, x, y, max };
    });
  }, [series, innerH, innerW, pad.l, pad.t]);

  if (!points.length) return <EmptyChart message="No collection in this range." />;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const area = `${line} L${points[points.length - 1].x},${pad.t + innerH} L${points[0].x},${pad.t + innerH} Z`;
  const active = hover >= 0 ? points[hover] : null;
  const labelStep = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="dash-svg-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="dash-svg" role="img" aria-label="Collection trend">
        <defs>
          <linearGradient id="dashCollectFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((t) => {
          const y = pad.t + innerH * (1 - t);
          return (
            <line
              key={t}
              x1={pad.l}
              x2={pad.l + innerW}
              y1={y}
              y2={y}
              className="dash-svg-grid"
            />
          );
        })}
        <path d={area} fill="url(#dashCollectFill)" />
        <path d={line} fill="none" stroke="#0d9488" strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle
            key={p.period}
            cx={p.x}
            cy={p.y}
            r={hover === i ? 5.5 : 3.5}
            fill={hover === i ? "#042f2e" : "#14b8a6"}
            stroke="#fff"
            strokeWidth="1.5"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(-1)}
            style={{ cursor: "pointer" }}
          />
        ))}
        {points.map((p, i) =>
          i % labelStep === 0 || i === points.length - 1 ? (
            <text key={`l-${p.period}`} x={p.x} y={height - 10} textAnchor="middle" className="dash-svg-axis">
              {formatPeriodLabel(p.period, bucket)}
            </text>
          ) : null
        )}
      </svg>
      <div className="dash-chart-footnote">
        {active
          ? `${formatPeriodLabel(active.period, bucket)} · Collection ${toMoney(active.collection)}`
          : "Hover points for exact collection"}
      </div>
    </div>
  );
}

/** Grouped bars: collection vs expenses + profit line */
export function ProfitTrendChart({ series, bucket }) {
  const [hover, setHover] = useState(-1);
  const width = 560;
  const height = 220;
  const pad = { t: 16, r: 16, b: 36, l: 48 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const rows = Array.isArray(series) ? series : [];

  const max = Math.max(
    ...rows.flatMap((r) => [Number(r.collection || 0), Number(r.expenses || 0), Math.abs(Number(r.profit || 0))]),
    1
  );

  if (!rows.length) return <EmptyChart message="No profit trend in this range." />;

  const groupW = innerW / rows.length;
  const barW = Math.max(4, Math.min(16, groupW * 0.28));
  const active = hover >= 0 ? rows[hover] : null;
  const labelStep = Math.max(1, Math.ceil(rows.length / 6));

  return (
    <div className="dash-svg-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="dash-svg" role="img" aria-label="Profit trend">
        {[0.25, 0.5, 0.75, 1].map((t) => {
          const y = pad.t + innerH * (1 - t);
          return <line key={t} x1={pad.l} x2={pad.l + innerW} y1={y} y2={y} className="dash-svg-grid" />;
        })}
        {rows.map((row, i) => {
          const cx = pad.l + groupW * i + groupW / 2;
          const cH = (Number(row.collection || 0) / max) * innerH;
          const eH = (Number(row.expenses || 0) / max) * innerH;
          return (
            <g
              key={row.period}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(-1)}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={cx - barW - 2}
                y={pad.t + innerH - cH}
                width={barW}
                height={Math.max(2, cH)}
                rx="3"
                fill={hover === i ? "#0f766e" : "#14b8a6"}
              />
              <rect
                x={cx + 2}
                y={pad.t + innerH - eH}
                width={barW}
                height={Math.max(2, eH)}
                rx="3"
                fill={hover === i ? "#d97706" : "#f59e0b"}
              />
              {i % labelStep === 0 || i === rows.length - 1 ? (
                <text x={cx} y={height - 10} textAnchor="middle" className="dash-svg-axis">
                  {formatPeriodLabel(row.period, bucket)}
                </text>
              ) : null}
            </g>
          );
        })}
        {rows.length > 1 ? (
          <path
            d={rows
              .map((row, i) => {
                const cx = pad.l + groupW * i + groupW / 2;
                const y = pad.t + innerH - (Number(row.profit || 0) / max) * innerH;
                return `${i === 0 ? "M" : "L"}${cx},${y}`;
              })
              .join(" ")}
            fill="none"
            stroke="#0d9488"
            strokeWidth="2"
            strokeDasharray="4 3"
          />
        ) : null}
      </svg>
      <div className="dash-chart-legend">
        <span>
          <i className="dash-dot dash-dot--teal" /> Collection
        </span>
        <span>
          <i className="dash-dot dash-dot--amber" /> Expenses
        </span>
        <span>
          <i className="dash-dot dash-dot--indigo" /> Profit
        </span>
      </div>
      <div className="dash-chart-footnote">
        {active
          ? `${formatPeriodLabel(active.period, bucket)} · Profit ${toMoney(active.profit)} (C ${toMoney(
              active.collection
            )} − E ${toMoney(active.expenses)})`
          : "Hover bars for period detail"}
      </div>
    </div>
  );
}

export function ClassCollectionChart({ series }) {
  const [hover, setHover] = useState(-1);
  const rows = Array.isArray(series) ? series : [];
  const max = Math.max(...rows.map((r) => Number(r.total || 0)), 1);
  if (!rows.length) return <EmptyChart message="No class collections in this range." />;
  const active = hover >= 0 ? rows[hover] : null;

  return (
    <div className="dash-hbar">
      {rows.map((row, i) => {
        const pct = Math.max(4, (Number(row.total || 0) / max) * 100);
        return (
          <div
            key={row.class_id || row.class_name}
            className={`dash-hbar__row${hover === i ? " is-active" : ""}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(-1)}
          >
            <span className="dash-hbar__label" title={row.class_name}>
              {row.class_name}
            </span>
            <div className="dash-hbar__track">
              <div
                className="dash-hbar__fill"
                style={{
                  width: `${pct}%`,
                  background: CHART_PALETTE[i % CHART_PALETTE.length],
                }}
              />
            </div>
            <span className="dash-hbar__value">{toMoney(row.total)}</span>
          </div>
        );
      })}
      <div className="dash-chart-footnote">
        {active ? `${active.class_name}: ${toMoney(active.total)}` : "Hover a class for amount"}
      </div>
    </div>
  );
}

export function ExpenseCategoryDonut({ series }) {
  const [hover, setHover] = useState(-1);
  const rows = Array.isArray(series) ? series : [];
  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  if (!rows.length || total <= 0) return <EmptyChart message="No expenses in this range." />;

  const size = 220;
  const cx = 110;
  const cy = 110;
  const r = 78;
  const stroke = 28;
  let angle = -Math.PI / 2;
  const arcs = rows.map((row, i) => {
    const value = Number(row.total || 0);
    const sweep = (value / total) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const large = sweep > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const path = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
    return { ...row, path, color: CHART_PALETTE[i % CHART_PALETTE.length], pct: (value / total) * 100 };
  });
  const active = hover >= 0 ? arcs[hover] : null;

  return (
    <div className="dash-donut">
      <div className="dash-donut__viz">
        <svg viewBox={`0 0 ${size} ${size}`} className="dash-svg dash-svg--donut" role="img" aria-label="Expenses by category">
          {arcs.map((arc, i) => (
            <path
              key={arc.category_id || arc.category_name}
              d={arc.path}
              fill="none"
              stroke={arc.color}
              strokeWidth={hover === i ? stroke + 4 : stroke}
              strokeLinecap="butt"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(-1)}
              style={{ cursor: "pointer", transition: "stroke-width 0.15s ease" }}
            />
          ))}
          <circle cx={cx} cy={cy} r={r - stroke / 2 - 6} fill="#fff" />
          <text x={cx} y={cy - 6} textAnchor="middle" className="dash-donut__center-label">
            Expenses
          </text>
          <text x={cx} y={cy + 16} textAnchor="middle" className="dash-donut__center-value">
            {toMoney(active ? active.total : total)}
          </text>
        </svg>
      </div>
      <ul className="dash-donut__legend">
        {arcs.map((arc, i) => (
          <li
            key={arc.category_id || arc.category_name}
            className={hover === i ? "is-active" : ""}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(-1)}
          >
            <i style={{ background: arc.color }} />
            <span className="dash-donut__name">{arc.category_name}</span>
            <span className="dash-donut__amt">{toMoney(arc.total)}</span>
            <span className="dash-donut__pct">{arc.pct.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ClassStrengthChart({ series }) {
  const rows = Array.isArray(series) ? series : [];
  const max = Math.max(...rows.map((r) => Number(r.total_students || 0)), 1);
  if (!rows.length) return <EmptyChart message="No class strength data." />;

  return (
    <div className="dash-hbar">
      {rows.map((row) => {
        const male = Number(row.male_students || 0);
        const female = Number(row.female_students || 0);
        const total = Number(row.total_students || 0) || male + female;
        return (
          <div key={row.class_id || row.class_name} className="dash-hbar__row">
            <span className="dash-hbar__label" title={row.class_name}>
              {row.class_name}
            </span>
            <div className="dash-hbar__track dash-hbar__track--split">
              <div
                className="dash-hbar__male"
                style={{ width: `${(male / max) * 100}%` }}
                title={`Male: ${male}`}
              />
              <div
                className="dash-hbar__female"
                style={{ width: `${(female / max) * 100}%` }}
                title={`Female: ${female}`}
              />
            </div>
            <span className="dash-hbar__value">{total}</span>
          </div>
        );
      })}
      <div className="dash-chart-legend">
        <span>
          <i className="dash-dot dash-dot--blue" /> Male
        </span>
        <span>
          <i className="dash-dot dash-dot--pink" /> Female
        </span>
      </div>
    </div>
  );
}

export function YearTrendMini({ title, series, type }) {
  const [hover, setHover] = useState(-1);
  const rows = Array.isArray(series) ? series : [];
  const peak = Math.max(...rows.map((r) => Math.abs(Number(r.profit || 0))), 1);
  if (!rows.length) return <EmptyChart />;

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const active = hover >= 0 ? rows[hover] : null;

  return (
    <div className="dash-mini-bars" role="img" aria-label={title}>
      {rows.map((row, idx) => {
        const profit = Number(row.profit || 0);
        const label = type === "monthly" ? monthNames[(Number(row.month) || 1) - 1] : String(row.year);
        const h = Math.max(8, (Math.abs(profit) / peak) * 120);
        return (
          <button
            key={`${type}-${label}`}
            type="button"
            className="dash-mini-bars__item"
            onMouseEnter={() => setHover(idx)}
            onMouseLeave={() => setHover(-1)}
            title={`${label}: ${toMoney(profit)}`}
          >
            <span
              className={`dash-mini-bars__bar${profit >= 0 ? " is-pos" : " is-neg"}`}
              style={{ height: `${h}px` }}
            />
            <span className="dash-mini-bars__label">{label}</span>
          </button>
        );
      })}
      <div className="dash-chart-footnote dash-chart-footnote--full">
        {active
          ? `${type === "monthly" ? monthNames[(Number(active.month) || 1) - 1] : active.year}: ${toMoney(
              active.profit
            )}`
          : "Hover for profit"}
      </div>
    </div>
  );
}
