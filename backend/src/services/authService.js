const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

class AuthValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthValidationError";
  }
}

const SYSTEM_ROLES = Object.freeze({
  ADMIN: "admin",
  ACCOUNTANT: "accountant",
});

const SYSTEM_USERS = [
  { phone: "admin", role: SYSTEM_ROLES.ADMIN, name: "Admin" },
  { phone: "accountant", role: SYSTEM_ROLES.ACCOUNTANT, name: "Accountant" },
];

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    const err = new AuthValidationError("JWT_SECRET is not configured");
    err.statusCode = 500;
    throw err;
  }
  return secret;
};

const getJwtExpiresIn = () => process.env.JWT_EXPIRES_IN || "1d";

const normalizeRole = (role) => {
  const r = String(role || "").trim().toLowerCase();
  if (r === "staff") return SYSTEM_ROLES.ACCOUNTANT;
  if (r === SYSTEM_ROLES.ADMIN || r === SYSTEM_ROLES.ACCOUNTANT) return r;
  return "";
};

const defaultPasswordForRole = (role) => {
  if (role === SYSTEM_ROLES.ADMIN) {
    return process.env.DEFAULT_ADMIN_PASSWORD || "admin123";
  }
  if (role === SYSTEM_ROLES.ACCOUNTANT) {
    return process.env.DEFAULT_ACCOUNTANT_PASSWORD || "accountant123";
  }
  return null;
};

/** Ensures exactly one Admin and one Accountant exist (offline school setup). */
const ensureSystemUsers = async () => {
  await pool.query(`UPDATE users SET role = $1 WHERE role = 'staff'`, [SYSTEM_ROLES.ACCOUNTANT]);

  for (const spec of SYSTEM_USERS) {
    const byRole = await pool.query(
      `
        SELECT id, phone, password_hash, role
        FROM users
        WHERE lower(role) = $1
        ORDER BY id ASC
        LIMIT 1
      `,
      [spec.role]
    );

    if (!byRole.rows[0]) {
      const initialPassword = defaultPasswordForRole(spec.role);
      const hashedPassword = await bcrypt.hash(String(initialPassword), 10);
      await pool.query(
        `
          INSERT INTO users (name, phone, password_hash, role)
          VALUES ($1, $2, $3, $4)
        `,
        [spec.name, spec.phone, hashedPassword, spec.role]
      );
      continue;
    }

    const row = byRole.rows[0];
    if (String(row.phone || "").trim().toLowerCase() !== spec.phone) {
      await pool.query(`UPDATE users SET phone = $1, name = $2 WHERE id = $3`, [spec.phone, spec.name, row.id]);
    }
  }
};

const loginByRole = async (role, password) => {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) {
    throw new AuthValidationError("role must be admin or accountant");
  }
  if (!password) {
    throw new AuthValidationError("password is required");
  }

  await ensureSystemUsers();

  const result = await pool.query(
    `
      SELECT id, name, phone, password_hash, role
      FROM users
      WHERE lower(role) = $1
      ORDER BY id ASC
      LIMIT 1
    `,
    [normalizedRole]
  );

  const user = result.rows[0];
  const invalidLogin = () => {
    const err = new AuthValidationError("Invalid role or password");
    err.statusCode = 401;
    throw err;
  };

  if (!user || !user.password_hash) {
    invalidLogin();
  }

  const passwordOk = await bcrypt.compare(String(password), user.password_hash);
  if (!passwordOk) {
    invalidLogin();
  }

  const token = jwt.sign(
    { id: user.id, role: normalizeRole(user.role) },
    getJwtSecret(),
    { expiresIn: getJwtExpiresIn() }
  );

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: normalizeRole(user.role),
    },
  };
};

/** Admin only: change Admin or Accountant password (option A — only in Settings). */
const changeRolePassword = async ({ adminUserId, adminCurrentPassword, targetRole, newPassword }) => {
  const normalizedTarget = normalizeRole(targetRole);
  if (!normalizedTarget) {
    throw new AuthValidationError("target_role must be admin or accountant");
  }
  if (!adminCurrentPassword) {
    throw new AuthValidationError("admin_current_password is required");
  }
  if (!newPassword || String(newPassword).length < 6) {
    throw new AuthValidationError("new_password must be at least 6 characters");
  }

  const adminRes = await pool.query(
    `
      SELECT id, password_hash, role
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [adminUserId]
  );
  const adminRow = adminRes.rows[0];
  if (!adminRow || normalizeRole(adminRow.role) !== SYSTEM_ROLES.ADMIN) {
    const err = new AuthValidationError("Only admin can change passwords");
    err.statusCode = 403;
    throw err;
  }

  const adminOk = await bcrypt.compare(String(adminCurrentPassword), adminRow.password_hash || "");
  if (!adminOk) {
    throw new AuthValidationError("Admin current password is incorrect");
  }

  const targetRes = await pool.query(
    `
      SELECT id
      FROM users
      WHERE lower(role) = $1
      ORDER BY id ASC
      LIMIT 1
    `,
    [normalizedTarget]
  );
  if (!targetRes.rows[0]) {
    throw new AuthValidationError("Target user not found");
  }

  const hashedPassword = await bcrypt.hash(String(newPassword), 10);
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
    hashedPassword,
    targetRes.rows[0].id,
  ]);

  return { role: normalizedTarget, updated: true };
};

module.exports = {
  ensureSystemUsers,
  loginByRole,
  changeRolePassword,
  normalizeRole,
  SYSTEM_ROLES,
};

module.exports.AuthValidationError = AuthValidationError;
