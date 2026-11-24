const bcrypt = require("bcrypt");
const pool = require("../config/db");
const { normalizeRole, SYSTEM_ROLES } = require("./authService");

class PurgeValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "PurgeValidationError";
    this.statusCode = statusCode;
  }
}

const tableExists = async (client, tableName) => {
  const result = await client.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = $1
      LIMIT 1
    `,
    [tableName]
  );
  return Boolean(result.rows[0]);
};

const assertAdminPassword = async (adminUserId, password) => {
  if (!password) {
    throw new PurgeValidationError("admin_current_password is required");
  }
  const adminRes = await pool.query(
    `SELECT id, password_hash, role FROM users WHERE id = $1 LIMIT 1`,
    [adminUserId]
  );
  const adminRow = adminRes.rows[0];
  if (!adminRow || normalizeRole(adminRow.role) !== SYSTEM_ROLES.ADMIN) {
    throw new PurgeValidationError("Only admin can permanently delete data", 403);
  }
  const ok = await bcrypt.compare(String(password), adminRow.password_hash || "");
  if (!ok) {
    throw new PurgeValidationError("Admin current password is incorrect");
  }
};

const listStudentsForPurge = async ({ includeDeleted = true } = {}) => {
  const result = await pool.query(
    `
      SELECT
        s.id,
        s.name,
        s.father_name,
        s.phone,
        s.status,
        s.deleted_at,
        c.name AS class_name,
        sec.name AS section_name
      FROM students s
      LEFT JOIN classes c ON c.id = s.current_class_id
      LEFT JOIN sections sec ON sec.id = s.current_section_id
      ${includeDeleted ? "" : "WHERE s.deleted_at IS NULL"}
      ORDER BY s.name ASC, s.id ASC
    `
  );
  return result.rows;
};

const getStudentPurgePreview = async (studentId) => {
  const stud = await pool.query(
    `
      SELECT s.id, s.name, s.father_name, s.deleted_at, c.name AS class_name
      FROM students s
      LEFT JOIN classes c ON c.id = s.current_class_id
      WHERE s.id = $1
      LIMIT 1
    `,
    [studentId]
  );
  if (!stud.rows[0]) {
    throw new PurgeValidationError("Student not found", 404);
  }

  const counts = {};
  const countQueries = [
    ["payments", `SELECT COUNT(*)::int AS n FROM payments WHERE student_id = $1`, [studentId]],
    ["challans", `SELECT COUNT(*)::int AS n FROM challans WHERE student_id = $1`, [studentId]],
    [
      "fee_assignments",
      `SELECT COUNT(*)::int AS n FROM student_fee_assignments WHERE student_id = $1`,
      [studentId],
    ],
    [
      "academic_history",
      `SELECT COUNT(*)::int AS n FROM student_academic_history WHERE student_id = $1`,
      [studentId],
    ],
    ["alumni", `SELECT COUNT(*)::int AS n FROM alumni WHERE student_id = $1`, [studentId]],
  ];

  for (const [key, sql, params] of countQueries) {
    try {
      const r = await pool.query(sql, params);
      counts[key] = Number(r.rows[0]?.n ?? 0);
    } catch (error) {
      if (error?.code === "42P01") {
        counts[key] = 0;
      } else {
        throw error;
      }
    }
  }

  if (await tableExists(pool, "payment_allocations")) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM payment_allocations WHERE student_id = $1`,
      [studentId]
    );
    counts.payment_allocations = Number(r.rows[0]?.n ?? 0);
  }

  return { student: stud.rows[0], counts };
};

const purgeStudentPermanent = async ({ adminUserId, adminCurrentPassword, studentId, confirmName }) => {
  await assertAdminPassword(adminUserId, adminCurrentPassword);

  const preview = await getStudentPurgePreview(studentId);
  const expectedName = String(preview.student.name || "").trim();
  if (!expectedName) {
    throw new PurgeValidationError("Student has no name to confirm");
  }
  if (String(confirmName || "").trim() !== expectedName) {
    throw new PurgeValidationError("Confirmation name does not match the student name");
  }

  const client = await pool.connect();
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;

    const del = await client.query(`DELETE FROM students WHERE id = $1 RETURNING id`, [studentId]);
    if (!del.rows[0]) {
      throw new PurgeValidationError("Student not found", 404);
    }

    await client.query("COMMIT");
    return {
      deleted: true,
      student_id: studentId,
      message: "Student and all linked financial records were permanently removed.",
    };
  } catch (error) {
    if (began) await client.query("ROLLBACK");
    if (error instanceof PurgeValidationError) throw error;
    throw new PurgeValidationError(error.message || "Failed to permanently delete student");
  } finally {
    client.release();
  }
};

const purgeSoftDeletedStudents = async ({ adminUserId, adminCurrentPassword, confirmPhrase }) => {
  await assertAdminPassword(adminUserId, adminCurrentPassword);
  if (String(confirmPhrase || "").trim() !== "DELETE ALL") {
    throw new PurgeValidationError('Type exactly "DELETE ALL" to confirm bulk permanent delete');
  }

  const idsRes = await pool.query(
    `SELECT id FROM students WHERE deleted_at IS NOT NULL ORDER BY id ASC`
  );
  const ids = idsRes.rows.map((r) => r.id);
  if (!ids.length) {
    return { deleted_count: 0, message: "No soft-deleted students to remove." };
  }

  const client = await pool.connect();
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;
    const del = await client.query(`DELETE FROM students WHERE deleted_at IS NOT NULL RETURNING id`);
    await client.query("COMMIT");
    return {
      deleted_count: del.rows.length,
      message: `Permanently removed ${del.rows.length} soft-deleted student(s) and their linked records.`,
    };
  } catch (error) {
    if (began) await client.query("ROLLBACK");
    throw new PurgeValidationError(error.message || "Failed to bulk delete students");
  } finally {
    client.release();
  }
};

const listClassesForPurge = async () => {
  const result = await pool.query(
    `
      SELECT
        c.id,
        c.name,
        c.deleted_at,
        (
          SELECT COUNT(*)::int
          FROM students s
          WHERE s.current_class_id = c.id
        ) AS student_count
      FROM classes c
      ORDER BY c.name ASC
    `
  );
  return result.rows;
};

const purgeClassPermanent = async ({ adminUserId, adminCurrentPassword, classId, confirmPhrase }) => {
  await assertAdminPassword(adminUserId, adminCurrentPassword);
  if (String(confirmPhrase || "").trim() !== "DELETE") {
    throw new PurgeValidationError('Type exactly "DELETE" to confirm permanent class removal');
  }

  const classRes = await pool.query(`SELECT id, name FROM classes WHERE id = $1 LIMIT 1`, [classId]);
  if (!classRes.rows[0]) {
    throw new PurgeValidationError("Class not found", 404);
  }

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM students WHERE current_class_id = $1`,
    [classId]
  );
  if (Number(countRes.rows[0]?.n ?? 0) > 0) {
    throw new PurgeValidationError(
      "Cannot permanently delete this class while any student (active or archived) is assigned to it. Permanently delete those students first."
    );
  }

  const client = await pool.connect();
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;

    if (await tableExists(client, "fee_structures")) {
      await client.query(`DELETE FROM fee_structures WHERE class_id = $1`, [classId]);
    }
    if (await tableExists(client, "class_fee_billing_config")) {
      await client.query(`DELETE FROM class_fee_billing_config WHERE class_id = $1`, [classId]);
    }
    if (await tableExists(client, "fee_advance_links")) {
      await client.query(`DELETE FROM fee_advance_links WHERE class_id = $1`, [classId]);
    }
    if (await tableExists(client, "class_fee_components")) {
      await client.query(`DELETE FROM class_fee_components WHERE class_id = $1`, [classId]);
    }
    await client.query(`DELETE FROM sections WHERE class_id = $1`, [classId]);
    const del = await client.query(`DELETE FROM classes WHERE id = $1 RETURNING id`, [classId]);
    if (!del.rows[0]) {
      throw new PurgeValidationError("Class not found", 404);
    }

    await client.query("COMMIT");
    return {
      deleted: true,
      class_id: classId,
      message: `Class "${classRes.rows[0].name}" and its fee setup were permanently removed.`,
    };
  } catch (error) {
    if (began) await client.query("ROLLBACK");
    if (error instanceof PurgeValidationError) throw error;
    throw new PurgeValidationError(error.message || "Failed to permanently delete class");
  } finally {
    client.release();
  }
};

const listSectionsForPurge = async (classId) => {
  if (!classId) {
    throw new PurgeValidationError("class_id is required");
  }
  const result = await pool.query(
    `
      SELECT
        sec.id,
        sec.name,
        sec.class_id,
        sec.deleted_at,
        (
          SELECT COUNT(*)::int
          FROM students s
          WHERE s.current_section_id = sec.id
        ) AS student_count
      FROM sections sec
      WHERE sec.class_id = $1
      ORDER BY sec.name ASC
    `,
    [classId]
  );
  return result.rows;
};

const purgeSectionPermanent = async ({ adminUserId, adminCurrentPassword, sectionId, confirmPhrase }) => {
  await assertAdminPassword(adminUserId, adminCurrentPassword);
  if (String(confirmPhrase || "").trim() !== "DELETE") {
    throw new PurgeValidationError('Type exactly "DELETE" to confirm permanent section removal');
  }

  const secRes = await pool.query(
    `SELECT id, name, class_id FROM sections WHERE id = $1 LIMIT 1`,
    [sectionId]
  );
  if (!secRes.rows[0]) {
    throw new PurgeValidationError("Section not found", 404);
  }

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM students WHERE current_section_id = $1`,
    [sectionId]
  );
  if (Number(countRes.rows[0]?.n ?? 0) > 0) {
    throw new PurgeValidationError(
      "Cannot permanently delete this section while any student is assigned to it."
    );
  }

  const del = await pool.query(`DELETE FROM sections WHERE id = $1 RETURNING id`, [sectionId]);
  if (!del.rows[0]) {
    throw new PurgeValidationError("Section not found", 404);
  }

  return {
    deleted: true,
    section_id: sectionId,
    message: `Section "${secRes.rows[0].name}" was permanently removed.`,
  };
};

module.exports = {
  listStudentsForPurge,
  getStudentPurgePreview,
  purgeStudentPermanent,
  purgeSoftDeletedStudents,
  listClassesForPurge,
  purgeClassPermanent,
  listSectionsForPurge,
  purgeSectionPermanent,
  PurgeValidationError,
};
