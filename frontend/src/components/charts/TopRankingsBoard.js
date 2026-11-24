import React, { useMemo, useState } from "react";

import { toMoney } from "../../utils/money";
import ChartCard from "./ChartCard";

const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function RankList({ title, tone, items, activeKey, onHover, empty }) {
  return (
    <article className={`dash-tops__col dash-tops__col--${tone}`}>
      <header className="dash-tops__col-head">
        <h4>{title}</h4>
      </header>
      {items.length === 0 ? (
        <p className="dash-tops__empty">{empty}</p>
      ) : (
        <ol className="dash-tops__list">
          {items.map((item, idx) => {
            const key = `${title}-${item.label}`;
            const isActive = activeKey === key;
            return (
              <li key={key}>
                <button
                  type="button"
                  className={`dash-tops__row${isActive ? " is-active" : ""}`}
                  onMouseEnter={() => onHover(key, item)}
                  onMouseLeave={() => onHover(null, null)}
                  onFocus={() => onHover(key, item)}
                  onBlur={() => onHover(null, null)}
                  title={`${item.label}: ${item.display}`}
                >
                  <span className={`dash-tops__rank${idx === 0 ? " is-gold" : ""}`}>{idx + 1}</span>
                  <span className="dash-tops__label">{item.label}</span>
                  <strong className="dash-tops__value">{item.display}</strong>
                  <span className="dash-tops__bar" aria-hidden="true">
                    <i style={{ width: `${item.pct}%` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}

function toTop(rows, { labelKey, valueKey, money = false, limit = 5 }) {
  const mapped = (rows || [])
    .map((r) => ({
      label: String(r[labelKey] ?? r.class_name ?? r.name ?? "—"),
      value: Number(r[valueKey] ?? r.total ?? r.value ?? 0),
      hint: r.hint || "",
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  const peak = Math.max(...mapped.map((r) => Math.abs(r.value)), 1);
  return mapped.map((r) => ({
    ...r,
    pct: Math.max(6, Math.round((Math.abs(r.value) / peak) * 100)),
    display: money ? toMoney(r.value) : String(r.value),
  }));
}

/**
 * Concise interactive top lists for Fee ERP analytics.
 */
export default function TopRankingsBoard({
  title,
  subtitle,
  collectionByClass,
  expenseByCategory,
  classStrength,
  pendingByClass,
  monthlyProfit,
}) {
  const [active, setActive] = useState({ key: null, item: null, list: null });

  const tops = useMemo(() => {
    const collection = toTop(collectionByClass, {
      labelKey: "class_name",
      valueKey: "total",
      money: true,
    });
    const expenses = toTop(expenseByCategory, {
      labelKey: "name",
      valueKey: "total",
      money: true,
    });
    const strength = toTop(classStrength, {
      labelKey: "class_name",
      valueKey: "total_students",
      money: false,
    });
    const pending = toTop(pendingByClass, {
      labelKey: "class_name",
      valueKey: "total",
      money: true,
    });
    const profitMonths = toTop(
      (monthlyProfit || []).map((r) => ({
        name: MONTH_SHORT[Number(r.month)] || String(r.month),
        total: Number(r.profit || 0),
      })),
      { labelKey: "name", valueKey: "total", money: true }
    );

    return { collection, expenses, strength, pending, profitMonths };
  }, [collectionByClass, expenseByCategory, classStrength, pendingByClass, monthlyProfit]);

  const onHover = (listName) => (key, item) => {
    setActive(key ? { key, item, list: listName } : { key: null, item: null, list: null });
  };

  const focusText = useMemo(() => {
    if (!active.item) return "Hover any row to highlight the top performer.";
    const prefix =
      active.list === "collection"
        ? "Top collection"
        : active.list === "expenses"
          ? "Top expense"
          : active.list === "strength"
            ? "Top strength"
            : active.list === "pending"
              ? "Top pending"
              : "Top profit month";
    return `${prefix}: ${active.item.label} · ${active.item.display}`;
  }, [active]);

  return (
    <ChartCard title={title} subtitle={subtitle} className="dash-chart-card--span">
      <div className="dash-tops">
        <p className="dash-tops__focus" aria-live="polite">
          {focusText}
        </p>
        <div className="dash-tops__grid">
          <RankList
            title="Top collection by class"
            tone="teal"
            items={tops.collection}
            activeKey={active.key}
            onHover={onHover("collection")}
            empty="No collection yet."
          />
          <RankList
            title="Top expense category"
            tone="amber"
            items={tops.expenses}
            activeKey={active.key}
            onHover={onHover("expenses")}
            empty="No expenses yet."
          />
          <RankList
            title="Top strength by class"
            tone="blue"
            items={tops.strength}
            activeKey={active.key}
            onHover={onHover("strength")}
            empty="No students yet."
          />
          <RankList
            title="Top pending by class"
            tone="rose"
            items={tops.pending}
            activeKey={active.key}
            onHover={onHover("pending")}
            empty="No pending fees."
          />
          <RankList
            title="Top profit months"
            tone="indigo"
            items={tops.profitMonths}
            activeKey={active.key}
            onHover={onHover("profit")}
            empty="No profit months yet."
          />
        </div>
      </div>
    </ChartCard>
  );
}
