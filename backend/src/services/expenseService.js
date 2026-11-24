const pool = require("../config/db");
const staffPayrollService = require("./staffPayrollService");

class ExpenseValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExpenseValidationError";
  }
}

class ExpenseNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExpenseNotFoundError";
  }
}

const parseMonthYear = (month, year) => {
  const hasMonth = month !== undefined && month !== null && String(month).trim() !== "";
  const hasYear = year !== undefined && year !== null && String(year).trim() !== "";

  if (!hasMonth && !hasYear) return { parsedMonth: null, parsedYear: null };

  const parsedMonth = Number(month);
  const parsedYear = Number(year);

  if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
    throw new ExpenseValidationError("month must be an integer between 1 and 12");
  }
  if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
    throw new ExpenseValidationError("year must be an integer between 1900 and 2100");
  }

  return { parsedMonth, parsedYear };
};

const normalizePayload = (payload = {}) => {
  const name = String(payload.name ?? "").trim();
  if (!name) {
    throw new ExpenseValidationError("expense name is required");
  }

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ExpenseValidationError("amount must be greater than 0");
  }

  const rawDate = String(payload.date ?? "").trim();
  if (!rawDate) {
    throw new ExpenseValidationError("date is required");
  }

  const parsedDate = new Date(rawDate);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new ExpenseValidationError("date is invalid");
  }

  const isoDate = parsedDate.toISOString().slice(0, 10);
  return { name, amount, isoDate };
};

const createExpense = async (payload = {}) => {
  const { name, amount, isoDate } = normalizePayload(payload);
  const requestedCampusId = String(payload.campus_id || "").trim() || null;
  const client = await pool.connect();
  let began = false;

  try {
    await client.query("BEGIN");
    began = true;

    let categoryId = null;
    const existingCategory = await client.query(
      `
        SELECT id
        FROM expense_categories
        WHERE LOWER(name) = LOWER($1)
        LIMIT 1
      `,
      [name]
    );
    if (existingCategory.rows[0]) {
      categoryId = existingCategory.rows[0].id;
    } else {
      const createdCategory = await client.query(
        `
          INSERT INTO expense_categories (name)
          VALUES ($1)
          RETURNING id
        `,
        [name]
      );
      categoryId = createdCategory.rows[0].id;
    }

    let campusId = requestedCampusId;
    if (campusId) {
      const campusCheck = await client.query(
        `
          SELECT id
          FROM campuses
          WHERE id = $1
          LIMIT 1
        `,
        [campusId]
      );
      if (!campusCheck.rows[0]) {
        throw new ExpenseValidationError("Selected campus not found");
      }
    } else {
      const defaultCampus = await client.query(
        `
          SELECT id
          FROM campuses
          ORDER BY name ASC, id ASC
          LIMIT 1
        `
      );
      if (!defaultCampus.rows[0]) {
        throw new ExpenseValidationError("No campus found. Please add campus first.");
      }
      campusId = defaultCampus.rows[0].id;
    }

    const result = await client.query(
      `
        INSERT INTO expenses (campus_id, category_id, amount, date, description)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, amount, date, category_id, campus_id, description
      `,
      [campusId, categoryId, amount, isoDate, name]
    );

    await client.query("COMMIT");
    const row = result.rows[0];
    return {
      id: row.id,
      name,
      amount: Number(row.amount || 0),
      date: row.date,
    };
  } catch (error) {
    if (began) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const assertNotPayrollLinkedExpense = async (expenseId) => {
  const link = await staffPayrollService.findSalaryLinkByExpenseId(expenseId);
  if (link) {
    throw new ExpenseValidationError(
      "This expense was posted from Staff Salaries. Reverse the salary payment there instead of editing/deleting here."
    );
  }
};

const updateExpense = async (id, payload = {}) => {
  const expenseId = String(id || "").trim();
  if (!expenseId) {
    throw new ExpenseValidationError("expense id is required");
  }

  await assertNotPayrollLinkedExpense(expenseId);

  const { name, amount, isoDate } = normalizePayload(payload);
  const client = await pool.connect();
  let began = false;

  try {
    await client.query("BEGIN");
    began = true;

    const existingExpense = await client.query(
      `
        SELECT id, campus_id
        FROM expenses
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [expenseId]
    );
    if (!existingExpense.rows[0]) {
      throw new ExpenseNotFoundError("Expense not found");
    }

    let categoryId = null;
    const existingCategory = await client.query(
      `
        SELECT id
        FROM expense_categories
        WHERE LOWER(name) = LOWER($1)
        LIMIT 1
      `,
      [name]
    );
    if (existingCategory.rows[0]) {
      categoryId = existingCategory.rows[0].id;
    } else {
      const createdCategory = await client.query(
        `
          INSERT INTO expense_categories (name)
          VALUES ($1)
          RETURNING id
        `,
        [name]
      );
      categoryId = createdCategory.rows[0].id;
    }

    const result = await client.query(
      `
        UPDATE expenses
        SET category_id = $2,
            amount = $3,
            date = $4,
            description = $5,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND deleted_at IS NULL
        RETURNING id, amount, date, description
      `,
      [expenseId, categoryId, amount, isoDate, name]
    );

    await client.query("COMMIT");
    const row = result.rows[0];
    return {
      id: row.id,
      name: row.description || name,
      amount: Number(row.amount || 0),
      date: row.date,
    };
  } catch (error) {
    if (began) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const deleteExpense = async (id) => {
  const expenseId = String(id || "").trim();
  if (!expenseId) {
    throw new ExpenseValidationError("expense id is required");
  }

  await assertNotPayrollLinkedExpense(expenseId);

  const result = await pool.query(
    `
      DELETE FROM expenses
      WHERE id = $1
      RETURNING id
    `,
    [expenseId]
  );

  if (!result.rows[0]) {
    throw new ExpenseNotFoundError("Expense not found");
  }

  return { id: result.rows[0].id };
};

const listExpenses = async ({ month, year } = {}) => {
  const { parsedMonth, parsedYear } = parseMonthYear(month, year);
  const params = [];
  const where = ["1=1"];

  if (parsedMonth && parsedYear) {
    params.push(parsedMonth);
    where.push(`EXTRACT(MONTH FROM e.date) = $${params.length}`);
    params.push(parsedYear);
    where.push(`EXTRACT(YEAR FROM e.date) = $${params.length}`);
  }

  const result = await pool.query(
    `
      SELECT
        e.id,
        e.description,
        COALESCE(ec.name, 'Expense') AS expense_name,
        e.amount,
        e.date
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id = e.category_id
      WHERE ${where.join(" AND ")}
        AND e.deleted_at IS NULL
      ORDER BY e.date DESC, e.id DESC
      LIMIT 500
    `,
    params
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: (row.description && String(row.description).trim()) || row.expense_name,
    amount: Number(row.amount || 0),
    date: row.date,
  }));
};

module.exports = {
  createExpense,
  updateExpense,
  deleteExpense,
  listExpenses,
};

module.exports.ExpenseValidationError = ExpenseValidationError;
module.exports.ExpenseNotFoundError = ExpenseNotFoundError;
