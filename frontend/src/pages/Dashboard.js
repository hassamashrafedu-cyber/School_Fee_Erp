import React, { useEffect, useMemo, useState } from "react";

import API from "../api";
import {
  BarChartCard,
  CHART_COLORS,
  ClassFeeStatusBoard,
  CollectionProfitTrendCard,
  CollectionDistributionPieCard,
  ExpenseCategoryDonutCard,
  ExpenseSpotlightCard,
  FeeRecoveryProgressCard,
  FinancePulseBoard,
  FinanceTrendHatchCard,
  TopDefaultersBoard,
  TopRankingsBoard,
} from "../components/charts";
import { toMoney } from "../utils/money";
import { RANGE_PRESETS, resolveRangePreset, toIsoDate } from "../utils/dateRangePresets";

import "./dashboard.css";

const MONTH_OPTIONS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
];

function monthShort(monthNum) {
  const found = MONTH_OPTIONS.find((m) => Number(m.value) === Number(monthNum));
  return found ? found.label : String(monthNum);
}

function MetricCard({ label, value, hint, tone = "light", accent = "teal", barPct }) {
  const width = Math.min(100, Math.max(6, Number(barPct) || 42));
  return (
    <article className={`dash-metric dash-metric--${tone} dash-metric--${accent}`}>
      <span className="dash-metric__label">{label}</span>
      <strong className="dash-metric__value">{value}</strong>
      {hint ? <span className="dash-metric__hint">{hint}</span> : null}
      <div className="dash-metric__foot" aria-hidden="true">
        {tone === "dark" ? (
          <svg className="dash-metric__spark" viewBox="0 0 120 28" preserveAspectRatio="none">
            <path
              d="M0 20 C20 18 28 8 45 12 C62 16 70 4 90 8 C105 11 112 18 120 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        ) : (
          <div className="dash-metric__bar">
            <span style={{ width: `${width}%` }} />
          </div>
        )}
      </div>
    </article>
  );
}

function StrengthHero({ strength, billingMonthLabel, classStrength }) {
  const total = Number(strength?.total_students || 0);
  const paid = Number(strength?.paid_students || 0);
  const partial = Number(strength?.partial_students || 0);
  const withFee = Math.max(paid + partial, 1);
  const paidPct = Math.round((paid / withFee) * 100);
  const partialPct = Math.round((partial / withFee) * 100);
  const male = Number(strength?.total_males || 0);
  const female = Number(strength?.total_females || 0);
  const genderTotal = Math.max(male + female, 1);

  const topClasses = useMemo(
    () =>
      [...(classStrength || [])]
        .sort((a, b) => Number(b.total_students || 0) - Number(a.total_students || 0))
        .slice(0, 4),
    [classStrength]
  );

  return (
    <section className="dash-strength" aria-label="School strength">
      <div className="dash-strength__intro">
        <div>
          <p className="dash-strength__eyebrow">Strength · {billingMonthLabel}</p>
          <h2 className="dash-strength__title">Who is on roll</h2>
        </div>
        <div className="dash-strength__hero-num">
          <strong>{total}</strong>
          <span>Total students</span>
        </div>
      </div>

      <div className="dash-strength__grid">
        <article className="dash-strength-card dash-strength-card--main">
          <span className="dash-strength-card__label">Fee status this month</span>
          <div className="dash-strength-track" role="img" aria-label={`Paid ${paidPct}%, Partial ${partialPct}%`}>
            <span className="is-paid" style={{ width: `${paidPct}%` }} />
            <span className="is-partial" style={{ width: `${partialPct}%` }} />
          </div>
          <div className="dash-strength-card__split">
            <div>
              <strong>{paid}</strong>
              <span>Paid · {paidPct}%</span>
            </div>
            <div>
              <strong>{partial}</strong>
              <span>Partial · {partialPct}%</span>
            </div>
          </div>
        </article>

        <article className="dash-strength-card">
          <span className="dash-strength-card__label">Gender mix</span>
          <div className="dash-strength-gender">
            <div className="dash-strength-gender__row">
              <span>Male</span>
              <strong>{male}</strong>
            </div>
            <div className="dash-strength-gender__bar">
              <i style={{ width: `${(male / genderTotal) * 100}%` }} className="is-male" />
            </div>
            <div className="dash-strength-gender__row">
              <span>Female</span>
              <strong>{female}</strong>
            </div>
            <div className="dash-strength-gender__bar">
              <i style={{ width: `${(female / genderTotal) * 100}%` }} className="is-female" />
            </div>
          </div>

          <div className="dash-gender-status" aria-label="Paid and partial by gender">
            <div className="dash-gender-status__head">
              <span />
              <span className="is-male-col">Male</span>
              <span className="is-female-col">Female</span>
            </div>
            <div className="dash-gender-status__row is-paid" title="Fully paid this month">
              <span className="dash-gender-status__tag">Paid</span>
              <button type="button" className="dash-gender-status__cell" title={`${strength?.male_paid || 0} males fully paid`}>
                <strong>{strength?.male_paid || 0}</strong>
              </button>
              <button type="button" className="dash-gender-status__cell" title={`${strength?.female_paid || 0} females fully paid`}>
                <strong>{strength?.female_paid || 0}</strong>
              </button>
            </div>
            <div className="dash-gender-status__row is-partial" title="Partial or unpaid this month">
              <span className="dash-gender-status__tag">Partial</span>
              <button type="button" className="dash-gender-status__cell" title={`${strength?.male_partial || 0} males partial / unpaid`}>
                <strong>{strength?.male_partial || 0}</strong>
              </button>
              <button type="button" className="dash-gender-status__cell" title={`${strength?.female_partial || 0} females partial / unpaid`}>
                <strong>{strength?.female_partial || 0}</strong>
              </button>
            </div>
          </div>
        </article>

        <article className="dash-strength-card dash-strength-card--classes">
          <span className="dash-strength-card__label">Largest classes</span>
          {topClasses.length === 0 ? (
            <p className="dash-muted">No class data.</p>
          ) : (
            <ul className="dash-strength-class-list">
              {topClasses.map((row) => {
                const max = Math.max(...topClasses.map((c) => Number(c.total_students || 0)), 1);
                const pct = (Number(row.total_students || 0) / max) * 100;
                return (
                  <li key={row.class_id}>
                    <div className="dash-strength-class-list__meta">
                      <span>{row.class_name}</span>
                      <strong>{row.total_students}</strong>
                    </div>
                    <div className="dash-strength-class-list__bar">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}

function InsightStrip({ metrics, meta, paid, partial }) {
  const collection = Number(metrics?.total_collection || 0);
  const pending = Number(metrics?.pending_fees || 0);
  const concession = Number(metrics?.concession || 0);
  const withFee = Math.max(Number(paid || 0) + Number(partial || 0), 0);
  const recoveryPct = withFee ? Math.round((Number(paid || 0) / withFee) * 100) : 0;
  const pendingPct = collection > 0 ? Math.round((pending / collection) * 1000) / 10 : 0;
  const concessionPct = collection > 0 ? Math.round((concession / collection) * 1000) / 10 : 0;

  const items = [
    {
      key: "margin",
      label: "Profit margin",
      value: `${meta?.margin_pct ?? 0}%`,
      tip: "Net profit as % of collection",
      tone: "teal",
    },
    {
      key: "expense",
      label: "Expense ratio",
      value: `${meta?.expense_pct_of_collection ?? 0}%`,
      tip: "Expenses as % of collection",
      tone: "amber",
    },
    {
      key: "recovery",
      label: "Fee recovery",
      value: `${recoveryPct}%`,
      tip: "Paid students among those with this month fee",
      tone: "teal",
    },
    {
      key: "pending",
      label: "Pending vs collection",
      value: `${pendingPct}%`,
      tip: "Pending fees compared to collection in range",
      tone: "rose",
    },
    {
      key: "concession",
      label: "Concession rate",
      value: `${concessionPct}%`,
      tip: "Concessions as % of collection",
      tone: "teal",
    },
  ];

  return (
    <section className="dash-insights" aria-label="Key insights">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`dash-insights__chip dash-insights__chip--${item.tone}`}
          title={item.tip}
        >
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </button>
      ))}
    </section>
  );
}

function SectionLabel({ eyebrow, title }) {
  return (
    <div className="dash-section-label">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
    </div>
  );
}

export default function Dashboard() {
  const initialRange = resolveRangePreset("this_month");
  const [preset, setPreset] = useState("this_month");
  const [customFrom, setCustomFrom] = useState(initialRange.from);
  const [customTo, setCustomTo] = useState(initialRange.to);
  const [appliedFrom, setAppliedFrom] = useState(initialRange.from);
  const [appliedTo, setAppliedTo] = useState(initialRange.to);

  const [selectedClass, setSelectedClass] = useState("all");
  const [classes, setClasses] = useState([]);

  const [analytics, setAnalytics] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const asOfMonth = analytics?.as_of?.month || new Date(appliedTo + "T12:00:00").getMonth() + 1;
  const asOfYear = analytics?.as_of?.year || new Date(appliedTo + "T12:00:00").getFullYear();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await API.get("/classes");
        if (!cancelled) setClasses(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setClasses([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyPreset = (id) => {
    setPreset(id);
    if (id === "custom") return;
    const range = resolveRangePreset(id);
    setCustomFrom(range.from);
    setCustomTo(range.to);
    setAppliedFrom(range.from);
    setAppliedTo(range.to);
  };

  const applyCustom = () => {
    if (!customFrom || !customTo) return;
    if (customFrom > customTo) {
      setError("Date From must be on or before Date To");
      return;
    }
    setError("");
    setPreset("custom");
    setAppliedFrom(customFrom);
    setAppliedTo(customTo);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const [analyticsRes, summaryRes] = await Promise.all([
          API.get("/reports/dashboard-analytics", {
            params: { from: appliedFrom, to: appliedTo, class: selectedClass },
          }),
          API.get("/reports/dashboard", {
            params: {
              month: new Date(`${appliedTo}T12:00:00`).getMonth() + 1,
              year: new Date(`${appliedTo}T12:00:00`).getFullYear(),
              class: selectedClass,
            },
          }),
        ]);
        if (!cancelled) {
          setAnalytics(analyticsRes.data);
          setDashboard(summaryRes.data);
        }
      } catch (err) {
        if (!cancelled) {
          setAnalytics(null);
          setDashboard(null);
          setError(err?.response?.data?.message || err.message || "Failed to load dashboard");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appliedFrom, appliedTo, selectedClass]);

  const billingMonthLabel = `${monthShort(asOfMonth)} ${asOfYear}`;
  const m = analytics?.metrics;
  const meta = analytics?.meta;
  const charts = analytics?.charts || {};
  const classStrength = dashboard?.charts?.class_gender_strength || [];
  const pendingByClass = charts.pending_by_class || dashboard?.charts?.pending_by_class || [];
  const monthlyProfit = dashboard?.charts?.monthly_profit_trend || [];
  const yearlyProfit = dashboard?.charts?.yearly_profit_trend || [];
  const classFeeStatus = dashboard?.charts?.class_fee_status || [];

  const presetLabel = RANGE_PRESETS.find((p) => p.id === preset)?.label || "Custom";
  const classLabel =
    selectedClass === "all"
      ? "All Classes"
      : classes.find((c) => String(c.id) === String(selectedClass))?.name || "Class";

  return (
    <section className="page-card dashboard-page">
      <section className="dash-range-panel" aria-label="Date range">
        <div className="dash-range-panel__row">
          <select
            className="dash-range-panel__class-select"
            aria-label="Class"
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
          >
            <option value="all">All Classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="dash-range-pills" role="tablist" aria-label="Quick ranges">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={preset === p.id}
                title={p.label}
                className={`dash-range-pill${preset === p.id ? " is-active" : ""}`}
                onClick={() => applyPreset(p.id)}
              >
                <span className="dash-range-pill__full">{p.label}</span>
                <span className="dash-range-pill__short">{p.shortLabel}</span>
              </button>
            ))}
          </div>
        </div>

        {preset === "custom" ? (
          <div className="dash-range-custom">
            <label className="dash-range-custom__field">
              <span>Date From</span>
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value || toIsoDate(new Date()))}
              />
            </label>
            <label className="dash-range-custom__field">
              <span>Date To</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value || toIsoDate(new Date()))}
              />
            </label>
            <button type="button" className="dash-range-custom__apply" onClick={applyCustom}>
              Apply
            </button>
          </div>
        ) : null}
      </section>

      <div className="dash-scope" aria-live="polite">
        <span className="dash-scope__chip">{presetLabel}</span>
        <span className="dash-scope__chip">{classLabel}</span>
        <span className="dash-scope__meta">
          Money figures use {appliedFrom} → {appliedTo}. Strength & pending use {billingMonthLabel}.
        </span>
      </div>

      {error ? <div className="alert alert--error dash-banner">{error}</div> : null}
      {loading ? (
        <div className="dash-loading" aria-live="polite">
          <span className="dash-loading__pulse" />
          <p>Loading dashboard analytics…</p>
        </div>
      ) : null}

      {!loading && analytics ? (
        <>
          <SectionLabel eyebrow="Overview" title="Money at a glance" />
          <InsightStrip
            metrics={m}
            meta={meta}
            paid={dashboard?.strength?.paid_students}
            partial={dashboard?.strength?.partial_students}
          />
          <section className="dash-metric-grid" aria-label="Range metrics">
            <MetricCard
              label="Total Collection"
              value={toMoney(m.total_collection)}
              hint="Fees collected in selected range"
              tone="dark"
              accent="teal"
              barPct={100}
            />
            <MetricCard
              label="Expenses"
              value={toMoney(m.expenses)}
              hint={
                m.total_collection > 0
                  ? `${meta.expense_pct_of_collection}% of collection`
                  : "Expenses in selected range"
              }
              tone="light"
              accent="amber"
              barPct={meta.expense_pct_of_collection}
            />
            <MetricCard
              label="Additional Amount"
              value={toMoney(m.additional_amount)}
              hint="Extra income in selected range"
              tone="light"
              accent="teal"
              barPct={m.total_collection > 0 ? (m.additional_amount / m.total_collection) * 100 : 20}
            />
            <MetricCard
              label="Concession"
              value={toMoney(m.concession)}
              hint="Concessions in selected range"
              tone="light"
              accent="teal"
              barPct={m.total_collection > 0 ? (m.concession / m.total_collection) * 100 : 20}
            />
            <MetricCard
              label="Net Profit"
              value={toMoney(m.net_profit)}
              hint={
                m.total_collection > 0
                  ? `${meta.margin_pct}% margin on collection`
                  : "Collection − expenses + additional"
              }
              tone="light"
              accent="teal"
              barPct={Math.max(0, meta.margin_pct)}
            />
            <MetricCard
              label="Pending Fees"
              value={toMoney(m.pending_fees)}
              hint={`Unpaid through ${billingMonthLabel}`}
              tone="light"
              accent="rose"
              barPct={55}
            />
            <MetricCard
              label="Previous Year Due"
              value={toMoney(m.previous_year_due ?? dashboard?.dues?.previous_year_total_due)}
              hint={`Arrears from ${asOfYear - 1}`}
              tone="light"
              accent="violet"
              barPct={40}
            />
          </section>
        </>
      ) : null}

      {!dashboard || loading ? null : (
        <>
          <SectionLabel eyebrow="Students" title="Strength & fee recovery" />
          <StrengthHero
            strength={dashboard.strength}
            billingMonthLabel={billingMonthLabel}
            classStrength={classStrength}
          />

          {!analytics ? null : (
            <>
              <SectionLabel eyebrow="Analytics" title="Trends, classes & spend" />
              <section className="dash-analytics-grid" aria-label="Analytics charts">
                <FinancePulseBoard
                  title="Finance snapshot"
                  subtitle="Collection, expenses, additional & profit for the selected filter"
                  metrics={m}
                />

                <ExpenseSpotlightCard data={monthlyProfit} />

                <FinanceTrendHatchCard
                  data={charts.finance_trend}
                  totalCollection={m.total_collection}
                  rangeLabel={`${appliedFrom} – ${appliedTo}`}
                />

                <CollectionProfitTrendCard
                  title="Month trends"
                  subtitle={`Collection & profit · Jan–${monthShort(asOfMonth)} ${asOfYear}`}
                  data={monthlyProfit}
                  mode="month"
                />
                <CollectionProfitTrendCard
                  title="Year trends"
                  subtitle="Collection & profit · recent years"
                  data={yearlyProfit}
                  mode="year"
                />

                <ExpenseCategoryDonutCard data={charts.expense_by_category} />
                <CollectionDistributionPieCard data={charts.collection_by_method} />
                <BarChartCard
                  title="Collection per class"
                  subtitle="Fees collected in selected range"
                  data={charts.collection_by_class}
                  nameKey="class_name"
                  valueKey="total"
                  color={CHART_COLORS.teal}
                  valueLabel="Collection"
                />

                <BarChartCard
                  title="Pending fee per class"
                  subtitle={`Unpaid through ${billingMonthLabel}`}
                  data={pendingByClass}
                  nameKey="class_name"
                  valueKey="total"
                  color={CHART_COLORS.rose}
                  valueLabel="Pending fee"
                />

                <ClassFeeStatusBoard
                  title="Class fee status"
                  subtitle={`${billingMonthLabel} · paid students vs pending fee students by class`}
                  data={classFeeStatus}
                />

                <FeeRecoveryProgressCard
                  paid={dashboard.strength?.paid_students}
                  partial={dashboard.strength?.partial_students}
                  billingMonthLabel={billingMonthLabel}
                />
                <TopDefaultersBoard
                  title="Top 5 defaulters"
                  subtitle={`${billingMonthLabel} · highest remaining year due · hover for class`}
                  data={charts.top_defaulters || dashboard?.charts?.top_defaulters}
                />
              </section>

              <SectionLabel eyebrow="Leaders" title="Who is leading" />
              <TopRankingsBoard
                title="Top rankings"
                subtitle="Quick leaders for collection, spend, strength, pending & profit"
                collectionByClass={charts.collection_by_class}
                expenseByCategory={charts.expense_by_category}
                classStrength={classStrength}
                pendingByClass={pendingByClass}
                monthlyProfit={monthlyProfit}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
