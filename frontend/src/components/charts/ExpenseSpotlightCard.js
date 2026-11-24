import React, { useMemo } from "react";

import { toMoney } from "../../utils/money";

const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Sales-Revenue-style spotlight card, adapted for Expenses.
 * Uses monthly_profit_trend[].expenses from existing dashboard API.
 */
export default function ExpenseSpotlightCard({ data, className = "" }) {
  const { rows, currentValue, insightVerb, insightAmount, peakIndex, currentIndex } = useMemo(() => {
    const list = (Array.isArray(data) ? data : [])
      .map((d) => ({
        month: Number(d.month),
        label: MONTH_SHORT[Number(d.month)] || String(d.month),
        value: Math.max(0, Number(d.expenses || 0)),
      }))
      .filter((d) => d.month >= 1 && d.month <= 12);

    if (!list.length) {
      return {
        rows: [],
        currentValue: 0,
        insightVerb: "unchanged",
        insightAmount: 0,
        peakIndex: -1,
        currentIndex: -1,
      };
    }

    const currentIndex = list.length - 1;
    const currentValue = list[currentIndex].value;
    const prevValue = currentIndex > 0 ? list[currentIndex - 1].value : currentValue;
    const delta = currentValue - prevValue;
    const insightVerb = delta > 0 ? "increased" : delta < 0 ? "decreased" : "unchanged";
    const insightAmount = Math.abs(delta);

    let peakIndex = 0;
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].value > list[peakIndex].value) peakIndex = i;
    }

    return { rows: list, currentValue, insightVerb, insightAmount, peakIndex, currentIndex };
  }, [data]);

  const peak = Math.max(...rows.map((r) => r.value), 1);

  return (
    <article className={`dash-expense-spotlight ${className}`.trim()}>
      <header className="dash-expense-spotlight__head">
        <div>
          <p className="dash-expense-spotlight__title">Expenses</p>
          <strong className="dash-expense-spotlight__value">{toMoney(currentValue)}</strong>
        </div>
        <span className="dash-expense-spotlight__chevron" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </header>

      <p className="dash-expense-spotlight__insight">
        {insightVerb === "unchanged" ? (
          <>Your expense is about the same this month.</>
        ) : (
          <>
            Your expense {insightVerb} this month by about{" "}
            <span className={insightVerb === "decreased" ? "is-down" : "is-up"}>{toMoney(insightAmount)}</span>.
          </>
        )}
      </p>

      {rows.length === 0 ? (
        <p className="dash-expense-spotlight__empty">No expense trend yet.</p>
      ) : (
        <div className="dash-expense-spotlight__chart" role="img" aria-label="Monthly expenses">
          {rows.map((row, idx) => {
            const height = Math.max(10, (row.value / peak) * 100);
            let tone = "muted";
            if (idx === currentIndex) tone = "current";
            else if (idx === peakIndex) tone = "peak";
            return (
              <div key={row.label} className="dash-expense-spotlight__col" title={`${row.label}: ${toMoney(row.value)}`}>
                <div className="dash-expense-spotlight__track">
                  <span className={`dash-expense-spotlight__bar is-${tone}`} style={{ height: `${height}%` }} />
                </div>
                <span className="dash-expense-spotlight__label">{row.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
