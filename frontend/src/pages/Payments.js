import React from "react";

export default function Payments() {
  return (
    <section className="page-card">
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title page-title">Payments</h1>
          <p className="page-header__subtitle page-lead">
            Collections, receipts, and reconciliation will live here.
          </p>
        </div>
      </div>
      <div className="empty-state">
        <p className="empty-state__title">Coming soon</p>
        <p className="empty-state__text">
          Use Fee Collection to record payments today. This workspace will expand for receipts and reconciliation.
        </p>
      </div>
    </section>
  );
}
