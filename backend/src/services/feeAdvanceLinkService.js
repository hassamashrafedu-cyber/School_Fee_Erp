const pool = require("../config/db");

class FeeAdvanceLinkValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FeeAdvanceLinkValidationError";
  }
}

const listForClassYear = async (classId, calendarYear) => {
  if (!classId) {
    throw new FeeAdvanceLinkValidationError("class_id is required");
  }
  const y = Number(calendarYear);
  if (!Number.isInteger(y) || y < 1900 || y > 2100) {
    throw new FeeAdvanceLinkValidationError("year must be between 1900 and 2100");
  }

  const result = await pool.query(
    `
      SELECT *
      FROM fee_advance_links
      WHERE class_id = $1
        AND active = TRUE
        AND (source_year = $2 OR target_year = $2)
      ORDER BY source_year ASC, source_month ASC, sort_order ASC, target_year ASC, target_month ASC
    `,
    [classId, y]
  );
  return result.rows;
};

const createLink = async (data) => {
  const { class_id, source_year, source_month, target_year, target_month, sort_order = 0, active = true } = data;
  if (!class_id) {
    throw new FeeAdvanceLinkValidationError("class_id is required");
  }
  const sy = Number(source_year);
  const sm = Number(source_month);
  const ty = Number(target_year);
  const tm = Number(target_month);
  if (!Number.isInteger(sm) || sm < 1 || sm > 12) throw new FeeAdvanceLinkValidationError("source_month must be 1–12");
  if (!Number.isInteger(tm) || tm < 1 || tm > 12) throw new FeeAdvanceLinkValidationError("target_month must be 1–12");
  if (!Number.isInteger(sy) || sy < 1900 || sy > 2100) throw new FeeAdvanceLinkValidationError("source_year invalid");
  if (!Number.isInteger(ty) || ty < 1900 || ty > 2100) throw new FeeAdvanceLinkValidationError("target_year invalid");

  try {
    const result = await pool.query(
      `
      INSERT INTO fee_advance_links (
        class_id, source_year, source_month, target_year, target_month, sort_order, active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
      [class_id, sy, sm, ty, tm, Number(sort_order) || 0, active !== false]
    );
    return result.rows[0];
  } catch (e) {
    if (e && e.code === "23505") {
      throw new FeeAdvanceLinkValidationError("This advance link already exists for the class");
    }
    throw e;
  }
};

const deleteLink = async (id) => {
  if (!id) throw new FeeAdvanceLinkValidationError("id is required");
  const result = await pool.query(`DELETE FROM fee_advance_links WHERE id = $1 RETURNING id`, [id]);
  if (!result.rowCount) throw new FeeAdvanceLinkValidationError("Advance link not found");
};

module.exports = {
  listForClassYear,
  createLink,
  deleteLink,
  FeeAdvanceLinkValidationError,
};
