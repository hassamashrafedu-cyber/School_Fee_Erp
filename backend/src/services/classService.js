console.log("🔥 classRoutes loaded");
const pool = require("../config/db");

class ClassInUseError extends Error {
  constructor(message) {
    super(message);
    this.name = "ClassInUseError";
  }
}

const createClass = async (data) => {
  const { name, level } = data;

  const result = await pool.query(
    `
      INSERT INTO classes (name, level)
      VALUES ($1, $2)
      RETURNING *
    `,
    [name, level]
  );

  return result.rows[0];
};

const getClasses = async () => {
  const result = await pool.query(
    `
      SELECT *
      FROM classes
      WHERE deleted_at IS NULL
      ORDER BY name ASC
    `
  );

  return result.rows;
};

const updateClass = async (id, data) => {
  const { name, level } = data;

  const result = await pool.query(
    `
      UPDATE classes
      SET name = $1, level = $2
      WHERE id = $3
        AND deleted_at IS NULL
      RETURNING *
    `,
    [name, level, id]
  );

  return result.rows[0];
};

const deleteClass = async (id) => {
  const client = await pool.connect();

  let began = false;

  try {
    await client.query("BEGIN");
    began = true;

    const studentsCountResult = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM students
        WHERE current_class_id = $1
          AND deleted_at IS NULL
      `,
      [id]
    );

    const sectionsCountResult = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM sections
        WHERE class_id = $1
          AND deleted_at IS NULL
      `,
      [id]
    );

    const studentsCount = studentsCountResult.rows[0].count;
    const sectionsCount = sectionsCountResult.rows[0].count;

    if (studentsCount > 0 || sectionsCount > 0) {
      throw new ClassInUseError("Cannot delete class. It is in use.");
    }

    const deleteResult = await client.query(
      `
        DELETE FROM classes
        WHERE id = $1
        RETURNING id
      `,
      [id]
    );

    if (!deleteResult.rows[0]) {
      throw new ClassInUseError("Class not found.");
    }

    await client.query("COMMIT");
    return { message: "Class deleted permanently" };
  } catch (error) {
    if (began) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  createClass,
  getClasses,
  updateClass,
  deleteClass,
};

module.exports.ClassInUseError = ClassInUseError;
