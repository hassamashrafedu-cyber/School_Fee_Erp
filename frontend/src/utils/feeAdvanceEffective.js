import { roundMoney } from "./money";

/** Key for cross-year / off-grid target month lookups. */
export function targetMonthlyKey(year, month) {
  return `${Number(year)}-${Number(month)}`;
}

/** True when student has a scalar or per-month monthly fee override. */
export function hasStudentMonthlyOverride(overrideAmount, overrideAmountByMonth) {
  const monthlyMap =
    overrideAmountByMonth && typeof overrideAmountByMonth === "object" && !Array.isArray(overrideAmountByMonth)
      ? overrideAmountByMonth
      : null;
  if (monthlyMap && Object.keys(monthlyMap).length > 0) return true;
  return (
    overrideAmount != null && overrideAmount !== "" && !Number.isNaN(Number(overrideAmount))
  );
}

/** Effective monthly fee for one billing month (class grid + optional student override). */
export function computeEffectiveMonthlyPart(monthNum, structureMonths, overrideAmount, overrideAmountByMonth) {
  const monthFeeMap = new Map(
    (Array.isArray(structureMonths) ? structureMonths : []).map((m) => [
      Number(m.month),
      roundMoney(m.monthly_fee != null ? m.monthly_fee : m.fee),
    ])
  );
  const key = String(monthNum);
  const monthlyMap =
    overrideAmountByMonth && typeof overrideAmountByMonth === "object" && !Array.isArray(overrideAmountByMonth)
      ? overrideAmountByMonth
      : null;
  const monthlyMapHasKeys = monthlyMap && Object.keys(monthlyMap).length > 0;
  const hasScalar =
    overrideAmount != null && overrideAmount !== "" && !Number.isNaN(Number(overrideAmount));
  const overrideMonthlyScalar = hasScalar ? roundMoney(overrideAmount) : null;

  let monthlyPart = roundMoney(monthFeeMap.get(monthNum) || 0);
  if (monthlyMapHasKeys && Object.prototype.hasOwnProperty.call(monthlyMap, key)) {
    monthlyPart = roundMoney(Number(monthlyMap[key]));
  } else if (!monthlyMapHasKeys && overrideMonthlyScalar != null) {
    monthlyPart = overrideMonthlyScalar;
  }
  return monthlyPart;
}

/** Whether this month (or scalar) has an explicit monthly override vs class-only. */
export function monthHasMonthlyOverride(monthNum, overrideAmount, overrideAmountByMonth) {
  const monthlyMap =
    overrideAmountByMonth && typeof overrideAmountByMonth === "object" && !Array.isArray(overrideAmountByMonth)
      ? overrideAmountByMonth
      : null;
  const key = String(monthNum);
  if (monthlyMap && Object.prototype.hasOwnProperty.call(monthlyMap, key)) return true;
  const hasScalar =
    overrideAmount != null && overrideAmount !== "" && !Number.isNaN(Number(overrideAmount));
  if (hasScalar && (!monthlyMap || !Object.keys(monthlyMap).length)) return true;
  return false;
}

/** Derive Advanced from links when source year or any cross-year target has monthly override. */
export function shouldDeriveAdvancedFromLinks({
  overrideAmount,
  overrideAmountByMonth,
  crossYearTargetHasOverride = null,
}) {
  if (hasStudentMonthlyOverride(overrideAmount, overrideAmountByMonth)) return true;
  if (crossYearTargetHasOverride && typeof crossYearTargetHasOverride === "object") {
    return Object.values(crossYearTargetHasOverride).some(Boolean);
  }
  return false;
}

/** Sum linked target monthly fees for a source month (advance "Advanced to" amount). */
export function sumAdvanceForSourceMonth(sourceMonth, sourceYear, advanceLinks, getMonthlyFee) {
  let total = 0;
  for (const link of advanceLinks || []) {
    if (Number(link.source_year) !== Number(sourceYear) || Number(link.source_month) !== Number(sourceMonth)) {
      continue;
    }
    const ty = Number(link.target_year);
    const tm = Number(link.target_month);
    total = roundMoney(total + getMonthlyFee(ty, tm));
  }
  return total;
}

/** Target month fee for advance bundles: monthly portion only (override-aware when present). */
export function resolveTargetMonthlyFeeForAdvance(targetYear, targetMonth, billingMonths, offGridTargetFeeMap = {}) {
  const row = (billingMonths || []).find(
    (b) => Number(b.month) === Number(targetMonth) && Number(b.year) === Number(targetYear)
  );
  if (row) {
    if (row.monthlyPart != null && row.monthlyPart !== "") {
      return roundMoney(row.monthlyPart);
    }
    return roundMoney(row.fee);
  }
  const raw = offGridTargetFeeMap[targetMonthlyKey(targetYear, targetMonth)];
  if (raw == null || raw === "") return 0;
  return roundMoney(Number(raw));
}

/**
 * Derive Advanced fee on source months from advance links + effective target monthly fees.
 * Cross-year targets use crossYearTargetMonthlyMap (override or class fee for that target year).
 */
export function buildLinkDerivedAdvancedByMonth({
  calendarYear,
  startMonth,
  endMonth,
  advanceLinks,
  monthlyPartsByMonth,
  monthFeeMap,
  overrideAmountByMonth,
  overrideAmount,
  advancedFeeOverrideByMonth,
  crossYearTargetMonthlyMap = null,
  crossYearTargetHasOverride = null,
}) {
  if (
    !shouldDeriveAdvancedFromLinks({
      overrideAmount,
      overrideAmountByMonth,
      crossYearTargetHasOverride,
    })
  ) {
    return {};
  }
  if (!advanceLinks?.length) return {};

  const y = Number(calendarYear);
  const crossMap =
    crossYearTargetMonthlyMap && typeof crossYearTargetMonthlyMap === "object"
      ? crossYearTargetMonthlyMap
      : null;
  const monthlyMap =
    overrideAmountByMonth && typeof overrideAmountByMonth === "object" && !Array.isArray(overrideAmountByMonth)
      ? overrideAmountByMonth
      : null;
  const monthlyMapHasKeys = monthlyMap && Object.keys(monthlyMap).length > 0;
  const hasScalar =
    overrideAmount != null && overrideAmount !== "" && !Number.isNaN(Number(overrideAmount));
  const overrideMonthlyScalar = hasScalar ? roundMoney(overrideAmount) : null;

  const advMap =
    advancedFeeOverrideByMonth && typeof advancedFeeOverrideByMonth === "object" && !Array.isArray(advancedFeeOverrideByMonth)
      ? advancedFeeOverrideByMonth
      : null;
  const advMapHasKeys = advMap && Object.keys(advMap).length > 0;

  const getMonthlyFee = (ty, tm) => {
    const key = String(tm);
    const crossKey = targetMonthlyKey(ty, tm);
    if (Number(ty) !== y && crossMap && Object.prototype.hasOwnProperty.call(crossMap, crossKey)) {
      return roundMoney(crossMap[crossKey]);
    }
    if (Number(ty) === y && monthlyPartsByMonth && Object.prototype.hasOwnProperty.call(monthlyPartsByMonth, key)) {
      return roundMoney(monthlyPartsByMonth[key]);
    }
    if (Number(ty) === y) {
      let part = roundMoney(monthFeeMap?.get(tm) || 0);
      if (monthlyMapHasKeys && Object.prototype.hasOwnProperty.call(monthlyMap, key)) {
        part = roundMoney(Number(monthlyMap[key]));
      } else if (!monthlyMapHasKeys && overrideMonthlyScalar != null) {
        part = overrideMonthlyScalar;
      }
      return part;
    }
    if (crossMap && Object.prototype.hasOwnProperty.call(crossMap, crossKey)) {
      return roundMoney(crossMap[crossKey]);
    }
    return 0;
  };

  const out = {};
  for (let month = startMonth; month <= endMonth; month += 1) {
    const mKey = String(month);
    if (advMapHasKeys && Object.prototype.hasOwnProperty.call(advMap, mKey)) continue;
    const derived = sumAdvanceForSourceMonth(month, y, advanceLinks, getMonthlyFee);
    if (derived > 0) out[mKey] = derived;
  }
  return out;
}
