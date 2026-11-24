import React, { useMemo, useState } from "react";

import { toMoney } from "../../utils/money";
import ChartCard from "./ChartCard";

/**
 * Top 5 fee defaulters. Hover/focus a row to reveal the student's class.
 */
export default function TopDefaultersBoard({ title, subtitle, data }) {
  const [hoveredId, setHoveredId] = useState(null);

  const rows = useMemo(() => {
    const mapped = (Array.isArray(data) ? data : [])
      .map((d) => ({
        student_id: d.student_id,
        student_name: d.student_name || "Student",
        class_name: d.class_name || "Class",
        remaining: Number(d.remaining || d.total_year_due || 0),
      }))
      .filter((d) => d.remaining > 0)
      .slice(0, 5);
    const peak = Math.max(...mapped.map((r) => r.remaining), 1);
    return mapped.map((r, idx) => ({
      ...r,
      rank: idx + 1,
      pct: Math.max(8, Math.round((r.remaining / peak) * 100)),
    }));
  }, [data]);

  const active = rows.find((r) => String(r.student_id) === String(hoveredId)) || null;

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className="dash-chart-card--defaulters"
      empty={rows.length === 0 ? "No defaulters for this filter." : null}
    >
      <div className="dash-defaulters">
        <ol className="dash-defaulters__list">
          {rows.map((row) => {
            const isActive = String(row.student_id) === String(hoveredId);
            return (
              <li key={row.student_id || `${row.student_name}-${row.rank}`}>
                <button
                  type="button"
                  className={`dash-defaulters__row${isActive ? " is-active" : ""}`}
                  title={`Class ${row.class_name}`}
                  onMouseEnter={() => setHoveredId(row.student_id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(row.student_id)}
                  onBlur={() => setHoveredId(null)}
                >
                  <span className={`dash-defaulters__rank${row.rank === 1 ? " is-gold" : ""}`}>
                    {row.rank}
                  </span>
                  <span className="dash-defaulters__name">{row.student_name}</span>
                  <strong className="dash-defaulters__due">{toMoney(row.remaining)}</strong>
                  <span className="dash-defaulters__bar" aria-hidden="true">
                    <i style={{ width: `${row.pct}%` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <aside className="dash-defaulters__focus" aria-live="polite">
          {active ? (
            <>
              <span className="dash-defaulters__focus-label">Class</span>
              <strong className="dash-defaulters__focus-class">{active.class_name}</strong>
              <span className="dash-defaulters__focus-name">{active.student_name}</span>
            </>
          ) : (
            <span className="dash-defaulters__focus-hint">Hover a student to see class</span>
          )}
        </aside>
      </div>
    </ChartCard>
  );
}
