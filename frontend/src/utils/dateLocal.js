/**
 * `YYYY-MM-DD` for `<input type="date">` using the PC's local calendar (not UTC).
 */
export function localDateInputValue(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    const n = new Date();
    const y = n.getFullYear();
    const m = String(n.getMonth() + 1).padStart(2, "0");
    const day = String(n.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Value for date inputs from API / DB (handles `YYYY-MM-DD` without UTC day shift).
 */
export function toDateInputValue(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : localDateInputValue(value);
  }
  const s = String(value).trim();
  const isoDay = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (isoDay) return isoDay[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return localDateInputValue(d);
}
