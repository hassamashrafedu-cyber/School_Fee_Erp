const pool = require("./db");

const seed = async () => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const instituteResult = await client.query(
      `
        INSERT INTO institutes (name)
        VALUES ($1)
        RETURNING id
      `,
      ["Test Institute"]
    );
    const instituteId = instituteResult.rows[0].id;
    console.log("Inserted institute id:", instituteId);

    const campusResult = await client.query(
      `
        INSERT INTO campuses (institute_id, name, gender_type)
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [instituteId, "Main Campus", "boys"]
    );
    const campusId = campusResult.rows[0].id;
    console.log("Inserted campus id:", campusId);

    // Only one academic year may be active at a time (partial unique index).
    await client.query(`UPDATE academic_years SET is_active = FALSE WHERE is_active = TRUE`);

    const academicYearResult = await client.query(
      `
        INSERT INTO academic_years (name, start_date, end_date, is_active)
        VALUES ($1, $2, $3, TRUE)
        RETURNING id
      `,
      ["2025-2026", "2025-01-01", "2026-01-01"]
    );
    const academicYearId = academicYearResult.rows[0].id;
    console.log("Inserted academic_year id:", academicYearId);

    const classResult = await client.query(
      `
        INSERT INTO classes (name, level)
        VALUES ($1, $2)
        RETURNING id
      `,
      ["10th", "school"]
    );
    const classId = classResult.rows[0].id;
    console.log("Inserted class id:", classId);

    const sectionResult = await client.query(
      `
        INSERT INTO sections (class_id, name)
        VALUES ($1, $2)
        RETURNING id
      `,
      [classId, "A"]
    );
    const sectionId = sectionResult.rows[0].id;
    console.log("Inserted section id:", sectionId);

    await client.query("COMMIT");
    console.log("Seed completed successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

seed();
