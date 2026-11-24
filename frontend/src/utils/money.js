/** Whole rupees only (school-style amounts; no decimal paise). */
export function roundMoney(n) {
  const x = Number(n || 0);
  if (Number.isNaN(x)) return 0;
  return Math.round(x);
}

export function toMoney(num) {
  const r = roundMoney(num);
  return r.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Parse user amount input to a non-negative integer, or NaN if invalid. */
export function parseWholeAmount(str) {
  const s = String(str ?? "").trim();
  if (!s) return NaN;
  if (!/^\d+$/.test(s)) return NaN;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n);
}
