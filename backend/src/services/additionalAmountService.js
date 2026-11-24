const pool = require("../config/db");

class AdditionalAmountValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AdditionalAmountValidationError";
  }
}

class AdditionalAmountNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "AdditionalAmountNotFoundError";
  }
}

const ensureTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS additional_amounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      date DATE NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL
    )
  `);
};

const normalizePayload = (payload = {}) => {
  const name = String(payload.name ?? "").trim();
  if (!name) {
    throw new AdditionalAmountValidationError("additional amount name is required");
  }

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AdditionalAmountValidationError("amount must be greater than 0");
  }

  const rawDate = String(payload.date ?? "").trim();
  if (!rawDate) {
    throw new AdditionalAmountValidationError("date is required");
  }
  const parsedDate = new Date(rawDate);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new AdditionalAmountValidationError("date is invalid");
  }

  return {
    name,
    amount,
    isoDate: parsedDate.toISOString().slice(0, 10),
  };
};

const createAdditionalAmount = async (payload = {}) => {
  await ensureTable();
  const { name, amount, isoDate } = normalizePayload(payload);
  const result = await pool.query(
    `
      INSERT INTO additional_amounts (name, amount, date)
      VALUES ($1, $2, $3)
      RETURNING id, name, amount, date
    `,
    [name, amount, isoDate]
  );
  return result.rows[0];
};

const listAdditionalAmounts = async () => {
  await ensureTable();
  const result = await pool.query(
    `
      SELECT id, name, amount, date
      FROM additional_amounts
      WHERE deleted_at IS NULL
      ORDER BY date DESC, created_at DESC
      LIMIT 1000
    `
  );
  return result.rows;
};

const updateAdditionalAmount = async (id, payload = {}) => {
  await ensureTable();
  const additionalId = String(id || "").trim();
  if (!additionalId) {
    throw new AdditionalAmountValidationError("id is required");
  }
  const { name, amount, isoDate } = normalizePayload(payload);
  const result = await pool.query(
    `
      UPDATE additional_amounts
      SET name = $2,
          amount = $3,
          date = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND deleted_at IS NULL
      RETURNING id, name, amount, date
    `,
    [additionalId, name, amount, isoDate]
  );
  if (!result.rows[0]) {
    throw new AdditionalAmountNotFoundError("Additional amount not found");
  }
  return result.rows[0];
};

const deleteAdditionalAmount = async (id) => {
  await ensureTable();
  const additionalId = String(id || "").trim();
  if (!additionalId) {
    throw new AdditionalAmountValidationError("id is required");
  }
  const result = await pool.query(
    `
      DELETE FROM additional_amounts
      WHERE id = $1
      RETURNING id
    `,
    [additionalId]
  );
  if (!result.rows[0]) {
    throw new AdditionalAmountNotFoundError("Additional amount not found");
  }
  return result.rows[0];
};

module.exports = {
  createAdditionalAmount,
  listAdditionalAmounts,
  updateAdditionalAmount,
  deleteAdditionalAmount,
  ensureAdditionalAmountsTable: ensureTable,
};

module.exports.AdditionalAmountValidationError = AdditionalAmountValidationError;
module.exports.AdditionalAmountNotFoundError = AdditionalAmountNotFoundError;
