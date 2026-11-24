/**
 * Keeps payment_allocations in sync with payments.
 * Single default row (booking month) or explicit split lines including advance (multi-year).
 */

const pool = require("../config/db");

const roundMoney = (n) => Math.round(Number(n || 0));

function isConcessionPayment(p) {
  return (
    (p.payment_type || "payment") === "concession" ||
    String(p.reference_no || "").toUpperCase().startsWith("CONCESSION")
  );
}

/**
 * Calendar booking for a payment line (aligned with reportService / fee ledger filters).
 */
function ledgerBucketForPayment(payment) {
  const pd = payment.payment_date || payment.created_at;
  const d = pd ? new Date(pd) : new Date();
  const fallbackYear = Number.isNaN(d.getFullYear()) ? new Date().getFullYear() : d.getFullYear();
  const fallbackMonth = Number.isNaN(d.getMonth()) ? new Date().getMonth() + 1 : d.getMonth() + 1;

  let ledgerYear = fallbackYear;
  if (payment.ledger_year != null && String(payment.ledger_year).trim() !== "") {
    const y = Number(payment.ledger_year);
    if (!Number.isNaN(y) && y >= 1900 && y <= 2100) ledgerYear = y;
  }

  let month = fallbackMonth;
  if (payment.selected_month != null && String(payment.selected_month).trim() !== "") {
    const m = Number(payment.selected_month);
    if (!Number.isNaN(m) && m >= 1 && m <= 12) month = m;
  }

  return { ledgerYear, month };
}

function normalizeExplicitLine(raw, payment) {
  const ly = Number(raw.ledger_year);
  const m = Number(raw.month);
  const amt = roundMoney(raw.amount);
  const kind = String(raw.allocation_kind || "normal").toLowerCase();
  if (!Number.isInteger(ly) || ly < 1900 || ly > 2100) {
    throw new Error("Each allocation needs a valid ledger_year");
  }
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error("Each allocation needs month 1–12");
  }
  if (amt <= 0) {
    throw new Error("Each allocation amount must be greater than 0");
  }
  if (!["normal", "advance", "concession"].includes(kind)) {
    throw new Error("allocation_kind must be normal, advance, or concession");
  }
  if (isConcessionPayment(payment) && kind !== "concession") {
    throw new Error("Concession payments must use allocation_kind concession");
  }
  if (!isConcessionPayment(payment) && kind === "concession") {
    throw new Error("Only concession entries may use allocation_kind concession");
  }
  const linkId = raw.fee_advance_link_id || null;
  if (kind === "advance" && !linkId) {
    throw new Error("fee_advance_link_id is required for advance allocations");
  }
  if (kind !== "advance" && linkId) {
    throw new Error("fee_advance_link_id is only valid for advance allocations");
  }
  return {
    ledger_year: ly,
    month: m,
    amount: amt,
    allocation_kind: kind,
    fee_advance_link_id: linkId,
  };
}

async function validateAdvanceLines(client, classId, lines) {
  for (const line of lines) {
    if (line.allocation_kind !== "advance") continue;
    const r = await client.query(
      `
        SELECT id, class_id, target_year, target_month, active
        FROM fee_advance_links
        WHERE id = $1
      `,
      [line.fee_advance_link_id]
    );
    const row = r.rows[0];
    if (!row || !row.active) {
      throw new Error("Invalid or inactive advance fee link");
    }
    if (String(row.class_id) !== String(classId)) {
      throw new Error("Advance link does not belong to this student's class");
    }
    if (Number(row.target_year) !== Number(line.ledger_year) || Number(row.target_month) !== Number(line.month)) {
      throw new Error("Advance allocation must match the link target month and year");
    }
  }
}

/**
 * Replace all allocation lines for a payment.
 * @param {import('pg').PoolClient} client
 * @param {object} payment – row from payments (RETURNING *)
 * @param {Array<object>|null} explicitLines – optional split lines
 * @param {string|null} classId – student class (required if any advance line)
 */
async function replaceAllocationsForPayment(client, payment, explicitLines = null, classId = null) {
  const amount = roundMoney(payment.amount_paid);
  if (amount <= 0) {
    await client.query(`DELETE FROM payment_allocations WHERE payment_id = $1`, [payment.id]);
    return;
  }

  let lines;
  if (Array.isArray(explicitLines) && explicitLines.length > 0) {
    lines = explicitLines.map((row) => normalizeExplicitLine(row, payment));
  } else {
    const { ledgerYear, month } = ledgerBucketForPayment(payment);
    const kind = isConcessionPayment(payment) ? "concession" : "normal";
    lines = [{ ledger_year: ledgerYear, month, amount, allocation_kind: kind, fee_advance_link_id: null }];
  }

  const sum = lines.reduce((s, l) => s + roundMoney(l.amount), 0);
  if (sum !== amount) {
    throw new Error(`Allocations must sum to payment amount (paid ${amount}, allocations sum to ${sum})`);
  }

  if (lines.some((l) => l.allocation_kind === "advance")) {
    if (!classId) {
      throw new Error("Student class is required for advance allocations");
    }
    await validateAdvanceLines(client, classId, lines);
  }

  await client.query(`DELETE FROM payment_allocations WHERE payment_id = $1`, [payment.id]);

  for (const line of lines) {
    await client.query(
      `
        INSERT INTO payment_allocations (
          payment_id,
          student_id,
          ledger_year,
          month,
          amount,
          allocation_kind,
          fee_advance_link_id,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()), COALESCE($9::timestamptz, NOW()))
      `,
      [
        payment.id,
        payment.student_id,
        line.ledger_year,
        line.month,
        line.amount,
        line.allocation_kind,
        line.fee_advance_link_id,
        payment.created_at,
        payment.updated_at || payment.created_at,
      ]
    );
  }
}

async function deleteAllocationsForPayment(client, paymentId) {
  await client.query(`DELETE FROM payment_allocations WHERE payment_id = $1`, [paymentId]);
}

async function backfillMissingAllocations() {
  const result = await pool.query(
    `
      INSERT INTO payment_allocations (
        id,
        payment_id,
        student_id,
        ledger_year,
        month,
        amount,
        allocation_kind,
        created_at,
        updated_at
      )
      SELECT
        gen_random_uuid(),
        p.id,
        p.student_id,
        COALESCE(p.ledger_year, EXTRACT(YEAR FROM p.payment_date)::integer),
        COALESCE(p.selected_month, EXTRACT(MONTH FROM p.payment_date)::integer),
        p.amount_paid,
        CASE
          WHEN COALESCE(p.payment_type, 'payment') = 'concession'
            OR UPPER(COALESCE(p.reference_no, '')) LIKE 'CONCESSION%' THEN 'concession'
          ELSE 'normal'
        END,
        p.created_at,
        COALESCE(p.updated_at, p.created_at)
      FROM payments p
      WHERE p.deleted_at IS NULL
        AND p.amount_paid > 0
        AND NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.payment_id = p.id)
      RETURNING payment_id
    `
  );
  return { inserted: result.rowCount };
}

module.exports = {
  ledgerBucketForPayment,
  replaceAllocationsForPayment,
  deleteAllocationsForPayment,
  backfillMissingAllocations,
  roundMoney,
};
