console.log("🔥 studentRoutes loaded");
const pool = require("../config/db");

const createStudent = async (data) => {
  const {
    campus_id,
    current_class_id,
    current_section_id,
    name,
    father_name,
    phone,
    gender,
    address,
    admission_date,
  } = data;

  const result = await pool.query(
    `
      INSERT INTO students (
        campus_id,
        current_class_id,
        current_section_id,
        name,
        father_name,
        phone,
        gender,
        address,
        admission_date,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
      RETURNING *
    `,
    [
      campus_id,
      current_class_id,
      current_section_id,
      name,
      father_name,
      phone,
      gender,
      address,
      admission_date,
    ]
  );

  return result.rows[0];
};

const getStudents = async (filters = {}) => {
  const values = [];
  const conditions = ["deleted_at IS NULL"];
  const includeInactive =
    filters.include_inactive === true ||
    String(filters.include_inactive || "")
      .trim()
      .toLowerCase() === "true";

  if (!includeInactive) {
    conditions.push(`status = 'active'`);
  }

  if (filters.current_class_id) {
    values.push(filters.current_class_id);
    conditions.push(`current_class_id = $${values.length}`);
  }

  if (filters.gender) {
    values.push(filters.gender);
    conditions.push(`gender = $${values.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `
      SELECT *
      FROM students
      ${whereClause}
      ORDER BY admission_date DESC, id ASC
    `,
    values
  );

  return result.rows;
};

const updateStudent = async (id, data) => {
  const { name, father_name, phone, gender } = data;
  const genderValue =
    gender === undefined || gender === null || String(gender).trim() === "" ? null : String(gender).trim();

  const result = await pool.query(
    `
      UPDATE students
      SET
        name = $1,
        father_name = $2,
        phone = $3,
        gender = COALESCE($4, gender),
        updated_at = NOW()
      WHERE id = $5
        AND deleted_at IS NULL
      RETURNING *
    `,
    [name, father_name, phone, genderValue, id]
  );

  return result.rows[0];
};

const deleteStudent = async (id) => {
  const result = await pool.query(
    `
      DELETE FROM students
      WHERE id = $1
      RETURNING id
    `,
    [id]
  );

  return result.rows[0];
};

module.exports = {
  createStudent,
  getStudents,
  updateStudent,
  deleteStudent,
};
