const pool = require("../config/db");
const paymentAllocationService = require("./paymentAllocationService");
const feeService = require("./feeService");
const academicService = require("./academicService");

class ChallanValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChallanValidationError";
  }
}

const toNumber = (value) => Number(value || 0);

/** Whole rupees only (no decimal paise). */
const roundMoney = (n) => Math.round(toNumber(n));

const ensurePaymentsLedgerColumns = async (client) => {
  await client.query(`
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS selected_month INTEGER;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS ledger_year INTEGER;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type VARCHAR(20) DEFAULT 'payment';
  `);
};

const getAcademicYearScope = async (client) => {
  const active = await client.query(
    `
      SELECT id
      FROM academic_years
      WHERE is_active = TRUE
      ORDER BY start_date DESC NULLS LAST
      LIMIT 1
    `
  );
  if (active.rows[0]?.id) return active.rows[0].id;

  const latest = await client.query(
    `
      SELECT id
      FROM academic_years
      ORDER BY start_date DESC NULLS LAST
      LIMIT 1
    `
  );
  return latest.rows[0]?.id || null;
};

const challanFeeSql = `
  COALESCE(
    (
      SELECT SUM(ci.amount)::numeric
      FROM challan_items ci
      WHERE ci.challan_id = c.id
    ),
    0
  )
`;

const challanPaidSql = `
  COALESCE(
    (
      SELECT SUM(p.amount_paid)::numeric
      FROM payments p
      WHERE p.challan_id = c.id
        AND COALESCE(p.deleted_at, NULL) IS NULL
        AND COALESCE(p.payment_type, 'payment') <> 'concession'
        AND NOT (UPPER(COALESCE(p.reference_no, '')) LIKE 'CONCESSION%')
    ),
    0
  )
`;

const createChallan = async (data) => {
  const { student_id, academic_year_id, issue_date, due_date, month, year, notes } = data;

  if (!student_id || !academic_year_id || !issue_date) {
    throw new ChallanValidationError("student_id, academic_year_id and issue_date are required");
  }

  const studentCheck = await pool.query(
    `
      SELECT id
      FROM students
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [student_id]
  );

  if (!studentCheck.rows[0]) {
    throw new ChallanValidationError("Student not found");
  }

  const result = await pool.query(
    `
      INSERT INTO challans (
        student_id,
        academic_year_id,
        issue_date,
        due_date,
        month,
        year,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [
      student_id,
      academic_year_id,
      issue_date,
      due_date || null,
      month || null,
      year || null,
      notes || null,
    ]
  );

  return result.rows[0];
};

const addChallanItem = async (data) => {
  const { challan_id, fee_type_id, amount } = data;

  if (!challan_id || !fee_type_id || amount === undefined || amount === null) {
    throw new ChallanValidationError("challan_id, fee_type_id and amount are required");
  }

  if (toNumber(amount) < 0) {
    throw new ChallanValidationError("amount must be greater than or equal to 0");
  }

  const challanCheck = await pool.query(
    `
      SELECT id
      FROM challans
      WHERE id = $1
    `,
    [challan_id]
  );

  if (!challanCheck.rows[0]) {
    throw new ChallanValidationError("Challan not found");
  }

  const feeTypeCheck = await pool.query(
    `
      SELECT id
      FROM fee_types
      WHERE id = $1
    `,
    [fee_type_id]
  );

  if (!feeTypeCheck.rows[0]) {
    throw new ChallanValidationError("Fee type not found");
  }

  const result = await pool.query(
    `
      INSERT INTO challan_items (challan_id, fee_type_id, amount)
      VALUES ($1, $2, $3)
      RETURNING *
    `,
    [challan_id, fee_type_id, amount]
  );

  return result.rows[0];
};

const getChallanDetails = async (challanId) => {
  if (!challanId) {
    throw new ChallanValidationError("challan_id is required");
  }

  const challanResult = await pool.query(
    `
      SELECT *
      FROM challans
      WHERE id = $1
    `,
    [challanId]
  );

  const challan = challanResult.rows[0];
  if (!challan) {
    throw new ChallanValidationError("Challan not found");
  }

  const studentResult = await pool.query(
    `
      SELECT
        s.id,
        s.name,
        s.phone,
        s.father_name,
        c.name AS class_name,
        sec.name AS section_name
      FROM students s
      LEFT JOIN classes c ON c.id = s.current_class_id AND c.deleted_at IS NULL
      LEFT JOIN sections sec ON sec.id = s.current_section_id AND sec.deleted_at IS NULL
      WHERE s.id = $1
        AND s.deleted_at IS NULL
    `,
    [challan.student_id]
  );

  const itemsResult = await pool.query(
    `
      SELECT
        ci.*,
        ft.name AS fee_type_name
      FROM challan_items ci
      INNER JOIN fee_types ft ON ft.id = ci.fee_type_id
      WHERE ci.challan_id = $1
      ORDER BY ft.name ASC
    `,
    [challanId]
  );

  const paymentsResult = await pool.query(
    `
      SELECT *
      FROM payments
      WHERE challan_id = $1
      ORDER BY payment_date ASC, created_at ASC
    `,
    [challanId]
  );

  const totalFee = itemsResult.rows.reduce((sum, item) => sum + toNumber(item.amount), 0);
  const totalPaid = paymentsResult.rows.reduce((sum, payment) => sum + toNumber(payment.amount_paid), 0);
  const remaining = totalFee - totalPaid;

  return {
    challan,
    student: studentResult.rows[0] || null,
    items: itemsResult.rows,
    payments: paymentsResult.rows,
    totals: {
      total_fee: totalFee,
      total_paid: totalPaid,
      remaining,
    },
  };
};

const addPayment = async (data) => {
  const {
    student_id,
    challan_id,
    amount_paid,
    payment_date,
    method,
    reference_no,
    selected_month,
    ledger_year,
    payment_type: rawPaymentType,
    allocations: rawAllocations,
  } = data;

  if (!student_id || amount_paid === undefined || amount_paid === null || !payment_date || !method) {
    throw new ChallanValidationError("student_id, amount_paid, payment_date and method are required");
  }

  const amount = roundMoney(amount_paid);
  if (amount <= 0) {
    throw new ChallanValidationError("amount_paid must be greater than 0");
  }

  const allowedMethods = ["cash", "bank", "online"];
  if (!allowedMethods.includes(method)) {
    throw new ChallanValidationError("method must be one of cash, bank, online");
  }

  const payment_type = rawPaymentType === "concession" ? "concession" : "payment";

  let selMonth = null;
  let ledYear = null;
  if (selected_month !== undefined && selected_month !== null && String(selected_month).trim() !== "") {
    const m = Number(selected_month);
    if (!Number.isNaN(m) && m >= 1 && m <= 12) selMonth = m;
  }
  if (ledger_year !== undefined && ledger_year !== null && String(ledger_year).trim() !== "") {
    const y = Number(ledger_year);
    if (!Number.isNaN(y) && y >= 1900 && y <= 2100) ledYear = y;
  }

  await ensurePaymentsLedgerColumns(pool);

  const studentCheck = await pool.query(
    `
      SELECT id
      FROM students
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [student_id]
  );

  if (!studentCheck.rows[0]) {
    throw new ChallanValidationError("Student not found");
  }

  if (challan_id) {
    const challanCheck = await pool.query(
      `
        SELECT id
        FROM challans
        WHERE id = $1
          AND student_id = $2
          AND COALESCE(deleted_at, NULL) IS NULL
      `,
      [challan_id, student_id]
    );
    if (!challanCheck.rows[0]) {
      throw new ChallanValidationError("Challan does not belong to this student");
    }
  }

  const studentRow = await pool.query(
    `
      SELECT current_class_id
      FROM students
      WHERE id = $1 AND deleted_at IS NULL
    `,
    [student_id]
  );
  const studentClassId = studentRow.rows[0]?.current_class_id || null;

  let classIdForAlloc = studentClassId;
  if (ledYear != null) {
    try {
      const enrollment = await academicService.resolveStudentEnrollmentForYear(student_id, ledYear);
      if (enrollment && enrollment.source !== "alumni_post_graduation") {
        classIdForAlloc = enrollment.class_id || studentClassId;
      } else if (enrollment?.source === "alumni_post_graduation") {
        classIdForAlloc = null;
      }
    } catch {
      classIdForAlloc = studentClassId;
    }
  }

  let allocationLines =
    Array.isArray(rawAllocations) && rawAllocations.length > 0 ? rawAllocations : null;
  if (!allocationLines && payment_type === "payment" && classIdForAlloc) {
    try {
      const auto = await buildAutoAdvanceAllocationLines({
        student_id,
        class_id: classIdForAlloc,
        amount_paid: amount,
        ledger_year: ledYear,
        selected_month: selMonth,
        payment_date,
        payment_type,
      });
      if (auto && auto.length > 0) allocationLines = auto;
    } catch {
      /* single default allocation */
    }
  }
  if (!allocationLines && payment_type === "concession" && classIdForAlloc) {
    try {
      const feeLedgerService = require("./feeLedgerService");
      const auto = await feeLedgerService.inferConcessionAllocationLines({
        student_id,
        class_id: classIdForAlloc,
        amount_paid: amount,
        ledger_year: ledYear,
        selected_month: selMonth,
        payment_date,
      });
      if (auto && auto.length > 0) allocationLines = auto;
    } catch {
      /* payment-style fallback below */
    }
  }
  if (!allocationLines && payment_type === "concession" && classIdForAlloc) {
    try {
      const payLines = await buildAutoAdvanceAllocationLines({
        student_id,
        class_id: classIdForAlloc,
        amount_paid: amount,
        ledger_year: ledYear,
        selected_month: selMonth,
        payment_date,
        payment_type: "payment",
      });
      if (payLines && payLines.length > 0) {
        allocationLines = payLines.map((l) => ({
          ledger_year: l.ledger_year,
          month: l.month,
          amount: l.amount,
          allocation_kind: "concession",
          fee_advance_link_id: null,
        }));
      }
    } catch {
      /* booking-month default below */
    }
  }
  if (!allocationLines && payment_type === "concession") {
    allocationLines = buildDefaultConcessionAllocationLines({
      amount,
      ledger_year: ledYear,
      selected_month: selMonth,
      payment_date,
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
      INSERT INTO payments (
        student_id,
        challan_id,
        amount_paid,
        payment_date,
        method,
        reference_no,
        selected_month,
        ledger_year,
        payment_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
      [
        student_id,
        challan_id || null,
        amount,
        payment_date,
        method,
        reference_no || null,
        selMonth,
        ledYear,
        payment_type,
      ]
    );
    const row = result.rows[0];
    try {
      await paymentAllocationService.replaceAllocationsForPayment(
        client,
        row,
        allocationLines,
        classIdForAlloc || studentClassId
      );
    } catch (allocErr) {
      await client.query("ROLLBACK").catch(() => {});
      throw new ChallanValidationError(allocErr.message || "Invalid payment allocations");
    }
    await client.query("COMMIT");
    return row;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
};

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const getStudentLedger = async (studentId) => {
  if (!studentId) {
    throw new ChallanValidationError("student_id is required");
  }

  const studentResult = await pool.query(
    `
      SELECT id, name, current_class_id
      FROM students
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [studentId]
  );
  const student = studentResult.rows[0];
  if (!student) {
    throw new ChallanValidationError("Student not found");
  }

  const academicYearId = await getAcademicYearScope(pool);
  if (!academicYearId) {
    return {
      student_id: studentId,
      months: [],
      total_fee: 0,
      total_paid: 0,
      remaining: 0,
    };
  }

  const yearResult = await pool.query(
    `
      SELECT id, name, start_date
      FROM academic_years
      WHERE id = $1
    `,
    [academicYearId]
  );
  const yearRow = yearResult.rows[0] || {};
  const feeYear = yearRow.start_date ? new Date(yearRow.start_date).getFullYear() : new Date().getFullYear();

  const structureResult = await pool.query(
    `
      SELECT id, start_month, end_month
      FROM fee_structures
      WHERE class_id = $1
        AND academic_year_id = $2
        AND title = 'Fee Setup'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [student.current_class_id, academicYearId]
  );
  const structure = structureResult.rows[0];
  if (!structure) {
    return {
      student_id: studentId,
      months: [],
      total_fee: 0,
      total_paid: 0,
      remaining: 0,
    };
  }

  const monthlyFeeResult = await pool.query(
    `
      SELECT COALESCE(MAX(fsi.amount), 0)::numeric AS monthly_fee
      FROM fee_structure_items fsi
      INNER JOIN fee_types ft ON ft.id = fsi.fee_type_id
      WHERE fsi.structure_id = $1
        AND LOWER(TRIM(ft.name)) IN ('monthly', 'monthly fee')
    `,
    [structure.id]
  );
  const baseMonthlyFee = roundMoney(monthlyFeeResult.rows[0]?.monthly_fee || 0);

  const assignmentResult = await pool.query(
    `
      SELECT discount_amount
      FROM student_fee_assignments
      WHERE student_id = $1
        AND academic_year_id = $2
      LIMIT 1
    `,
    [studentId, academicYearId]
  );
  const discount = roundMoney(assignmentResult.rows[0]?.discount_amount || 0);
  const effectiveMonthlyFee = Math.max(0, roundMoney(baseMonthlyFee - discount));

  const startMonth = Math.max(1, Math.min(12, Number(structure.start_month || 1)));
  const endMonth = Math.max(1, Math.min(12, Number(structure.end_month || 12)));
  const monthRange = startMonth <= endMonth ? Array.from({ length: endMonth - startMonth + 1 }, (_, i) => startMonth + i) : [];

  const paymentsResult = await pool.query(
    `
      SELECT amount_paid
      FROM payments
      WHERE student_id = $1
        AND COALESCE(deleted_at, NULL) IS NULL
        AND COALESCE(payment_type, 'payment') <> 'concession'
        AND NOT (UPPER(COALESCE(reference_no, '')) LIKE 'CONCESSION%')
      ORDER BY payment_date ASC, created_at ASC, id ASC
    `,
    [studentId]
  );

  let remainingPaymentTotal = roundMoney(
    paymentsResult.rows.reduce((sum, row) => sum + roundMoney(row.amount_paid), 0)
  );

  const months = monthRange.map((month) => {
    const fee = effectiveMonthlyFee;
    const paid = Math.min(remainingPaymentTotal, fee);
    remainingPaymentTotal = roundMoney(Math.max(0, remainingPaymentTotal - paid));
    const remainingMonth = roundMoney(Math.max(0, fee - paid));
    const status = paid === 0 ? "unpaid" : paid >= fee ? "paid" : "partial";
    return {
      month,
      year: feeYear,
      month_label: monthNames[month - 1],
      fee: roundMoney(fee),
      paid: roundMoney(paid),
      remaining: remainingMonth,
      status,
    };
  });

  const totalFee = roundMoney(months.reduce((sum, m) => sum + m.fee, 0));
  const totalPaid = roundMoney(months.reduce((sum, m) => sum + m.paid, 0));
  const remaining = roundMoney(Math.max(0, totalFee - totalPaid));

  return {
    student_id: studentId,
    months,
    total_fee: totalFee,
    total_paid: totalPaid,
    remaining,
  };
};

const getStudentSummary = async (studentId) => {
  if (!studentId) {
    throw new ChallanValidationError("student_id is required");
  }

  const studentCheck = await pool.query(
    `
      SELECT id
      FROM students
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [studentId]
  );

  if (!studentCheck.rows[0]) {
    throw new ChallanValidationError("Student not found");
  }

  const academicYearId = await getAcademicYearScope(pool);
  if (!academicYearId) {
    return {
      student_id: studentId,
      total_fee: 0,
      total_paid: 0,
      remaining: 0,
      status: "unpaid",
      monthly_breakdown: [],
    };
  }

  const breakdownResult = await pool.query(
    `
      SELECT
        c.id AS challan_id,
        c.month AS month,
        c.year AS year,
        (${challanFeeSql})::numeric AS fee,
        (${challanPaidSql})::numeric AS paid
      FROM challans c
      WHERE c.student_id = $1
        AND c.academic_year_id = $2
        AND COALESCE(c.deleted_at, NULL) IS NULL
      ORDER BY c.year ASC NULLS LAST, c.month ASC NULLS LAST, c.issue_date ASC NULLS LAST, c.id ASC
    `,
    [studentId, academicYearId]
  );

  const monthly_breakdown = breakdownResult.rows.map((r) => {
    const fee = roundMoney(r.fee);
    const paid = roundMoney(r.paid);
    const remaining = Math.max(0, roundMoney(fee - paid));
    return {
      challan_id: r.challan_id,
      month: r.month,
      year: r.year,
      fee,
      paid,
      remaining,
    };
  });

  const total_fee = roundMoney(monthly_breakdown.reduce((s, row) => s + row.fee, 0));

  const paidResult = await pool.query(
    `
      SELECT COALESCE(SUM(p.amount_paid), 0)::numeric AS total_paid
      FROM payments p
      WHERE p.student_id = $1
        AND COALESCE(p.deleted_at, NULL) IS NULL
        AND COALESCE(p.payment_type, 'payment') <> 'concession'
        AND NOT (UPPER(COALESCE(p.reference_no, '')) LIKE 'CONCESSION%')
    `,
    [studentId]
  );

  const total_paid = roundMoney(paidResult.rows[0].total_paid);
  const remaining = Math.max(0, roundMoney(total_fee - total_paid));

  let status = "unpaid";
  if (total_fee <= 0) {
    status = remaining <= 0 ? "paid" : "unpaid";
  } else if (remaining <= 0) {
    status = "paid";
  } else if (total_paid > 0) {
    status = "partial";
  } else {
    status = "unpaid";
  }

  return {
    student_id: studentId,
    total_fee,
    total_paid,
    remaining,
    status,
    monthly_breakdown,
  };
};

const getStudentPayments = async (studentId, billingYear = null) => {
  if (!studentId) {
    throw new ChallanValidationError("student_id is required");
  }

  const studentCheck = await pool.query(
    `
      SELECT id
      FROM students
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [studentId]
  );

  if (!studentCheck.rows[0]) {
    throw new ChallanValidationError("Student not found");
  }

  await ensurePaymentsLedgerColumns(pool);

  const yearFilter =
    billingYear != null && Number.isInteger(billingYear) && billingYear >= 1900 && billingYear <= 2100;

  const result = await pool.query(
    `
      SELECT
        p.*,
        CASE
          WHEN COALESCE(p.payment_type, 'payment') = 'concession'
            OR UPPER(COALESCE(p.reference_no, '')) LIKE 'CONCESSION%' THEN 'Concession'
          ELSE 'Payment'
        END AS type,
        COALESCE(a.allocations, '[]'::json) AS allocations
      FROM payments p
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', pa.id,
            'ledger_year', pa.ledger_year,
            'month', pa.month,
            'amount', pa.amount,
            'allocation_kind', pa.allocation_kind,
            'fee_advance_link_id', pa.fee_advance_link_id
          ) ORDER BY pa.created_at ASC, pa.id ASC
        ) AS allocations
        FROM payment_allocations pa
        WHERE pa.payment_id = p.id
      ) a ON TRUE
      WHERE p.student_id = $1
        AND COALESCE(p.deleted_at, NULL) IS NULL
        AND (
          $2::integer IS NULL
          OR EXISTS (
            SELECT 1
            FROM payment_allocations pa2
            WHERE pa2.payment_id = p.id
              AND pa2.ledger_year = $2
          )
          /* Advance lines store the *target* month’s calendar year. A Nov→Jan payment can be
             all-advance with ledger_year = 2027 only, and must still appear when viewing 2026. */
          OR EXISTS (
            SELECT 1
            FROM payment_allocations pa4
            INNER JOIN fee_advance_links fal
              ON fal.id = pa4.fee_advance_link_id
              AND fal.active = TRUE
            WHERE pa4.payment_id = p.id
              AND LOWER(COALESCE(pa4.allocation_kind, '')) = 'advance'
              AND (fal.source_year = $2 OR fal.target_year = $2)
          )
          /* Concession on a linked target month (e.g. Feb 2027 for Dec 2026→Feb 2027). */
          OR EXISTS (
            SELECT 1
            FROM payment_allocations pa_cy
            INNER JOIN fee_advance_links fal_cy
              ON fal_cy.active = TRUE
              AND fal_cy.target_year = pa_cy.ledger_year
              AND fal_cy.target_month = pa_cy.month
              AND (fal_cy.source_year = $2 OR fal_cy.target_year = $2)
            WHERE pa_cy.payment_id = p.id
              AND LOWER(COALESCE(pa_cy.allocation_kind, '')) = 'concession'
          )
          OR (
            NOT EXISTS (SELECT 1 FROM payment_allocations pa3 WHERE pa3.payment_id = p.id)
            AND (
              p.ledger_year = $2
              OR (
                p.ledger_year IS NULL
                AND EXTRACT(YEAR FROM COALESCE(p.payment_date::timestamp, p.created_at))::integer = $2
              )
            )
          )
        )
      ORDER BY p.payment_date ASC, p.created_at ASC, p.id ASC
    `,
    [studentId, yearFilter ? billingYear : null]
  );

  return result.rows.map((row) => ({
    ...row,
    allocations:
      typeof row.allocations === "string"
        ? JSON.parse(row.allocations)
        : row.allocations || [],
  }));
};

async function loadFeeAdvanceLinksForClass(classId) {
  const r = await pool.query(
    `
      SELECT id, source_year, source_month, target_year, target_month, sort_order
      FROM fee_advance_links
      WHERE class_id = $1 AND active = TRUE
      ORDER BY sort_order ASC NULLS LAST, source_year ASC, source_month ASC, target_year ASC, target_month ASC
    `,
    [classId]
  );
  return r.rows;
}

function nextCalendarMonth(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (m === 12) return { year: y + 1, month: 1 };
  return { year: y, month: m + 1 };
}

/** When concession infer fails: book on ledger year + booking month (not payment_date alone). */
function buildDefaultConcessionAllocationLines({ amount, ledger_year, selected_month, payment_date }) {
  const amt = roundMoney(amount);
  if (amt <= 0) return null;

  const synthetic = {
    ledger_year,
    selected_month,
    payment_date,
    payment_type: "concession",
  };
  const bucket = paymentAllocationService.ledgerBucketForPayment(synthetic);
  return [
    {
      ledger_year: bucket.ledgerYear,
      month: bucket.month,
      amount: amt,
      allocation_kind: "concession",
      fee_advance_link_id: null,
    },
  ];
}

async function buildAutoConcessionAllocationLines({
  student_id,
  class_id,
  amount_paid,
  ledger_year,
  selected_month,
  payment_date,
}) {
  const amount = roundMoney(amount_paid);
  if (amount <= 0 || !class_id || !student_id) return null;
  try {
    const feeLedgerService = require("./feeLedgerService");
    const inferred = await feeLedgerService.inferConcessionAllocationLines({
      student_id,
      class_id,
      amount_paid: amount,
      ledger_year,
      selected_month,
      payment_date,
    });
    if (inferred && inferred.length > 0) return inferred;
  } catch {
    /* single default allocation */
  }
  return null;
}

/**
 * FIFO-style allocation starting at the booking month: fill that month's base fee, then linked advance
 * targets (Fee Setup), then move forward calendar month by month until the amount is exhausted.
 * Surplus no longer dumps entirely onto the advance target (fixes Nov→Jan taking all extra cash).
 */
async function buildAutoAdvanceAllocationLines({
  student_id,
  class_id,
  amount_paid,
  ledger_year,
  selected_month,
  payment_date,
  payment_type,
}) {
  if (payment_type !== "payment") return null;
  const amount = roundMoney(amount_paid);
  if (amount <= 0 || !class_id || !student_id) return null;

  try {
    const feeLedgerService = require("./feeLedgerService");
    const inferred = await feeLedgerService.inferPaymentAllocationLines({
      student_id,
      class_id,
      amount_paid: amount,
      ledger_year,
      selected_month,
      payment_date,
    });
    if (inferred && inferred.length > 0) return inferred;
  } catch {
    /* fall through to isolated calendar walk */
  }

  const synthetic = {
    ledger_year,
    selected_month,
    payment_date,
    payment_type: "payment",
    reference_no: null,
  };
  const { ledgerYear: startYear, month: startMonth } = paymentAllocationService.ledgerBucketForPayment(synthetic);

  let linksAll;
  try {
    linksAll = await loadFeeAdvanceLinksForClass(class_id);
  } catch {
    linksAll = [];
  }

  const lines = [];
  let remaining = amount;
  let y = Number(startYear);
  let m = Number(startMonth);
  const maxIter = 48;
  let iter = 0;

  while (remaining > 0 && iter < maxIter) {
    iter += 1;

    let baseFee = 0;
    try {
      const r = await feeService.resolveStudentMonthlyFee({
        student_id,
        class_id,
        year: y,
        month: m,
      });
      baseFee = r.source === "out_of_range" ? 0 : roundMoney(r.fee || 0);
    } catch {
      baseFee = 0;
    }

    const linksHere = linksAll.filter(
      (l) => Number(l.source_year) === Number(y) && Number(l.source_month) === Number(m)
    );

    const normalAmt = roundMoney(Math.min(remaining, baseFee));
    if (normalAmt > 0) {
      lines.push({
        ledger_year: y,
        month: m,
        amount: normalAmt,
        allocation_kind: "normal",
        fee_advance_link_id: null,
      });
      remaining = roundMoney(remaining - normalAmt);
    }

    const sortedLinks = linksHere.slice().sort((a, b) => {
      const so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
      if (so !== 0) return so;
      if (Number(a.target_year) !== Number(b.target_year)) return Number(a.target_year) - Number(b.target_year);
      return Number(a.target_month) - Number(b.target_month);
    });

    for (const link of sortedLinks) {
      if (remaining <= 0) break;
      let tf = 0;
      try {
        const tr = await feeService.resolveStudentMonthlyFee({
          student_id,
          class_id,
          year: link.target_year,
          month: link.target_month,
        });
        tf = tr.source === "out_of_range" ? 0 : roundMoney(tr.fee || 0);
      } catch {
        tf = 0;
      }
      const advAmt = roundMoney(Math.min(remaining, tf));
      if (advAmt > 0) {
        lines.push({
          ledger_year: Number(link.target_year),
          month: Number(link.target_month),
          amount: advAmt,
          allocation_kind: "advance",
          fee_advance_link_id: link.id,
        });
        remaining = roundMoney(remaining - advAmt);
      }
    }

    if (remaining <= 0) break;

    const next = nextCalendarMonth(y, m);
    y = next.year;
    m = next.month;
  }

  if (remaining > 0) {
    lines.push({
      ledger_year: startYear,
      month: startMonth,
      amount: remaining,
      allocation_kind: "normal",
      fee_advance_link_id: null,
    });
    remaining = 0;
  }

  if (!lines.length) return null;

  const sum = lines.reduce((s, l) => s + roundMoney(l.amount), 0);
  const drift = roundMoney(amount - sum);
  if (drift !== 0 && lines.length) {
    lines[lines.length - 1].amount = roundMoney(lines[lines.length - 1].amount + drift);
  }

  return lines;
}

const deletePayment = async (paymentId) => {
  if (!paymentId) {
    throw new ChallanValidationError("payment id is required");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
      DELETE FROM payments
      WHERE id = $1
      RETURNING *
    `,
      [paymentId]
    );

    if (!result.rows[0]) {
      throw new ChallanValidationError("Payment not found");
    }

    await paymentAllocationService.deleteAllocationsForPayment(client, paymentId);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
};

const addConcession = async (data) => {
  const { student_id, amount, date, ledger_year } = data;

  if (!student_id || amount === undefined || amount === null) {
    throw new ChallanValidationError("student_id and amount are required");
  }

  const parsedAmount = toNumber(amount);
  if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new ChallanValidationError("amount must be greater than 0");
  }

  let ledYear = null;
  if (ledger_year !== undefined && ledger_year !== null && String(ledger_year).trim() !== "") {
    const y = Number(ledger_year);
    if (!Number.isNaN(y) && y >= 1900 && y <= 2100) ledYear = y;
  }

  const studentCheck = await pool.query(
    `
      SELECT id
      FROM students
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [student_id]
  );

  if (!studentCheck.rows[0]) {
    throw new ChallanValidationError("Student not found");
  }

  await ensurePaymentsLedgerColumns(pool);

  const concessionDate = date || new Date().toISOString().slice(0, 10);

  const studentRow = await pool.query(
    `
      SELECT current_class_id
      FROM students
      WHERE id = $1 AND deleted_at IS NULL
    `,
    [student_id]
  );
  const studentClassId = studentRow.rows[0]?.current_class_id || null;

  let allocationLines = null;
  if (studentClassId) {
    try {
      const auto = await buildAutoConcessionAllocationLines({
        student_id,
        class_id: studentClassId,
        amount_paid: parsedAmount,
        ledger_year: ledYear,
        selected_month: null,
        payment_date: concessionDate,
      });
      if (auto && auto.length > 0) allocationLines = auto;
    } catch {
      /* single default allocation */
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
      INSERT INTO payments (
        student_id,
        challan_id,
        amount_paid,
        payment_date,
        method,
        reference_no,
        selected_month,
        ledger_year,
        payment_type
      )
      VALUES ($1, NULL, $2, $3, 'cash', NULL, NULL, $4, 'concession')
      RETURNING *
    `,
      [student_id, parsedAmount, concessionDate, ledYear]
    );
    const row = result.rows[0];
    await paymentAllocationService.replaceAllocationsForPayment(client, row, allocationLines, studentClassId);
    await client.query("COMMIT");
    return {
      ...row,
      type: "Concession",
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

module.exports = {
  createChallan,
  addChallanItem,
  getChallanDetails,
  addPayment,
  getStudentLedger,
  getStudentSummary,
  getStudentPayments,
  deletePayment,
  addConcession,
};

module.exports.ChallanValidationError = ChallanValidationError;
