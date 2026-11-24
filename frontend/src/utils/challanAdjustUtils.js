import { roundMoney } from "./money";

function feeItemsTotal(items) {
  return roundMoney((items || []).reduce((sum, row) => sum + Number(row.amount || 0), 0));
}

export function isAdvancedFeeLabel(label) {
  const lab = String(label || "").trim().toLowerCase();
  return (
    lab === "advanced fee" ||
    lab === "advance fee" ||
    lab.startsWith("advanced fee ") ||
    lab.startsWith("advance fee ")
  );
}

export function getAdvancedFeeFromItems(items) {
  const row = (items || []).find((r) => isAdvancedFeeLabel(r.label));
  if (!row) return null;
  return roundMoney(Number(row.amount ?? 0));
}

function setAdvancedFeeInItems(items, rawValue) {
  const parsed = Number(rawValue);
  const amount = roundMoney(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
  const list = Array.isArray(items) ? items.map((row) => ({ ...row })) : [];
  const idx = list.findIndex((row) => isAdvancedFeeLabel(row.label));
  const existingLabel = idx >= 0 ? list[idx].label : "Advanced fee";
  if (idx >= 0) {
    list[idx] = { ...list[idx], amount };
    return list;
  }
  if (amount > 0) {
    list.push({ label: existingLabel, amount });
  }
  return list;
}

/** School configures fine in Settings → Fee Slip. Default is no fine. */
export const DEFAULT_FINE_CONFIG = { fine_type: "percent", fine_value: 0 };

export function normalizeFineConfig(config) {
  const type = String(config?.fine_type || DEFAULT_FINE_CONFIG.fine_type).toLowerCase();
  const fine_type = type === "amount" ? "amount" : "percent";
  const raw = Number(config?.fine_value);
  const fine_value =
    Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) / 100 : DEFAULT_FINE_CONFIG.fine_value;
  return { fine_type, fine_value };
}

/** Unpaid previous months (arrear > 0) + current fee month. */
export function normalizeFineMonthCount(monthCount) {
  const n = Number(monthCount);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 48);
}

/**
 * Count months fine applies to from challan data:
 * previous rows with arrear > 0, plus 1 for the selected fee month.
 */
export function countFineMonthsFromChallan(challan) {
  const stored = Number(challan?.fine_month_count);
  if (Number.isFinite(stored) && stored >= 1) {
    return normalizeFineMonthCount(stored);
  }
  const previous = Array.isArray(challan?.previous) ? challan.previous : [];
  const unpaidPrev = previous.filter((row) => Number(row?.arrear || 0) > 0).length;
  return normalizeFineMonthCount(unpaidPrev + 1);
}

/**
 * @param {number} withinDue
 * @param {{ fine_type?: string, fine_value?: number }} fineConfig
 * @param {number} [monthCount=1]
 */
export function calcLateFineFromWithinDue(withinDue, fineConfig, monthCount = 1) {
  const base = Number(withinDue) || 0;
  if (base <= 0) return 0;

  const { fine_type, fine_value } = normalizeFineConfig(fineConfig);
  if (!(fine_value > 0)) return 0;

  const months = normalizeFineMonthCount(monthCount);

  if (fine_type === "amount") {
    return roundMoney(fine_value * months);
  }
  return roundMoney((base * fine_value) / 100);
}

export function calcAfterDueFromWithinDue(withinDue, fineConfig, monthCount = 1) {
  const base = roundMoney(Number(withinDue) || 0);
  return roundMoney(base + calcLateFineFromWithinDue(base, fineConfig, monthCount));
}

export function formatFineNote(fineConfig) {
  const { fine_type, fine_value } = normalizeFineConfig(fineConfig);
  const deadline =
    "Note: Fee must be paid before the 10th of every month.";

  if (!(fine_value > 0)) {
    return deadline;
  }

  if (fine_type === "amount") {
    return `${deadline} Otherwise, a fine of ${fine_value} per unpaid month (including the fee month) will be charged additionally.`;
  }

  return `${deadline} Otherwise, a ${fine_value}% fine will be charged additionally.`;
}

export function recalcChallanWithinDue(challan, fineConfig) {
  const withinDue = roundMoney(feeItemsTotal(challan?.items) + Number(challan?.arrears ?? 0));
  const monthCount = countFineMonthsFromChallan(challan);
  const lateFee = calcLateFineFromWithinDue(withinDue, fineConfig, monthCount);
  const afterDue = calcAfterDueFromWithinDue(withinDue, fineConfig, monthCount);
  return {
    ...challan,
    fine_month_count: monthCount,
    within_due: withinDue,
    late_fee: lateFee,
    after_due: afterDue,
    summary: {
      ...(challan?.summary || {}),
      total: withinDue,
      paid: Number(challan?.summary?.paid ?? 0),
      balance: withinDue,
    },
  };
}

/** Apply manual or calculated arrears and refresh within-due totals (frontend only). */
export function applyArrearsToChallan(challan, arrearsValue, fineConfig) {
  const parsed = Number(arrearsValue);
  const arrears = roundMoney(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
  return recalcChallanWithinDue({ ...challan, arrears }, fineConfig);
}

/** Apply manual Advanced fee (advance / Advanced to) and refresh within-due totals (frontend only). */
export function applyAdvancedFeeToChallan(challan, rawValue, fineConfig) {
  const items = setAdvancedFeeInItems(challan?.items, rawValue);
  return recalcChallanWithinDue({ ...challan, items }, fineConfig);
}
