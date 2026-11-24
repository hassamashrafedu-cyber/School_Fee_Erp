import { roundMoney } from "./money";
import {
  buildLinkDerivedAdvancedByMonth,
  resolveTargetMonthlyFeeForAdvance,
} from "./feeAdvanceEffective";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Same key as Fee Collection uses for persisting the month pointer. */
export const CURRENT_MONTH_STORAGE_KEY = "fee_current_month";

export function isConcessionPayment(p) {
  return p.payment_type === "concession" || String(p.reference_no || "").toUpperCase().startsWith("CONCESSION");
}

export function paymentSortKey(p) {
  const d = p.payment_date || p.created_at;
  return d ? new Date(d).getTime() : 0;
}

/** Active rows only (soft-deleted excluded). */
export function activePaymentsOnly(payments) {
  return (payments || []).filter((p) => p.deleted_at === null || p.deleted_at === undefined);
}

function admissionGridAmountForMonth(structure, billingMonth) {
  const comps = structure?.fee_components ?? structure?.components ?? [];
  if (!Array.isArray(comps)) return 0;
  const key = String(billingMonth);
  for (const c of comps) {
    if (String(c.label || "").trim().toLowerCase() !== "admission fee") continue;
    const amts = c.amounts;
    if (!amts || typeof amts !== "object") return 0;
    return roundMoney(Number(amts[key] ?? amts[billingMonth] ?? 0));
  }
  return 0;
}

function advancedGridAmountForMonth(structure, billingMonth) {
  const comps = structure?.fee_components ?? structure?.components ?? [];
  if (!Array.isArray(comps)) return 0;
  const key = String(billingMonth);
  for (const c of comps) {
    if (String(c.label || "").trim().toLowerCase() !== "advanced fee") continue;
    const amts = c.amounts;
    if (!amts || typeof amts !== "object") return 0;
    return roundMoney(Number(amts[key] ?? amts[billingMonth] ?? 0));
  }
  return 0;
}

function componentOverrideAmountForMonth(componentOverrideByMonth, componentId, billingMonth) {
  if (!componentOverrideByMonth || typeof componentOverrideByMonth !== "object") return null;
  const cid = componentId != null ? String(componentId) : "";
  const inner = componentOverrideByMonth[cid];
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) return null;
  const key = String(billingMonth);
  if (!Object.prototype.hasOwnProperty.call(inner, key)) return null;
  return roundMoney(Number(inner[key]));
}

function extrasSumFromStructure(
  structure,
  billingMonth,
  admissionFeeOverride,
  admissionFeeOverrideByMonth,
  advancedFeeOverrideByMonth,
  componentOverrideByMonth = null
) {
  const comps = structure?.fee_components ?? structure?.components ?? [];
  if (!Array.isArray(comps)) return 0;
  const key = String(billingMonth);
  const admissionGrid = admissionGridAmountForMonth(structure, billingMonth);
  const map =
    admissionFeeOverrideByMonth && typeof admissionFeeOverrideByMonth === "object" && !Array.isArray(admissionFeeOverrideByMonth)
      ? admissionFeeOverrideByMonth
      : null;
  const mapHasKeys = map && Object.keys(map).length > 0;
  let admissionPart = admissionGrid;
  if (mapHasKeys && Object.prototype.hasOwnProperty.call(map, key)) {
    admissionPart = roundMoney(Number(map[key]));
  } else if (!mapHasKeys) {
    const hasScalar =
      admissionFeeOverride != null &&
      admissionFeeOverride !== "" &&
      !Number.isNaN(Number(admissionFeeOverride));
    if (hasScalar) admissionPart = roundMoney(admissionFeeOverride);
  }

  const advancedGrid = advancedGridAmountForMonth(structure, billingMonth);
  const advMap =
    advancedFeeOverrideByMonth && typeof advancedFeeOverrideByMonth === "object" && !Array.isArray(advancedFeeOverrideByMonth)
      ? advancedFeeOverrideByMonth
      : null;
  const advMapHasKeys = advMap && Object.keys(advMap).length > 0;
  let advancedPart = advancedGrid;
  if (advMapHasKeys && Object.prototype.hasOwnProperty.call(advMap, key)) {
    advancedPart = roundMoney(Number(advMap[key]));
  }

  let s = 0;
  for (const c of comps) {
    const lab = String(c.label || "").trim().toLowerCase();
    if (lab === "admission fee") {
      s += admissionPart;
      continue;
    }
    if (lab === "advanced fee" || lab === "advance fee") {
      s += advancedPart;
      continue;
    }
    const compOv = componentOverrideAmountForMonth(componentOverrideByMonth, c.id, billingMonth);
    if (compOv != null) {
      s += compOv;
      continue;
    }
    const amts = c.amounts;
    if (!amts || typeof amts !== "object") continue;
    s += roundMoney(Number(amts[key] ?? amts[billingMonth] ?? 0));
  }
  return s;
}

export function buildBillingMonthsFromRange(
  config,
  structure,
  overrideAmount,
  admissionFeeOverride,
  admissionFeeOverrideByMonth,
  overrideAmountByMonth,
  advancedFeeOverrideByMonth,
  componentOverrideByMonth = null,
  advanceLinks = null,
  crossYearTargetMonthlyMap = null,
  crossYearTargetHasOverride = null
) {
  const y = Number(config?.year);
  const startMonth = Number(config?.start_month);
  const endMonth = Number(config?.end_month);
  if (
    Number.isNaN(y) ||
    Number.isNaN(startMonth) ||
    Number.isNaN(endMonth) ||
    startMonth < 1 ||
    endMonth > 12 ||
    startMonth > endMonth
  ) {
    return [];
  }
  const monthFeeMap = new Map(
    (Array.isArray(structure?.months) ? structure.months : []).map((m) => [
      Number(m.month),
      roundMoney(m.monthly_fee != null ? m.monthly_fee : m.fee),
    ])
  );
  const monthlyMap =
    overrideAmountByMonth && typeof overrideAmountByMonth === "object" && !Array.isArray(overrideAmountByMonth)
      ? overrideAmountByMonth
      : null;
  const monthlyMapHasKeys = monthlyMap && Object.keys(monthlyMap).length > 0;
  const hasScalarOverride =
    overrideAmount != null && overrideAmount !== "" && !Number.isNaN(Number(overrideAmount));
  const overrideMonthlyScalar = hasScalarOverride ? roundMoney(overrideAmount) : null;

  const monthlyPartsByMonth = {};
  for (let month = startMonth; month <= endMonth; month += 1) {
    const key = String(month);
    let monthlyPart = roundMoney(monthFeeMap.get(month) || 0);
    if (monthlyMapHasKeys && Object.prototype.hasOwnProperty.call(monthlyMap, key)) {
      monthlyPart = roundMoney(Number(monthlyMap[key]));
    } else if (!monthlyMapHasKeys && overrideMonthlyScalar != null) {
      monthlyPart = overrideMonthlyScalar;
    }
    monthlyPartsByMonth[key] = monthlyPart;
  }

  const linkDerivedAdv = buildLinkDerivedAdvancedByMonth({
    calendarYear: y,
    startMonth,
    endMonth,
    advanceLinks,
    monthlyPartsByMonth,
    monthFeeMap,
    overrideAmountByMonth,
    overrideAmount,
    advancedFeeOverrideByMonth,
    crossYearTargetMonthlyMap,
    crossYearTargetHasOverride,
  });

  const effectiveAdvByMonth = { ...(advancedFeeOverrideByMonth || {}) };
  for (const [mk, amt] of Object.entries(linkDerivedAdv)) {
    if (!Object.prototype.hasOwnProperty.call(effectiveAdvByMonth, mk)) {
      effectiveAdvByMonth[mk] = amt;
    }
  }
  const hasEffectiveAdv = Object.keys(effectiveAdvByMonth).length > 0;

  const out = [];
  for (let month = startMonth; month <= endMonth; month += 1) {
    const monthShort = MONTH_NAMES[month - 1] || `M${month}`;
    const key = String(month);
    const monthlyPart = monthlyPartsByMonth[key];
    const componentsSum = extrasSumFromStructure(
      structure,
      month,
      admissionFeeOverride,
      admissionFeeOverrideByMonth,
      hasEffectiveAdv ? effectiveAdvByMonth : advancedFeeOverrideByMonth,
      componentOverrideByMonth
    );
    const totalForMonth = roundMoney(monthlyPart + componentsSum);
    out.push({
      month,
      year: y,
      monthLabel: monthShort,
      label: `${monthShort} ${y}`,
      fee: totalForMonth,
      monthlyPart,
    });
  }
  return out;
}

/**
 * Which billing month is "current" (for Current Due and list badges).
 * Default rule: prefer PC system month/year; if not in range, use the first month in range.
 * @param {Array<object>} billingMonths
 * @param {object | null} previousMonth — kept for compatibility, not used in default selection
 * @returns {object | null}
 */
export function pickCurrentMonthForBilling(billingMonths, previousMonth) {
  if (!Array.isArray(billingMonths) || billingMonths.length === 0) {
    return null;
  }
  void previousMonth;
  const now = new Date();
  const sysMonth = now.getMonth() + 1;
  const sysYear = now.getFullYear();
  const matchedSystem = billingMonths.find((m) => m.month === sysMonth && m.year === sysYear);
  if (matchedSystem) return matchedSystem;
  return billingMonths[0];
}

/** Stable Map key for allocation rows and billing rows (avoids number/string month mismatches). */
export function ledgerYearMonthKey(year, month) {
  return `${Number(year)}-${Number(month)}`;
}

/** Same calendar bucket as backend payment_allocations default row (paymentAllocationService.ledgerBucketForPayment). */
function ledgerBucketForPayment(payment) {
  const pd = payment.payment_date || payment.created_at;
  const d = pd ? new Date(pd) : new Date();
  const fallbackYear = Number.isNaN(d.getFullYear()) ? new Date().getFullYear() : d.getFullYear();
  const fallbackMonth = Number.isNaN(d.getMonth()) ? new Date().getMonth() + 1 : d.getMonth() + 1;

  let ledgerYear = fallbackYear;
  if (payment.ledger_year != null && String(payment.ledger_year).trim() !== "") {
    const y = Number(payment.ledger_year);
    if (!Number.isNaN(y) && y >= 1900 && y <= 2100) ledgerYear = y;
  }

  let month = fallbackMonth;
  if (payment.selected_month != null && String(payment.selected_month).trim() !== "") {
    const m = Number(payment.selected_month);
    if (!Number.isNaN(m) && m >= 1 && m <= 12) month = m;
  }

  return { ledgerYear, month };
}

/**
 * Split payments (multi-line) or advance rows: amounts follow allocation lines only — do not also FIFO.
 * A single "normal" line (even if it matches amount_paid) is treated as the default booking bucket and may still FIFO-walk
 * so large payments spread across months unless the user used Split / Advance.
 */
function usesExplicitAllocationDistribution(p) {
  const list = p.allocations;
  if (!Array.isArray(list) || list.length === 0) return false;
  if (list.length > 1) return true;
  const a = list[0];
  const kind = String(a.allocation_kind || "").toLowerCase();
  if (kind === "advance") return true;
  if (a.fee_advance_link_id) return true;
  return false;
}

/** Persisted concession allocation rows — explicit credits only (incl. single target-month line for Advanced To). */
function concessionHasStoredAllocations(p) {
  if (!isConcessionPayment(p)) return false;
  const list = p.allocations;
  return Array.isArray(list) && list.length > 0;
}

function buildConcessionPaidByTargetFromPayments(activePayments) {
  const map = new Map();
  for (const p of activePaymentsOnly(activePayments)) {
    if (!isConcessionPayment(p)) continue;
    const list = p.allocations;
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      if (String(a.allocation_kind || "").toLowerCase() !== "concession") continue;
      const mk = ledgerYearMonthKey(a.ledger_year, a.month);
      map.set(mk, roundMoney((map.get(mk) || 0) + roundMoney(a.amount)));
    }
  }
  return map;
}

function concessionSummaryYearForLine(allocationLine, advanceLinks) {
  const ly = Number(allocationLine.ledger_year);
  const lm = Number(allocationLine.month);
  for (const link of advanceLinks || []) {
    if (Number(link.target_year) === ly && Number(link.target_month) === lm && Number(link.source_year) !== ly) {
      return Number(link.source_year);
    }
  }
  return ly;
}

/**
 * Cross-year Advanced To: concession on a link target counts toward source AND target year
 * (parity with payment advance rows in attributedAmountForCalendarYear).
 */
const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Human-readable allocation breakdown for payment history (e.g. Dec 2026: 500 · Feb 2027: 450). */
export function formatPaymentAllocationSummary(payment, advanceLinks = []) {
  const list = payment?.allocations;
  if (!Array.isArray(list) || list.length === 0) return null;
  const parts = [];
  for (const a of list) {
    const amt = roundMoney(a.amount);
    if (amt <= 0) continue;
    const m = Number(a.month);
    const y = Number(a.ledger_year);
    const label = `${MONTH_NAMES_SHORT[m - 1] || `M${m}`} ${y}`;
    const kind = String(a.allocation_kind || "normal").toLowerCase();
    const kindTag = kind === "concession" ? "concession" : kind === "advance" ? "advance" : "fee";
    parts.push(`${label}: ${amt} (${kindTag})`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export function concessionCountsTowardCalendarYear(allocationLine, calendarYear, advanceLinks = []) {
  const cy = Number(calendarYear);
  if (Number.isNaN(cy)) return false;
  const ly = Number(allocationLine.ledger_year);
  const lm = Number(allocationLine.month);
  for (const link of advanceLinks || []) {
    const ty = Number(link.target_year);
    const tm = Number(link.target_month);
    const sy = Number(link.source_year);
    if (ty === ly && tm === lm) {
      return cy === ty || cy === sy;
    }
  }
  if (cy === ly) return true;
  return concessionSummaryYearForLine(allocationLine, advanceLinks) === cy;
}

function paymentHasAdvanceAllocation(p) {
  const list = p.allocations;
  if (!Array.isArray(list)) return false;
  return list.some((a) => String(a.allocation_kind || "").toLowerCase() === "advance");
}

/** FIFO applies only to payments booked to this calendar year — avoids prior-year cash filling next year’s grid. */
function fifoPaymentBelongsToLedgerYear(p, calendarYear) {
  const b = ledgerBucketForPayment(p);
  return Number(b.ledgerYear) === Number(calendarYear);
}

/**
 * Amount of this payment counted toward calendar year `cy` for filtering and totals.
 * Advance rows count toward the link's **target** year (cash lands there) and toward the **source**
 * year (bundle leaving that calendar year), so a Nov→Jan payment appears when viewing either year.
 */
export function attributedAmountForCalendarYear(p, calendarYear, advanceLinks = []) {
  const cy = Number(calendarYear);
  if (Number.isNaN(cy)) return 0;
  const linkById = new Map((advanceLinks || []).map((l) => [String(l.id), l]));
  const list = p.allocations;
  if (!Array.isArray(list) || list.length === 0) {
    const b = ledgerBucketForPayment(p);
    return Number(b.ledgerYear) === cy ? roundMoney(p.amount_paid) : 0;
  }
  if (isConcessionPayment(p)) {
    let s = 0;
    for (const a of list) {
      if (String(a.allocation_kind || "").toLowerCase() !== "concession") continue;
      if (concessionCountsTowardCalendarYear(a, cy, advanceLinks)) s += roundMoney(a.amount);
    }
    return roundMoney(s);
  }

  let s = 0;
  for (const a of list) {
    const kind = String(a.allocation_kind || "").toLowerCase();
    const amt = roundMoney(a.amount);
    if (kind === "advance") {
      const lid = a.fee_advance_link_id;
      const link = lid ? linkById.get(String(lid)) : null;
      if (link) {
        const ty = Number(link.target_year);
        const sy = Number(link.source_year);
        if (cy === ty || cy === sy) s += amt;
      } else if (Number(a.ledger_year) === cy) {
        s += amt;
      }
      continue;
    }
    if (kind === "concession") continue;
    if (Number(a.ledger_year) === cy) s += amt;
  }
  return roundMoney(s);
}

/**
 * Fee Collection summary strip only: advance dollars count toward the link **source** (bundle) year,
 * not the target year — so Nov→Jan prepay appears in 2026 “total paid”, not 2027. Normal lines use
 * allocation ledger_year; no allocations → payment ledger bucket year.
 */
export function feeCollectionSummaryPaidForYear(p, calendarYear, advanceLinks = []) {
  const cy = Number(calendarYear);
  if (Number.isNaN(cy)) return 0;
  const linkById = new Map((advanceLinks || []).map((l) => [String(l.id), l]));
  const list = p.allocations;

  if (!Array.isArray(list) || list.length === 0) {
    const b = ledgerBucketForPayment(p);
    return Number(b.ledgerYear) === cy ? roundMoney(p.amount_paid) : 0;
  }

  if (isConcessionPayment(p)) {
    let s = 0;
    for (const a of list) {
      if (String(a.allocation_kind || "").toLowerCase() !== "concession") continue;
      if (concessionSummaryYearForLine(a, advanceLinks) === cy) s += roundMoney(a.amount);
    }
    return roundMoney(s);
  }

  let s = 0;
  for (const a of list) {
    const kind = String(a.allocation_kind || "").toLowerCase();
    const amt = roundMoney(a.amount);
    if (kind === "concession") continue;
    if (kind === "advance") {
      const lid = a.fee_advance_link_id;
      const link = lid ? linkById.get(String(lid)) : null;
      if (link) {
        if (Number(link.source_year) === cy) s += amt;
      } else if (Number(a.ledger_year) === cy) {
        s += amt;
      }
      continue;
    }
    if (Number(a.ledger_year) === cy) s += amt;
  }
  return roundMoney(s);
}

function buildExplicitPaidAndAdvanceByMonth(payments, calendarYear, advanceLinks = []) {
  const cy = Number(calendarYear);
  if (Number.isNaN(cy)) {
    return { paidByMonth: new Map(), advanceByMonth: new Map() };
  }
  const linkById = new Map((advanceLinks || []).map((l) => [String(l.id), l]));
  const paidByMonth = new Map();
  const advanceByMonth = new Map();
  const activePayments = activePaymentsOnly(payments);
  for (const p of activePayments) {
    const list = p.allocations;
    if (!Array.isArray(list) || list.length === 0) continue;
    const fullExplicit =
      usesExplicitAllocationDistribution(p) || concessionHasStoredAllocations(p);
    for (const a of list) {
      const kind = String(a.allocation_kind || "").toLowerCase();
      if (!fullExplicit && kind !== "advance") continue;

      let credYear = Number(a.ledger_year);
      let credMonth = Number(a.month);
      if (kind === "advance") {
        const lid = a.fee_advance_link_id;
        const link = lid ? linkById.get(String(lid)) : null;
        if (link) {
          credYear = Number(link.target_year);
          credMonth = Number(link.target_month);
        }
      }
      if (credYear !== cy) continue;

      const mk = ledgerYearMonthKey(credYear, credMonth);
      const amt = roundMoney(a.amount);
      paidByMonth.set(mk, roundMoney((paidByMonth.get(mk) || 0) + amt));
      if (kind === "advance") {
        advanceByMonth.set(mk, roundMoney((advanceByMonth.get(mk) || 0) + amt));
      }
    }
  }
  return { paidByMonth, advanceByMonth };
}

function findBillingMonthIndex(billingMonths, month, year) {
  return (billingMonths || []).findIndex(
    (b) => Number(b.month) === Number(month) && Number(b.year) === Number(year)
  );
}

/** Base + linked target month fee(s) from Fee Setup — always, when target row exists in `billingMonths`. */
function targetFeeLookupKey(targetYear, targetMonth) {
  return `${Number(targetYear)}-${Number(targetMonth)}`;
}

/** Fee for a link target month: monthly portion when available (override-aware), else off-grid map. */
function resolveTargetMonthFee(targetYear, targetMonth, billingMonths, offGridTargetFeeMap = {}) {
  return resolveTargetMonthlyFeeForAdvance(targetYear, targetMonth, billingMonths, offGridTargetFeeMap);
}

/**
 * Fee Setup advance embedded in source row + separate target billing month in same school year —
 * don't stack target month's full fee on top of structural bundle cap / due (avoids Aug base+advance + Nov fee duplicate).
 */
function skipStructuralAdditionForAdvanceLink(link, billingMonths) {
  const bm = billingMonths || [];
  const sy = Number(link.source_year);
  const ty = Number(link.target_year);
  const tm = Number(link.target_month);
  if (!Number.isFinite(sy) || !Number.isFinite(ty)) return false;
  if (sy !== ty) return false;
  return bm.some((m) => Number(m.year) === ty && Number(m.month) === tm);
}

function bundledAdvanceTargetUsesSeparateSchedule(link, billingMonths, offGridTargetFeeMap = {}) {
  const sy = Number(link.source_year);
  const ty = Number(link.target_year);
  const tm = Number(link.target_month);
  if (!Number.isFinite(sy) || !Number.isFinite(ty) || !Number.isFinite(tm)) return false;
  const tf = resolveTargetMonthFee(ty, tm, billingMonths, offGridTargetFeeMap);
  if (tf <= 0) return false;
  if (skipStructuralAdditionForAdvanceLink(link, billingMonths)) return true;
  return sy !== ty;
}

function embeddedStructuralAdvanceForSource(sourceMonth, sourceYear, billingMonths, advanceLinks, offGridTargetFeeMap = {}) {
  let emb = 0;
  for (const link of advanceLinks || []) {
    if (Number(link.source_year) !== Number(sourceYear) || Number(link.source_month) !== Number(sourceMonth)) {
      continue;
    }
    if (!bundledAdvanceTargetUsesSeparateSchedule(link, billingMonths, offGridTargetFeeMap)) continue;
    emb = roundMoney(
      emb + resolveTargetMonthFee(Number(link.target_year), Number(link.target_month), billingMonths, offGridTargetFeeMap)
    );
  }
  return roundMoney(emb);
}

function effectiveLocalBaseForFifo(monthRow, billingMonths, advanceLinks, offGridTargetFeeMap = {}) {
  const full = roundMoney(monthRow.fee);
  const embRaw = embeddedStructuralAdvanceForSource(monthRow.month, monthRow.year, billingMonths, advanceLinks, offGridTargetFeeMap);
  const emb = roundMoney(Math.min(embRaw, full));
  return roundMoney(Math.max(0, full - emb));
}

function structuralBundleFeeAdd(sourceMonth, sourceYear, billingMonths, advanceLinks, offGridTargetFeeMap = {}) {
  let add = 0;
  for (const link of advanceLinks || []) {
    if (Number(link.source_year) !== Number(sourceYear) || Number(link.source_month) !== Number(sourceMonth)) {
      continue;
    }
    if (bundledAdvanceTargetUsesSeparateSchedule(link, billingMonths, offGridTargetFeeMap)) continue;
    add += resolveTargetMonthFee(Number(link.target_year), Number(link.target_month), billingMonths, offGridTargetFeeMap);
  }
  return roundMoney(add);
}

function bundledTargetMonthKeysForYear(cy, billingMonths, advanceLinks, offGridTargetFeeMap = {}) {
  const keys = new Set();
  const y = Number(cy);
  for (const link of advanceLinks || []) {
    if (Number(link.source_year) !== y) continue;
    if (!bundledAdvanceTargetUsesSeparateSchedule(link, billingMonths, offGridTargetFeeMap)) continue;
    keys.add(`${Number(link.target_year)}-${Number(link.target_month)}`);
  }
  return keys;
}

/**
 * Total expected fees for calendar year `cy`: sum billing rows in `cy`, excluding months that are only
 * bundled advance targets (already inside a source row, e.g. Nov when Aug→Nov).
 */
function grossFeeForCalendarYear(cy, billingMonths, advanceLinks, offGridTargetFeeMap = {}) {
  const bm = billingMonths || [];
  const y = Number(cy);
  const excludeTargetKeys = bundledTargetMonthKeysForYear(y, billingMonths, advanceLinks, offGridTargetFeeMap);
  let sum = roundMoney(
    bm.filter((m) => Number(m.year) === y).reduce((s, m) => {
      const k = `${Number(m.year)}-${Number(m.month)}`;
      if (excludeTargetKeys.has(k)) return s;
      return roundMoney(s + roundMoney(m.fee));
    }, 0)
  );
  const hasBillMonth = (yr, mo) =>
    bm.some((m) => Number(m.year) === Number(yr) && Number(m.month) === Number(mo));

  for (const link of advanceLinks || []) {
    if (Number(link.source_year) !== y) continue;
    if (!hasBillMonth(link.source_year, link.source_month)) continue;
    const ty = Number(link.target_year);
    const tm = Number(link.target_month);
    const targetAlreadyCountedWithYear = ty === y && hasBillMonth(ty, tm);
    if (targetAlreadyCountedWithYear) continue;
    if (bundledAdvanceTargetUsesSeparateSchedule(link, billingMonths, offGridTargetFeeMap)) continue;
    sum = roundMoney(sum + resolveTargetMonthFee(ty, tm, bm, offGridTargetFeeMap));
  }
  return roundMoney(sum);
}

function computeAdvanceRemainderForSource(
  row,
  monthsState,
  billingMonths,
  advanceLinks,
  offGridTargetFeeMap,
  outgoingBySource,
  outgoingPartsDisplay,
  fifoAdvanceByLinkFromSource,
  concessionPaidByTarget = null
) {
  const parts = [];
  let total = 0;
  const srcKey = `${row.year}-${row.month}`;
  for (const link of advanceLinks || []) {
    if (Number(link.source_year) !== Number(row.year) || Number(link.source_month) !== Number(row.month)) {
      continue;
    }
    if (!bundledAdvanceTargetUsesSeparateSchedule(link, billingMonths, offGridTargetFeeMap)) continue;
    const ty = Number(link.target_year);
    const tm = Number(link.target_month);
    const tf = resolveTargetMonthFee(ty, tm, billingMonths, offGridTargetFeeMap);
    if (tf <= 0) continue;
    let paidToward = explicitOutgoingTowardTarget(row.year, row.month, ty, tm, outgoingBySource);
    for (const p of outgoingPartsDisplay || []) {
      if (Number(p.targetYear) === ty && Number(p.targetMonth) === tm) {
        paidToward = roundMoney(Math.max(paidToward, roundMoney(p.amount)));
      }
    }
    const linkKey = `${srcKey}|${String(link.id)}`;
    if (fifoAdvanceByLinkFromSource) {
      paidToward = roundMoney(paidToward + roundMoney(fifoAdvanceByLinkFromSource.get(linkKey) || 0));
    }
    const tIdx = findBillingMonthIndex(billingMonths, tm, ty);
    if (tIdx >= 0) {
      const ts = monthsState[tIdx];
      paidToward = roundMoney(
        Math.max(paidToward, roundMoney(ts.paid || 0), roundMoney(ts.advancePaid || 0))
      );
    }
    if (concessionPaidByTarget) {
      const tk = ledgerYearMonthKey(ty, tm);
      paidToward = roundMoney(Math.max(paidToward, roundMoney(concessionPaidByTarget.get(tk) || 0)));
    }
    const rem = roundMoney(Math.max(0, tf - paidToward));
    if (rem > 0) {
      parts.push({
        label: `${MONTH_NAMES[tm - 1] || `M${tm}`} ${ty}`,
        amount: rem,
        targetYear: ty,
        targetMonth: tm,
      });
      total = roundMoney(total + rem);
    }
  }
  return { advanceRemainder: total, advanceRemainderParts: parts };
}

/**
 * Fee Collection “total fee (gross)” for year `cy`: structural gross minus target months that are only
 * advance targets from a **prior** calendar year (already part of the previous year’s bundle gross).
 */
function feeCollectionGrossForYear(cy, billingMonths, advanceLinks, offGridTargetFeeMap = {}) {
  let g = grossFeeForCalendarYear(cy, billingMonths, advanceLinks, offGridTargetFeeMap);
  const seen = new Set();
  for (const link of advanceLinks || []) {
    if (Number(link.source_year) >= Number(cy)) continue;
    if (Number(link.target_year) !== Number(cy)) continue;
    const ty = Number(link.target_year);
    const tm = Number(link.target_month);
    const k = `${ty}-${tm}`;
    if (seen.has(k)) continue;
    seen.add(k);
    g = roundMoney(g - resolveTargetMonthFee(ty, tm, billingMonths, offGridTargetFeeMap));
  }
  return roundMoney(Math.max(0, g));
}

/** Max amount this month can absorb in FIFO: base fee + linked target fees (same as structural bundle cap). */
function fifoMonthCap(monthRow, billingMonths, advanceLinks, offGridTargetFeeMap = {}) {
  const base = roundMoney(monthRow.fee);
  const bundle = structuralBundleFeeAdd(monthRow.month, monthRow.year, billingMonths, advanceLinks, offGridTargetFeeMap);
  return roundMoney(base + bundle);
}

/** Satisfied bundle on source row: normal (capped at local base) + explicit outgoing + FIFO advances booked from this source. */
function fifoBundleConsumedOnSource(
  mi,
  monthsState,
  billingMonths,
  advanceLinks,
  offGridTargetFeeMap,
  outgoingBySource,
  fifoAdvanceFromSourceByKey
) {
  const row = monthsState[mi];
  const localBase = effectiveLocalBaseForFifo(row, billingMonths, advanceLinks, offGridTargetFeeMap);
  const srcKey = `${row.year}-${row.month}`;
  const paidOnSource = roundMoney(row.paid);
  const normalFilled = roundMoney(Math.min(paidOnSource, localBase));
  const outSrc = outgoingBySource.get(srcKey);
  const prepaidTowardTargets = outSrc ? roundMoney(outSrc.total) : 0;
  const fifoAdv = roundMoney(fifoAdvanceFromSourceByKey.get(srcKey) || 0);
  return roundMoney(normalFilled + prepaidTowardTargets + fifoAdv);
}

function fifoStructuralDueForMonth(
  mi,
  monthsState,
  billingMonths,
  advanceLinks,
  offGridTargetFeeMap,
  outgoingBySource,
  fifoAdvanceFromSourceByKey
) {
  const cap = fifoMonthCap(monthsState[mi], billingMonths, advanceLinks, offGridTargetFeeMap);
  const consumed = fifoBundleConsumedOnSource(
    mi,
    monthsState,
    billingMonths,
    advanceLinks,
    offGridTargetFeeMap,
    outgoingBySource,
    fifoAdvanceFromSourceByKey
  );
  return roundMoney(Math.max(0, cap - consumed));
}

/** Paid toward a linked target (on-grid or cross-year off-grid) — same math as backend FIFO infer. */
function paidTowardLinkedTarget(
  sourceYear,
  sourceMonth,
  targetYear,
  targetMonth,
  monthsState,
  billingMonths,
  outgoingBySource,
  fifoAdvanceByLinkFromSource,
  linkId,
  concessionPaidByTarget = null
) {
  const ty = Number(targetYear);
  const tm = Number(targetMonth);
  const srcKey = `${Number(sourceYear)}-${Number(sourceMonth)}`;
  const linkKey = `${srcKey}|${String(linkId)}`;
  let paidToward = explicitOutgoingTowardTarget(sourceYear, sourceMonth, ty, tm, outgoingBySource);
  if (fifoAdvanceByLinkFromSource) {
    paidToward = roundMoney(paidToward + roundMoney(fifoAdvanceByLinkFromSource.get(linkKey) || 0));
  }
  const tIdx = findBillingMonthIndex(billingMonths, tm, ty);
  if (tIdx >= 0) {
    const ts = monthsState[tIdx];
    paidToward = roundMoney(Math.max(paidToward, roundMoney(ts.paid || 0), roundMoney(ts.advancePaid || 0)));
  } else if (concessionPaidByTarget) {
    const tk = ledgerYearMonthKey(ty, tm);
    paidToward = roundMoney(Math.max(paidToward, roundMoney(concessionPaidByTarget.get(tk) || 0)));
  }
  return paidToward;
}

/**
 * Apply one FIFO chunk without lumping advance-to-target dollars onto the source row's `paid`
 * (fixes Dec showing 499+150 as "Dec paid" when 150 should sit on the linked month).
 * Updates targets' paid/advancePaid; records FIFO advance totals per source for bundle math.
 */
function applyFifoChunkSplit(
  mi,
  chunk,
  monthsState,
  billingMonths,
  advanceLinks,
  offGridTargetFeeMap,
  fifoAdvanceFromSourceByKey,
  outgoingBySource,
  fifoAdvanceByLinkFromSource,
  concessionPaidByTarget = null
) {
  let r = roundMoney(chunk);
  const row = monthsState[mi];
  const localBase = effectiveLocalBaseForFifo(row, billingMonths, advanceLinks, offGridTargetFeeMap);
  const y = row.year;
  const m = row.month;
  const srcKey = `${y}-${m}`;

  const paidOnSource = roundMoney(row.paid);
  const normalFilled = roundMoney(Math.min(paidOnSource, localBase));
  const normalRoom = roundMoney(Math.max(0, localBase - normalFilled));

  const toNormal = roundMoney(Math.min(r, normalRoom));
  if (toNormal > 0) {
    row.paid = roundMoney(row.paid + toNormal);
    r = roundMoney(r - toNormal);
  }

  const linksHere = (advanceLinks || [])
    .filter((l) => Number(l.source_year) === Number(y) && Number(l.source_month) === Number(m))
    .sort((a, b) => {
      const so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
      if (so !== 0) return so;
      if (Number(a.target_year) !== Number(b.target_year)) return Number(a.target_year) - Number(b.target_year);
      return Number(a.target_month) - Number(b.target_month);
    });

  for (const link of linksHere) {
    if (r <= 0) break;
    const ty = Number(link.target_year);
    const tm = Number(link.target_month);
    const tf = resolveTargetMonthFee(ty, tm, billingMonths, offGridTargetFeeMap);
    const tIdx = findBillingMonthIndex(billingMonths, tm, ty);
    const linkKey = `${srcKey}|${String(link.id)}`;
    const fifoTowardLink = roundMoney(fifoAdvanceByLinkFromSource.get(linkKey) || 0);
    const advExisting = paidTowardLinkedTarget(
      y,
      m,
      ty,
      tm,
      monthsState,
      billingMonths,
      outgoingBySource,
      fifoAdvanceByLinkFromSource,
      link.id,
      concessionPaidByTarget
    );
    const advRoom = roundMoney(Math.max(0, tf - advExisting));
    const advAmt = roundMoney(Math.min(r, advRoom));
    if (advAmt <= 0) continue;
    if (tIdx >= 0) {
      monthsState[tIdx].paid = roundMoney(monthsState[tIdx].paid + advAmt);
      monthsState[tIdx].advancePaid = roundMoney((monthsState[tIdx].advancePaid || 0) + advAmt);
    }
    r = roundMoney(r - advAmt);
    fifoAdvanceFromSourceByKey.set(
      srcKey,
      roundMoney((fifoAdvanceFromSourceByKey.get(srcKey) || 0) + advAmt)
    );
    fifoAdvanceByLinkFromSource.set(linkKey, roundMoney(fifoTowardLink + advAmt));
  }

  return r;
}

/** Advance amounts leaving a **source** calendar month (for UI + due math). Cross-year OK. */
function aggregateOutgoingAdvanceBySource(activePayments, advanceLinks) {
  const linkById = new Map((advanceLinks || []).map((l) => [String(l.id), l]));
  const bySource = new Map();

  for (const p of activePayments) {
    const list = p.allocations;
    if (!Array.isArray(list) || list.length === 0) continue;

    const advances = list.filter((a) => String(a.allocation_kind || "").toLowerCase() === "advance");
    if (!advances.length) continue;

    const normals = list.filter((a) => String(a.allocation_kind || "").toLowerCase() !== "advance");
    const defaultSource = normals.length
      ? { year: Number(normals[0].ledger_year), month: Number(normals[0].month) }
      : (() => {
          const b = ledgerBucketForPayment(p);
          return { year: b.ledgerYear, month: b.month };
        })();

    for (const a of advances) {
      const amt = roundMoney(a.amount);
      if (amt <= 0) continue;
      const lid = a.fee_advance_link_id;
      const link = lid ? linkById.get(String(lid)) : null;
      let srcYear;
      let srcMonth;
      if (link) {
        srcYear = Number(link.source_year);
        srcMonth = Number(link.source_month);
      } else {
        srcYear = defaultSource.year;
        srcMonth = defaultSource.month;
      }
      const tgtYear = link ? Number(link.target_year) : Number(a.ledger_year);
      const tgtMonth = link ? Number(link.target_month) : Number(a.month);
      const key = `${srcYear}-${srcMonth}`;
      const targetLabel = `${MONTH_NAMES[tgtMonth - 1] || `M${tgtMonth}`} ${tgtYear}`;
      const entry = bySource.get(key) || { total: 0, parts: [] };
      entry.total = roundMoney(entry.total + amt);
      entry.parts.push({
        amount: amt,
        targetYear: tgtYear,
        targetMonth: tgtMonth,
        targetLabel,
      });
      bySource.set(key, entry);
    }
  }
  return bySource;
}

function aggregateConcessionCrossYearOutgoing(activePayments, advanceLinks) {
  const bySource = new Map();

  for (const p of activePayments) {
    if (!isConcessionPayment(p)) continue;
    const list = p.allocations;
    if (!Array.isArray(list) || list.length === 0) continue;

    const concessions = list.filter((a) => String(a.allocation_kind || "").toLowerCase() === "concession");
    if (!concessions.length) continue;

    for (const link of advanceLinks || []) {
      const sy = Number(link.source_year);
      const sm = Number(link.source_month);
      const ty = Number(link.target_year);
      const tm = Number(link.target_month);
      const tgtLine = concessions.find((a) => Number(a.ledger_year) === ty && Number(a.month) === tm);
      if (!tgtLine) continue;

      const amt = roundMoney(tgtLine.amount);
      if (amt <= 0) continue;

      const key = `${sy}-${sm}`;
      const targetLabel = `${MONTH_NAMES[tm - 1] || `M${tm}`} ${ty}`;
      const entry = bySource.get(key) || { total: 0, parts: [] };
      entry.total = roundMoney(entry.total + amt);
      entry.parts.push({
        amount: amt,
        targetYear: ty,
        targetMonth: tm,
        targetLabel,
      });
      bySource.set(key, entry);
    }
  }
  return bySource;
}

function mergeOutgoingBySourceMaps(primary, secondary) {
  const out = new Map();
  for (const [key, entry] of primary || []) {
    out.set(key, { total: roundMoney(entry.total), parts: [...(entry.parts || [])] });
  }
  for (const [key, entry] of secondary || []) {
    const existing = out.get(key);
    if (!existing) {
      out.set(key, { total: roundMoney(entry.total), parts: [...(entry.parts || [])] });
      continue;
    }
    existing.total = roundMoney(existing.total + roundMoney(entry.total));
    existing.parts.push(...(entry.parts || []));
    out.set(key, existing);
  }
  return out;
}

/** Sum of explicit advance amounts from one source month toward a given target (cross-year OK). */
function explicitOutgoingTowardTarget(sourceYear, sourceMonth, targetYear, targetMonth, outgoingBySource) {
  const key = `${Number(sourceYear)}-${Number(sourceMonth)}`;
  const out = outgoingBySource.get(key);
  if (!out || !out.parts || !out.parts.length) return 0;
  let s = 0;
  for (const part of out.parts) {
    if (Number(part.targetYear) === Number(targetYear) && Number(part.targetMonth) === Number(targetMonth)) {
      s += roundMoney(part.amount);
    }
  }
  return roundMoney(s);
}

function mergedOutgoingParts(parts) {
  const map = new Map();
  for (const part of parts || []) {
    const tk = `${part.targetYear}-${part.targetMonth}`;
    const cur = map.get(tk) || {
      amount: 0,
      targetYear: part.targetYear,
      targetMonth: part.targetMonth,
      targetLabel: part.targetLabel,
    };
    cur.amount = roundMoney(cur.amount + part.amount);
    map.set(tk, cur);
  }
  return [...map.values()];
}

/**
 * If total `paid` on a bundle source row exceeds this month's base fee (e.g. FIFO filled base from
 * other payments + this row picked up surplus as "normal"), show the overflow on linked target
 * lines in the breakdown instead of inflating the first "Dec" number.
 */
function bundleDisplayPaidParts(paid, moFee, mergedOutgoingParts, structuralTargets, advanceLinks, rowYear, rowMonth) {
  const surplus = roundMoney(Math.max(0, roundMoney(paid) - roundMoney(moFee)));
  if (structuralTargets.length === 0 || surplus <= 0) {
    return { paidBase: paid, outgoingPartsDisplay: mergedOutgoingParts };
  }
  const paidBase = roundMoney(Math.min(paid, moFee));
  const parts = mergedOutgoingParts.map((p) => ({
    ...p,
    amount: roundMoney(p.amount),
  }));
  if (parts.length > 0) {
    parts[0] = { ...parts[0], amount: roundMoney(parts[0].amount + surplus) };
    return { paidBase, outgoingPartsDisplay: parts };
  }
  const linksHere = (advanceLinks || [])
    .filter((l) => Number(l.source_year) === Number(rowYear) && Number(l.source_month) === Number(rowMonth))
    .sort((a, b) => {
      const so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
      if (so !== 0) return so;
      if (Number(a.target_year) !== Number(b.target_year)) return Number(a.target_year) - Number(b.target_year);
      return Number(a.target_month) - Number(b.target_month);
    });
  const first = linksHere[0];
  if (!first) return { paidBase, outgoingPartsDisplay: parts };
  const ty = Number(first.target_year);
  const tm = Number(first.target_month);
  const targetLabel = `${MONTH_NAMES[tm - 1] || `M${tm}`} ${ty}`;
  return {
    paidBase,
    outgoingPartsDisplay: [
      {
        amount: surplus,
        targetYear: ty,
        targetMonth: tm,
        targetLabel,
      },
    ],
  };
}

function bundleFeeAddForOutgoing(outEntry, billingMonths, advanceLinks, sourceYear, sourceMonth, offGridTargetFeeMap = {}) {
  if (!outEntry || !outEntry.parts.length) return 0;
  const merged = mergedOutgoingParts(outEntry.parts);
  let add = 0;
  const seen = new Set();
  for (const part of merged) {
    const tk = `${part.targetYear}-${part.targetMonth}`;
    if (seen.has(tk)) continue;
    seen.add(tk);
    const link = (advanceLinks || []).find(
      (l) =>
        Number(l.source_year) === Number(sourceYear) &&
        Number(l.source_month) === Number(sourceMonth) &&
        Number(l.target_year) === Number(part.targetYear) &&
        Number(l.target_month) === Number(part.targetMonth)
    );
    if (link && bundledAdvanceTargetUsesSeparateSchedule(link, billingMonths, offGridTargetFeeMap)) continue;
    const tIdx = findBillingMonthIndex(billingMonths, part.targetMonth, part.targetYear);
    if (tIdx >= 0) {
      add += roundMoney(billingMonths[tIdx].fee);
    } else {
      add += roundMoney(part.amount);
    }
  }
  return roundMoney(add);
}

function rowFeeDisplay(m, outEntry, billingMonths, advanceLinks, offGridTargetFeeMap = {}) {
  const moFee = roundMoney(m.fee);
  const paymentOnlyBundleAdd = outEntry
    ? bundleFeeAddForOutgoing(outEntry, billingMonths, advanceLinks, m.year, m.month, offGridTargetFeeMap)
    : 0;
  return roundMoney(moFee + paymentOnlyBundleAdd);
}

function rowPaidDisplay(m, outEntry, fifoAdvanceFromSourceByKey) {
  const paid = roundMoney(m.paid);
  const key = `${m.year}-${m.month}`;
  const outgoingTotal = outEntry ? roundMoney(outEntry.total) : 0;
  const fifoAdvanceFromSource = roundMoney(fifoAdvanceFromSourceByKey.get(key) || 0);
  return roundMoney(paid + outgoingTotal + fifoAdvanceFromSource);
}

/** Target row index in billing order; -1 if not in grid. */
function targetBillingIndex(billingMonths, targetYear, targetMonth) {
  return findBillingMonthIndex(billingMonths, targetMonth, targetYear);
}

function calendarMonthAfter(aYear, aMonth, bYear, bMonth) {
  if (Number(aYear) !== Number(bYear)) return Number(aYear) > Number(bYear);
  return Number(aMonth) > Number(bMonth);
}

/**
 * Advance amounts from this source row that are still treated as “prepay” under current due
 * (target month strictly after current month in billing walk — but if target not in grid, use calendar order vs current row).
 */
function outgoingAdvanceCountedForDue(outEntry, billingMonths, currentMonthIndex, currentRow) {
  if (!outEntry || !outEntry.parts.length) return 0;
  let sum = 0;
  const merged = mergedOutgoingParts(outEntry.parts);
  const curY = Number(currentRow.year);
  const curM = Number(currentRow.month);

  for (const part of merged) {
    const tIdx = targetBillingIndex(billingMonths, part.targetYear, part.targetMonth);
    let future = false;
    if (tIdx >= 0) {
      future = tIdx > currentMonthIndex;
    } else {
      future = calendarMonthAfter(part.targetYear, part.targetMonth, curY, curM);
    }
    if (future) sum += roundMoney(part.amount);
  }
  return roundMoney(sum);
}

/** Cumulative “due” row fee: base + linked targets still ahead of current cutoff (no double-count when target month is already passed). Uses Fee Setup links. */
function feeBundleForDueRowStructural(
  moFee,
  rowMonth,
  rowYear,
  billingMonths,
  advanceLinks,
  currentMonthIndex,
  currentRow,
  offGridTargetFeeMap = {}
) {
  let f = roundMoney(moFee);
  const curY = Number(currentRow.year);
  const curM = Number(currentRow.month);

  for (const link of advanceLinks || []) {
    if (Number(link.source_year) !== Number(rowYear) || Number(link.source_month) !== Number(rowMonth)) continue;
    const ty = Number(link.target_year);
    const tm = Number(link.target_month);
    const tIdx = targetBillingIndex(billingMonths, ty, tm);
    let include = false;
    if (tIdx >= 0) {
      include = tIdx > currentMonthIndex;
    } else {
      include = calendarMonthAfter(ty, tm, curY, curM);
    }
    if (!include) continue;
    if (bundledAdvanceTargetUsesSeparateSchedule(link, billingMonths, offGridTargetFeeMap)) continue;
    const tgtFee = resolveTargetMonthFee(ty, tm, billingMonths, offGridTargetFeeMap);
    if (tgtFee > 0) f = roundMoney(f + tgtFee);
  }
  return roundMoney(f);
}

/**
 * Hybrid: explicit multi-line / advance allocations use stored lines; all other cash walks billing
 * months in **billing order** from the **first** month (FIFO: earliest unpaid months first).
 * Source months with advance links show **structural** bundle fee (base + linked target fee from Fee Setup).
 * @param {Array<{ id?: string, source_year: number, source_month: number, target_year: number, target_month: number }>} [advanceLinks]
 * @param {Record<string, number>} [offGridTargetFeeMap] — `"year-month"` → fee when target is not in `billingMonths` (e.g. Jan 2027 while viewing 2026).
 */
export function distributeLedger(
  payments,
  billingMonths,
  currentMonth,
  calendarYear,
  advanceLinks = [],
  offGridTargetFeeMap = {},
  options = {}
) {
  const activePayments = activePaymentsOnly(payments);
  const cy = Number(
    calendarYear != null && calendarYear !== undefined && !Number.isNaN(Number(calendarYear))
      ? calendarYear
      : (billingMonths || [])[0]?.year
  );
  const rowYearFilter = options.rowYearFilter !== undefined ? options.rowYearFilter : cy;
  const concessionTotal = roundMoney(
    activePayments
      .filter(isConcessionPayment)
      .reduce((s, p) => s + feeCollectionSummaryPaidForYear(p, cy, advanceLinks), 0)
  );
  const regular = activePayments.filter(
    (p) => (p.payment_type || "payment") === "payment" && !isConcessionPayment(p)
  );
  const totalPaidRegular = roundMoney(
    regular.reduce((s, p) => s + feeCollectionSummaryPaidForYear(p, cy, advanceLinks), 0)
  );
  const totalPaidAll = roundMoney(totalPaidRegular + concessionTotal);
  const gross = feeCollectionGrossForYear(cy, billingMonths, advanceLinks, offGridTargetFeeMap);
  let totalYearDue = roundMoney(Math.max(0, gross - totalPaidRegular - concessionTotal));

  if (!Array.isArray(billingMonths) || billingMonths.length === 0) {
    return {
      monthRows: [],
      totalFeeGross: gross,
      totalYearDue,
      concessionTotal,
      totalPaidAll,
      totalPaidRegular,
      remaining: 0,
    };
  }

  const { paidByMonth: explicitPaidByMonth, advanceByMonth } = buildExplicitPaidAndAdvanceByMonth(
    activePayments,
    cy,
    advanceLinks
  );

  const monthsState = billingMonths.map((bm) => {
    const ymk = ledgerYearMonthKey(bm.year, bm.month);
    return {
      month: bm.month,
      year: bm.year,
      monthLabel: bm.monthLabel,
      fee: roundMoney(bm.fee),
      paid: roundMoney(explicitPaidByMonth.get(ymk) || 0),
      advancePaid: roundMoney(advanceByMonth.get(ymk) || 0),
    };
  });

  const outgoingBySource = mergeOutgoingBySourceMaps(
    aggregateOutgoingAdvanceBySource(activePayments, advanceLinks),
    aggregateConcessionCrossYearOutgoing(activePayments, advanceLinks)
  );
  const concessionPaidByTarget = buildConcessionPaidByTargetFromPayments(activePayments);

  const fifoRows = activePayments.filter(
    (p) =>
      !usesExplicitAllocationDistribution(p) &&
      !paymentHasAdvanceAllocation(p) &&
      !concessionHasStoredAllocations(p) &&
      fifoPaymentBelongsToLedgerYear(p, cy) &&
      (isConcessionPayment(p) || ((p.payment_type || "payment") === "payment" && !isConcessionPayment(p)))
  );

  const sortedFifo = fifoRows.slice().sort((a, b) => {
    const da = paymentSortKey(a) - paymentSortKey(b);
    if (da !== 0) return da;
    const ca = isConcessionPayment(a) ? 1 : 0;
    const cb = isConcessionPayment(b) ? 1 : 0;
    if (ca !== cb) return ca - cb;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  const fifoAdvanceFromSourceByKey = new Map();
  const fifoAdvanceByLinkFromSource = new Map();

  for (const p of sortedFifo) {
    let remainingPayment = roundMoney(Number(p.amount_paid || 0));
    if (remainingPayment <= 0) continue;
    for (let mi = 0; mi < monthsState.length && remainingPayment > 0; mi += 1) {
      const due = fifoStructuralDueForMonth(
        mi,
        monthsState,
        billingMonths,
        advanceLinks,
        offGridTargetFeeMap,
        outgoingBySource,
        fifoAdvanceFromSourceByKey
      );
      if (due <= 0) continue;
      const chunk = roundMoney(Math.min(remainingPayment, due));
      const leftover = applyFifoChunkSplit(
        mi,
        chunk,
        monthsState,
        billingMonths,
        advanceLinks,
        offGridTargetFeeMap,
        fifoAdvanceFromSourceByKey,
        outgoingBySource,
        fifoAdvanceByLinkFromSource,
        concessionPaidByTarget
      );
      remainingPayment = roundMoney(remainingPayment - chunk + leftover);
    }
  }

  let currentMonthIndex = monthsState.length - 1;
  if (currentMonth != null && currentMonth.month != null && currentMonth.year != null) {
    const idx = monthsState.findIndex(
      (m) => Number(m.month) === Number(currentMonth.month) && Number(m.year) === Number(currentMonth.year)
    );
    if (idx >= 0) currentMonthIndex = idx;
  }

  const excludeTargetKeys = bundledTargetMonthKeysForYear(cy, billingMonths, advanceLinks, offGridTargetFeeMap);
  let runningRemaining = 0;
  for (let i = 0; i <= currentMonthIndex; i += 1) {
    const m = monthsState[i];
    const key = `${m.year}-${m.month}`;
    if (excludeTargetKeys.has(key)) continue;
    const outEntry = outgoingBySource.get(key);
    const feeD = rowFeeDisplay(m, outEntry, billingMonths, advanceLinks, offGridTargetFeeMap);
    const paidD = rowPaidDisplay(m, outEntry, fifoAdvanceFromSourceByKey);
    runningRemaining = roundMoney(runningRemaining + Math.max(0, feeD - paidD));
  }

  const remaining = roundMoney(Math.max(0, runningRemaining));

  const monthRows = monthsState
    .filter((m) => rowYearFilter == null || Number(m.year) === Number(rowYearFilter))
    .map((m) => {
    const paid = m.paid;
    const moFee = m.fee;
    const advancePaid = m.advancePaid || 0;
    const key = `${m.year}-${m.month}`;
    const outEntry = outgoingBySource.get(key);
    const outgoingTotal = outEntry ? roundMoney(outEntry.total) : 0;
    const feeDisplay = rowFeeDisplay(m, outEntry, billingMonths, advanceLinks, offGridTargetFeeMap);

    const structuralTargets = [];
    for (const link of advanceLinks || []) {
      if (Number(link.source_year) !== Number(m.year) || Number(link.source_month) !== Number(m.month)) continue;
      if (bundledAdvanceTargetUsesSeparateSchedule(link, billingMonths, offGridTargetFeeMap)) continue;
      const tf = resolveTargetMonthFee(Number(link.target_year), Number(link.target_month), billingMonths, offGridTargetFeeMap);
      if (tf <= 0) continue;
      const tmo = Number(link.target_month);
      const tyy = Number(link.target_year);
      structuralTargets.push({
        label: `${MONTH_NAMES[tmo - 1] || `M${tmo}`} ${tyy}`,
        fee: tf,
      });
    }
    const fifoAdvanceFromSource = roundMoney(fifoAdvanceFromSourceByKey.get(key) || 0);
    const paidDisplay = rowPaidDisplay(m, outEntry, fifoAdvanceFromSourceByKey);
    const mergedParts = outEntry ? mergedOutgoingParts(outEntry.parts) : [];
    const { paidBase, outgoingPartsDisplay } = bundleDisplayPaidParts(
      paid,
      moFee,
      mergedParts,
      structuralTargets,
      advanceLinks,
      m.year,
      m.month
    );

    const localCap = effectiveLocalBaseForFifo(m, billingMonths, advanceLinks, offGridTargetFeeMap);
    const { advanceRemainder, advanceRemainderParts } = computeAdvanceRemainderForSource(
      m,
      monthsState,
      billingMonths,
      advanceLinks,
      offGridTargetFeeMap,
      outgoingBySource,
      outgoingPartsDisplay,
      fifoAdvanceByLinkFromSource,
      concessionPaidByTarget
    );
    const bundleFullyPaid = feeDisplay > 0 && paidDisplay >= feeDisplay;
    const localFullyPaid = localCap > 0 && roundMoney(paidBase) >= localCap;

    let status = "neutral";
    const gapFee = feeDisplay;
    const gapPaid = paidDisplay;
    if (bundleFullyPaid) status = "paid";
    else if (localFullyPaid && advanceRemainder > 0) status = "partial";
    else if (gapFee > 0 && gapPaid >= gapFee) status = "paid";
    else if (gapFee > 0 && gapPaid > 0) status = "partial";
    else if (gapFee > 0) status = "unpaid";

    return {
      key,
      label: `${m.monthLabel} ${m.year}`,
      month: m.month,
      year: m.year,
      fee: moFee,
      paid,
      advancePaid,
      feeDisplay,
      paidDisplay,
      paidBase,
      localCap,
      localFullyPaid,
      bundleFullyPaid,
      advanceRemainder,
      advanceRemainderParts,
      fifoAdvanceFromSource,
      outgoingAdvanceTotal: outgoingTotal,
      outgoingParts: outgoingPartsDisplay,
      structuralTargets,
      status,
    };
    });

  return {
    monthRows,
    totalFeeGross: gross,
    totalYearDue,
    concessionTotal,
    totalPaidAll,
    totalPaidRegular,
    remaining,
  };
}

export function ledgerStatus(remaining) {
  const r = roundMoney(remaining);
  if (r <= 0) return "paid";
  return "partial";
}
