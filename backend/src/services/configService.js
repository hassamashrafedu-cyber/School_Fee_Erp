const pool = require("../config/db");

class DuplicateConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "DuplicateConfigError";
  }
}

class ConfigInUseError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigInUseError";
  }
}

const isUniqueViolation = (error) => error && error.code === "23505";

const createFeeType = async (rawName) => {
  const name = String(rawName ?? "").trim();
  if (!name) {
    throw new DuplicateConfigError("Fee type already exists");
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO fee_types (name)
        VALUES ($1)
        RETURNING *
      `,
      [name]
    );

    return result.rows[0];
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateConfigError("Fee type already exists");
    }
    throw error;
  }
};

const getFeeTypes = async () => {
  const result = await pool.query(
    `
      SELECT *
      FROM fee_types
      ORDER BY name ASC
    `
  );

  return result.rows;
};

const updateFeeType = async (id, rawName) => {
  const name = String(rawName ?? "").trim();
  if (!name) {
    throw new DuplicateConfigError("Name is required");
  }

  try {
    const result = await pool.query(
      `
        UPDATE fee_types
        SET name = $2
        WHERE id = $1
        RETURNING *
      `,
      [id, name]
    );

    if (!result.rows[0]) {
      const err = new Error("Fee type not found");
      err.code = "NOT_FOUND";
      throw err;
    }

    return result.rows[0];
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateConfigError("Fee type name already exists");
    }
    throw error;
  }
};

const deleteFeeType = async (id) => {
  const client = await pool.connect();
  let began = false;

  try {
    await client.query("BEGIN");
    began = true;

    const usageResult = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM fee_structure_items
        WHERE fee_type_id = $1
      `,
      [id]
    );

    const usageCount = usageResult.rows[0].count;
    if (usageCount > 0) {
      throw new ConfigInUseError("Cannot delete fee type. It is in use.");
    }

    const deleteResult = await client.query(
      `
        DELETE FROM fee_types
        WHERE id = $1
        RETURNING id
      `,
      [id]
    );

    if (!deleteResult.rows[0]) {
      throw new ConfigInUseError("Fee type not found.");
    }

    await client.query("COMMIT");
    return { message: "Fee type deleted successfully" };
  } catch (error) {
    if (began) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
};

const createExpenseCategory = async (rawName) => {
  const name = String(rawName ?? "").trim();
  if (!name) {
    throw new DuplicateConfigError("Expense category already exists");
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO expense_categories (name)
        VALUES ($1)
        RETURNING *
      `,
      [name]
    );

    return result.rows[0];
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateConfigError("Expense category already exists");
    }
    throw error;
  }
};

const getExpenseCategories = async () => {
  const result = await pool.query(
    `
      SELECT *
      FROM expense_categories
      ORDER BY name ASC
    `
  );

  return result.rows;
};

const deleteExpenseCategory = async (id) => {
  const client = await pool.connect();
  let began = false;

  try {
    await client.query("BEGIN");
    began = true;

    const usageResult = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM expenses
        WHERE category_id = $1
      `,
      [id]
    );

    const usageCount = usageResult.rows[0].count;
    if (usageCount > 0) {
      throw new ConfigInUseError("Cannot delete category. It is in use.");
    }

    const deleteResult = await client.query(
      `
        DELETE FROM expense_categories
        WHERE id = $1
        RETURNING id
      `,
      [id]
    );

    if (!deleteResult.rows[0]) {
      throw new ConfigInUseError("Expense category not found.");
    }

    await client.query("COMMIT");
    return { message: "Expense category deleted successfully" };
  } catch (error) {
    if (began) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
};

const getCampuses = async () => {
  const result = await pool.query(
    `
      SELECT id, institute_id, name, gender_type
      FROM campuses
      ORDER BY name ASC
    `
  );

  return result.rows;
};

module.exports = {
  createFeeType,
  getFeeTypes,
  updateFeeType,
  deleteFeeType,
  createExpenseCategory,
  getExpenseCategories,
  deleteExpenseCategory,
  getCampuses,
};

module.exports.DuplicateConfigError = DuplicateConfigError;
module.exports.ConfigInUseError = ConfigInUseError;
