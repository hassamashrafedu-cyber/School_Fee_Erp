import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Fee recovery card — adapted from 21st Circular Progress Card (kavikatiyar).
 * Plain React + CSS (no Framer Motion / Tailwind) so it works fully offline.
 */
export default function FeeRecoveryProgressCard({
  paid = 0,
  partial = 0,
  billingMonthLabel = "",
  className = "",
}) {
  const paidCount = Math.max(0, Number(paid) || 0);
  const pendingCount = Math.max(0, Number(partial) || 0);
  const total = paidCount + pendingCount;

  const cardRef = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return undefined;

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25, rootMargin: "0px 0px -10% 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { progressPercentage, circumference, strokeDashoffset } = useMemo(() => {
    const radius = 80;
    const circ = 2 * Math.PI * radius;
    const progress = total > 0 ? Math.min(Math.max((paidCount / total) * 100, 0), 100) : 0;
    return {
      progressPercentage: Math.round(progress),
      circumference: circ,
      strokeDashoffset: circ * (1 - progress / 100),
    };
  }, [paidCount, total]);

  return (
    <article
      ref={cardRef}
      className={`card dash-chart-card dash-fee-recovery ${className}`.trim()}
    >
      <header className="dash-chart-card__head">
        <h3 className="dash-chart-card__title">Fee recovery</h3>
        <p className="dash-chart-card__sub">
          {billingMonthLabel ? `${billingMonthLabel} · ` : ""}
          students with month fee
        </p>
      </header>

      {total === 0 ? (
        <p className="dash-muted dash-chart-card__empty">No fee status for this month.</p>
      ) : (
        <div className="dash-fee-recovery__body">
          <div className="dash-fee-recovery__ring-wrap">
            <svg
              className="dash-fee-recovery__svg"
              viewBox="0 0 200 200"
              role="img"
              aria-label={`Fee recovery: ${progressPercentage}% paid (${paidCount} of ${total} students)`}
            >
              <g transform="rotate(-90, 100, 100)">
                <circle
                  className="dash-fee-recovery__track"
                  cx="100"
                  cy="100"
                  r="80"
                  fill="transparent"
                  strokeWidth="16"
                />
                <circle
                  className={`dash-fee-recovery__progress${inView ? " is-animate" : ""}`}
                  cx="100"
                  cy="100"
                  r="80"
                  fill="transparent"
                  strokeWidth="16"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  style={{
                    "--ring-circ": circumference,
                    "--ring-offset": strokeDashoffset,
                  }}
                />
              </g>
            </svg>
            <div className="dash-fee-recovery__center">
              <strong>{progressPercentage}%</strong>
              <span>
                {paidCount.toLocaleString()} / {total.toLocaleString()} paid
              </span>
            </div>
          </div>

          <div className="dash-fee-recovery__stats" role="list">
            <button
              type="button"
              className="dash-fee-recovery__stat is-paid"
              role="listitem"
              title="Fully paid students"
            >
              <span className="dash-fee-recovery__stat-label">
                <i aria-hidden="true" />
                Fully paid
              </span>
              <strong>{paidCount.toLocaleString()}</strong>
              <em>{total ? Math.round((paidCount / total) * 100) : 0}% of students</em>
            </button>
            <button
              type="button"
              className="dash-fee-recovery__stat is-pending"
              role="listitem"
              title="Pending fee students"
            >
              <span className="dash-fee-recovery__stat-label">
                <i aria-hidden="true" />
                Pending fee
              </span>
              <strong>{pendingCount.toLocaleString()}</strong>
              <em>{total ? Math.round((pendingCount / total) * 100) : 0}% of students</em>
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
