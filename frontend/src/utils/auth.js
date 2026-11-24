export function getStoredUser() {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function clearAuth() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export function normalizeRole(role) {
  const r = String(role || "").toLowerCase();
  if (r === "staff") return "accountant";
  return r;
}

export function isAdmin() {
  return normalizeRole(getStoredUser()?.role) === "admin";
}

export function isAccountant() {
  return normalizeRole(getStoredUser()?.role) === "accountant";
}

export function formatUserRole(role) {
  const r = normalizeRole(role);
  if (r === "admin") return "Admin";
  if (r === "accountant") return "Accountant";
  return role ? String(role) : "User";
}

export function defaultPathForRole(role) {
  return normalizeRole(role) === "admin" ? "/" : "/students";
}
