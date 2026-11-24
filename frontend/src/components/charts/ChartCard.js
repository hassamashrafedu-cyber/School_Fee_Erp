import React from "react";

export default function ChartCard({ title, subtitle, children, empty, className = "" }) {
  return (
    <article className={`card dash-chart-card ${className}`.trim()}>
      <header className="dash-chart-card__head">
        <h3 className="dash-chart-card__title">{title}</h3>
        {subtitle ? <p className="dash-chart-card__sub">{subtitle}</p> : null}
      </header>
      {empty ? <p className="dash-muted dash-chart-card__empty">{empty}</p> : children}
    </article>
  );
}
