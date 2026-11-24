const pool = require("../config/db");

class AcademicValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AcademicValidationError";
  }
}

const isUniqueViolation = (error) => error && error.code === "23505";
const parseCalendarYear = (value) => {
  const y = Number(value);
  if (!Number.isInteger(y) || y < 1900 || y > 2100) {
    throw new AcademicValidationError("year must be an integer between 1900 and 2100");
  }
  return y;
};

const ensurePromotionSchema = async (client) => {
  const runBestEffort = async (sql) => {
    try {
      await client.query(sql);
    } catch (error) {
      if (error?.code === "42501") return;
      throw error;
    }
  };
  await runBestEffort(`
    CREATE TABLE IF NOT EXISTS alumni (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL,
      graduation_year INTEGER NOT NULL,
      class_id UUID,
      section_id UUID,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await runBestEffort(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_alumni_student_graduation_year
    ON alumni (student_id, graduation_year);
  `);
};

const assertAcademicYearExists = async (client, academicYearId) => {
  const result = await client.query(
    `
      SELECT id
      FROM academic_years
      WHERE id = $1
    `,
    [academicYearId]
  );

  if (!result.rows[0]) {
    throw new AcademicValidationError("Academic year not found");
  }
};

const assertStudentActive = async (client, studentId) => {
  const result = await client.query(
    `
      SELECT id
      FROM students
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [studentId]
  );

  if (!result.rows[0]) {
    throw new AcademicValidationError("Student not found");
  }
};

const assertClassActive = async (client, classId) => {
  const result = await client.query(
    `
      SELECT id
      FROM classes
      WHERE id = $1
        AND deleted_at IS NULL
    `,
    [classId]
  );

  if (!result.rows[0]) {
    throw new AcademicValidationError("Class not found");
  }
};

const assertSectionBelongsToClass = async (client, classId, sectionId) => {
  const result = await client.query(
    `
      SELECT id
      FROM sections
      WHERE id = $1
        AND class_id = $2
        AND deleted_at IS NULL
    `,
    [sectionId, classId]
  );

  if (!result.rows[0]) {
    throw new AcademicValidationError("Section not found for this class");
  }
};

const assertNoHistoryForYear = async (client, studentId, academicYearId) => {
  const result = await client.query(
    `
      SELECT COUNT(*)::int AS count
      FROM student_academic_history
      WHERE student_id = $1
        AND academic_year_id = $2
    `,
    [studentId, academicYearId]
  );

  if (result.rows[0].count > 0) {
    throw new AcademicValidationError("Academic history already exists for this year");
  }
};

const getAcademicYearForCalendarYear = async (client, year) => {
  const y = parseCalendarYear(year);
  const result = await client.query(
    `
      SELECT id, name, start_date, end_date
      FROM academic_years
      WHERE EXTRACT(YEAR FROM start_date) = $1
      ORDER BY start_date DESC
      LIMIT 1
    `,
    [y]
  );
  return result.rows[0] || null;
};

const resolveStudentEnrollmentForYear = async (studentId, year) => {
  if (!studentId) throw new AcademicValidationError("student_id is required");
  const y = parseCalendarYear(year);
  const client = await pool.connect();
  try {
    await ensurePromotionSchema(client);
    const studentRes = await client.query(
      `
        SELECT s.id, s.name, s.current_class_id, s.current_section_id, s.status,
               c.name AS current_class_name, sec.name AS current_section_name
        FROM students s
        LEFT JOIN classes c ON c.id = s.current_class_id
        LEFT JOIN sections sec ON sec.id = s.current_section_id
        WHERE s.id = $1
          AND s.deleted_at IS NULL
        LIMIT 1
      `,
      [studentId]
    );
    const student = studentRes.rows[0];
    if (!student) throw new AcademicValidationError("Student not found");

    const alumRes = await client.query(
      `
        SELECT MAX(graduation_year)::int AS graduation_year
        FROM alumni
        WHERE student_id = $1
      `,
      [studentId]
    );
    const alumniGradYear = alumRes.rows[0]?.graduation_year;
    if (alumniGradYear != null && y > alumniGradYear) {
      const ay = await getAcademicYearForCalendarYear(client, y);
      return {
        student_id: student.id,
        student_name: student.name,
        year: y,
        academic_year_id: ay?.id || null,
        academic_year_name: ay?.name || null,
        class_id: null,
        section_id: null,
        class_name: null,
        section_name: null,
        result_status: null,
        source: "alumni_post_graduation",
        graduation_year: alumniGradYear,
      };
    }

    const ay = await getAcademicYearForCalendarYear(client, y);
    if (ay?.id) {
      const historyRes = await client.query(
        `
          SELECT h.class_id, h.section_id, h.result_status,
                 c.name AS class_name, sec.name AS section_name
          FROM student_academic_history h
          LEFT JOIN classes c ON c.id = h.class_id
          LEFT JOIN sections sec ON sec.id = h.section_id
          WHERE h.student_id = $1
            AND h.academic_year_id = $2
          LIMIT 1
        `,
        [studentId, ay.id]
      );
      if (historyRes.rows[0]) {
        return {
          student_id: student.id,
          student_name: student.name,
          year: y,
          academic_year_id: ay.id,
          academic_year_name: ay.name,
          class_id: historyRes.rows[0].class_id,
          section_id: historyRes.rows[0].section_id,
          class_name: historyRes.rows[0].class_name || null,
          section_name: historyRes.rows[0].section_name || null,
          result_status: historyRes.rows[0].result_status || null,
          source: "history",
        };
      }
    }

    return {
      student_id: student.id,
      student_name: student.name,
      year: y,
      academic_year_id: ay?.id || null,
      academic_year_name: ay?.name || null,
      class_id: student.current_class_id,
      section_id: student.current_section_id,
      class_name: student.current_class_name || null,
      section_name: student.current_section_name || null,
      result_status: null,
      source: "current",
    };
  } finally {
    client.release();
  }
};

const listPromotionCandidates = async ({ from_class_id, from_section_id = null }) => {
  if (!from_class_id) throw new AcademicValidationError("from_class_id is required");
  const params = [from_class_id];
  const sectionSql =
    from_section_id && String(from_section_id).trim() !== ""
      ? (() => {
          params.push(from_section_id);
          return ` AND s.current_section_id = $${params.length} `;
        })()
      : "";
  const res = await pool.query(
    `
      SELECT s.id, s.name, s.father_name, s.phone, s.current_class_id, s.current_section_id,
             c.name AS class_name, sec.name AS section_name
      FROM students s
      LEFT JOIN classes c ON c.id = s.current_class_id
      LEFT JOIN sections sec ON sec.id = s.current_section_id
      WHERE s.deleted_at IS NULL
        AND s.status = 'active'
        AND s.current_class_id = $1
        ${sectionSql}
      ORDER BY s.name ASC, s.id ASC
    `,
    params
  );
  return res.rows;
};

const previewPromotion = async (data) => {
  const { year, from_class_id, from_section_id, target_class_id, target_section_id, promote_to_alumni } = data || {};
  const y = parseCalendarYear(year);
  if (!from_class_id) throw new AcademicValidationError("from_class_id is required");
  const ay = await getAcademicYearForCalendarYear(pool, y);
  if (!ay?.id) throw new AcademicValidationError(`No academic year found for ${y}`);

  const candidates = await listPromotionCandidates({ from_class_id, from_section_id });

  let historyMap = new Map();
  if (candidates.length) {
    const hist = await pool.query(
      `
        SELECT student_id
        FROM student_academic_history
        WHERE academic_year_id = $1
          AND student_id = ANY($2::uuid[])
      `,
      [ay.id, candidates.map((c) => c.id)]
    );
    historyMap = new Map(hist.rows.map((r) => [r.student_id, true]));
  }

  const target = promote_to_alumni
    ? { type: "alumni", class_id: null, section_id: null }
    : { type: "class", class_id: target_class_id || null, section_id: target_section_id || null };

  return {
    year: y,
    academic_year_id: ay.id,
    academic_year_name: ay.name,
    target,
    total_candidates: candidates.length,
    students: candidates.map((s) => ({
      ...s,
      blocked_reason: historyMap.get(s.id) ? "Already processed for this academic year" : null,
    })),
  };
};

const createAcademicYear = async (data) => {
  const { name, start_date, end_date } = data;

  if (!name || !start_date || !end_date) {
    throw new AcademicValidationError("name, start_date and end_date are required");
  }

  if (new Date(end_date) <= new Date(start_date)) {
    throw new AcademicValidationError("end_date must be greater than start_date");
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO academic_years (name, start_date, end_date, is_active)
        VALUES ($1, $2, $3, FALSE)
        RETURNING *
      `,
      [name, start_date, end_date]
    );

    return result.rows[0];
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AcademicValidationError("Academic year name must be unique");
    }
    throw error;
  }
};

const setActiveYear = async (yearId) => {
  if (!yearId) {
    throw new AcademicValidationError("year_id is required");
  }

  const client = await pool.connect();
  let began = false;

  try {
    await client.query("BEGIN");
    began = true;

    const yearCheck = await client.query(
      `
        SELECT id
        FROM academic_years
        WHERE id = $1
      `,
      [yearId]
    );

    if (!yearCheck.rows[0]) {
      throw new AcademicValidationError("Academic year not found");
    }

    await client.query(`UPDATE academic_years SET is_active = FALSE WHERE is_active = TRUE`);
    await client.query(
      `
        UPDATE academic_years
        SET is_active = TRUE
        WHERE id = $1
      `,
      [yearId]
    );

    await client.query("COMMIT");

    const active = await pool.query(
      `
        SELECT *
        FROM academic_years
        WHERE is_active = TRUE
        LIMIT 1
      `
    );

    return active.rows[0];
  } catch (error) {
    if (began) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
};

const getActiveYear = async () => {
  const result = await pool.query(
    `
      SELECT *
      FROM academic_years
      WHERE is_active = TRUE
      LIMIT 1
    `
  );

  if (!result.rows[0]) {
    throw new AcademicValidationError("No active academic year");
  }

  return result.rows[0];
};

const getAcademicYears = async () => {
  const result = await pool.query(
    `
      SELECT *
      FROM academic_years
      ORDER BY start_date DESC, name ASC
    `
  );

  return result.rows;
};

const promoteStudents = async (data) => {
  const { academic_year_id, items } = data;

  if (!academic_year_id || !Array.isArray(items) || items.length === 0) {
    throw new AcademicValidationError("academic_year_id and a non-empty items array are required");
  }

  const client = await pool.connect();
  let began = false;

  try {
    await client.query("BEGIN");
    began = true;

    await assertAcademicYearExists(client, academic_year_id);

    for (const item of items) {
      const { student_id, new_class_id, new_section_id } = item;

      if (!student_id || !new_class_id || !new_section_id) {
        throw new AcademicValidationError("Each item requires student_id, new_class_id, new_section_id");
      }

      await assertStudentActive(client, student_id);
      await assertNoHistoryForYear(client, student_id, academic_year_id);

      await assertClassActive(client, new_class_id);
      await assertSectionBelongsToClass(client, new_class_id, new_section_id);

      await client.query(
        `
          INSERT INTO student_academic_history (
            student_id,
            academic_year_id,
            class_id,
            section_id,
            result_status
          )
          VALUES ($1, $2, $3, $4, 'promoted')
        `,
        [student_id, academic_year_id, new_class_id, new_section_id]
      );

      const updateResult = await client.query(
        `
          UPDATE students
          SET
            current_class_id = $1,
            current_section_id = $2,
            updated_at = NOW()
          WHERE id = $3
            AND deleted_at IS NULL
        `,
        [new_class_id, new_section_id, student_id]
      );

      if (updateResult.rowCount === 0) {
        throw new AcademicValidationError("Student not found");
      }
    }

    await client.query("COMMIT");
    return { message: "Students promoted successfully", count: items.length };
  } catch (error) {
    if (began) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
};

const failStudent = async (student_id, academic_year_id) => {
  if (!student_id || !academic_year_id) {
    throw new AcademicValidationError("student_id and academic_year_id are required");
  }

  const client = await pool.connect();
  let began = false;

  try {
    await client.query("BEGIN");
    began = true;

    await assertAcademicYearExists(client, academic_year_id);
    await assertStudentActive(client, student_id);
    await assertNoHistoryForYear(client, student_id, academic_year_id);

    const studentRow = await client.query(
      `
        SELECT current_class_id, current_section_id
        FROM students
        WHERE id = $1
          AND deleted_at IS NULL
      `,
      [student_id]
    );

    const { current_class_id, current_section_id } = studentRow.rows[0];

    await client.query(
      `
        INSERT INTO student_academic_history (
          student_id,
          academic_year_id,
          class_id,
          section_id,
          result_status
        )
        VALUES ($1, $2, $3, $4, 'failed')
      `,
      [student_id, academic_year_id, current_class_id, current_section_id]
    );

    await client.query("COMMIT");
    return { message: "Student marked as failed for academic year" };
  } catch (error) {
    if (began) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
};

const markStudentLeft = async (student_id, academic_year_id) => {
  if (!student_id || !academic_year_id) {
    throw new AcademicValidationError("student_id and academic_year_id are required");
  }

  const client = await pool.connect();
  let began = false;

  try {
    await client.query("BEGIN");
    began = true;

    await assertAcademicYearExists(client, academic_year_id);
    await assertStudentActive(client, student_id);
    await assertNoHistoryForYear(client, student_id, academic_year_id);

    const studentRow = await client.query(
      `
        SELECT current_class_id, current_section_id
        FROM students
        WHERE id = $1
          AND deleted_at IS NULL
      `,
      [student_id]
    );

    const { current_class_id, current_section_id } = studentRow.rows[0];

    await client.query(
      `
        INSERT INTO student_academic_history (
          student_id,
          academic_year_id,
          class_id,
          section_id,
          result_status
        )
        VALUES ($1, $2, $3, $4, 'left')
      `,
      [student_id, academic_year_id, current_class_id, current_section_id]
    );

    const updateResult = await client.query(
      `
        UPDATE students
        SET
          status = 'left',
          updated_at = NOW()
        WHERE id = $1
          AND deleted_at IS NULL
      `,
      [student_id]
    );

    if (updateResult.rowCount === 0) {
      throw new AcademicValidationError("Student not found");
    }

    await client.query("COMMIT");
    return { message: "Student marked as left" };
  } catch (error) {
    if (began) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
};

const executePromotion = async (data) => {
  const {
    year,
    student_ids,
    target_class_id,
    target_section_id,
    promote_to_alumni = false,
  } = data || {};
  const y = parseCalendarYear(year);
  if (!Array.isArray(student_ids) || student_ids.length === 0) {
    throw new AcademicValidationError("student_ids must be a non-empty array");
  }
  if (!promote_to_alumni && (!target_class_id || !target_section_id)) {
    throw new AcademicValidationError("target_class_id and target_section_id are required");
  }

  const client = await pool.connect();
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;

    await ensurePromotionSchema(client);
    const ay = await getAcademicYearForCalendarYear(client, y);
    if (!ay?.id) throw new AcademicValidationError(`No academic year found for ${y}`);

    if (!promote_to_alumni) {
      await assertClassActive(client, target_class_id);
      await assertSectionBelongsToClass(client, target_class_id, target_section_id);
    }

    const studentsRes = await client.query(
      `
        SELECT id, current_class_id, current_section_id
        FROM students
        WHERE id = ANY($1::uuid[])
          AND deleted_at IS NULL
          AND status = 'active'
        FOR UPDATE
      `,
      [student_ids]
    );
    const students = studentsRes.rows;
    if (!students.length) throw new AcademicValidationError("No active students found for promotion");

    const existingRes = await client.query(
      `
        SELECT student_id
        FROM student_academic_history
        WHERE academic_year_id = $1
          AND student_id = ANY($2::uuid[])
      `,
      [ay.id, students.map((s) => s.id)]
    );
    const alreadyDone = new Set(existingRes.rows.map((r) => r.student_id));

    let processed = 0;
    let skipped = 0;
    for (const s of students) {
      if (alreadyDone.has(s.id)) {
        skipped += 1;
        continue;
      }
      const histClassId = promote_to_alumni ? s.current_class_id : target_class_id;
      const histSectionId = promote_to_alumni ? s.current_section_id : target_section_id;
      await client.query(
        `
          INSERT INTO student_academic_history (
            student_id, academic_year_id, class_id, section_id, result_status
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [s.id, ay.id, histClassId, histSectionId, "promoted"]
      );

      if (promote_to_alumni) {
        await client.query(
          `
            INSERT INTO alumni (student_id, graduation_year, class_id, section_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (student_id, graduation_year) DO NOTHING
          `,
          [s.id, y, s.current_class_id, s.current_section_id]
        );
        await client.query(
          `
            UPDATE students
            SET status = 'left', updated_at = NOW()
            WHERE id = $1
          `,
          [s.id]
        );
      } else {
        await client.query(
          `
            UPDATE students
            SET current_class_id = $1,
                current_section_id = $2,
                updated_at = NOW()
            WHERE id = $3
          `,
          [target_class_id, target_section_id, s.id]
        );
      }
      processed += 1;
    }

    await client.query("COMMIT");
    return {
      message: promote_to_alumni ? "Students moved to alumni successfully" : "Students promoted successfully",
      academic_year_id: ay.id,
      academic_year_name: ay.name,
      year: y,
      promote_to_alumni: Boolean(promote_to_alumni),
      processed,
      skipped,
    };
  } catch (error) {
    if (began) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const listAlumniYears = async () => {
  await ensurePromotionSchema(pool);
  const res = await pool.query(
    `
      SELECT DISTINCT graduation_year
      FROM alumni
      ORDER BY graduation_year DESC
    `
  );
  return res.rows.map((r) => Number(r.graduation_year)).filter((y) => Number.isInteger(y));
};

const getAlumniStudentsByYear = async (year) => {
  const y = parseCalendarYear(year);
  await ensurePromotionSchema(pool);
  const res = await pool.query(
    `
      SELECT
        s.*,
        a.graduation_year,
        c.name AS alumni_class_name,
        sec.name AS alumni_section_name
      FROM alumni a
      INNER JOIN students s ON s.id = a.student_id
      LEFT JOIN classes c ON c.id = a.class_id
      LEFT JOIN sections sec ON sec.id = a.section_id
      WHERE a.graduation_year = $1
        AND s.deleted_at IS NULL
      ORDER BY s.name ASC, s.id ASC
    `,
    [y]
  );
  return res.rows;
};

module.exports = {
  createAcademicYear,
  setActiveYear,
  getActiveYear,
  getAcademicYears,
  promoteStudents,
  previewPromotion,
  executePromotion,
  failStudent,
  markStudentLeft,
  resolveStudentEnrollmentForYear,
  listPromotionCandidates,
  listAlumniYears,
  getAlumniStudentsByYear,
};

module.exports.AcademicValidationError = AcademicValidationError;
