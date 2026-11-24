console.log("🔥 sectionRoutes loaded");
const pool = require("../config/db");

const SECTION_NAME_MAX_LENGTH = 25;

class SectionValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SectionValidationError";
  }
}

class SectionInUseError extends Error {
  constructor(message) {
    super(message);
    this.name = "SectionInUseError";
  }
}

const normalizeSectionName = (rawName) => {
  const name = String(rawName ?? "").trim();
  if (!name) {
    throw new SectionValidationError("Section name is required.");
  }
  if (name.length > SECTION_NAME_MAX_LENGTH) {
    throw new SectionValidationError(`Section name must be at most ${SECTION_NAME_MAX_LENGTH} characters.`);
  }
  return name;
};

const createSection = async (data) => {
  const { class_id, name: rawName } = data;
  const name = normalizeSectionName(rawName);

  const result = await pool.query(
    `
      INSERT INTO sections (class_id, name)
      VALUES ($1, $2)
      RETURNING *
    `,
    [class_id, name]
  );

  return result.rows[0];
};

const getSections = async (classId) => {
  const result = await pool.query(
    `
      SELECT *
      FROM sections
      WHERE class_id = $1
        AND deleted_at IS NULL
      ORDER BY name ASC
    `,
    [classId]
  );

  return result.rows;
};

const deleteSection = async (id) => {
  const client = await pool.connect();

  let began = false;

  try {
    await client.query("BEGIN");
    began = true;

    const studentsCountResult = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM students
        WHERE current_section_id = $1
          AND deleted_at IS NULL
      `,
      [id]
    );

    const studentsCount = studentsCountResult.rows[0].count;

    if (studentsCount > 0) {
      throw new SectionInUseError("Cannot delete section. It is assigned to students.");
    }

    const deleteResult = await client.query(
      `
        DELETE FROM sections
        WHERE id = $1
        RETURNING id
      `,
      [id]
    );

    if (!deleteResult.rows[0]) {
      throw new SectionInUseError("Section not found.");
    }

    await client.query("COMMIT");
    return { message: "Section deleted permanently" };
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
  createSection,
  getSections,
  deleteSection,
  SECTION_NAME_MAX_LENGTH,
};

module.exports.SectionInUseError = SectionInUseError;
module.exports.SectionValidationError = SectionValidationError;
