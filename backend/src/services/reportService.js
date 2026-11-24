const pool = require("../config/db");
const feeLedgerService = require("./feeLedgerService");
const academicService = require("./academicService");
const additionalAmountService = require("./additionalAmountService");

class ReportValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReportValidationError";
  }
}

const toNumber = (value) => Number(value || 0);

const validateMonthYear = (month, year) => {
  const parsedMonth = Number(month);
  const parsedYear = Number(year);

  if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
    throw new ReportValidationError("month must be an integer between 1 and 12");
  }

  if (!Number.isInteger(parsedYear) || parsedYear < 2000) {
    throw new ReportValidationError("year must be an integer greater than or equal to 2000");
  }

  return { parsedMonth, parsedYear };
};

const getMonthlyPayments = async (month, year) => {
  const { parsedMonth, parsedYear } = validateMonthYear(month, year);

  const result = await pool.query(
    `
      SELECT COALESCE(SUM(p.amount_paid), 0)::numeric AS total_payments
      FROM payments p
      WHERE EXTRACT(MONTH FROM p.payment_date) = $1
        AND EXTRACT(YEAR FROM p.payment_date) = $2
    `,
    [parsedMonth, parsedYear]
  );

  return toNumber(result.rows[0].total_payments);
};

const getMonthlyExpenses = async (month, year) => {
  const { parsedMonth, parsedYear } = validateMonthYear(month, year);

  const result = await pool.query(
    `
      SELECT COALESCE(SUM(e.amount), 0)::numeric AS total_expenses
      FROM expenses e
      WHERE EXTRACT(MONTH FROM e.date) = $1
        AND EXTRACT(YEAR FROM e.date) = $2
        AND e.deleted_at IS NULL
    `,
    [parsedMonth, parsedYear]
  );

  return toNumber(result.rows[0].total_expenses);
};

const getMonthlyProfit = async (month, year) => {
  const [totalPayments, totalExpenses, additionalAmount] = await Promise.all([
    getMonthlyPayments(month, year),
    getMonthlyExpenses(month, year),
    getAdditionalAmountTotal({ month: Number(month), year: Number(year) }),
  ]);

  return {
    total_payments: totalPayments,
    total_expenses: totalExpenses,
    additional_amount: additionalAmount,
    profit: totalPayments - totalExpenses + additionalAmount,
  };
};

const getTotalProfit = async () => {
  const [paymentsResult, expensesResult, additionalAmount] = await Promise.all([
    pool.query(`
      SELECT COALESCE(SUM(amount_paid), 0)::numeric AS total_payments
      FROM payments
    `),
    pool.query(`
      SELECT COALESCE(SUM(amount), 0)::numeric AS total_expenses
      FROM expenses
      WHERE deleted_at IS NULL
    `),
    getAdditionalAmountTotal({}),
  ]);

  const totalPayments = toNumber(paymentsResult.rows[0].total_payments);
  const totalExpenses = toNumber(expensesResult.rows[0].total_expenses);

  return {
    total_payments: totalPayments,
    total_expenses: totalExpenses,
    additional_amount: additionalAmount,
    profit: totalPayments - totalExpenses + additionalAmount,
  };
};

const getExpenseBreakdown = async ({ from, to } = {}) => {
  const params = [];
  const where = ["e.deleted_at IS NULL"];
  if (from) {
    params.push(from);
    where.push(`e.date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`e.date <= $${params.length}::date`);
  }
  const result = await pool.query(
    `
      SELECT
        ec.name,
        COALESCE(SUM(e.amount), 0)::numeric AS total
      FROM expenses e
      JOIN expense_categories ec ON e.category_id = ec.id
      WHERE ${where.join(" AND ")}
      GROUP BY ec.name
      HAVING COALESCE(SUM(e.amount), 0) > 0
      ORDER BY total DESC, ec.name ASC
    `,
    params
  );

  return result.rows.map((row) => ({
    name: row.name,
    total: Math.round(toNumber(row.total)),
  }));
};

const parseClassQuery = (classParam) => {
  const s = String(classParam || "").trim();
  if (!s) return { mode: "all" };
  const lower = s.toLowerCase();
  if (lower.startsWith("alumni:")) {
    const y = Number(s.slice("alumni:".length));
    if (Number.isInteger(y) && y >= 1900 && y <= 2100) return { mode: "alumni", alumniYear: y };
  }
  return { mode: "class", classId: s };
};

const listStudentsForFeeReport = async ({ classParam, sectionId, gender }) => {
  const g = gender ? String(gender).trim().toLowerCase() : null;
  if (g && g !== "male" && g !== "female") {
    throw new ReportValidationError("gender must be male, female, or omitted");
  }

  const parsed = parseClassQuery(classParam);

  if (parsed.mode === "alumni") {
    let rows = await academicService.getAlumniStudentsByYear(parsed.alumniYear);
    if (g) rows = rows.filter((s) => String(s.gender).toLowerCase() === g);
    return rows;
  }

  const params = [];
  const where = ["s.deleted_at IS NULL", "s.status = 'active'"];

  if (parsed.mode === "class" && parsed.classId) {
    params.push(parsed.classId);
    where.push(`s.current_class_id = $${params.length}`);
  }
  if (sectionId && String(sectionId).trim() !== "" && parsed.mode === "class" && parsed.classId) {
    params.push(sectionId);
    where.push(`s.current_section_id = $${params.length}`);
  }
  if (g) {
    params.push(g);
    where.push(`LOWER(s.gender) = $${params.length}`);
  }

  const result = await pool.query(
    `
      SELECT s.*
      FROM students s
      WHERE ${where.join(" AND ")}
      ORDER BY s.name ASC, s.id ASC
    `,
    params
  );
  return result.rows;
};

const getClassWiseCollection = async (classId) => {
  if (!classId) {
    throw new ReportValidationError("class_id is required");
  }

  const classCheck = await pool.query(
    `
      SELECT id
      FROM classes
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [classId]
  );

  if (!classCheck.rows[0]) {
    throw new ReportValidationError("Class not found");
  }

  const result = await pool.query(
    `
      SELECT COALESCE(SUM(pa.amount), 0)::numeric AS total
      FROM payment_allocations pa
      INNER JOIN payments p ON p.id = pa.payment_id
      JOIN students s ON p.student_id = s.id
      WHERE s.current_class_id = $1
        AND s.deleted_at IS NULL
        AND p.deleted_at IS NULL
    `,
    [classId]
  );

  return {
    class_id: classId,
    total: toNumber(result.rows[0].total),
  };
};

const getFeeRegister = async (filters = {}) => {
  const { class: classParam, section: sectionId, year, status, gender, current_month: currentMonthRaw } = filters;
  const yearNumber = year !== undefined && year !== null && String(year).trim() !== "" ? Number(year) : NaN;
  const statusFilter = status ? String(status).toLowerCase() : null;

  if (!Number.isInteger(yearNumber) || yearNumber < 1900 || yearNumber > 2100) {
    throw new ReportValidationError("year must be an integer between 1900 and 2100");
  }
  if (statusFilter && statusFilter !== "all" && !["paid", "partial", "unpaid"].includes(statusFilter)) {
    throw new ReportValidationError("status must be all, paid, partial, or unpaid");
  }

  let currentMonthOpt;
  if (currentMonthRaw != null && String(currentMonthRaw).trim() !== "") {
    const m = Number(String(currentMonthRaw).trim());
    if (Number.isInteger(m) && m >= 1 && m <= 12) currentMonthOpt = m;
  }
  const ledgerOpts = currentMonthOpt !== undefined ? { current_month: currentMonthOpt } : {};

  const students = await listStudentsForFeeReport({
    classParam,
    sectionId,
    gender,
  });

  const rows = await Promise.all(
    students.map(async (student) => {
      const ledger = await feeLedgerService.computeStudentYearLedger(student, yearNumber, ledgerOpts);
      const monthly = ledger.monthly.map((m) => {
        let cellStatus = "unpaid";
        if (m.status === "paid") cellStatus = "paid";
        else if (m.status === "partial") cellStatus = "partial";
        else if (m.status === "neutral") cellStatus = "unpaid";

        const amount =
          m.fee > 0 && m.paid >= m.fee ? 0 : m.remaining;

        return {
          month: m.month,
          status: cellStatus,
          amount,
          fee: m.fee,
          paid: m.paid,
          remaining: m.remaining,
        };
      });

      return {
        student_id: ledger.student_id,
        student_name: ledger.student_name,
        class_name: ledger.class_name,
        total_year_due: ledger.total_year_due,
        current_due: ledger.current_due,
        remaining: ledger.remaining,
        status: ledger.overall_status,
        monthly,
      };
    })
  );

  const sf = statusFilter && statusFilter !== "all" ? statusFilter : null;
  const filteredRows = sf ? rows.filter((row) => row.status === sf) : rows;

  return filteredRows;
};

const getDefaulters = async (filters = {}) => {
  const { class: classParam, section: sectionId, year, gender, current_month: currentMonthRaw } = filters;
  const yearNumber = year !== undefined && year !== null && String(year).trim() !== "" ? Number(year) : NaN;

  if (!Number.isInteger(yearNumber) || yearNumber < 1900 || yearNumber > 2100) {
    throw new ReportValidationError("year must be an integer between 1900 and 2100");
  }

  let currentMonthOpt;
  if (currentMonthRaw != null && String(currentMonthRaw).trim() !== "") {
    const m = Number(String(currentMonthRaw).trim());
    if (Number.isInteger(m) && m >= 1 && m <= 12) currentMonthOpt = m;
  }

  const students = await listStudentsForFeeReport({
    classParam,
    sectionId,
    gender,
  });

  const ledgerOpts = currentMonthOpt !== undefined ? { current_month: currentMonthOpt } : {};

  const rows = await Promise.all(
    students.map(async (student) => {
      const ledger = await feeLedgerService.computeStudentYearLedger(student, yearNumber, ledgerOpts);
      return {
        student_id: ledger.student_id,
        student_name: ledger.student_name,
        class_name: ledger.class_name,
        phone: student.phone != null && String(student.phone).trim() !== "" ? String(student.phone).trim() : null,
        current_due: ledger.current_due,
        remaining: ledger.total_year_due,
      };
    })
  );

  // Defaulters = students with Current Due > 0 (same current_due as Fee Collection)
  return rows
    .filter((row) => Number(row.current_due) > 0)
    .sort(
      (a, b) =>
        Number(b.current_due) - Number(a.current_due) ||
        String(a.student_name).localeCompare(String(b.student_name))
    );
};

const validateYear = (year) => {
  const parsedYear = Number(year);
  if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
    throw new ReportValidationError("year must be an integer between 1900 and 2100");
  }
  return parsedYear;
};

const normalizeClassFilter = (classParam) => {
  const s = String(classParam || "").trim();
  if (!s || s.toLowerCase() === "all") return "all";
  return s;
};

/** Timestamp used for dashboard cash-period filtering when `payment_date` is missing. */
const PAYMENT_DATE_EXPR =
  "COALESCE(p.payment_date::timestamp, p.created_at::timestamp)";

/**
 * Dashboard finance KPIs: sum whole **payments** by **payment_date** (cash month/year received).
 * Does not split by FIFO or allocation lines — the full receipt counts in the month the payment landed.
 */
const getPaymentsTotalByPaymentDate = async ({ month, year, classFilter, paymentType } = {}) => {
  const params = [];
  const where = ["p.deleted_at IS NULL"];

  if (paymentType === "concession") {
    where.push(
      "(COALESCE(p.payment_type, 'payment') = 'concession' OR UPPER(COALESCE(p.reference_no, '')) LIKE 'CONCESSION%')"
    );
  } else if (paymentType === "payment") {
    where.push("COALESCE(p.payment_type, 'payment') <> 'concession'");
    where.push("NOT (UPPER(COALESCE(p.reference_no, '')) LIKE 'CONCESSION%')");
  }

  if (Number.isInteger(Number(month))) {
    params.push(Number(month));
    where.push(`EXTRACT(MONTH FROM ${PAYMENT_DATE_EXPR}) = $${params.length}`);
  }
  if (Number.isInteger(Number(year))) {
    params.push(Number(year));
    where.push(`EXTRACT(YEAR FROM ${PAYMENT_DATE_EXPR}) = $${params.length}`);
  }

  if (classFilter && classFilter !== "all") {
    params.push(classFilter);
    where.push(`s.current_class_id = $${params.length}`);
  }

  const result = await pool.query(
    `
      SELECT COALESCE(SUM(p.amount_paid), 0)::numeric AS total
      FROM payments p
      INNER JOIN students s ON s.id = p.student_id
      WHERE ${where.join(" AND ")}
        AND s.deleted_at IS NULL
        AND s.status = 'active'
    `,
    params
  );
  return toNumber(result.rows[0]?.total || 0);
};

const getExpensesTotal = async ({ month, year } = {}) => {
  const params = [];
  const where = ["1=1"];
  if (Number.isInteger(Number(month))) {
    params.push(Number(month));
    where.push(`EXTRACT(MONTH FROM e.date) = $${params.length}`);
  }
  if (Number.isInteger(Number(year))) {
    params.push(Number(year));
    where.push(`EXTRACT(YEAR FROM e.date) = $${params.length}`);
  }
  const result = await pool.query(
    `
      SELECT COALESCE(SUM(e.amount), 0)::numeric AS total
      FROM expenses e
      WHERE ${where.join(" AND ")}
        AND e.deleted_at IS NULL
    `,
    params
  );
  return toNumber(result.rows[0]?.total || 0);
};

const getClassStrengthBreakdown = async (classFilter) => {
  const params = [];
  const where = [
    "s.deleted_at IS NULL",
    "s.status = 'active'",
    "s.current_class_id IS NOT NULL",
  ];
  if (classFilter && classFilter !== "all") {
    params.push(classFilter);
    where.push(`s.current_class_id = $${params.length}`);
  }
  const result = await pool.query(
    `
      SELECT
        c.id AS class_id,
        c.name AS class_name,
        COUNT(s.id)::int AS total_students,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(s.gender, '')) = 'male')::int AS male_students,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(s.gender, '')) = 'female')::int AS female_students
      FROM classes c
      LEFT JOIN students s ON s.current_class_id = c.id AND ${where.join(" AND ")}
      WHERE c.deleted_at IS NULL
      ${classFilter && classFilter !== "all" ? "AND c.id = $1" : ""}
      GROUP BY c.id, c.name
      ORDER BY c.name ASC
    `,
    params
  );
  return result.rows;
};

/**
 * Sum of additional amounts (extra income for net profit).
 * Optional `year` / `month` filters by entry `date` so totals match the dashboard selectors.
 * Optional `from`/`to` (YYYY-MM-DD) filter by entry date range.
 */
const getAdditionalAmountTotal = async ({ year, month, from, to } = {}) => {
  await additionalAmountService.ensureAdditionalAmountsTable();
  const params = [];
  const where = ["a.deleted_at IS NULL"];
  if (from) {
    params.push(from);
    where.push(`a.date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`a.date <= $${params.length}::date`);
  }
  if (!from && !to && Number.isInteger(Number(year))) {
    params.push(Number(year));
    where.push(`EXTRACT(YEAR FROM a.date) = $${params.length}`);
    if (Number.isInteger(Number(month))) {
      params.push(Number(month));
      where.push(`EXTRACT(MONTH FROM a.date) = $${params.length}`);
    }
  }
  const result = await pool.query(
    `
      SELECT COALESCE(SUM(a.amount), 0)::numeric AS total
      FROM additional_amounts a
      WHERE ${where.join(" AND ")}
    `,
    params
  );
  return toNumber(result.rows[0]?.total || 0);
};

const parseIsoDateOnly = (value, label) => {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ReportValidationError(`${label} must be YYYY-MM-DD`);
  }
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    throw new ReportValidationError(`${label} is invalid`);
  }
  return s;
};

/**
 * Interactive dashboard analytics for an inclusive date range.
 * Collection / concession / expenses / additional amount are cash-dated in range.
 * Pending fees = ledger current due as of the range end date (prev + current month unpaid).
 */
const getDashboardAnalytics = async ({ from, to, class: classParam } = {}) => {
  const fromDate = parseIsoDateOnly(from, "from");
  const toDate = parseIsoDateOnly(to, "to");
  if (fromDate > toDate) {
    throw new ReportValidationError("from must be on or before to");
  }
  const classFilter = normalizeClassFilter(classParam);

  const toParts = new Date(`${toDate}T12:00:00`);
  const asOfMonth = toParts.getMonth() + 1;
  const asOfYear = toParts.getFullYear();

  const [
    totalCollection,
    concession,
    expenses,
    additionalAmount,
    expenseByCategory,
    collectionByClass,
    collectionByMethod,
    trend,
  ] = await Promise.all([
    getPaymentsTotalByDateRange({ from: fromDate, to: toDate, classFilter, paymentType: "payment" }),
    getPaymentsTotalByDateRange({ from: fromDate, to: toDate, classFilter, paymentType: "concession" }),
    getExpensesTotalByDateRange({ from: fromDate, to: toDate }),
    getAdditionalAmountTotal({ from: fromDate, to: toDate }),
    classFilter === "all" ? getExpenseBreakdown({ from: fromDate, to: toDate }) : Promise.resolve([]),
    getCollectionByClassInRange({ from: fromDate, to: toDate, classFilter }),
    getCollectionByMethodInRange({ from: fromDate, to: toDate, classFilter }),
    getFinanceTrendSeries({ from: fromDate, to: toDate, classFilter }),
  ]);

  const collectionForProfit = totalCollection;
  const expensesForProfit = classFilter === "all" ? expenses : 0;
  const additionalForProfit = classFilter === "all" ? additionalAmount : 0;
  const netProfit = collectionForProfit - expensesForProfit + additionalForProfit;

  let pendingFees = 0;
  let previousYearDue = 0;
  let pendingByClass = [];
  let topDefaulters = [];
  let paymentStatusMix = [];
  try {
    const dashboardSnapshotService = require("./dashboardSnapshotService");
    const snap = await dashboardSnapshotService.getDashboardSummary({
      month: asOfMonth,
      year: asOfYear,
      class: classFilter,
    });
    pendingFees = toNumber(snap?.dues?.current_due_total || 0);
    previousYearDue = toNumber(snap?.dues?.previous_year_total_due || 0);
    pendingByClass = Array.isArray(snap?.charts?.pending_by_class) ? snap.charts.pending_by_class : [];
    topDefaulters = Array.isArray(snap?.charts?.top_defaulters) ? snap.charts.top_defaulters : [];
    const strength = snap?.strength || {};
    paymentStatusMix = [
      { name: "Paid", value: Number(strength.paid_students || 0) },
      { name: "Partial", value: Number(strength.partial_students || 0) },
    ].filter((r) => r.value > 0);
  } catch {
    pendingFees = 0;
    previousYearDue = 0;
    pendingByClass = [];
    topDefaulters = [];
    paymentStatusMix = [];
  }

  const expensePct =
    totalCollection > 0 ? Math.round((expensesForProfit / totalCollection) * 1000) / 10 : 0;
  const marginPct =
    totalCollection > 0 ? Math.round((netProfit / totalCollection) * 1000) / 10 : 0;

  const incomeMix = [
    { name: "Collection", value: Math.round(totalCollection) },
    { name: "Additional", value: Math.round(additionalForProfit) },
    { name: "Expenses", value: Math.round(expensesForProfit) },
  ].filter((r) => r.value > 0);

  return {
    range: { from: fromDate, to: toDate },
    as_of: { month: asOfMonth, year: asOfYear },
    metrics: {
      total_collection: Math.round(totalCollection),
      expenses: Math.round(classFilter === "all" ? expenses : 0),
      additional_amount: Math.round(classFilter === "all" ? additionalAmount : 0),
      concession: Math.round(concession),
      net_profit: Math.round(netProfit),
      pending_fees: Math.round(pendingFees),
      previous_year_due: Math.round(previousYearDue),
    },
    meta: {
      expense_pct_of_collection: expensePct,
      margin_pct: marginPct,
      class: classFilter,
      trend_bucket: trend.bucket,
    },
    charts: {
      expense_by_category: expenseByCategory,
      collection_by_class: collectionByClass,
      collection_by_method: collectionByMethod,
      finance_trend: trend.series,
      payment_status_mix: paymentStatusMix,
      pending_by_class: pendingByClass,
      top_defaulters: topDefaulters,
      income_mix: incomeMix,
    },
  };
};

const getPaymentsTotalByDateRange = async ({ from, to, classFilter, paymentType } = {}) => {
  const params = [from, to];
  const where = [
    "p.deleted_at IS NULL",
    `${PAYMENT_DATE_EXPR}::date >= $1::date`,
    `${PAYMENT_DATE_EXPR}::date <= $2::date`,
  ];

  if (paymentType === "concession") {
    where.push(
      "(COALESCE(p.payment_type, 'payment') = 'concession' OR UPPER(COALESCE(p.reference_no, '')) LIKE 'CONCESSION%')"
    );
  } else if (paymentType === "payment") {
    where.push("COALESCE(p.payment_type, 'payment') <> 'concession'");
    where.push("NOT (UPPER(COALESCE(p.reference_no, '')) LIKE 'CONCESSION%')");
  }

  if (classFilter && classFilter !== "all") {
    params.push(classFilter);
    where.push(`s.current_class_id = $${params.length}`);
  }

  const result = await pool.query(
    `
      SELECT COALESCE(SUM(p.amount_paid), 0)::numeric AS total
      FROM payments p
      INNER JOIN students s ON s.id = p.student_id
      WHERE ${where.join(" AND ")}
        AND s.deleted_at IS NULL
        AND s.status = 'active'
    `,
    params
  );
  return toNumber(result.rows[0]?.total || 0);
};

const getExpensesTotalByDateRange = async ({ from, to } = {}) => {
  const result = await pool.query(
    `
      SELECT COALESCE(SUM(e.amount), 0)::numeric AS total
      FROM expenses e
      WHERE e.deleted_at IS NULL
        AND e.date >= $1::date
        AND e.date <= $2::date
    `,
    [from, to]
  );
  return toNumber(result.rows[0]?.total || 0);
};

const getCollectionByClassInRange = async ({ from, to, classFilter } = {}) => {
  const params = [from, to];
  const where = [
    "p.deleted_at IS NULL",
    "s.deleted_at IS NULL",
    "s.status = 'active'",
    "s.current_class_id IS NOT NULL",
    "COALESCE(p.payment_type, 'payment') <> 'concession'",
    "NOT (UPPER(COALESCE(p.reference_no, '')) LIKE 'CONCESSION%')",
    `${PAYMENT_DATE_EXPR}::date >= $1::date`,
    `${PAYMENT_DATE_EXPR}::date <= $2::date`,
  ];
  if (classFilter && classFilter !== "all") {
    params.push(classFilter);
    where.push(`s.current_class_id = $${params.length}`);
  }

  const result = await pool.query(
    `
      SELECT
        c.id AS class_id,
        c.name AS class_name,
        COALESCE(SUM(p.amount_paid), 0)::numeric AS total
      FROM payments p
      INNER JOIN students s ON s.id = p.student_id
      INNER JOIN classes c ON c.id = s.current_class_id AND c.deleted_at IS NULL
      WHERE ${where.join(" AND ")}
      GROUP BY c.id, c.name
      HAVING COALESCE(SUM(p.amount_paid), 0) > 0
      ORDER BY total DESC, c.name ASC
    `,
    params
  );

  return result.rows.map((row) => ({
    class_id: row.class_id,
    class_name: row.class_name,
    total: Math.round(toNumber(row.total)),
  }));
};

const METHOD_LABELS = {
  cash: "Cash",
  bank: "Bank",
  online: "Online",
};

/** Fee collection totals by payment method (cash / bank / online) for the date range. */
const getCollectionByMethodInRange = async ({ from, to, classFilter } = {}) => {
  const params = [from, to];
  const where = [
    "p.deleted_at IS NULL",
    "s.deleted_at IS NULL",
    "s.status = 'active'",
    "COALESCE(p.payment_type, 'payment') <> 'concession'",
    "NOT (UPPER(COALESCE(p.reference_no, '')) LIKE 'CONCESSION%')",
    `${PAYMENT_DATE_EXPR}::date >= $1::date`,
    `${PAYMENT_DATE_EXPR}::date <= $2::date`,
  ];
  if (classFilter && classFilter !== "all") {
    params.push(classFilter);
    where.push(`s.current_class_id = $${params.length}`);
  }

  const result = await pool.query(
    `
      SELECT
        LOWER(COALESCE(NULLIF(TRIM(p.method), ''), 'cash')) AS method,
        COALESCE(SUM(p.amount_paid), 0)::numeric AS total
      FROM payments p
      INNER JOIN students s ON s.id = p.student_id
      WHERE ${where.join(" AND ")}
      GROUP BY LOWER(COALESCE(NULLIF(TRIM(p.method), ''), 'cash'))
      HAVING COALESCE(SUM(p.amount_paid), 0) > 0
    `,
    params
  );

  const byMethod = new Map(
    result.rows.map((row) => [String(row.method || "cash"), Math.round(toNumber(row.total))])
  );

  return ["cash", "bank", "online"]
    .map((key) => ({
      name: METHOD_LABELS[key],
      method: key,
      total: byMethod.get(key) || 0,
    }))
    .filter((row) => row.total > 0);
};

const daysBetweenInclusive = (from, to) => {
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
};

const chooseTrendBucket = (from, to) => {
  const days = daysBetweenInclusive(from, to);
  if (days <= 31) return "day";
  if (days <= 92) return "week";
  return "month";
};

const addDaysIso = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const startOfWeekMonday = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dayNum = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dayNum}`;
};

const buildTrendBuckets = (from, to) => {
  const bucket = chooseTrendBucket(from, to);
  const buckets = [];
  if (bucket === "day") {
    let cur = from;
    while (cur <= to) {
      buckets.push({ key: cur, label: cur.slice(5), from: cur, to: cur });
      cur = addDaysIso(cur, 1);
    }
    return { bucket, buckets };
  }
  if (bucket === "week") {
    let weekStart = startOfWeekMonday(from);
    while (weekStart <= to) {
      const weekEnd = addDaysIso(weekStart, 6);
      const rangeFrom = weekStart < from ? from : weekStart;
      const rangeTo = weekEnd > to ? to : weekEnd;
      if (rangeFrom <= rangeTo) {
        buckets.push({
          key: weekStart,
          label: `${rangeFrom.slice(5)}–${rangeTo.slice(5)}`,
          from: rangeFrom,
          to: rangeTo,
        });
      }
      weekStart = addDaysIso(weekStart, 7);
    }
    return { bucket, buckets };
  }
  // month
  let [y, m] = from.split("-").map(Number);
  const [toY, toM] = to.split("-").map(Number);
  while (y < toY || (y === toY && m <= toM)) {
    const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const rangeFrom = monthStart < from ? from : monthStart;
    const rangeTo = monthEnd > to ? to : monthEnd;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    buckets.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      label: `${monthNames[m - 1]} ${y}`,
      from: rangeFrom,
      to: rangeTo,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return { bucket, buckets };
};

const getFinanceTrendSeries = async ({ from, to, classFilter } = {}) => {
  const { bucket, buckets } = buildTrendBuckets(from, to);
  const series = [];
  for (const b of buckets) {
    // eslint-disable-next-line no-await-in-loop
    const [collection, expenses, additional] = await Promise.all([
      getPaymentsTotalByDateRange({ from: b.from, to: b.to, classFilter, paymentType: "payment" }),
      getExpensesTotalByDateRange({ from: b.from, to: b.to }),
      getAdditionalAmountTotal({ from: b.from, to: b.to }),
    ]);
    const expensesForProfit = classFilter === "all" ? expenses : 0;
    const additionalForProfit = classFilter === "all" ? additional : 0;
    const profit = collection - expensesForProfit + additionalForProfit;
    series.push({
      key: b.key,
      label: b.label,
      from: b.from,
      to: b.to,
      collection: Math.round(collection),
      expenses: Math.round(expensesForProfit),
      additional: Math.round(additionalForProfit),
      profit: Math.round(profit),
    });
  }
  return { bucket, series };
};

const getStudentCohortForDashboard = async (classFilter) => {
  const filters = {};
  if (classFilter && classFilter !== "all") {
    filters.classParam = classFilter;
  }
  return listStudentsForFeeReport(filters);
};

/** Fast SQL parts of the dashboard (no per-student ledger). Used to refresh finance/charts after deltas. */
const getDashboardFastParts = async ({ month, year, class: classParam } = {}) => {
  const { parsedMonth } = validateMonthYear(month, year);
  const parsedYear = validateYear(year);
  const classFilter = normalizeClassFilter(classParam);

  const [monthlyCollection, monthlyConcession, yearlyCollection, yearlyConcession] = await Promise.all([
    getPaymentsTotalByPaymentDate({ month: parsedMonth, year: parsedYear, classFilter, paymentType: "payment" }),
    getPaymentsTotalByPaymentDate({ month: parsedMonth, year: parsedYear, classFilter, paymentType: "concession" }),
    getPaymentsTotalByPaymentDate({ year: parsedYear, classFilter, paymentType: "payment" }),
    getPaymentsTotalByPaymentDate({ year: parsedYear, classFilter, paymentType: "concession" }),
  ]);

  const [monthlyExpenses, yearlyExpenses, monthlyAdditionalAmount, additionalAmountTotal] =
    await Promise.all([
      getExpensesTotal({ month: parsedMonth, year: parsedYear }),
      getExpensesTotal({ year: parsedYear }),
      getAdditionalAmountTotal({ month: parsedMonth, year: parsedYear }),
      getAdditionalAmountTotal({ year: parsedYear }),
    ]);

  // Profit everywhere = collection − expenses + additional (class filter: collection only).
  const effectiveMonthlyProfit =
    classFilter === "all"
      ? monthlyCollection - monthlyExpenses + monthlyAdditionalAmount
      : monthlyCollection;
  const effectiveYearlyProfit =
    classFilter === "all"
      ? yearlyCollection - yearlyExpenses + additionalAmountTotal
      : yearlyCollection;

  const classWiseStrength = await getClassStrengthBreakdown(classFilter);

  const monthlyProfitTrend = [];
  for (let m = 1; m <= parsedMonth; m += 1) {
    // eslint-disable-next-line no-await-in-loop
    const [mCollection, mExpenses, mAdditional] = await Promise.all([
      getPaymentsTotalByPaymentDate({ month: m, year: parsedYear, classFilter, paymentType: "payment" }),
      getExpensesTotal({ month: m, year: parsedYear }),
      classFilter === "all"
        ? getAdditionalAmountTotal({ month: m, year: parsedYear })
        : Promise.resolve(0),
    ]);
    const mExpensesForProfit = classFilter === "all" ? mExpenses : 0;
    const mAdditionalForProfit = classFilter === "all" ? mAdditional : 0;
    monthlyProfitTrend.push({
      month: m,
      collection: mCollection,
      expenses: mExpensesForProfit,
      additional: mAdditionalForProfit,
      profit:
        classFilter === "all"
          ? mCollection - mExpensesForProfit + mAdditionalForProfit
          : mCollection,
    });
  }

  const yearsForTrend = [parsedYear - 3, parsedYear - 2, parsedYear - 1, parsedYear].filter(
    (y) => y >= 1900
  );
  const yearlyProfitTrend = await Promise.all(
    yearsForTrend.map(async (y) => {
      const [yCollection, yExpenses, yAdditional] = await Promise.all([
        getPaymentsTotalByPaymentDate({ year: y, classFilter, paymentType: "payment" }),
        getExpensesTotal({ year: y }),
        classFilter === "all" ? getAdditionalAmountTotal({ year: y }) : Promise.resolve(0),
      ]);
      return {
        year: y,
        collection: yCollection,
        expenses: classFilter === "all" ? yExpenses : 0,
        profit:
          classFilter === "all" ? yCollection - yExpenses + yAdditional : yCollection,
      };
    })
  );

  return {
    finance: {
      month_collection: monthlyCollection,
      month_expenses: classFilter === "all" ? monthlyExpenses : 0,
      month_profit: effectiveMonthlyProfit,
      year_collection: yearlyCollection,
      year_expenses: classFilter === "all" ? yearlyExpenses : 0,
      year_profit: effectiveYearlyProfit,
      additional_amount_total: classFilter === "all" ? additionalAmountTotal : 0,
    },
    concession: {
      month_concession: monthlyConcession,
      year_concession: yearlyConcession,
    },
    charts: {
      class_gender_strength: classWiseStrength.map((r) => ({
        class_id: r.class_id,
        class_name: r.class_name,
        total_students: Number(r.total_students || 0),
        male_students: Number(r.male_students || 0),
        female_students: Number(r.female_students || 0),
      })),
      monthly_profit_trend: monthlyProfitTrend,
      yearly_profit_trend: yearlyProfitTrend,
    },
  };
};

/**
 * Full dashboard build + per-student contributions (for snapshot cache / delta updates).
 * @returns {Promise<{ payload: object, contribs: object[] }>}
 */
const buildDashboardSnapshotBundle = async ({ month, year, class: classParam } = {}) => {
  const { parsedMonth } = validateMonthYear(month, year);
  const parsedYear = validateYear(year);
  const classFilter = normalizeClassFilter(classParam);
  const prevYear = parsedYear - 1;

  const fast = await getDashboardFastParts({ month: parsedMonth, year: parsedYear, class: classFilter });

  const students = await getStudentCohortForDashboard(classFilter);
  const ledgerOpts = { current_month: parsedMonth };
  const ledgers = await Promise.all(
    students.map((student) => feeLedgerService.computeStudentYearLedger(student, parsedYear, ledgerOpts))
  );

  let totalCurrentDue = 0;
  let totalYearDue = 0;
  let paidStudents = 0;
  let partialStudents = 0;
  let maleStudents = 0;
  let femaleStudents = 0;
  let malePaid = 0;
  let malePartial = 0;
  let femalePaid = 0;
  let femalePartial = 0;
  const contribs = [];

  let prevYearByStudent = new Map();
  if (prevYear >= 1900) {
    const prevLedgers = await Promise.all(
      students.map((student) => feeLedgerService.computeStudentYearLedger(student, prevYear))
    );
    prevYearByStudent = new Map(
      students.map((student, i) => [String(student.id), toNumber(prevLedgers[i]?.total_year_due || 0)])
    );
  }

  for (let i = 0; i < ledgers.length; i += 1) {
    const ledger = ledgers[i];
    const student = students[i];
    const gender = String(student?.gender || "").toLowerCase();
    const currentMonthCell = (ledger.monthly || []).find((m) => Number(m.month) === Number(parsedMonth));
    const monthFee = toNumber(currentMonthCell?.fee || 0);
    const monthStatus = currentMonthCell?.status || "neutral";
    const currentDue = toNumber(ledger.current_due || 0);
    const totalYearDueRow = toNumber(ledger.total_year_due || 0);
    const prevYearDue = toNumber(prevYearByStudent.get(String(student.id)) || 0);

    totalCurrentDue += currentDue;
    totalYearDue += totalYearDueRow;

    if (monthFee > 0) {
      if (monthStatus === "paid") paidStudents += 1;
      else partialStudents += 1;
    }

    if (gender === "male") {
      maleStudents += 1;
      if (monthFee > 0) {
        if (monthStatus === "paid") malePaid += 1;
        else malePartial += 1;
      }
    } else if (gender === "female") {
      femaleStudents += 1;
      if (monthFee > 0) {
        if (monthStatus === "paid") femalePaid += 1;
        else femalePartial += 1;
      }
    }

    contribs.push({
      student_id: student.id,
      student_name: ledger.student_name || student.student_name || student.name || "Student",
      class_id: student.current_class_id || null,
      class_name: ledger.class_name || student.class_name || null,
      gender,
      current_due: Math.round(currentDue),
      total_year_due: Math.round(totalYearDueRow),
      previous_year_total_due: Math.round(prevYearDue),
      month_fee: Math.round(monthFee),
      month_status: monthStatus,
    });
  }

  const prevYearTotalYearDue = contribs.reduce((sum, c) => sum + toNumber(c.previous_year_total_due), 0);

  const topDefaulters = [...contribs]
    .filter((c) => toNumber(c.total_year_due) > 0)
    .sort(
      (a, b) =>
        toNumber(b.total_year_due) - toNumber(a.total_year_due) ||
        String(a.student_name || "").localeCompare(String(b.student_name || ""))
    )
    .slice(0, 5)
    .map((c) => ({
      student_id: c.student_id,
      student_name: c.student_name || "Student",
      class_name: c.class_name || "Class",
      remaining: Math.round(toNumber(c.total_year_due)),
      current_due: Math.round(toNumber(c.current_due)),
    }));

  const pendingByClassMap = new Map();
  const classFeeStatusMap = new Map();
  for (const c of contribs) {
    if (!c.class_id) continue;
    const key = String(c.class_id);
    const due = toNumber(c.current_due);
    if (due > 0) {
      const pending = pendingByClassMap.get(key) || { class_id: c.class_id, total: 0 };
      pending.total += due;
      pendingByClassMap.set(key, pending);
    }

    const feeRow =
      classFeeStatusMap.get(key) ||
      ({
        class_id: c.class_id,
        total_students: 0,
        male_students: 0,
        female_students: 0,
        paid: 0,
        partial: 0,
        male_paid: 0,
        male_partial: 0,
        female_paid: 0,
        female_partial: 0,
      });
    feeRow.total_students += 1;
    const g = String(c.gender || "").toLowerCase();
    if (g === "male") feeRow.male_students += 1;
    else if (g === "female") feeRow.female_students += 1;

    if (toNumber(c.month_fee) > 0) {
      const isPaid = c.month_status === "paid";
      if (isPaid) {
        feeRow.paid += 1;
        if (g === "male") feeRow.male_paid += 1;
        else if (g === "female") feeRow.female_paid += 1;
      } else {
        feeRow.partial += 1;
        if (g === "male") feeRow.male_partial += 1;
        else if (g === "female") feeRow.female_partial += 1;
      }
    }
    classFeeStatusMap.set(key, feeRow);
  }

  const classNameById = new Map(
    (fast.charts.class_gender_strength || []).map((r) => [String(r.class_id), r.class_name])
  );
  // Fill any missing class names from cohort
  for (const student of students) {
    if (student.current_class_id && student.class_name) {
      classNameById.set(String(student.current_class_id), student.class_name);
    }
  }

  const pendingByClass = [...pendingByClassMap.values()]
    .map((row) => ({
      class_id: row.class_id,
      class_name: classNameById.get(String(row.class_id)) || "Class",
      total: Math.round(row.total),
    }))
    .sort((a, b) => b.total - a.total || String(a.class_name).localeCompare(String(b.class_name)));

  const classFeeStatus = [...classFeeStatusMap.values()]
    .map((row) => ({
      ...row,
      class_name: classNameById.get(String(row.class_id)) || "Class",
    }))
    .sort(
      (a, b) =>
        b.total_students - a.total_students ||
        String(a.class_name).localeCompare(String(b.class_name))
    );

  const payload = {
    selectorsEcho: {
      month: parsedMonth,
      year: parsedYear,
      class: classFilter,
    },
    finance: fast.finance,
    dues: {
      current_due_total: Math.round(totalCurrentDue),
      total_year_due: Math.round(totalYearDue),
      previous_year_total_due: Math.round(prevYearTotalYearDue),
    },
    concession: fast.concession,
    strength: {
      total_students: students.length,
      total_males: maleStudents,
      total_females: femaleStudents,
      paid_students: paidStudents,
      partial_students: partialStudents,
      male_paid: malePaid,
      male_partial: malePartial,
      female_paid: femalePaid,
      female_partial: femalePartial,
      students_with_month_fee: paidStudents + partialStudents,
    },
    charts: {
      ...fast.charts,
      pending_by_class: pendingByClass,
      class_fee_status: classFeeStatus,
      top_defaulters: topDefaulters,
    },
  };

  return { payload, contribs };
};

const getDashboardSummary = async (query = {}) => {
  const { payload } = await buildDashboardSnapshotBundle(query);
  return payload;
};

module.exports = {
  getFeeRegister,
  getDefaulters,
  getMonthlyPayments,
  getMonthlyExpenses,
  getMonthlyProfit,
  getTotalProfit,
  getExpenseBreakdown,
  getClassWiseCollection,
  getDashboardSummary,
  getDashboardAnalytics,
  buildDashboardSnapshotBundle,
  getDashboardFastParts,
  normalizeClassFilter,
};

module.exports.ReportValidationError = ReportValidationError;
