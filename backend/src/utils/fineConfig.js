/** School sets late fine in Settings → Fee Slip Configuration. */
const DEFAULT_FINE_CONFIG = { fine_type: "percent", fine_value: 0 };

const roundMoney = (n) => Math.round(Number(n || 0));

function normalizeFineConfig(config) {
  const type = String(config?.fine_type || DEFAULT_FINE_CONFIG.fine_type).toLowerCase();
  const fine_type = type === "amount" ? "amount" : "percent";
  const raw = Number(config?.fine_value);
  const fine_value =
    Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) / 100 : DEFAULT_FINE_CONFIG.fine_value;
  return { fine_type, fine_value };
}

/**
 * Count of months the late fine applies to:
 * unpaid previous months (remaining > 0) + current fee month (always 1 when challan is issued).
 */
function normalizeFineMonthCount(monthCount) {
  const n = Number(monthCount);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 48);
}

/**
 * @param {number} withinDue - total due within due date (fee month + arrears)
 * @param {{ fine_type?: string, fine_value?: number }} fineConfig
 * @param {number} [monthCount=1] - unpaid months + fee month
 */
function calcLateFineFromWithinDue(withinDue, fineConfig, monthCount = 1) {
  const base = Number(withinDue) || 0;
  if (base <= 0) return 0;

  const { fine_type, fine_value } = normalizeFineConfig(fineConfig);
  if (!(fine_value > 0)) return 0;

  const months = normalizeFineMonthCount(monthCount);

  if (fine_type === "amount") {
    // Fixed amount applies once per overdue/fee month
    return roundMoney(fine_value * months);
  }

  // Percent applies to total within-due (same as % on each month's share, summed)
  return roundMoney((base * fine_value) / 100);
}

function calcAfterDueFromWithinDue(withinDue, fineConfig, monthCount = 1) {
  const base = roundMoney(Number(withinDue) || 0);
  return roundMoney(base + calcLateFineFromWithinDue(base, fineConfig, monthCount));
}

module.exports = {
  DEFAULT_FINE_CONFIG,
  normalizeFineConfig,
  normalizeFineMonthCount,
  calcLateFineFromWithinDue,
  calcAfterDueFromWithinDue,
};
