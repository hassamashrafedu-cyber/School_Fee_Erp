const pool = require("../config/db");

const STAFF_SALARIES_CATEGORY = "Staff Salaries";
const MONTH_LABELS = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

class StaffPayrollValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "StaffPayrollValidationError";
  }
}

class StaffPayrollNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "StaffPayrollNotFoundError";
  }
}

class StaffPayrollConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "StaffPayrollConflictError";
  }
}

let schemaReady = null;

const ensureSchema = async () => {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        monthly_salary NUMERIC(12, 2) NOT NULL,
        absent_deduction_per_day NUMERIC(12, 2) NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_staff_members_name_not_empty CHECK (BTRIM(name) <> ''),
        CONSTRAINT chk_staff_members_salary_positive CHECK (monthly_salary > 0),
        CONSTRAINT chk_staff_members_absent_day_nonneg CHECK (absent_deduction_per_day >= 0)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_staff_members_active_name
        ON staff_members (is_active, name)
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_salary_months (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_id UUID NOT NULL,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        base_salary NUMERIC(12, 2) NOT NULL,
        absent_deduction_per_day NUMERIC(12, 2) NOT NULL DEFAULT 0,
        absent_days INTEGER NOT NULL DEFAULT 0,
        deduction_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
        payable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        expense_id UUID NULL,
        paid_at TIMESTAMP NULL,
        paid_by UUID NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_staff_salary_months_staff
          FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE RESTRICT,
        CONSTRAINT fk_staff_salary_months_expense
          FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL,
        CONSTRAINT fk_staff_salary_months_paid_by
          FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT uq_staff_salary_months_staff_year_month UNIQUE (staff_id, year, month),
        CONSTRAINT chk_staff_salary_months_year CHECK (year >= 1900 AND year <= 2100),
        CONSTRAINT chk_staff_salary_months_month CHECK (month >= 1 AND month <= 12),
        CONSTRAINT chk_staff_salary_months_absent_days CHECK (absent_days >= 0 AND absent_days <= 31),
        CONSTRAINT chk_staff_salary_months_amounts_nonneg CHECK (
          base_salary >= 0
          AND absent_deduction_per_day >= 0
          AND deduction_amount >= 0
          AND payable_amount >= 0
        ),
        CONSTRAINT chk_staff_salary_months_status CHECK (status IN ('draft', 'paid'))
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_staff_salary_months_year_month
        ON staff_salary_months (year, month)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_staff_salary_months_expense_id
        ON staff_salary_months (expense_id)
        WHERE expense_id IS NOT NULL
    `);
    await pool.query(
      `
        INSERT INTO expense_categories (name)
        SELECT $1::text
        WHERE NOT EXISTS (
          SELECT 1
          FROM expense_categories
          WHERE LOWER(TRIM(name)) = LOWER($1::text)
        )
      `,
      [STAFF_SALARIES_CATEGORY]
    );
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

const toMoney = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
};

const calcPayable = ({ baseSalary, absentDays, perDayDeduction }) => {
  const base = toMoney(baseSalary);
  const days = Math.max(0, Number(absentDays) || 0);
  const perDay = toMoney(perDayDeduction);
  const deduction = toMoney(days * perDay);
  const payable = toMoney(Math.max(0, base - deduction));
  return { deduction_amount: deduction, payable_amount: payable };
};

const parseMonthYear = (month, year) => {
  const parsedMonth = Number(month);
  const parsedYear = Number(year);
  if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
    throw new StaffPayrollValidationError("month must be an integer between 1 and 12");
  }
  if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
    throw new StaffPayrollValidationError("year must be an integer between 1900 and 2100");
  }
  return { parsedMonth, parsedYear };
};

const normalizeStaffPayload = (payload = {}, { partial = false } = {}) => {
  const out = {};

  if (!partial || payload.name !== undefined) {
    const name = String(payload.name ?? "").trim();
    if (!name) throw new StaffPayrollValidationError("staff name is required");
    out.name = name;
  }

  if (!partial || payload.monthly_salary !== undefined) {
    const monthlySalary = toMoney(payload.monthly_salary);
    if (!(monthlySalary > 0)) {
      throw new StaffPayrollValidationError("monthly salary must be greater than 0");
    }
    out.monthly_salary = monthlySalary;
  }

  if (!partial || payload.absent_deduction_per_day !== undefined) {
    const perDay = toMoney(payload.absent_deduction_per_day);
    if (perDay < 0) {
      throw new StaffPayrollValidationError("absent deduction per day cannot be negative");
    }
    out.absent_deduction_per_day = perDay;
  }

  if (!partial || payload.is_active !== undefined) {
    out.is_active = payload.is_active === false || payload.is_active === "false" ? false : true;
  }

  return out;
};

const mapStaffRow = (row) => ({
  id: row.id,
  name: row.name,
  monthly_salary: toMoney(row.monthly_salary),
  absent_deduction_per_day: toMoney(row.absent_deduction_per_day),
  is_active: Boolean(row.is_active),
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const mapMonthRow = (row) => ({
  id: row.id || null,
  staff_id: row.staff_id,
  staff_name: row.staff_name,
  year: Number(row.year),
  month: Number(row.month),
  base_salary: toMoney(row.base_salary),
  absent_deduction_per_day: toMoney(row.absent_deduction_per_day),
  absent_days: Number(row.absent_days || 0),
  deduction_amount: toMoney(row.deduction_amount),
  payable_amount: toMoney(row.payable_amount),
  status: row.status || "draft",
  expense_id: row.expense_id || null,
  paid_at: row.paid_at || null,
  is_active: row.is_active === undefined ? true : Boolean(row.is_active),
});

const listStaffMembers = async ({ includeInactive = false } = {}) => {
  await ensureSchema();
  const result = await pool.query(
    `
      SELECT id, name, monthly_salary, absent_deduction_per_day, is_active, created_at, updated_at
      FROM staff_members
      WHERE ($1::boolean = TRUE OR is_active = TRUE)
      ORDER BY is_active DESC, name ASC, id ASC
    `,
    [Boolean(includeInactive)]
  );
  return result.rows.map(mapStaffRow);
};

const createStaffMember = async (payload = {}) => {
  await ensureSchema();
  const data = normalizeStaffPayload(payload);
  const result = await pool.query(
    `
      INSERT INTO staff_members (name, monthly_salary, absent_deduction_per_day, is_active)
      VALUES ($1, $2, $3, COALESCE($4, TRUE))
      RETURNING id, name, monthly_salary, absent_deduction_per_day, is_active, created_at, updated_at
    `,
    [data.name, data.monthly_salary, data.absent_deduction_per_day, data.is_active]
  );
  return mapStaffRow(result.rows[0]);
};

const updateStaffMember = async (id, payload = {}) => {
  await ensureSchema();
  const staffId = String(id || "").trim();
  if (!staffId) throw new StaffPayrollValidationError("staff id is required");

  const data = normalizeStaffPayload(payload, { partial: true });
  if (Object.keys(data).length === 0) {
    throw new StaffPayrollValidationError("no fields to update");
  }

  const fields = [];
  const params = [staffId];
  const push = (sql, value) => {
    params.push(value);
    fields.push(`${sql} = $${params.length}`);
  };

  if (data.name !== undefined) push("name", data.name);
  if (data.monthly_salary !== undefined) push("monthly_salary", data.monthly_salary);
  if (data.absent_deduction_per_day !== undefined) {
    push("absent_deduction_per_day", data.absent_deduction_per_day);
  }
  if (data.is_active !== undefined) push("is_active", data.is_active);

  fields.push("updated_at = CURRENT_TIMESTAMP");

  const result = await pool.query(
    `
      UPDATE staff_members
      SET ${fields.join(", ")}
      WHERE id = $1
      RETURNING id, name, monthly_salary, absent_deduction_per_day, is_active, created_at, updated_at
    `,
    params
  );
  if (!result.rows[0]) throw new StaffPayrollNotFoundError("Staff member not found");
  return mapStaffRow(result.rows[0]);
};

const deactivateStaffMember = async (id) => updateStaffMember(id, { is_active: false });

const ensureCategoryId = async (client) => {
  const existing = await client.query(
    `
      SELECT id
      FROM expense_categories
      WHERE LOWER(TRIM(name)) = LOWER($1)
      LIMIT 1
    `,
    [STAFF_SALARIES_CATEGORY]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const created = await client.query(
    `
      INSERT INTO expense_categories (name)
      VALUES ($1)
      RETURNING id
    `,
    [STAFF_SALARIES_CATEGORY]
  );
  return created.rows[0].id;
};

const resolveDefaultCampusId = async (client) => {
  const result = await client.query(
    `
      SELECT id
      FROM campuses
      ORDER BY name ASC, id ASC
      LIMIT 1
    `
  );
  if (!result.rows[0]) {
    throw new StaffPayrollValidationError("No campus found. Please add campus first.");
  }
  return result.rows[0].id;
};

const getMonthPayroll = async ({ month, year } = {}) => {
  await ensureSchema();
  const { parsedMonth, parsedYear } = parseMonthYear(month, year);

  const result = await pool.query(
    `
      SELECT
        sm.id AS staff_id,
        sm.name AS staff_name,
        sm.is_active,
        sm.monthly_salary AS current_salary,
        sm.absent_deduction_per_day AS current_per_day,
        ssm.id,
        ssm.year,
        ssm.month,
        COALESCE(ssm.base_salary, sm.monthly_salary) AS base_salary,
        COALESCE(ssm.absent_deduction_per_day, sm.absent_deduction_per_day) AS absent_deduction_per_day,
        COALESCE(ssm.absent_days, 0) AS absent_days,
        COALESCE(ssm.deduction_amount, 0) AS deduction_amount,
        COALESCE(ssm.payable_amount, sm.monthly_salary) AS payable_amount,
        COALESCE(ssm.status, 'draft') AS status,
        ssm.expense_id,
        ssm.paid_at
      FROM staff_members sm
      LEFT JOIN staff_salary_months ssm
        ON ssm.staff_id = sm.id
       AND ssm.year = $1
       AND ssm.month = $2
      WHERE sm.is_active = TRUE
         OR ssm.id IS NOT NULL
      ORDER BY sm.is_active DESC, sm.name ASC, sm.id ASC
    `,
    [parsedYear, parsedMonth]
  );

  const rows = result.rows.map((row) => {
    if (row.status === "paid") {
      return mapMonthRow({
        ...row,
        year: parsedYear,
        month: parsedMonth,
      });
    }

    const baseSalary = toMoney(row.current_salary);
    const perDay = toMoney(row.current_per_day);
    const absentDays = Number(row.absent_days || 0);
    const calc = calcPayable({
      baseSalary,
      absentDays,
      perDayDeduction: perDay,
    });

    return mapMonthRow({
      id: row.id,
      staff_id: row.staff_id,
      staff_name: row.staff_name,
      year: parsedYear,
      month: parsedMonth,
      base_salary: baseSalary,
      absent_deduction_per_day: perDay,
      absent_days: absentDays,
      deduction_amount: calc.deduction_amount,
      payable_amount: calc.payable_amount,
      status: "draft",
      expense_id: null,
      paid_at: null,
      is_active: row.is_active,
    });
  });

  const totals = rows.reduce(
    (acc, row) => {
      acc.base_salary += row.base_salary;
      acc.deduction_amount += row.deduction_amount;
      acc.payable_amount += row.payable_amount;
      if (row.status === "paid") acc.paid_count += 1;
      else acc.draft_count += 1;
      return acc;
    },
    { base_salary: 0, deduction_amount: 0, payable_amount: 0, paid_count: 0, draft_count: 0 }
  );

  return {
    year: parsedYear,
    month: parsedMonth,
    month_label: MONTH_LABELS[parsedMonth],
    rows,
    totals: {
      base_salary: toMoney(totals.base_salary),
      deduction_amount: toMoney(totals.deduction_amount),
      payable_amount: toMoney(totals.payable_amount),
      paid_count: totals.paid_count,
      draft_count: totals.draft_count,
    },
  };
};

const upsertDraftMonth = async ({ staffId, year, month, absentDays }, client) => {
  const staffResult = await client.query(
    `
      SELECT id, name, monthly_salary, absent_deduction_per_day, is_active
      FROM staff_members
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
    `,
    [staffId]
  );
  if (!staffResult.rows[0]) throw new StaffPayrollNotFoundError("Staff member not found");
  const staff = staffResult.rows[0];

  const existing = await client.query(
    `
      SELECT id, status
      FROM staff_salary_months
      WHERE staff_id = $1 AND year = $2 AND month = $3
      LIMIT 1
      FOR UPDATE
    `,
    [staffId, year, month]
  );

  if (existing.rows[0]?.status === "paid") {
    throw new StaffPayrollConflictError("Salary already paid for this month. Reverse payment to edit.");
  }

  const days = Number(absentDays);
  if (!Number.isInteger(days) || days < 0 || days > 31) {
    throw new StaffPayrollValidationError("absent days must be an integer between 0 and 31");
  }

  const baseSalary = toMoney(staff.monthly_salary);
  const perDay = toMoney(staff.absent_deduction_per_day);
  const calc = calcPayable({
    baseSalary,
    absentDays: days,
    perDayDeduction: perDay,
  });

  if (existing.rows[0]) {
    const updated = await client.query(
      `
        UPDATE staff_salary_months
        SET base_salary = $2,
            absent_deduction_per_day = $3,
            absent_days = $4,
            deduction_amount = $5,
            payable_amount = $6,
            status = 'draft',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [
        existing.rows[0].id,
        baseSalary,
        perDay,
        days,
        calc.deduction_amount,
        calc.payable_amount,
      ]
    );
    return { staff, row: updated.rows[0] };
  }

  const inserted = await client.query(
    `
      INSERT INTO staff_salary_months (
        staff_id, year, month, base_salary, absent_deduction_per_day,
        absent_days, deduction_amount, payable_amount, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')
      RETURNING *
    `,
    [
      staffId,
      year,
      month,
      baseSalary,
      perDay,
      days,
      calc.deduction_amount,
      calc.payable_amount,
    ]
  );
  return { staff, row: inserted.rows[0] };
};

const saveMonthAbsences = async ({ month, year, items = [] } = {}) => {
  await ensureSchema();
  const { parsedMonth, parsedYear } = parseMonthYear(month, year);
  if (!Array.isArray(items) || items.length === 0) {
    throw new StaffPayrollValidationError("items array is required");
  }

  const client = await pool.connect();
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;

    for (const item of items) {
      const staffId = String(item.staff_id || "").trim();
      if (!staffId) throw new StaffPayrollValidationError("staff_id is required");
      await upsertDraftMonth(
        {
          staffId,
          year: parsedYear,
          month: parsedMonth,
          absentDays: item.absent_days,
        },
        client
      );
    }

    await client.query("COMMIT");
    return getMonthPayroll({ month: parsedMonth, year: parsedYear });
  } catch (error) {
    if (began) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const resolvePaymentDate = ({ paymentDate, month, year }) => {
  if (paymentDate) {
    const parsed = new Date(String(paymentDate).trim());
    if (Number.isNaN(parsed.getTime())) {
      throw new StaffPayrollValidationError("payment date is invalid");
    }
    return parsed.toISOString().slice(0, 10);
  }

  const now = new Date();
  if (now.getFullYear() === year && now.getMonth() + 1 === month) {
    return now.toISOString().slice(0, 10);
  }
  // Last calendar day of the salary month when paying outside that month.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

const payStaffMonth = async ({
  staffId,
  month,
  year,
  paymentDate,
  absentDays,
  userId,
} = {}) => {
  await ensureSchema();
  const { parsedMonth, parsedYear } = parseMonthYear(month, year);
  const id = String(staffId || "").trim();
  if (!id) throw new StaffPayrollValidationError("staff_id is required");
  const isoDate = resolvePaymentDate({
    paymentDate,
    month: parsedMonth,
    year: parsedYear,
  });

  const client = await pool.connect();
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;

    const existing = await client.query(
      `
        SELECT id, status, absent_days
        FROM staff_salary_months
        WHERE staff_id = $1 AND year = $2 AND month = $3
        LIMIT 1
        FOR UPDATE
      `,
      [id, parsedYear, parsedMonth]
    );
    if (existing.rows[0]?.status === "paid") {
      throw new StaffPayrollConflictError("Salary already paid for this staff member and month");
    }

    const daysToUse =
      absentDays !== undefined && absentDays !== null && String(absentDays).trim() !== ""
        ? absentDays
        : existing.rows[0]?.absent_days ?? 0;

    const { staff, row } = await upsertDraftMonth(
      {
        staffId: id,
        year: parsedYear,
        month: parsedMonth,
        absentDays: daysToUse,
      },
      client
    );

    const payable = toMoney(row.payable_amount);
    let expenseId = null;

    if (payable > 0) {
      const categoryId = await ensureCategoryId(client);
      const campusId = await resolveDefaultCampusId(client);
      const label = `Salary – ${staff.name} – ${MONTH_LABELS[parsedMonth]} ${parsedYear}`;

      const expense = await client.query(
        `
          INSERT INTO expenses (campus_id, category_id, amount, date, description)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `,
        [campusId, categoryId, payable, isoDate, label]
      );
      expenseId = expense.rows[0].id;
    }

    const paid = await client.query(
      `
        UPDATE staff_salary_months
        SET status = 'paid',
            expense_id = $2,
            paid_at = CURRENT_TIMESTAMP,
            paid_by = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [row.id, expenseId, userId || null]
    );

    await client.query("COMMIT");
    return mapMonthRow({
      ...paid.rows[0],
      staff_name: staff.name,
      is_active: staff.is_active,
    });
  } catch (error) {
    if (began) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const payAllDraftForMonth = async ({ month, year, paymentDate, userId } = {}) => {
  const preview = await getMonthPayroll({ month, year });
  const draftStaffIds = preview.rows
    .filter((row) => row.status !== "paid" && row.is_active !== false)
    .map((row) => row.staff_id);

  const paid = [];
  for (const staffId of draftStaffIds) {
    // Refresh absences from preview so unsaved UI values are not assumed —
    // caller should save absences first. Pay uses DB draft/current master rates.
    paid.push(
      // eslint-disable-next-line no-await-in-loop
      await payStaffMonth({ staffId, month, year, paymentDate, userId })
    );
  }
  return {
    paid_count: paid.length,
    rows: paid,
    month_payroll: await getMonthPayroll({ month, year }),
  };
};

const reverseStaffMonthPayment = async ({ staffId, month, year } = {}) => {
  await ensureSchema();
  const { parsedMonth, parsedYear } = parseMonthYear(month, year);
  const id = String(staffId || "").trim();
  if (!id) throw new StaffPayrollValidationError("staff_id is required");

  const client = await pool.connect();
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;

    const existing = await client.query(
      `
        SELECT ssm.*, sm.name AS staff_name, sm.is_active
        FROM staff_salary_months ssm
        JOIN staff_members sm ON sm.id = ssm.staff_id
        WHERE ssm.staff_id = $1 AND ssm.year = $2 AND ssm.month = $3
        LIMIT 1
        FOR UPDATE OF ssm
      `,
      [id, parsedYear, parsedMonth]
    );
    if (!existing.rows[0]) throw new StaffPayrollNotFoundError("Salary month not found");
    const row = existing.rows[0];
    if (row.status !== "paid") {
      throw new StaffPayrollConflictError("Salary is not paid for this month");
    }

    if (row.expense_id) {
      await client.query(`DELETE FROM expenses WHERE id = $1`, [row.expense_id]);
    }

    const updated = await client.query(
      `
        UPDATE staff_salary_months
        SET status = 'draft',
            expense_id = NULL,
            paid_at = NULL,
            paid_by = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [row.id]
    );

    await client.query("COMMIT");
    return mapMonthRow({
      ...updated.rows[0],
      staff_name: row.staff_name,
      is_active: row.is_active,
    });
  } catch (error) {
    if (began) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const findSalaryLinkByExpenseId = async (expenseId) => {
  await ensureSchema();
  const id = String(expenseId || "").trim();
  if (!id) return null;
  const result = await pool.query(
    `
      SELECT id, staff_id, year, month, status
      FROM staff_salary_months
      WHERE expense_id = $1
      LIMIT 1
    `,
    [id]
  );
  return result.rows[0] || null;
};

module.exports = {
  STAFF_SALARIES_CATEGORY,
  ensureSchema,
  listStaffMembers,
  createStaffMember,
  updateStaffMember,
  deactivateStaffMember,
  getMonthPayroll,
  saveMonthAbsences,
  payStaffMonth,
  payAllDraftForMonth,
  reverseStaffMonthPayment,
  findSalaryLinkByExpenseId,
  calcPayable,
};

module.exports.StaffPayrollValidationError = StaffPayrollValidationError;
module.exports.StaffPayrollNotFoundError = StaffPayrollNotFoundError;
module.exports.StaffPayrollConflictError = StaffPayrollConflictError;
