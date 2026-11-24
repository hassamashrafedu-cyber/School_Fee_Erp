const DEFAULT_API_BASE = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000/api";
const STORAGE_KEY = "feeerp.apiBaseUrl";

export function getDefaultApiBaseUrl() {
  return DEFAULT_API_BASE;
}

export function getStoredApiBaseUrl() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return "";
    return String(raw).trim();
  } catch {
    return "";
  }
}

export function getActiveApiBaseUrl() {
  return getStoredApiBaseUrl() || getDefaultApiBaseUrl();
}

export function setStoredApiBaseUrl(url) {
  const value = String(url || "").trim();
  if (!value) {
    clearStoredApiBaseUrl();
    return getDefaultApiBaseUrl();
  }
  localStorage.setItem(STORAGE_KEY, value.replace(/\/+$/, ""));
  return getActiveApiBaseUrl();
}

export function clearStoredApiBaseUrl() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return getDefaultApiBaseUrl();
}

export function normalizeApiBaseUrl(input) {
  let value = String(input || "").trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) {
    value = `http://${value}`;
  }
  value = value.replace(/\/+$/, "");
  if (!/\/api$/i.test(value)) {
    value = `${value}/api`;
  }
  return value;
}
