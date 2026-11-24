const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const pool = require("../config/db");

const APP_VERSION = process.env.APP_VERSION || "0.1.0";
const MAX_LOGO_CHARS = 2_500_000;

const DEFAULTS = {
  school_name: "ISLAMIA MODEL SCHOOL",
  school_name_line2: "AND COLLEGE",
  address_line1: "CAMPUS KHARICK RAWALAKOT , AJK",
  address_line2: "",
  phone: "03125051520",
  academic_year: "",
  bank_name: "Easypaisa Bank Limited (For Online)",
  bank_account_no: "03408107933",
  fine_type: "percent",
  fine_value: 0,
  logo_data: null,
  logo_mime: null,
};

class SettingsValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "SettingsValidationError";
    this.statusCode = statusCode;
  }
}

let schemaReady = false;

const ensureSchema = async () => {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      school_name TEXT NOT NULL DEFAULT '',
      school_name_line2 TEXT NOT NULL DEFAULT '',
      address_line1 TEXT NOT NULL DEFAULT '',
      address_line2 TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      academic_year TEXT NOT NULL DEFAULT '',
      bank_name TEXT NOT NULL DEFAULT '',
      bank_account_no TEXT NOT NULL DEFAULT '',
      logo_data TEXT NULL,
      logo_mime TEXT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    INSERT INTO app_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS fine_type TEXT NOT NULL DEFAULT 'percent'`);
  await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS fine_value NUMERIC(12, 2) NOT NULL DEFAULT 0`);
  schemaReady = true;
};

const rowToSettings = (row) => {
  if (!row) {
    return { ...DEFAULTS, updated_at: null };
  }
  const fineType = String(row.fine_type || DEFAULTS.fine_type).toLowerCase() === "amount" ? "amount" : "percent";
  const fineRaw = Number(row.fine_value);
  const fineValue = Number.isFinite(fineRaw) && fineRaw >= 0 ? Math.round(fineRaw * 100) / 100 : 0;

  return {
    school_name: row.school_name || DEFAULTS.school_name,
    school_name_line2: row.school_name_line2 || "",
    address_line1: row.address_line1 || "",
    address_line2: row.address_line2 || "",
    phone: row.phone || "",
    academic_year: row.academic_year || "",
    bank_name: row.bank_name || DEFAULTS.bank_name,
    bank_account_no: row.bank_account_no || DEFAULTS.bank_account_no,
    fine_type: fineType,
    fine_value: fineValue,
    logo_data: row.logo_data || null,
    logo_mime: row.logo_mime || null,
    updated_at: row.updated_at || null,
  };
};

const getSettings = async () => {
  await ensureSchema();
  const result = await pool.query(`SELECT * FROM app_settings WHERE id = 1 LIMIT 1`);
  return rowToSettings(result.rows[0]);
};

const pickString = (value, fallback = "") => {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
};

const updateSettings = async (payload = {}) => {
  await ensureSchema();
  const current = await getSettings();

  const fineTypeRaw = payload.fine_type !== undefined ? payload.fine_type : current.fine_type;
  const fine_type = String(fineTypeRaw || "percent").toLowerCase() === "amount" ? "amount" : "percent";
  const fineValueRaw =
    payload.fine_value !== undefined && payload.fine_value !== null
      ? Number(payload.fine_value)
      : Number(current.fine_value);
  if (!Number.isFinite(fineValueRaw) || fineValueRaw < 0) {
    throw new SettingsValidationError("Fine value must be a number 0 or greater");
  }
  const fine_value = Math.round(fineValueRaw * 100) / 100;

  const next = {
    school_name: pickString(payload.school_name, current.school_name),
    school_name_line2: pickString(payload.school_name_line2, current.school_name_line2),
    address_line1: pickString(payload.address_line1, current.address_line1),
    address_line2: pickString(payload.address_line2, current.address_line2),
    phone: pickString(payload.phone, current.phone),
    academic_year: pickString(payload.academic_year, current.academic_year),
    bank_name: pickString(payload.bank_name, current.bank_name),
    bank_account_no: pickString(payload.bank_account_no, current.bank_account_no),
    fine_type,
    fine_value,
  };

  if (!next.school_name) {
    throw new SettingsValidationError("School name is required");
  }

  const result = await pool.query(
    `
      UPDATE app_settings
      SET
        school_name = $1,
        school_name_line2 = $2,
        address_line1 = $3,
        address_line2 = $4,
        phone = $5,
        academic_year = $6,
        bank_name = $7,
        bank_account_no = $8,
        fine_type = $9,
        fine_value = $10,
        updated_at = NOW()
      WHERE id = 1
      RETURNING *
    `,
    [
      next.school_name,
      next.school_name_line2,
      next.address_line1,
      next.address_line2,
      next.phone,
      next.academic_year,
      next.bank_name,
      next.bank_account_no,
      next.fine_type,
      next.fine_value,
    ]
  );

  return rowToSettings(result.rows[0]);
};

const updateLogo = async ({ logo_data, logo_mime }) => {
  await ensureSchema();
  const data = logo_data == null ? null : String(logo_data);
  if (data && data.length > MAX_LOGO_CHARS) {
    throw new SettingsValidationError("Logo file is too large. Use an image under about 1.5 MB.");
  }
  if (data && !/^data:image\//i.test(data) && !logo_mime) {
    throw new SettingsValidationError("Logo must be an image file.");
  }

  const result = await pool.query(
    `
      UPDATE app_settings
      SET
        logo_data = $1,
        logo_mime = $2,
        updated_at = NOW()
      WHERE id = 1
      RETURNING *
    `,
    [data, logo_mime ? String(logo_mime) : null]
  );

  return rowToSettings(result.rows[0]);
};

const clearLogo = async () => updateLogo({ logo_data: null, logo_mime: null });

const getAbout = () => ({
  app_name: "FEE ERP",
  version: APP_VERSION,
  description: "School fee management",
});

const dbEnv = () => ({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "127.0.0.1",
  database: process.env.DB_NAME || "postgres",
  password: process.env.DB_PASSWORD || "",
  port: String(process.env.DB_PORT || 5432),
});

const toolCache = new Map();

const listCandidateBinDirs = () => {
  const dirs = [];
  const push = (dir) => {
    if (dir && !dirs.includes(dir)) dirs.push(dir);
  };

  if (process.env.PG_BIN) push(process.env.PG_BIN);
  if (process.env.POSTGRES_BIN) push(process.env.POSTGRES_BIN);
  if (process.env.PostgreSQL_ROOT) {
    push(path.join(process.env.PostgreSQL_ROOT, "bin"));
  }

  const programFiles = [
    process.env["ProgramFiles"],
    process.env["ProgramFiles(x86)"],
    "C:\\Program Files",
    "C:\\Program Files (x86)",
  ].filter(Boolean);

  for (const root of programFiles) {
    const pgRoot = path.join(root, "PostgreSQL");
    if (!fs.existsSync(pgRoot)) continue;
    let versions = [];
    try {
      versions = fs
        .readdirSync(pgRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => Number(b) - Number(a) || String(b).localeCompare(String(a)));
    } catch {
      versions = [];
    }
    for (const version of versions) {
      push(path.join(pgRoot, version, "bin"));
    }
  }

  // Common single-folder installs / portable layouts
  push("C:\\PostgreSQL\\bin");
  push("C:\\pgsql\\bin");

  return dirs;
};

const resolvePgTool = (toolName) => {
  const exe = process.platform === "win32" ? `${toolName}.exe` : toolName;
  if (toolCache.has(exe)) return toolCache.get(exe);

  // 1) Explicit full path override, e.g. PG_DUMP=C:\...\pg_dump.exe
  const envKey = toolName === "pg_dump" ? "PG_DUMP" : toolName === "psql" ? "PG_PSQL" : null;
  if (envKey && process.env[envKey] && fs.existsSync(process.env[envKey])) {
    toolCache.set(exe, process.env[envKey]);
    return process.env[envKey];
  }

  // 2) Search usual PostgreSQL bin folders (works even when PATH has no pg_dump)
  for (const dir of listCandidateBinDirs()) {
    const full = path.join(dir, exe);
    if (fs.existsSync(full)) {
      toolCache.set(exe, full);
      return full;
    }
  }

  // 3) Fall back to bare command name (PATH)
  toolCache.set(exe, toolName);
  return toolName;
};

const runPgTool = (toolName, args, { input, env } = {}) => {
  const command = resolvePgTool(toolName);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...(env || {}) },
      windowsHide: true,
    });
    const chunks = [];
    const errChunks = [];
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => errChunks.push(d));
    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(
          new SettingsValidationError(
            `${toolName} was not found. Install PostgreSQL (Server) on this PC, or set PG_BIN to the PostgreSQL bin folder (example: C:\\Program Files\\PostgreSQL\\13\\bin).`,
            500
          )
        );
        return;
      }
      reject(err);
    });
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
    child.on("close", (code) => {
      const stderr = Buffer.concat(errChunks).toString("utf8");
      if (code !== 0) {
        reject(
          new SettingsValidationError(
            stderr.trim() || `${toolName} failed with exit code ${code}`,
            500
          )
        );
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
};

const createBackup = async () => {
  const db = dbEnv();
  const args = [
    "-h",
    db.host,
    "-p",
    db.port,
    "-U",
    db.user,
    "-d",
    db.database,
    "--no-owner",
    "--no-acl",
    "--clean",
    "--if-exists",
  ];
  const buffer = await runPgTool("pg_dump", args, {
    env: { PGPASSWORD: db.password },
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return {
    filename: `fee-erp-backup-${stamp}.sql`,
    mime: "application/sql",
    content: buffer.toString("utf8"),
  };
};

const restoreBackup = async (sqlText) => {
  const sql = String(sqlText || "").trim();
  if (!sql) {
    throw new SettingsValidationError("Backup file is empty.");
  }
  if (sql.length > 80_000_000) {
    throw new SettingsValidationError("Backup file is too large.");
  }

  const db = dbEnv();
  const tmpPath = path.join(os.tmpdir(), `fee-erp-restore-${Date.now()}.sql`);
  try {
    fs.writeFileSync(tmpPath, sql, "utf8");
    await runPgTool(
      "psql",
      ["-h", db.host, "-p", db.port, "-U", db.user, "-d", db.database, "-v", "ON_ERROR_STOP=1", "-f", tmpPath],
      { env: { PGPASSWORD: db.password } }
    );
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }

  schemaReady = false;
  await ensureSchema();
  return { message: "Database restored successfully. Refresh the app." };
};

module.exports = {
  ensureSchema,
  getSettings,
  updateSettings,
  updateLogo,
  clearLogo,
  getAbout,
  createBackup,
  restoreBackup,
  SettingsValidationError,
  DEFAULTS,
};
