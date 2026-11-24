/**
 * Dashboard snapshot cache: warm on startup, serve instantly, patch on student-level changes.
 * Full rebuild only for class-wide fee / promotion / purge style changes.
 */

const pool = require("../config/db");
const reportService = require("./reportService");
const feeLedgerService = require("./feeLedgerService");

let schemaReady = null;
let writeChain = Promise.resolve();
let warmPromise = null;
let rebuildQueued = false;
let rebuildRunning = false;

const log = (msg, err) => {
  // eslint-disable-next-line no-console
  console.error(`[dashboard-snapshot] ${msg}`, err?.message || err || "");
};

const withWriteLock = (fn) => {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
};

const ensureSchema = async () => {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dashboard_snapshots (
        month integer NOT NULL,
        year integer NOT NULL,
        class_key text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT NOW(),
        PRIMARY KEY (month, year, class_key)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dashboard_student_contrib (
        month integer NOT NULL,
        year integer NOT NULL,
        class_key text NOT NULL,
        student_id uuid NOT NULL,
        contrib jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT NOW(),
        PRIMARY KEY (month, year, class_key, student_id)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS dashboard_student_contrib_student_idx
      ON dashboard_student_contrib (student_id)
    `);
  })().catch((err) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
};

const normalizeClassKey = (classParam) => reportService.normalizeClassFilter(classParam);

const emptyContrib = () => ({
  student_id: null,
  class_id: null,
  gender: "",
  current_due: 0,
  total_year_due: 0,
  previous_year_total_due: 0,
  month_fee: 0,
  month_status: "neutral",
});

const toNum = (v) => Math.round(Number(v || 0));

const applyPaidPartialDelta = (strength, gender, oldC, newC, sign) => {
  const applyOne = (c, s) => {
    if (!c || toNum(c.month_fee) <= 0) return;
    const paid = c.month_status === "paid";
    if (paid) {
      strength.paid_students = Math.max(0, (strength.paid_students || 0) + s);
      if (gender === "male") strength.male_paid = Math.max(0, (strength.male_paid || 0) + s);
      else if (gender === "female") strength.female_paid = Math.max(0, (strength.female_paid || 0) + s);
    } else {
      strength.partial_students = Math.max(0, (strength.partial_students || 0) + s);
      if (gender === "male") strength.male_partial = Math.max(0, (strength.male_partial || 0) + s);
      else if (gender === "female") strength.female_partial = Math.max(0, (strength.female_partial || 0) + s);
    }
  };
  if (oldC) applyOne(oldC, -sign);
  if (newC) applyOne(newC, sign);
};

const patchStrengthForStudent = (payload, oldC, newC) => {
  const strength = payload.strength || (payload.strength = {});
  const oldPresent = Boolean(oldC);
  const newPresent = Boolean(newC);
  const oldGender = String(oldC?.gender || "").toLowerCase();
  const newGender = String(newC?.gender || "").toLowerCase();

  if (oldPresent && !newPresent) {
    strength.total_students = Math.max(0, (strength.total_students || 0) - 1);
    if (oldGender === "male") strength.total_males = Math.max(0, (strength.total_males || 0) - 1);
    else if (oldGender === "female") strength.total_females = Math.max(0, (strength.total_females || 0) - 1);
    applyPaidPartialDelta(strength, oldGender, oldC, null, 1);
  } else if (!oldPresent && newPresent) {
    strength.total_students = (strength.total_students || 0) + 1;
    if (newGender === "male") strength.total_males = (strength.total_males || 0) + 1;
    else if (newGender === "female") strength.total_females = (strength.total_females || 0) + 1;
    applyPaidPartialDelta(strength, newGender, null, newC, 1);
  } else if (oldPresent && newPresent) {
    if (oldGender !== newGender) {
      if (oldGender === "male") strength.total_males = Math.max(0, (strength.total_males || 0) - 1);
      else if (oldGender === "female") strength.total_females = Math.max(0, (strength.total_females || 0) - 1);
      if (newGender === "male") strength.total_males = (strength.total_males || 0) + 1;
      else if (newGender === "female") strength.total_females = (strength.total_females || 0) + 1;
    }
    applyPaidPartialDelta(strength, oldGender, oldC, null, 1);
    applyPaidPartialDelta(strength, newGender, null, newC, 1);
  }

  strength.students_with_month_fee = (strength.paid_students || 0) + (strength.partial_students || 0);
};

const patchDues = (payload, oldC, newC) => {
  const dues = payload.dues || (payload.dues = {});
  const o = oldC || emptyContrib();
  const n = newC || emptyContrib();
  dues.current_due_total = Math.max(0, toNum(dues.current_due_total) - toNum(o.current_due) + toNum(n.current_due));
  dues.total_year_due = Math.max(0, toNum(dues.total_year_due) - toNum(o.total_year_due) + toNum(n.total_year_due));
  dues.previous_year_total_due = Math.max(
    0,
    toNum(dues.previous_year_total_due) - toNum(o.previous_year_total_due) + toNum(n.previous_year_total_due)
  );
};

/**
 * Rebuild pending_by_class + class_fee_status + top_defaulters from live student contribs
 * so charts stay in sync after delta patches.
 */
const syncPendingByClassFromContribs = async (payload, month, year, classKey) => {
  if (!payload || typeof payload !== "object") return payload;
  const result = await pool.query(
    `
      SELECT contrib
      FROM dashboard_student_contrib
      WHERE month = $1
        AND year = $2
        AND class_key = $3
    `,
    [month, year, classKey]
  );

  const nameById = new Map(
    (payload.charts?.class_gender_strength || []).map((r) => [String(r.class_id), r.class_name])
  );

  const pendingByClassMap = new Map();
  const classFeeStatusMap = new Map();

  for (const row of result.rows) {
    const c = typeof row.contrib === "string" ? JSON.parse(row.contrib) : row.contrib || {};
    const classId = c.class_id;
    if (!classId) continue;
    const key = String(classId);
    const due = toNum(c.current_due);
    if (due > 0) {
      const pending = pendingByClassMap.get(key) || { class_id: classId, total: 0 };
      pending.total += due;
      pendingByClassMap.set(key, pending);
    }

    const feeRow =
      classFeeStatusMap.get(key) ||
      ({
        class_id: classId,
        total_students: 0,
        male_students: 0,
        female_students: 0,
        paid: 0,
        partial: 0,
        male_paid: 0,
        male_partial: 0,
        female_paid: 0,
        female_partial: 0,
      });
    feeRow.total_students += 1;
    const g = String(c.gender || "").toLowerCase();
    if (g === "male") feeRow.male_students += 1;
    else if (g === "female") feeRow.female_students += 1;
    if (toNum(c.month_fee) > 0) {
      const isPaid = c.month_status === "paid";
      if (isPaid) {
        feeRow.paid += 1;
        if (g === "male") feeRow.male_paid += 1;
        else if (g === "female") feeRow.female_paid += 1;
      } else {
        feeRow.partial += 1;
        if (g === "male") feeRow.male_partial += 1;
        else if (g === "female") feeRow.female_partial += 1;
      }
    }
    classFeeStatusMap.set(key, feeRow);
  }

  const pendingByClass = [...pendingByClassMap.values()]
    .map((row) => ({
      class_id: row.class_id,
      class_name: nameById.get(String(row.class_id)) || "Class",
      total: toNum(row.total),
    }))
    .sort((a, b) => b.total - a.total || String(a.class_name).localeCompare(String(b.class_name)));

  const classFeeStatus = [...classFeeStatusMap.values()]
    .map((row) => ({
      ...row,
      class_name: nameById.get(String(row.class_id)) || "Class",
    }))
    .sort(
      (a, b) =>
        b.total_students - a.total_students ||
        String(a.class_name).localeCompare(String(b.class_name))
    );

  let topRaw = result.rows
    .map((row) => {
      const c = typeof row.contrib === "string" ? JSON.parse(row.contrib) : row.contrib || {};
      return c;
    })
    .filter((c) => toNum(c.total_year_due) > 0)
    .sort(
      (a, b) =>
        toNum(b.total_year_due) - toNum(a.total_year_due) ||
        String(a.student_name || "").localeCompare(String(b.student_name || ""))
    )
    .slice(0, 5);

  // Enrich names for older contribs that predate student_name / class_name fields.
  const missingIds = topRaw
    .filter((c) => !c.student_name || !c.class_name)
    .map((c) => c.student_id)
    .filter(Boolean);
  if (missingIds.length) {
    const nameResult = await pool.query(
      `
        SELECT s.id, s.name AS student_name, c.name AS class_name
        FROM students s
        LEFT JOIN classes c ON c.id = s.current_class_id AND c.deleted_at IS NULL
        WHERE s.id = ANY($1::uuid[])
      `,
      [missingIds]
    );
    const metaById = new Map(
      nameResult.rows.map((r) => [String(r.id), { student_name: r.student_name, class_name: r.class_name }])
    );
    topRaw = topRaw.map((c) => {
      const meta = metaById.get(String(c.student_id));
      if (!meta) return c;
      return {
        ...c,
        student_name: c.student_name || meta.student_name,
        class_name: c.class_name || meta.class_name,
      };
    });
  }

  const topDefaulters = topRaw.map((c) => ({
    student_id: c.student_id,
    student_name: c.student_name || "Student",
    class_name: c.class_name || nameById.get(String(c.class_id)) || "Class",
    remaining: toNum(c.total_year_due),
    current_due: toNum(c.current_due),
  }));

  payload.charts = {
    ...(payload.charts || {}),
    pending_by_class: pendingByClass,
    class_fee_status: classFeeStatus,
    top_defaulters: topDefaulters,
  };

  // Keep KPI pending aligned with the same contrib source
  const sumPending = pendingByClass.reduce((s, r) => s + toNum(r.total), 0);
  if (!payload.dues) payload.dues = {};
  payload.dues.current_due_total = sumPending;

  return payload;
};

const saveSnapshotBundle = async (month, year, classKey, payload, contribs) => {
  await pool.query(
    `
      INSERT INTO dashboard_snapshots (month, year, class_key, payload, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, NOW())
      ON CONFLICT (month, year, class_key)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
    `,
    [month, year, classKey, JSON.stringify(payload)]
  );

  await pool.query(
    `
      DELETE FROM dashboard_student_contrib
      WHERE month = $1 AND year = $2 AND class_key = $3
    `,
    [month, year, classKey]
  );

  if (contribs && contribs.length) {
    const chunkSize = 200;
    for (let start = 0; start < contribs.length; start += chunkSize) {
      const chunk = contribs.slice(start, start + chunkSize);
      const values = [];
      const params = [];
      let i = 1;
      for (const c of chunk) {
        values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}::jsonb, NOW())`);
        params.push(month, year, classKey, c.student_id, JSON.stringify(c));
      }
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `
          INSERT INTO dashboard_student_contrib (month, year, class_key, student_id, contrib, updated_at)
          VALUES ${values.join(", ")}
        `,
        params
      );
    }
  }
};

const readSnapshot = async (month, year, classKey) => {
  const result = await pool.query(
    `
      SELECT payload, updated_at
      FROM dashboard_snapshots
      WHERE month = $1 AND year = $2 AND class_key = $3
    `,
    [month, year, classKey]
  );
  return result.rows[0] || null;
};

const listSnapshots = async () => {
  const result = await pool.query(
    `
      SELECT month, year, class_key, payload
      FROM dashboard_snapshots
      ORDER BY year DESC, month DESC, class_key ASC
    `
  );
  return result.rows;
};

const readContrib = async (month, year, classKey, studentId) => {
  const result = await pool.query(
    `
      SELECT contrib
      FROM dashboard_student_contrib
      WHERE month = $1 AND year = $2 AND class_key = $3 AND student_id = $4
    `,
    [month, year, classKey, studentId]
  );
  return result.rows[0]?.contrib || null;
};

const upsertContrib = async (month, year, classKey, studentId, contrib) => {
  if (!contrib) {
    await pool.query(
      `
        DELETE FROM dashboard_student_contrib
        WHERE month = $1 AND year = $2 AND class_key = $3 AND student_id = $4
      `,
      [month, year, classKey, studentId]
    );
    return;
  }
  await pool.query(
    `
      INSERT INTO dashboard_student_contrib (month, year, class_key, student_id, contrib, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
      ON CONFLICT (month, year, class_key, student_id)
      DO UPDATE SET contrib = EXCLUDED.contrib, updated_at = NOW()
    `,
    [month, year, classKey, studentId, JSON.stringify(contrib)]
  );
};

const rebuildOne = async (month, year, classKey) => {
  const { payload, contribs } = await reportService.buildDashboardSnapshotBundle({
    month,
    year,
    class: classKey,
  });
  await saveSnapshotBundle(month, year, classKey, payload, contribs);
  return payload;
};

const getOrBuildSnapshot = async (month, year, classKey) => {
  await ensureSchema();
  const cached = await readSnapshot(month, year, classKey);
  if (cached?.payload) return cached.payload;

  return withWriteLock(async () => {
    const again = await readSnapshot(month, year, classKey);
    if (again?.payload) return again.payload;
    return rebuildOne(month, year, classKey);
  });
};

/**
 * Public API used by report controller — same response shape as before.
 * Always refreshes finance/SQL parts so collection, expenses, and additional amount
 * stay correct even if an older snapshot was cached.
 */
const getDashboardSummary = async (query = {}) => {
  await ensureSchema();
  const month = Number(query.month);
  const year = Number(query.year);
  const classKey = normalizeClassKey(query.class);
  const payload = await getOrBuildSnapshot(month, year, classKey);
  const live = typeof payload === "object" && payload ? { ...payload } : payload;
  if (live && typeof live === "object") {
    await refreshFastPartsOnPayload(live, month, year, classKey);
    await syncPendingByClassFromContribs(live, month, year, classKey);
  }
  return live;
};

const listActiveClasses = async () => {
  const result = await pool.query(
    `
      SELECT id
      FROM classes
      WHERE deleted_at IS NULL
      ORDER BY name ASC
    `
  );
  return result.rows.map((r) => String(r.id));
};

/**
 * Warm current month/year for All + each class (background).
 */
const warmDefaultSnapshots = async (opts = {}) => {
  await ensureSchema();
  const now = new Date();
  const month = Number(opts.month) || now.getMonth() + 1;
  const year = Number(opts.year) || now.getFullYear();

  if (warmPromise) return warmPromise;

  warmPromise = (async () => {
    const classIds = await listActiveClasses();
    const keys = ["all", ...classIds];
    // eslint-disable-next-line no-console
    console.log(`[dashboard-snapshot] Warming ${keys.length} snapshot(s) for ${month}/${year}…`);
    for (const classKey of keys) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await withWriteLock(() => rebuildOne(month, year, classKey));
      } catch (err) {
        log(`warm failed for class=${classKey}`, err);
      }
    }
    // eslint-disable-next-line no-console
    console.log("[dashboard-snapshot] Warm complete");
  })().finally(() => {
    warmPromise = null;
  });

  return warmPromise;
};

const scheduleWarmDefaultSnapshots = (opts) => {
  setImmediate(() => {
    warmDefaultSnapshots(opts).catch((err) => log("warm error", err));
  });
};

const computeStudentContrib = async (student, month, year) => {
  if (!student || student.deleted_at || student.status !== "active") return null;

  const ledger = await feeLedgerService.computeStudentYearLedger(student, year, {
    current_month: month,
  });
  let previousYearDue = 0;
  const prevYear = year - 1;
  if (prevYear >= 1900) {
    const prev = await feeLedgerService.computeStudentYearLedger(student, prevYear);
    previousYearDue = toNum(prev.total_year_due);
  }
  const cell = (ledger.monthly || []).find((m) => Number(m.month) === Number(month));
  const gender = String(student.gender || "").toLowerCase();
  return {
    student_id: student.id,
    student_name: ledger.student_name || student.student_name || student.name || "Student",
    class_id: student.current_class_id || null,
    class_name: ledger.class_name || student.class_name || null,
    gender,
    current_due: toNum(ledger.current_due),
    total_year_due: toNum(ledger.total_year_due),
    previous_year_total_due: previousYearDue,
    month_fee: toNum(cell?.fee),
    month_status: cell?.status || "neutral",
  };
};

const loadStudentRow = async (studentId, { includeDeleted = false } = {}) => {
  const result = await pool.query(
    `
      SELECT *
      FROM students
      WHERE id = $1
        ${includeDeleted ? "" : "AND deleted_at IS NULL"}
    `,
    [studentId]
  );
  return result.rows[0] || null;
};

const studentBelongsToClassKey = (student, classKey) => {
  if (!student || student.deleted_at || student.status !== "active") return false;
  if (classKey === "all") return true;
  return String(student.current_class_id || "") === String(classKey);
};

const refreshFastPartsOnPayload = async (payload, month, year, classKey) => {
  const fast = await reportService.getDashboardFastParts({ month, year, class: classKey });
  payload.finance = fast.finance;
  payload.concession = fast.concession;
  if (payload.history) delete payload.history;
  payload.charts = {
    ...(payload.charts || {}),
    class_gender_strength: fast.charts.class_gender_strength,
    monthly_profit_trend: fast.charts.monthly_profit_trend,
    yearly_profit_trend: fast.charts.yearly_profit_trend,
  };
};

/**
 * Recompute one student and patch every stored snapshot that includes them.
 */
const notifyStudentLedgerChanged = async (studentId, options = {}) => {
  if (!studentId) return;
  await ensureSchema();

  return withWriteLock(async () => {
    const student = await loadStudentRow(studentId, { includeDeleted: true });
    const snapshots = await listSnapshots();
    if (!snapshots.length) {
      // Nothing warmed yet — warm defaults so next dashboard open is ready.
      scheduleWarmDefaultSnapshots();
      return;
    }

    const removed = Boolean(options.removed) || !student || student.deleted_at || student.status !== "active";

    for (const snap of snapshots) {
      const month = Number(snap.month);
      const year = Number(snap.year);
      const classKey = String(snap.class_key);
      const payload =
        typeof snap.payload === "string" ? JSON.parse(snap.payload) : { ...snap.payload };

      const oldC = await readContrib(month, year, classKey, studentId);
      let newC = null;
      if (!removed && student && studentBelongsToClassKey(student, classKey)) {
        newC = await computeStudentContrib(student, month, year);
      }

      if (!oldC && !newC) {
        // Still refresh finance (payment may affect collection charts).
        await refreshFastPartsOnPayload(payload, month, year, classKey);
        await pool.query(
          `
            UPDATE dashboard_snapshots
            SET payload = $4::jsonb, updated_at = NOW()
            WHERE month = $1 AND year = $2 AND class_key = $3
          `,
          [month, year, classKey, JSON.stringify(payload)]
        );
        continue;
      }

      patchDues(payload, oldC, newC);
      patchStrengthForStudent(payload, oldC, newC);
      await refreshFastPartsOnPayload(payload, month, year, classKey);
      await upsertContrib(month, year, classKey, studentId, newC);
      await syncPendingByClassFromContribs(payload, month, year, classKey);

      await pool.query(
        `
          UPDATE dashboard_snapshots
          SET payload = $4::jsonb, updated_at = NOW()
          WHERE month = $1 AND year = $2 AND class_key = $3
        `,
        [month, year, classKey, JSON.stringify(payload)]
      );
    }
  });
};

const scheduleStudentLedgerChanged = (studentId, options) => {
  setImmediate(() => {
    notifyStudentLedgerChanged(studentId, options).catch((err) => log("delta update failed", err));
  });
};

/**
 * Rebuild all existing snapshot keys (or warm defaults if none).
 * Used after fee structure / promotion / purge.
 */
const rebuildAllSnapshots = async () => {
  await ensureSchema();
  if (rebuildRunning) {
    rebuildQueued = true;
    return;
  }
  rebuildRunning = true;
  try {
    do {
      rebuildQueued = false;
      const existing = await listSnapshots();
      if (!existing.length) {
        await warmDefaultSnapshots();
        continue;
      }
      for (const snap of existing) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await withWriteLock(() => rebuildOne(Number(snap.month), Number(snap.year), String(snap.class_key)));
        } catch (err) {
          log(`rebuild failed ${snap.class_key} ${snap.month}/${snap.year}`, err);
        }
      }
    } while (rebuildQueued);
  } finally {
    rebuildRunning = false;
  }
};

const scheduleFullRebuild = () => {
  setImmediate(() => {
    rebuildAllSnapshots().catch((err) => log("full rebuild failed", err));
  });
};

/**
 * Expense / additional amount: refresh SQL finance parts only (no ledger recompute).
 */
const refreshFinanceSnapshots = async () => {
  await ensureSchema();
  return withWriteLock(async () => {
    const snapshots = await listSnapshots();
    for (const snap of snapshots) {
      const month = Number(snap.month);
      const year = Number(snap.year);
      const classKey = String(snap.class_key);
      const payload =
        typeof snap.payload === "string" ? JSON.parse(snap.payload) : { ...snap.payload };
      // eslint-disable-next-line no-await-in-loop
      await refreshFastPartsOnPayload(payload, month, year, classKey);
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `
          UPDATE dashboard_snapshots
          SET payload = $4::jsonb, updated_at = NOW()
          WHERE month = $1 AND year = $2 AND class_key = $3
        `,
        [month, year, classKey, JSON.stringify(payload)]
      );
    }
  });
};

const scheduleFinanceRefresh = () => {
  setImmediate(() => {
    refreshFinanceSnapshots().catch((err) => log("finance refresh failed", err));
  });
};

module.exports = {
  ensureSchema,
  getDashboardSummary,
  warmDefaultSnapshots,
  scheduleWarmDefaultSnapshots,
  notifyStudentLedgerChanged,
  scheduleStudentLedgerChanged,
  rebuildAllSnapshots,
  scheduleFullRebuild,
  scheduleFinanceRefresh,
};
