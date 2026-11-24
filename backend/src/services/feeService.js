const pool = require("../config/db");

class FeeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FeeValidationError";
  }
}

const MONTHLY_FEE_TITLE = "Monthly Fee";

const ensureSimplifiedFeeSchema = async (client) => {
  const runBestEffort = async (sql) => {
    try {
      await client.query(sql);
    } catch (error) {
      // In many deployments the app DB user cannot run DDL.
      // If schema is already migrated, we should not fail runtime fee APIs.
      if (error?.code === "42501") return;
      throw error;
    }
  };

  await runBestEffort(`
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS year INTEGER;
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS month INTEGER;
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2);
    ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS year INTEGER;
    ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS admission_fee_override NUMERIC(12,2);
    ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS admission_fee_override_by_month JSONB;
    ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS override_amount_by_month JSONB;
    ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS advanced_fee_override_by_month JSONB;
    ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS component_override_by_month JSONB;
  `);
  await runBestEffort(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'student_fee_assignments'
          AND column_name = 'discount_amount'
          AND is_nullable = 'NO'
      ) THEN
        ALTER TABLE student_fee_assignments ALTER COLUMN discount_amount DROP NOT NULL;
      END IF;
    END
    $$;
  `);

  await runBestEffort(`
    CREATE TABLE IF NOT EXISTS fee_config (
      year INTEGER PRIMARY KEY,
      start_month INTEGER NOT NULL,
      end_month INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_fee_config_start_month CHECK (start_month BETWEEN 1 AND 12),
      CONSTRAINT chk_fee_config_end_month CHECK (end_month BETWEEN 1 AND 12),
      CONSTRAINT chk_fee_config_range CHECK (start_month <= end_month)
    );
  `);

  await runBestEffort(`
    CREATE TABLE IF NOT EXISTS class_fee_billing_config (
      year INTEGER NOT NULL,
      class_id UUID NOT NULL,
      start_month INTEGER NOT NULL,
      end_month INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (year, class_id),
      CONSTRAINT chk_cfbc_start CHECK (start_month BETWEEN 1 AND 12),
      CONSTRAINT chk_cfbc_end CHECK (end_month BETWEEN 1 AND 12),
      CONSTRAINT chk_cfbc_range CHECK (start_month <= end_month),
      CONSTRAINT fk_cfbc_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
    );
  `);

  await runBestEffort(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_class_year_month
    ON fee_structures (class_id, year, month)
    WHERE year IS NOT NULL AND month IS NOT NULL;
  `);

  // Legacy index from old model blocks month-wise rows (one row per class/year only).
  await runBestEffort(`
    DROP INDEX IF EXISTS uq_fee_structures_class_calendar_year;
  `);

  await runBestEffort(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fee_assignments_student_calendar_year
    ON student_fee_assignments (student_id, year)
    WHERE year IS NOT NULL;
  `);

  await runBestEffort(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fee_structures'
          AND column_name = 'academic_year_id'
          AND is_nullable = 'NO'
      ) THEN
        ALTER TABLE fee_structures ALTER COLUMN academic_year_id DROP NOT NULL;
      END IF;
    END
    $$;
  `);

  await runBestEffort(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'student_fee_assignments'
          AND column_name = 'academic_year_id'
          AND is_nullable = 'NO'
      ) THEN
        ALTER TABLE student_fee_assignments ALTER COLUMN academic_year_id DROP NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'student_fee_assignments'
          AND column_name = 'structure_id'
          AND is_nullable = 'NO'
      ) THEN
        ALTER TABLE student_fee_assignments ALTER COLUMN structure_id DROP NOT NULL;
      END IF;
    END
    $$;
  `);

  await runBestEffort(`
    CREATE TABLE IF NOT EXISTS class_fee_components (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id UUID NOT NULL,
      year INTEGER NOT NULL,
      label VARCHAR(120) NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      apply_month INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_class_fee_components_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      CONSTRAINT chk_cfc_amount CHECK (amount >= 0),
      CONSTRAINT chk_cfc_label CHECK (BTRIM(label) <> ''),
      CONSTRAINT chk_cfc_year CHECK (year >= 1900 AND year <= 2100),
      CONSTRAINT chk_cfc_apply_month CHECK (apply_month IS NULL OR (apply_month >= 1 AND apply_month <= 12))
    );
  `);
  await runBestEffort(`
    CREATE INDEX IF NOT EXISTS idx_class_fee_components_class_year ON class_fee_components (class_id, year);
  `);
  await runBestEffort(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_class_fee_components_class_year_label
    ON class_fee_components (class_id, year, lower(trim(label)));
  `);
  await runBestEffort(`ALTER TABLE class_fee_components ADD COLUMN IF NOT EXISTS apply_month INTEGER;`);
  await runBestEffort(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_cfc_apply_month'
      ) THEN
        ALTER TABLE class_fee_components
        ADD CONSTRAINT chk_cfc_apply_month
        CHECK (apply_month IS NULL OR (apply_month >= 1 AND apply_month <= 12));
      END IF;
    END
    $$;
  `);

  await runBestEffort(`
    CREATE TABLE IF NOT EXISTS class_fee_component_month_amounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      component_id UUID NOT NULL,
      month INTEGER NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      CONSTRAINT fk_cfcm_component FOREIGN KEY (component_id) REFERENCES class_fee_components(id) ON DELETE CASCADE,
      CONSTRAINT chk_cfcm_month CHECK (month >= 1 AND month <= 12),
      CONSTRAINT chk_cfcm_amount CHECK (amount >= 0),
      CONSTRAINT uq_cfcm_component_month UNIQUE (component_id, month)
    );
  `);
  await runBestEffort(`
    CREATE INDEX IF NOT EXISTS idx_cfcm_component ON class_fee_component_month_amounts (component_id);
  `);
};

const DEFAULT_FEE_COLUMN_LABELS = [
  "Sports fund",
  "Admission fee",
  "Annual charges",
  "Heating charges",
  "Examination fee",
  "Registration fee",
  "Advanced fee",
];

const sqlIsAdmissionFee = "lower(trim(c.label)) = 'admission fee'";
/** Sum extras excluding admission fee and advanced fee (those resolved per student in ledger). */
const sqlExtrasExcludeAdmissionAdvanced =
  "lower(trim(c.label)) NOT IN ('admission fee', 'advanced fee')";
const sqlIsAdvancedFee = "lower(trim(c.label)) = 'advanced fee'";

const tableHasColumn = async (client, tableName, columnName) => {
  const result = await client.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    [tableName, columnName]
  );
  return Boolean(result.rows[0]);
};

const parseYear = (value) => {
  const y = Number(value);
  if (Number.isNaN(y) || y < 1900 || y > 2100) {
    throw new FeeValidationError("year must be a valid integer between 1900 and 2100");
  }
  return y;
};

const parseMonth = (value, field = "month") => {
  const m = Number(value);
  if (Number.isNaN(m) || m < 1 || m > 12) {
    throw new FeeValidationError(`${field} must be an integer between 1 and 12`);
  }
  return m;
};

/** NULL = applies every billing month; 1–12 = that month only. */
const normalizeApplyMonthFromBody = (value) => {
  if (value === undefined || value === null || value === "" || value === "all") return null;
  return parseMonth(value, "apply_month");
};

const ensureDefaultFeeComponents = async (classId, year) => {
  const y = parseYear(year);
  try {
    await pool.query(
      `
        UPDATE class_fee_components AS c
        SET label = 'Advanced fee'
        WHERE c.class_id = $1 AND c.year = $2
          AND lower(trim(c.label)) = 'advanced'
          AND NOT EXISTS (
            SELECT 1 FROM class_fee_components x
            WHERE x.class_id = c.class_id AND x.year = c.year
              AND lower(trim(x.label)) = 'advanced fee'
          )
      `,
      [classId, y]
    );
  } catch (error) {
    if (error?.code !== "42P01") throw error;
  }
  const cnt = await pool.query(
    `SELECT COUNT(*)::int AS n FROM class_fee_components WHERE class_id = $1 AND year = $2`,
    [classId, y]
  );
  const isEmpty = (cnt.rows[0]?.n ?? 0) === 0;

  if (isEmpty) {
    for (let i = 0; i < DEFAULT_FEE_COLUMN_LABELS.length; i += 1) {
      await pool.query(
        `
          INSERT INTO class_fee_components (class_id, year, label, amount, sort_order, apply_month)
          VALUES ($1, $2, $3, 0, $4, NULL)
        `,
        [classId, y, DEFAULT_FEE_COLUMN_LABELS[i], i]
      );
    }
    return;
  }

  for (let i = 0; i < DEFAULT_FEE_COLUMN_LABELS.length; i += 1) {
    const label = DEFAULT_FEE_COLUMN_LABELS[i];
    const maxRes = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1)::int AS m FROM class_fee_components WHERE class_id = $1 AND year = $2`,
      [classId, y]
    );
    const nextOrder = Number(maxRes.rows[0]?.m ?? -1) + 1;
    await pool.query(
      `
        INSERT INTO class_fee_components (class_id, year, label, amount, sort_order, apply_month)
        SELECT $1::uuid, $2::int, $3::varchar, 0, $4::int, NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM class_fee_components
          WHERE class_id = $1 AND year = $2 AND lower(trim(label)) = lower(trim($3::text))
        )
      `,
      [classId, y, label, nextOrder]
    );
  }
};

const migrateLegacyComponentAmounts = async (classId, year) => {
  const y = parseYear(year);
  const config = await readFeeConfigForClass(y, classId);
  let comps;
  try {
    comps = await pool.query(
      `SELECT id, amount, apply_month, label FROM class_fee_components WHERE class_id = $1 AND year = $2`,
      [classId, y]
    );
  } catch (error) {
    if (error?.code === "42P01") return;
    throw error;
  }

  for (const row of comps.rows) {
    const hasMonthRows = await pool.query(
      `SELECT 1 FROM class_fee_component_month_amounts WHERE component_id = $1 LIMIT 1`,
      [row.id]
    );
    if (hasMonthRows.rows.length > 0) continue;

    const amt = Math.round(Number(row.amount || 0));
    if (amt === 0) continue;

    if (row.apply_month != null && row.apply_month !== "") {
      const m = Number(row.apply_month);
      if (m >= 1 && m <= 12) {
        await pool.query(
          `
            INSERT INTO class_fee_component_month_amounts (component_id, month, amount)
            VALUES ($1, $2, $3)
            ON CONFLICT (component_id, month) DO UPDATE SET amount = EXCLUDED.amount
          `,
          [row.id, m, amt]
        );
      }
    } else {
      for (let m = config.start_month; m <= config.end_month; m += 1) {
        await pool.query(
          `
            INSERT INTO class_fee_component_month_amounts (component_id, month, amount)
            VALUES ($1, $2, $3)
            ON CONFLICT (component_id, month) DO UPDATE SET amount = EXCLUDED.amount
          `,
          [row.id, m, amt]
        );
      }
    }
  }
};

const readFeeConfig = async (year) => {
  const y = parseYear(year);
  await ensureSimplifiedFeeSchema(pool);
  let result;
  try {
    result = await pool.query(
      `SELECT year, start_month, end_month FROM fee_config WHERE year = $1`,
      [y]
    );
  } catch (error) {
    if (error?.code === "42P01") {
      return { year: y, start_month: 1, end_month: 12 };
    }
    throw error;
  }
  if (!result.rows[0]) return { year: y, start_month: 1, end_month: 12 };
  return {
    year: Number(result.rows[0].year),
    start_month: Number(result.rows[0].start_month),
    end_month: Number(result.rows[0].end_month),
  };
};

const saveFeeConfig = async (data) => {
  const y = parseYear(data.year);
  const startMonth = parseMonth(data.start_month, "start_month");
  const endMonth = parseMonth(data.end_month, "end_month");
  if (startMonth > endMonth) {
    throw new FeeValidationError("start_month must be less than or equal to end_month");
  }

  const classId = data.class_id && String(data.class_id).trim() !== "" ? data.class_id : null;

  await ensureSimplifiedFeeSchema(pool);

  if (classId) {
    const hasClassDeletedAt = await tableHasColumn(pool, "classes", "deleted_at");
    const classCheck = await pool.query(
      hasClassDeletedAt
        ? `SELECT id FROM classes WHERE id = $1 AND deleted_at IS NULL`
        : `SELECT id FROM classes WHERE id = $1`,
      [classId]
    );
    if (!classCheck.rows[0]) throw new FeeValidationError("Class not found");

    let result;
    try {
      result = await pool.query(
        `
          INSERT INTO class_fee_billing_config (year, class_id, start_month, end_month, updated_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
          ON CONFLICT (year, class_id)
          DO UPDATE SET
            start_month = EXCLUDED.start_month,
            end_month = EXCLUDED.end_month,
            updated_at = CURRENT_TIMESTAMP
          RETURNING year, class_id, start_month, end_month
        `,
        [y, classId, startMonth, endMonth]
      );
    } catch (error) {
      if (error?.code === "42P01") {
        throw new FeeValidationError(
          "class_fee_billing_config table is missing. Run the latest database/schema.sql migration first."
        );
      }
      throw error;
    }
    return {
      year: Number(result.rows[0].year),
      class_id: result.rows[0].class_id,
      start_month: Number(result.rows[0].start_month),
      end_month: Number(result.rows[0].end_month),
      source: "class",
    };
  }

  let result;
  try {
    result = await pool.query(
      `
        INSERT INTO fee_config (year, start_month, end_month, updated_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (year)
        DO UPDATE SET
          start_month = EXCLUDED.start_month,
          end_month = EXCLUDED.end_month,
          updated_at = CURRENT_TIMESTAMP
        RETURNING year, start_month, end_month
      `,
      [y, startMonth, endMonth]
    );
  } catch (error) {
    if (error?.code === "42P01") {
      throw new FeeValidationError(
        "fee_config table is missing. Run the latest database/schema.sql migration first."
      );
    }
    throw error;
  }
  return {
    year: Number(result.rows[0].year),
    start_month: Number(result.rows[0].start_month),
    end_month: Number(result.rows[0].end_month),
    source: "default",
  };
};

const deleteClassFeeBillingConfig = async (year, classId) => {
  if (!classId) throw new FeeValidationError("class_id is required");
  const y = parseYear(year);
  await ensureSimplifiedFeeSchema(pool);
  try {
    await pool.query(
      `DELETE FROM class_fee_billing_config WHERE year = $1 AND class_id = $2`,
      [y, classId]
    );
  } catch (error) {
    if (error?.code === "42P01") {
      return readFeeConfigForClass(y, classId);
    }
    throw error;
  }
  return readFeeConfigForClass(y, classId);
};

const readFeeConfigForClass = async (year, classId) => {
  const y = parseYear(year);
  const base = await readFeeConfig(y);
  if (!classId || String(classId).trim() === "") {
    return { year: y, start_month: base.start_month, end_month: base.end_month, source: "default" };
  }
  await ensureSimplifiedFeeSchema(pool);
  let result;
  try {
    result = await pool.query(
      `
        SELECT start_month, end_month
        FROM class_fee_billing_config
        WHERE year = $1 AND class_id = $2
      `,
      [y, classId]
    );
  } catch (error) {
    if (error?.code === "42P01") {
      return { year: y, class_id: classId, start_month: base.start_month, end_month: base.end_month, source: "default" };
    }
    throw error;
  }
  if (result.rows[0]) {
    return {
      year: y,
      class_id: classId,
      start_month: Number(result.rows[0].start_month),
      end_month: Number(result.rows[0].end_month),
      source: "class",
    };
  }
  return {
    year: y,
    class_id: classId,
    start_month: base.start_month,
    end_month: base.end_month,
    source: "default",
  };
};

const getMonthlyFeeStructure = async (classId, year) => {
  if (!classId) throw new FeeValidationError("class_id is required");
  const y = parseYear(year);
  await ensureSimplifiedFeeSchema(pool);
  await ensureDefaultFeeComponents(classId, y);
  await migrateLegacyComponentAmounts(classId, y);

  const config = await readFeeConfigForClass(y, classId);
  const rows = await pool.query(
    `
      SELECT month, amount
      FROM fee_structures
      WHERE class_id = $1
        AND year = $2
        AND month BETWEEN $3 AND $4
    `,
    [classId, y, config.start_month, config.end_month]
  );
  const byMonth = new Map(
    rows.rows.map((r) => [Number(r.month), Math.round(Number(r.amount || 0))])
  );

  let extrasByMonth = new Map();
  try {
    const extrasRes = await pool.query(
      `
        SELECT a.month, COALESCE(SUM(a.amount), 0)::numeric AS s
        FROM class_fee_component_month_amounts a
        INNER JOIN class_fee_components c ON c.id = a.component_id
        WHERE c.class_id = $1 AND c.year = $2 AND a.month BETWEEN $3 AND $4
          AND ${sqlExtrasExcludeAdmissionAdvanced}
        GROUP BY a.month
      `,
      [classId, y, config.start_month, config.end_month]
    );
    extrasByMonth = new Map(
      extrasRes.rows.map((r) => [Number(r.month), Math.round(Number(r.s || 0))])
    );
  } catch (error) {
    if (error?.code !== "42P01") throw error;
  }

  let feeComponents = [];
  try {
    const compRes = await pool.query(
      `
        SELECT id, label, amount, sort_order, apply_month
        FROM class_fee_components
        WHERE class_id = $1 AND year = $2
        ORDER BY sort_order ASC, label ASC
      `,
      [classId, y]
    );
    const ids = compRes.rows.map((r) => r.id);
    const amountsByComponent = new Map();
    if (ids.length) {
      const amRes = await pool.query(
        `
          SELECT component_id, month, amount
          FROM class_fee_component_month_amounts
          WHERE component_id = ANY($1::uuid[])
        `,
        [ids]
      );
      for (const ar of amRes.rows) {
        const cid = ar.component_id;
        if (!amountsByComponent.has(cid)) amountsByComponent.set(cid, {});
        const obj = amountsByComponent.get(cid);
        obj[String(Number(ar.month))] = Math.round(Number(ar.amount || 0));
      }
    }
    feeComponents = compRes.rows.map((row) => {
      const amounts = amountsByComponent.get(row.id) || {};
      return {
        id: row.id,
        label: String(row.label || "").trim(),
        amount: Math.round(Number(row.amount || 0)),
        sort_order: Number(row.sort_order || 0),
        apply_month: row.apply_month != null ? Number(row.apply_month) : null,
        amounts,
      };
    });

    feeComponents = feeComponents.map((compObj) => {
      const next = { ...compObj, amounts: { ...(compObj.amounts || {}) } };
      for (let bm = config.start_month; bm <= config.end_month; bm += 1) {
        const k = String(bm);
        const cur = next.amounts[k];
        if (cur !== undefined && cur !== null && cur !== "") continue;
        next.amounts[k] = effectiveComponentGridAmount(next, bm);
      }
      return next;
    });
  } catch (error) {
    if (error?.code !== "42P01") throw error;
  }

  const months = [];
  for (let m = config.start_month; m <= config.end_month; m += 1) {
    const monthly = byMonth.get(m) ?? 0;
    const compSum = extrasByMonth.get(m) ?? 0;
    months.push({
      month: m,
      fee: monthly,
      monthly_fee: monthly,
      total_fee: Math.round(monthly + compSum),
    });
  }
  return {
    year: y,
    start_month: config.start_month,
    end_month: config.end_month,
    months,
    components: feeComponents,
    fee_components: feeComponents,
    billing_range_source: config.source,
  };
};

const upsertMonthlyFeeStructure = async (data) => {
  const { class_id, year, month, fee } = data;
  if (!class_id) throw new FeeValidationError("class_id is required");
  const y = parseYear(year);
  const m = parseMonth(month);
  const amount = Math.round(Number(fee));
  if (Number.isNaN(amount) || amount < 0) {
    throw new FeeValidationError("fee must be a non-negative whole number");
  }

  await ensureSimplifiedFeeSchema(pool);

  const hasClassDeletedAt = await tableHasColumn(pool, "classes", "deleted_at");
  const classCheck = await pool.query(
    hasClassDeletedAt
      ? `SELECT id FROM classes WHERE id = $1 AND deleted_at IS NULL`
      : `SELECT id FROM classes WHERE id = $1`,
    [class_id]
  );
  if (!classCheck.rows[0]) throw new FeeValidationError("Class not found");

  const config = await readFeeConfigForClass(y, class_id);
  if (m < config.start_month || m > config.end_month) {
    throw new FeeValidationError(
      `Month must be within the billing range for this class (${config.start_month}–${config.end_month})`
    );
  }

  const client = await pool.connect();
  let result;
  try {
    await client.query("BEGIN");
    result = await client.query(
      `
        UPDATE fee_structures
        SET amount = $4,
            title = $5,
            academic_year_id = NULL
        WHERE class_id = $1
          AND year = $2
          AND month = $3
        RETURNING class_id, year, month, amount
      `,
      [class_id, y, m, amount, MONTHLY_FEE_TITLE]
    );

    if (!result.rows[0]) {
      result = await client.query(
        `
          INSERT INTO fee_structures (class_id, academic_year_id, title, year, month, amount)
          VALUES ($1, NULL, $2, $3, $4, $5)
          RETURNING class_id, year, month, amount
        `,
        [class_id, MONTHLY_FEE_TITLE, y, m, amount]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    class_id: result.rows[0].class_id,
    year: Number(result.rows[0].year),
    month: Number(result.rows[0].month),
    fee: Math.round(Number(result.rows[0].amount || 0)),
  };
};

const listClassFeeComponents = async (classId, year) => {
  if (!classId) throw new FeeValidationError("class_id is required");
  const y = parseYear(year);
  await ensureSimplifiedFeeSchema(pool);
  const r = await pool.query(
    `
      SELECT id, label, amount, sort_order, apply_month
      FROM class_fee_components
      WHERE class_id = $1 AND year = $2
      ORDER BY sort_order ASC, label ASC
    `,
    [classId, y]
  );
  return r.rows.map((row) => ({
    id: row.id,
    label: String(row.label || "").trim(),
    amount: Math.round(Number(row.amount || 0)),
    sort_order: Number(row.sort_order || 0),
    apply_month: row.apply_month != null ? Number(row.apply_month) : null,
  }));
};

const createClassFeeComponent = async (data) => {
  const { class_id, year, label, amount } = data;
  if (!class_id) throw new FeeValidationError("class_id is required");
  const y = parseYear(year);
  const trimmed = String(label || "").trim();
  if (!trimmed) throw new FeeValidationError("label is required");
  const amt = Math.round(Number(amount));
  if (Number.isNaN(amt) || amt < 0) {
    throw new FeeValidationError("amount must be a non-negative whole number");
  }
  const applyMonth = normalizeApplyMonthFromBody(data.apply_month);

  await ensureSimplifiedFeeSchema(pool);

  const hasClassDeletedAt = await tableHasColumn(pool, "classes", "deleted_at");
  const classCheck = await pool.query(
    hasClassDeletedAt
      ? `SELECT id FROM classes WHERE id = $1 AND deleted_at IS NULL`
      : `SELECT id FROM classes WHERE id = $1`,
    [class_id]
  );
  if (!classCheck.rows[0]) throw new FeeValidationError("Class not found");

  const maxRes = await pool.query(
    `
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS n
      FROM class_fee_components
      WHERE class_id = $1 AND year = $2
    `,
    [class_id, y]
  );
  const sortOrder = Number(maxRes.rows[0]?.n ?? 0);

  const ins = await pool.query(
    `
      INSERT INTO class_fee_components (class_id, year, label, amount, sort_order, apply_month)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, class_id, year, label, amount, sort_order, apply_month
    `,
    [class_id, y, trimmed, amt, sortOrder, applyMonth]
  );
  return ins.rows[0];
};

const updateClassFeeComponent = async (componentId, data) => {
  if (!componentId) throw new FeeValidationError("component id is required");
  const trimmed = data.label != null ? String(data.label).trim() : null;
  if (trimmed !== null && trimmed === "") throw new FeeValidationError("label is required");
  let amt;
  if (data.amount != null) {
    amt = Math.round(Number(data.amount));
    if (Number.isNaN(amt) || amt < 0) {
      throw new FeeValidationError("amount must be a non-negative whole number");
    }
  }

  await ensureSimplifiedFeeSchema(pool);

  const fields = [];
  const vals = [];
  let i = 1;
  if (trimmed != null) {
    fields.push(`label = $${i}`);
    vals.push(trimmed);
    i += 1;
  }
  if (amt != null) {
    fields.push(`amount = $${i}`);
    vals.push(amt);
    i += 1;
  }
  if (Object.prototype.hasOwnProperty.call(data, "apply_month")) {
    const am = normalizeApplyMonthFromBody(data.apply_month);
    fields.push(`apply_month = $${i}`);
    vals.push(am);
    i += 1;
  }
  if (!fields.length) throw new FeeValidationError("Nothing to update");

  vals.push(componentId);
  const idPlaceholder = vals.length;
  const result = await pool.query(
    `
      UPDATE class_fee_components
      SET ${fields.join(", ")}
      WHERE id = $${idPlaceholder}
      RETURNING id, class_id, year, label, amount, sort_order, apply_month
    `,
    vals
  );
  if (!result.rows[0]) throw new FeeValidationError("Fee column not found");
  return result.rows[0];
};

const deleteClassFeeComponent = async (componentId) => {
  if (!componentId) throw new FeeValidationError("component id is required");
  await ensureSimplifiedFeeSchema(pool);
  const result = await pool.query(`DELETE FROM class_fee_components WHERE id = $1 RETURNING id`, [componentId]);
  if (!result.rows[0]) throw new FeeValidationError("Fee column not found");
  return { id: result.rows[0].id };
};

const upsertComponentMonthAmount = async (data) => {
  const { component_id, month, amount } = data;
  if (!component_id) throw new FeeValidationError("component_id is required");
  const m = parseMonth(month);
  const amt = Math.round(Number(amount));
  if (Number.isNaN(amt) || amt < 0) {
    throw new FeeValidationError("amount must be a non-negative whole number");
  }

  await ensureSimplifiedFeeSchema(pool);

  const row = await pool.query(`SELECT class_id, year FROM class_fee_components WHERE id = $1 LIMIT 1`, [
    component_id,
  ]);
  if (!row.rows[0]) throw new FeeValidationError("Fee column not found");

  try {
    await pool.query(
      `
        INSERT INTO class_fee_component_month_amounts (component_id, month, amount)
        VALUES ($1, $2, $3)
        ON CONFLICT (component_id, month)
        DO UPDATE SET amount = EXCLUDED.amount
      `,
      [component_id, m, amt]
    );
  } catch (error) {
    if (error?.code === "42P01") {
      throw new FeeValidationError(
        "class_fee_component_month_amounts table is missing. Run the latest database migration first."
      );
    }
    throw error;
  }

  return { component_id, month: m, amount: amt };
};

const parseOptionalNonNegativeInt = (value, fieldLabel) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Math.round(Number(value));
  if (Number.isNaN(n) || n < 0) {
    throw new FeeValidationError(`${fieldLabel} must be a non-negative whole number`);
  }
  return n;
};

/** Returns null (clear), undefined (omit / keep existing), or plain object { "1": n, ... }. */
const normalizeBillingMonthAmountMapFromBody = (value, fieldName, entryLabel) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  let obj = value;
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "" || t === "null") return null;
    try {
      obj = JSON.parse(value);
    } catch {
      throw new FeeValidationError(`${fieldName} must be valid JSON`);
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new FeeValidationError(`${fieldName} must be an object`);
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const m = Number(String(k).trim());
    if (!Number.isInteger(m) || m < 1 || m > 12) continue;
    if (v === null || v === undefined || v === "") continue;
    const n = Math.round(Number(v));
    if (Number.isNaN(n) || n < 0) {
      throw new FeeValidationError(`${entryLabel} for month ${m} must be a non-negative whole number`);
    }
    out[String(m)] = n;
  }
  return Object.keys(out).length ? out : null;
};

const normalizeAdmissionMonthMapFromBody = (value) =>
  normalizeBillingMonthAmountMapFromBody(value, "admission_fee_override_by_month", "Admission fee override");

const normalizeOverrideAmountMonthMapFromBody = (value) =>
  normalizeBillingMonthAmountMapFromBody(value, "override_amount_by_month", "Monthly fee override");

const normalizeAdvancedFeeMonthMapFromBody = (value) =>
  normalizeBillingMonthAmountMapFromBody(value, "advanced_fee_override_by_month", "Advanced fee override");

const admissionMonthMapHasKeys = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return Object.keys(raw).length > 0;
};

const parseAdmissionMonthMapFromRow = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const m = Number(String(k).trim());
    if (!Number.isInteger(m) || m < 1 || m > 12) continue;
    if (v === null || v === undefined || v === "") continue;
    const n = Math.round(Number(v));
    if (!Number.isNaN(n) && n >= 0) out[String(m)] = n;
  }
  return Object.keys(out).length ? out : null;
};

/** Nested: { "component-uuid": { "1": amount, ... "12": amount } } */
const parseComponentOverrideMapFromRow = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [compId, monthObj] of Object.entries(raw)) {
    if (!compId || typeof compId !== "string") continue;
    if (!monthObj || typeof monthObj !== "object" || Array.isArray(monthObj)) continue;
    const inner = {};
    for (const [mk, mv] of Object.entries(monthObj)) {
      const m = Number(String(mk).trim());
      if (!Number.isInteger(m) || m < 1 || m > 12) continue;
      if (mv === null || mv === undefined || mv === "") continue;
      const n = Math.round(Number(mv));
      if (!Number.isNaN(n) && n >= 0) inner[String(m)] = n;
    }
    if (Object.keys(inner).length) out[String(compId).trim()] = inner;
  }
  return Object.keys(out).length ? out : null;
};

const componentOverrideMapHasAny = (raw) => {
  const p = parseComponentOverrideMapFromRow(raw);
  if (!p) return false;
  return Object.values(p).some((inner) => inner && Object.keys(inner).length > 0);
};

const resolveAdmissionPartForMonth = (assignRow, billingMonth, admissionGrid) => {
  const m = Number(billingMonth);
  const key = String(m);
  const map = assignRow ? parseAdmissionMonthMapFromRow(assignRow.admission_fee_override_by_month) : null;
  if (admissionMonthMapHasKeys(map) && Object.prototype.hasOwnProperty.call(map, key)) {
    return Math.round(Number(map[key]));
  }
  if (admissionMonthMapHasKeys(map)) {
    return admissionGrid;
  }
  if (assignRow && assignRow.admission_fee_override != null && assignRow.admission_fee_override !== "") {
    return Math.round(Number(assignRow.admission_fee_override));
  }
  return admissionGrid;
};

const resolveMonthlyPartForMonth = (assignRow, billingMonth, classMonthly) => {
  const m = Number(billingMonth);
  const key = String(m);
  const map = assignRow ? parseAdmissionMonthMapFromRow(assignRow.override_amount_by_month) : null;
  if (admissionMonthMapHasKeys(map) && Object.prototype.hasOwnProperty.call(map, key)) {
    return Math.round(Number(map[key]));
  }
  if (admissionMonthMapHasKeys(map)) {
    return classMonthly;
  }
  if (assignRow && assignRow.discount_amount != null && assignRow.discount_amount !== "") {
    return Math.round(Number(assignRow.discount_amount));
  }
  return classMonthly;
};

const resolveAdvancedPartForMonth = (assignRow, billingMonth, advancedGrid) => {
  const key = String(Number(billingMonth));
  const map = assignRow ? parseAdmissionMonthMapFromRow(assignRow.advanced_fee_override_by_month) : null;
  if (admissionMonthMapHasKeys(map) && Object.prototype.hasOwnProperty.call(map, key)) {
    return Math.round(Number(map[key]));
  }
  return advancedGrid;
};

const rmExtra = (n) => Math.round(Number(n || 0));

/**
 * Class grid amount for one component + billing month: uses per-month map first, then legacy
 * `class_fee_components.amount` / `apply_month` (same idea as migrateLegacyComponentAmounts).
 */
function effectiveComponentGridAmount(component, billingMonth) {
  const m = Number(billingMonth);
  if (Number.isNaN(m) || m < 1 || m > 12) return 0;
  const key = String(m);
  const amts = component.amounts && typeof component.amounts === "object" ? component.amounts : {};
  const raw = amts[key] ?? amts[m];
  if (raw !== undefined && raw !== null && raw !== "") {
    const n = Math.round(Number(raw));
    return Number.isNaN(n) ? 0 : n;
  }
  const legacy = Math.round(Number(component.amount ?? 0));
  if (!legacy) return 0;
  const am = component.apply_month;
  if (am != null && am !== "") {
    const amn = Number(am);
    if (!Number.isNaN(amn) && amn >= 1 && amn <= 12) return m === amn ? legacy : 0;
  }
  return legacy;
}

function admissionGridSumForMonth(structure, billingMonth) {
  const comps = structure?.fee_components ?? structure?.components ?? [];
  if (!Array.isArray(comps)) return 0;
  let sum = 0;
  for (const c of comps) {
    if (String(c.label || "").trim().toLowerCase() !== "admission fee") continue;
    sum += effectiveComponentGridAmount(c, billingMonth);
  }
  return rmExtra(sum);
}

function advancedGridSumForMonth(structure, billingMonth) {
  const comps = structure?.fee_components ?? structure?.components ?? [];
  if (!Array.isArray(comps)) return 0;
  let sum = 0;
  for (const c of comps) {
    const lab = String(c.label || "").trim().toLowerCase();
    if (lab !== "advanced fee" && lab !== "advance fee") continue;
    sum += effectiveComponentGridAmount(c, billingMonth);
  }
  return rmExtra(sum);
}

/**
 * Sum of all extra columns for one billing month (matches Fee Collection ledger).
 * Uses component_override_by_month first per component id when set.
 */
const sumExtraFeeComponentsForMonth = (structure, billingMonth, assignRow) => {
  const comps = structure?.fee_components ?? structure?.components ?? [];
  if (!Array.isArray(comps)) return 0;
  const key = String(billingMonth);
  const compOverrides = parseComponentOverrideMapFromRow(assignRow?.component_override_by_month);

  const admissionGrid = admissionGridSumForMonth(structure, billingMonth);
  const map = assignRow ? parseAdmissionMonthMapFromRow(assignRow.admission_fee_override_by_month) : null;
  const mapHasKeys = map && Object.keys(map).length > 0;
  let admissionPart = admissionGrid;
  if (mapHasKeys && Object.prototype.hasOwnProperty.call(map, key)) {
    admissionPart = rmExtra(map[key]);
  } else if (!mapHasKeys) {
    const hasScalar =
      assignRow &&
      assignRow.admission_fee_override != null &&
      assignRow.admission_fee_override !== "" &&
      !Number.isNaN(Number(assignRow.admission_fee_override));
    if (hasScalar) admissionPart = rmExtra(assignRow.admission_fee_override);
  }

  const advancedGrid = advancedGridSumForMonth(structure, billingMonth);
  const advMap = assignRow ? parseAdmissionMonthMapFromRow(assignRow.advanced_fee_override_by_month) : null;
  const advMapHasKeys = advMap && Object.keys(advMap).length > 0;
  let advancedPart = advancedGrid;
  if (advMapHasKeys && Object.prototype.hasOwnProperty.call(advMap, key)) {
    advancedPart = rmExtra(advMap[key]);
  }

  let s = 0;
  for (const c of comps) {
    const lab = String(c.label || "").trim().toLowerCase();
    const cid = c.id ? String(c.id) : "";
    if (cid && compOverrides && compOverrides[cid] && Object.prototype.hasOwnProperty.call(compOverrides[cid], key)) {
      s += rmExtra(compOverrides[cid][key]);
      continue;
    }
    if (lab === "admission fee") {
      s += admissionPart;
      continue;
    }
    if (lab === "advanced fee" || lab === "advance fee") {
      s += advancedPart;
      continue;
    }
    s += effectiveComponentGridAmount(c, billingMonth);
  }
  return rmExtra(s);
};

const normalizeComponentOverrideFromBody = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  let obj = value;
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "" || t === "null") return null;
    try {
      obj = JSON.parse(value);
    } catch {
      throw new FeeValidationError("component_override_by_month must be valid JSON");
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new FeeValidationError("component_override_by_month must be an object");
  }
  const out = {};
  for (const [cid, monthObj] of Object.entries(obj)) {
    if (!cid || typeof cid !== "string") continue;
    if (monthObj === null || typeof monthObj !== "object" || Array.isArray(monthObj)) continue;
    const inner = {};
    for (const [mk, mv] of Object.entries(monthObj)) {
      const m = Number(String(mk).trim());
      if (!Number.isInteger(m) || m < 1 || m > 12) continue;
      if (mv === null || mv === undefined || mv === "") continue;
      const n = Math.round(Number(mv));
      if (Number.isNaN(n) || n < 0) {
        throw new FeeValidationError(`Component override for month ${m} must be a non-negative whole number`);
      }
      inner[String(m)] = n;
    }
    if (Object.keys(inner).length) out[cid.trim()] = inner;
  }
  return Object.keys(out).length ? out : null;
};

const assignStudentFeeOverrideByYear = async (data) => {
  const { student_id, year } = data;
  if (!student_id) throw new FeeValidationError("student_id is required");
  const y = parseYear(year);

  const hasMonthly = Object.prototype.hasOwnProperty.call(data, "override_amount");
  const hasMonthlyMap = Object.prototype.hasOwnProperty.call(data, "override_amount_by_month");
  const hasAdmission = Object.prototype.hasOwnProperty.call(data, "admission_fee_override");
  const hasAdmissionMap = Object.prototype.hasOwnProperty.call(data, "admission_fee_override_by_month");
  const hasAdvancedMap = Object.prototype.hasOwnProperty.call(data, "advanced_fee_override_by_month");
  const hasComponentMap = Object.prototype.hasOwnProperty.call(data, "component_override_by_month");
  if (
    !hasMonthly &&
    !hasMonthlyMap &&
    !hasAdmission &&
    !hasAdmissionMap &&
    !hasAdvancedMap &&
    !hasComponentMap
  ) {
    throw new FeeValidationError(
      "At least one of override_amount, override_amount_by_month, admission_fee_override, admission_fee_override_by_month, advanced_fee_override_by_month, or component_override_by_month is required"
    );
  }

  const monthlyVal = hasMonthly ? parseOptionalNonNegativeInt(data.override_amount, "Monthly fee override") : undefined;
  const monthlyMapVal = hasMonthlyMap ? normalizeOverrideAmountMonthMapFromBody(data.override_amount_by_month) : undefined;
  const admissionVal = hasAdmission
    ? parseOptionalNonNegativeInt(data.admission_fee_override, "Admission fee override")
    : undefined;
  const admissionMapVal = hasAdmissionMap ? normalizeAdmissionMonthMapFromBody(data.admission_fee_override_by_month) : undefined;
  const advancedMapVal = hasAdvancedMap ? normalizeAdvancedFeeMonthMapFromBody(data.advanced_fee_override_by_month) : undefined;
  const componentMapVal = hasComponentMap ? normalizeComponentOverrideFromBody(data.component_override_by_month) : undefined;

  await ensureSimplifiedFeeSchema(pool);
  const hasStudentDeletedAt = await tableHasColumn(pool, "students", "deleted_at");
  const studentCheck = await pool.query(
    hasStudentDeletedAt
      ? `SELECT id FROM students WHERE id = $1 AND deleted_at IS NULL`
      : `SELECT id FROM students WHERE id = $1`,
    [student_id]
  );
  if (!studentCheck.rows[0]) throw new FeeValidationError("Student not found");

  const client = await pool.connect();
  let result;
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `
        SELECT discount_amount, admission_fee_override, admission_fee_override_by_month, override_amount_by_month, advanced_fee_override_by_month, component_override_by_month
        FROM student_fee_assignments
        WHERE student_id = $1 AND year = $2
      `,
      [student_id, y]
    );
    const cur = existing.rows[0];
    const nextMonthly = hasMonthly ? monthlyVal : cur?.discount_amount ?? null;
    const nextMonthlyMap = hasMonthlyMap ? monthlyMapVal : cur?.override_amount_by_month ?? null;
    const nextAdmission = hasAdmission ? admissionVal : cur?.admission_fee_override ?? null;
    const nextAdmissionMap =
      hasAdmissionMap ? admissionMapVal : cur?.admission_fee_override_by_month ?? null;
    const nextAdvancedMap = hasAdvancedMap ? advancedMapVal : cur?.advanced_fee_override_by_month ?? null;
    const nextComponentMap = hasComponentMap ? componentMapVal : cur?.component_override_by_month ?? null;

    const mapAdmissionEmpty = !admissionMonthMapHasKeys(parseAdmissionMonthMapFromRow(nextAdmissionMap));
    const mapMonthlyEmpty = !admissionMonthMapHasKeys(parseAdmissionMonthMapFromRow(nextMonthlyMap));
    const mapAdvancedEmpty = !admissionMonthMapHasKeys(parseAdmissionMonthMapFromRow(nextAdvancedMap));
    const mapComponentEmpty = !componentOverrideMapHasAny(nextComponentMap);
    if (
      nextMonthly == null &&
      nextAdmission == null &&
      mapAdmissionEmpty &&
      mapMonthlyEmpty &&
      mapAdvancedEmpty &&
      mapComponentEmpty
    ) {
      await client.query(`DELETE FROM student_fee_assignments WHERE student_id = $1 AND year = $2`, [student_id, y]);
      await client.query("COMMIT");
      return {
        student_id,
        year: y,
        override_amount: null,
        admission_fee_override: null,
        admission_fee_override_by_month: null,
        override_amount_by_month: null,
        advanced_fee_override_by_month: null,
        component_override_by_month: null,
      };
    }

    result = await client.query(
      `
        UPDATE student_fee_assignments
        SET discount_amount = $3,
            admission_fee_override = $4,
            admission_fee_override_by_month = $5::jsonb,
            override_amount_by_month = $6::jsonb,
            advanced_fee_override_by_month = $7::jsonb,
            component_override_by_month = $8::jsonb,
            academic_year_id = NULL,
            structure_id = NULL
        WHERE student_id = $1
          AND year = $2
        RETURNING student_id, year, discount_amount, admission_fee_override, admission_fee_override_by_month, override_amount_by_month, advanced_fee_override_by_month, component_override_by_month
      `,
      [
        student_id,
        y,
        nextMonthly,
        nextAdmission,
        nextAdmissionMap == null ? null : JSON.stringify(nextAdmissionMap),
        nextMonthlyMap == null ? null : JSON.stringify(nextMonthlyMap),
        nextAdvancedMap == null ? null : JSON.stringify(nextAdvancedMap),
        nextComponentMap == null ? null : JSON.stringify(nextComponentMap),
      ]
    );

    if (!result.rows[0]) {
      result = await client.query(
        `
          INSERT INTO student_fee_assignments (
            student_id,
            academic_year_id,
            structure_id,
            discount_amount,
            admission_fee_override,
            admission_fee_override_by_month,
            override_amount_by_month,
            advanced_fee_override_by_month,
            component_override_by_month,
            year
          )
          VALUES ($1, NULL, NULL, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8)
          RETURNING student_id, year, discount_amount, admission_fee_override, admission_fee_override_by_month, override_amount_by_month, advanced_fee_override_by_month, component_override_by_month
        `,
        [
          student_id,
          nextMonthly,
          nextAdmission,
          nextAdmissionMap == null ? null : JSON.stringify(nextAdmissionMap),
          nextMonthlyMap == null ? null : JSON.stringify(nextMonthlyMap),
          nextAdvancedMap == null ? null : JSON.stringify(nextAdvancedMap),
          nextComponentMap == null ? null : JSON.stringify(nextComponentMap),
          y,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const row = result.rows[0];
  return {
    student_id: row.student_id,
    year: Number(row.year),
    override_amount: row.discount_amount != null ? Math.round(Number(row.discount_amount)) : null,
    admission_fee_override: row.admission_fee_override != null ? Math.round(Number(row.admission_fee_override)) : null,
    admission_fee_override_by_month: parseAdmissionMonthMapFromRow(row.admission_fee_override_by_month),
    override_amount_by_month: parseAdmissionMonthMapFromRow(row.override_amount_by_month),
    advanced_fee_override_by_month: parseAdmissionMonthMapFromRow(row.advanced_fee_override_by_month),
    component_override_by_month: parseComponentOverrideMapFromRow(row.component_override_by_month),
  };
};

const getStudentFee = async (studentId, _academicYearId, calendarYear) => {
  if (!studentId) throw new FeeValidationError("student_id is required");
  const y = parseYear(calendarYear);
  await ensureSimplifiedFeeSchema(pool);

  const result = await pool.query(
    `
      SELECT student_id, year, discount_amount, admission_fee_override, admission_fee_override_by_month, override_amount_by_month, advanced_fee_override_by_month, component_override_by_month
      FROM student_fee_assignments
      WHERE student_id = $1 AND year = $2
      LIMIT 1
    `,
    [studentId, y]
  );
  if (!result.rows[0]) {
    return {
      student_id: studentId,
      year: y,
      override_monthly_fee: null,
      override_amount: null,
      admission_fee_override: null,
      admission_fee_override_by_month: null,
      override_amount_by_month: null,
      advanced_fee_override_by_month: null,
      component_override_by_month: null,
    };
  }

  const dm = result.rows[0].discount_amount;
  const am = result.rows[0].admission_fee_override;
  const monthlyOut = dm != null && dm !== "" ? Math.round(Number(dm)) : null;
  const admissionOut = am != null && am !== "" ? Math.round(Number(am)) : null;
  const mapOut = parseAdmissionMonthMapFromRow(result.rows[0].admission_fee_override_by_month);
  const monthlyMapOut = parseAdmissionMonthMapFromRow(result.rows[0].override_amount_by_month);
  const advancedMapOut = parseAdmissionMonthMapFromRow(result.rows[0].advanced_fee_override_by_month);
  const componentMapOut = parseComponentOverrideMapFromRow(result.rows[0].component_override_by_month);
  return {
    student_id: result.rows[0].student_id,
    year: Number(result.rows[0].year),
    override_monthly_fee: monthlyOut,
    override_amount: monthlyOut,
    admission_fee_override: admissionOut,
    admission_fee_override_by_month: mapOut,
    override_amount_by_month: monthlyMapOut,
    advanced_fee_override_by_month: advancedMapOut,
    component_override_by_month: componentMapOut,
  };
};

const resolveStudentMonthlyFee = async ({ student_id, class_id, year, month }) => {
  const y = parseYear(year);
  const m = parseMonth(month);
  if (!student_id) throw new FeeValidationError("student_id is required");
  if (!class_id) throw new FeeValidationError("class_id is required");

  await ensureSimplifiedFeeSchema(pool);

  const billing = await readFeeConfigForClass(y, class_id);
  if (m < billing.start_month || m > billing.end_month) {
    return { fee: 0, source: "out_of_range" };
  }

  const structure = await getMonthlyFeeStructure(class_id, y);

  const assignRes = await pool.query(
    `
      SELECT discount_amount, admission_fee_override, admission_fee_override_by_month, override_amount_by_month, advanced_fee_override_by_month, component_override_by_month
      FROM student_fee_assignments
      WHERE student_id = $1 AND year = $2
      LIMIT 1
    `,
    [student_id, y]
  );
  const assignRow = assignRes.rows[0];

  const componentsSum = sumExtraFeeComponentsForMonth(structure, m, assignRow);

  const classFeeRes = await pool.query(
    `
      SELECT amount
      FROM fee_structures
      WHERE class_id = $1 AND year = $2 AND month = $3
      LIMIT 1
    `,
    [class_id, y, m]
  );
  const classMonthly = Math.round(Number(classFeeRes.rows[0]?.amount || 0));

  const monthlyPart = resolveMonthlyPartForMonth(assignRow, m, classMonthly);

  const source =
    assignRow &&
    (assignRow.discount_amount != null ||
      assignRow.admission_fee_override != null ||
      admissionMonthMapHasKeys(parseAdmissionMonthMapFromRow(assignRow.admission_fee_override_by_month)) ||
      admissionMonthMapHasKeys(parseAdmissionMonthMapFromRow(assignRow.override_amount_by_month)) ||
      admissionMonthMapHasKeys(parseAdmissionMonthMapFromRow(assignRow.advanced_fee_override_by_month)) ||
      componentOverrideMapHasAny(assignRow.component_override_by_month))
      ? "override"
      : "class";

  return { fee: Math.round(monthlyPart + componentsSum), source };
};

/**
 * Fee rows for challan print: same labels/order as Fee Setup, with student overrides applied
 * (monthly, admission fee, advanced fee columns — same rules as billing / resolveStudentMonthlyFee).
 */
const getChallanFeeLines = async ({ student_id, year, month }) => {
  if (!student_id) throw new FeeValidationError("student_id is required");
  const y = parseYear(year);
  const m = parseMonth(month);

  const studRes = await pool.query(
    `
      SELECT id, current_class_id
      FROM students
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [student_id]
  );
  if (!studRes.rows[0]) throw new FeeValidationError("Student not found");

  const class_id = studRes.rows[0].current_class_id;
  if (!class_id) {
    return { year: y, month: m, items: [{ label: "Monthly fee", amount: 0 }] };
  }

  await ensureSimplifiedFeeSchema(pool);

  const billing = await readFeeConfigForClass(y, class_id);
  if (m < billing.start_month || m > billing.end_month) {
    return { year: y, month: m, items: [{ label: "Monthly fee", amount: 0 }] };
  }

  const structure = await getMonthlyFeeStructure(class_id, y);

  const assignRes = await pool.query(
    `
      SELECT discount_amount, admission_fee_override, admission_fee_override_by_month, override_amount_by_month, advanced_fee_override_by_month, component_override_by_month
      FROM student_fee_assignments
      WHERE student_id = $1 AND year = $2
      LIMIT 1
    `,
    [student_id, y]
  );
  const assignRow = assignRes.rows[0];
  const compOv = parseComponentOverrideMapFromRow(assignRow?.component_override_by_month);

  const classFeeRes = await pool.query(
    `
      SELECT amount
      FROM fee_structures
      WHERE class_id = $1 AND year = $2 AND month = $3
      LIMIT 1
    `,
    [class_id, y, m]
  );
  const classMonthly = Math.round(Number(classFeeRes.rows[0]?.amount || 0));
  const monthlyAmount = resolveMonthlyPartForMonth(assignRow, m, classMonthly);

  const fromFee = Array.isArray(structure.fee_components) ? structure.fee_components : null;
  const fromComp = Array.isArray(structure.components) ? structure.components : null;
  const rawComps = (fromFee && fromFee.length > 0 ? fromFee : fromComp) || [];
  const comps = rawComps.sort((a, b) => {
      const ao = Number(a.sort_order ?? 0);
      const bo = Number(b.sort_order ?? 0);
      if (ao !== bo) return ao - bo;
      return String(a.label || "").localeCompare(String(b.label || ""));
    });

  const gridAmt = (c) => effectiveComponentGridAmount(c, m);

  let admissionGridSum = 0;
  let advancedGridSum = 0;
  const admissionIndices = [];
  const advancedIndices = [];
  comps.forEach((c, idx) => {
    const lab = String(c.label || "").trim().toLowerCase();
    const g = gridAmt(c);
    if (lab === "admission fee") {
      admissionGridSum += g;
      admissionIndices.push(idx);
    }
    if (lab === "advanced fee" || lab === "advance fee") {
      advancedGridSum += g;
      advancedIndices.push(idx);
    }
  });

  const admissionResolved = resolveAdmissionPartForMonth(assignRow, m, admissionGridSum);
  const advancedResolved = resolveAdvancedPartForMonth(assignRow, m, advancedGridSum);

  const splitGroup = (resolved, indices, sumGrid) => {
    const map = new Map();
    if (!indices.length) return map;
    if (sumGrid > 0) {
      let allocated = 0;
      indices.forEach((ci, ii) => {
        const g = gridAmt(comps[ci]);
        const amt =
          ii === indices.length - 1 ? Math.round(resolved - allocated) : Math.round((resolved * g) / sumGrid);
        allocated += amt;
        map.set(ci, amt);
      });
    } else {
      indices.forEach((ci, ii) => {
        map.set(ci, ii === 0 ? Math.round(resolved) : 0);
      });
    }
    return map;
  };

  const admissionByIdx = splitGroup(admissionResolved, admissionIndices, admissionGridSum);
  const advancedByIdx = splitGroup(advancedResolved, advancedIndices, advancedGridSum);

  const items = [{ label: "Monthly fee", amount: monthlyAmount }];

  for (let i = 0; i < comps.length; i += 1) {
    const c = comps[i];
    const label = String(c.label || "").trim() || "Fee";
    const lab = label.toLowerCase();
    const cid = c.id ? String(c.id) : "";
    let amount;
    if (cid && compOv && compOv[cid] && Object.prototype.hasOwnProperty.call(compOv[cid], String(m))) {
      amount = Math.round(Number(compOv[cid][String(m)]));
    } else if (lab === "admission fee") {
      amount = admissionByIdx.get(i) ?? 0;
    } else if (lab === "advanced fee" || lab === "advance fee") {
      amount = advancedByIdx.get(i) ?? 0;
    } else {
      amount = gridAmt(c);
    }
    items.push({ label, amount });
  }

  return { year: y, month: m, items };
};

module.exports = {
  readFeeConfig,
  readFeeConfigForClass,
  saveFeeConfig,
  deleteClassFeeBillingConfig,
  getMonthlyFeeStructure,
  upsertMonthlyFeeStructure,
  listClassFeeComponents,
  createClassFeeComponent,
  updateClassFeeComponent,
  deleteClassFeeComponent,
  upsertComponentMonthAmount,
  assignStudentFeeOverrideByYear,
  getStudentFee,
  resolveStudentMonthlyFee,
  getChallanFeeLines,
  sumExtraFeeComponentsForMonth,
  parseComponentOverrideMapFromRow,
};

module.exports.FeeValidationError = FeeValidationError;
