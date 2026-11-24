/**
 * Fee ledger math aligned with Fee Collection (allocation-based monthly paid + concessions, whole rupees).
 */

const pool = require("../config/db");
const feeService = require("./feeService");
const challanService = require("./challanService");
const academicService = require("./academicService");
const paymentAllocationService = require("./paymentAllocationService");
const feeAdvanceLinkService = require("./feeAdvanceLinkService");
const {
  targetMonthlyKey,
  buildLinkDerivedAdvancedByMonth,
  resolveTargetMonthlyFeeForAdvance,
  computeEffectiveMonthlyPart,
  monthHasMonthlyOverride,
} = require("../utils/feeAdvanceEffective");

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const roundMoney = (n) => Math.round(Number(n || 0));

function isConcessionPayment(p) {
  return p.payment_type === "concession" || String(p.reference_no || "").toUpperCase().startsWith("CONCESSION");
}

function activePaymentsOnly(payments) {
  return (payments || []).filter((p) => p.deleted_at === null || p.deleted_at === undefined);
}

function paymentSortKey(p) {
  const d = p.payment_date || p.created_at;
  return d ? new Date(d).getTime() : 0;
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

/** Sum per-month extra column amounts from GET /fees/structure (`amounts` map per component). */
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

function buildBillingMonthsFromRange(
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

/**
 * Concession with persisted allocation rows (inferred or manual) — use explicit credits only,
 * same as payments with stored splits. A single row on a linked target month (e.g. Nov after Aug→Nov)
 * must not re-enter FIFO or it will mis-apply on the bundled source month.
 */
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

/** Cross-year Advanced To: same source+target year attribution as payment advance rows. */
function concessionCountsTowardCalendarYear(allocationLine, calendarYear, advanceLinks = []) {
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

function fifoPaymentBelongsToLedgerYear(p, calendarYear) {
  const b = paymentAllocationService.ledgerBucketForPayment(p);
  return Number(b.ledgerYear) === Number(calendarYear);
}

function attributedAmountForCalendarYear(p, calendarYear, advanceLinks = []) {
  const cy = Number(calendarYear);
  if (Number.isNaN(cy)) return 0;
  const linkById = new Map((advanceLinks || []).map((l) => [String(l.id), l]));
  const list = p.allocations;
  if (!Array.isArray(list) || list.length === 0) {
    const b = paymentAllocationService.ledgerBucketForPayment(p);
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

/** Aligns with frontend Fee Collection summary: advance counts toward source year only. */
function feeCollectionSummaryPaidForYear(p, calendarYear, advanceLinks = []) {
  const cy = Number(calendarYear);
  if (Number.isNaN(cy)) return 0;
  const linkById = new Map((advanceLinks || []).map((l) => [String(l.id), l]));
  const list = p.allocations;
  if (!Array.isArray(list) || list.length === 0) {
    const b = paymentAllocationService.ledgerBucketForPayment(p);
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

function ledgerYearMonthKey(year, month) {
  return `${Number(year)}-${Number(month)}`;
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

function targetFeeLookupKey(targetYear, targetMonth) {
  return `${Number(targetYear)}-${Number(targetMonth)}`;
}

function resolveTargetMonthFee(targetYear, targetMonth, billingMonths, offGridTargetFeeMap = {}) {
  return resolveTargetMonthlyFeeForAdvance(targetYear, targetMonth, billingMonths, offGridTargetFeeMap);
}

/**
 * Fee Setup advance embedded in source row + separate target billing month in same school year —
 * don't stack target month's full fee on top of structural bundle cap / due (avoids Aug 500+500advance + Nov 500 duplicate).
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

/**
 * Target is billed on its own schedule (grid row or off-grid map); Fee Setup folds prepay into source row —
 * same-calendar-year (skipStructural) or cross-calendar-year advances (Dec 2026 → Feb 2027).
 */
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

/** Sum of linked target-month fees folded into source row Fee Setup total (FIFO routes remainder to targets). */
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

/** Portion of source `fee` that FIFO treats as local to this month before routing remainder to linked targets. */
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

/** Target months already represented inside a source row's Fee Setup bundle — exclude from year gross sum (e.g. Nov when Aug→Nov). */
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

/** Same semantics as frontend `grossFeeForCalendarYear` — year gross = billing-range fees without double-counting bundled targets. */
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

function fifoMonthCap(monthRow, billingMonths, advanceLinks, offGridTargetFeeMap = {}) {
  const base = roundMoney(monthRow.fee);
  const bundle = structuralBundleFeeAdd(monthRow.month, monthRow.year, billingMonths, advanceLinks, offGridTargetFeeMap);
  return roundMoney(base + bundle);
}

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

/** Paid toward a linked target (on-grid or cross-year off-grid) — shared by FIFO infer and remainder UI. */
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
  onFifoAdvance,
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
    if (typeof onFifoAdvance === "function") {
      onFifoAdvance({
        fee_advance_link_id: link.id,
        target_year: ty,
        target_month: tm,
        amount: advAmt,
      });
    }
  }

  return r;
}

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
          const b = paymentAllocationService.ledgerBucketForPayment(p);
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

function bundleDisplayPaidParts(paid, moFee, mergedParts, structuralTargets, advanceLinks, rowYear, rowMonth) {
  const surplus = roundMoney(Math.max(0, roundMoney(paid) - roundMoney(moFee)));
  if (structuralTargets.length === 0 || surplus <= 0) {
    return { paidBase: paid, outgoingPartsDisplay: mergedParts };
  }
  const paidBase = roundMoney(Math.min(paid, moFee));
  const parts = mergedParts.map((p) => ({
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

function pickAdvanceLinkForTargetMonth(advanceLinks, targetYear, targetMonth) {
  const ty = Number(targetYear);
  const tm = Number(targetMonth);
  const candidates = (advanceLinks || []).filter(
    (l) => Number(l.target_year) === ty && Number(l.target_month) === tm
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  return candidates.slice().sort((a, b) => {
    const sy = Number(a.source_year) - Number(b.source_year);
    if (sy !== 0) return sy;
    return Number(a.source_month) - Number(b.source_month);
  })[candidates.length - 1];
}

function allocationLinesFromLedgerDelta(
  beforeRows,
  afterRows,
  billingMonths,
  advanceLinks,
  expectedTotal,
  opts = {}
) {
  const emitAdvanceRows = opts.emitAdvanceRows !== false;
  const toMap = (rows) => new Map(rows.map((r) => [`${r.year}-${r.month}`, r]));
  const beforeM = toMap(beforeRows);
  const afterM = toMap(afterRows);
  const lines = [];

  for (const bm of billingMonths || []) {
    const key = `${bm.year}-${bm.month}`;
    const b = beforeM.get(key) || { paid: 0, advancePaid: 0 };
    const a = afterM.get(key) || { paid: 0, advancePaid: 0 };
    const dPaid = roundMoney(roundMoney(a.paid) - roundMoney(b.paid));
    const dAdv = roundMoney(roundMoney(a.advancePaid || 0) - roundMoney(b.advancePaid || 0));
    const normalAmt = roundMoney(dPaid - dAdv);
    if (normalAmt > 0) {
      lines.push({
        ledger_year: bm.year,
        month: bm.month,
        amount: normalAmt,
        allocation_kind: "normal",
        fee_advance_link_id: null,
      });
    }
    if (emitAdvanceRows && dAdv > 0) {
      const link = pickAdvanceLinkForTargetMonth(advanceLinks, bm.year, bm.month);
      if (link) {
        lines.push({
          ledger_year: bm.year,
          month: bm.month,
          amount: dAdv,
          allocation_kind: "advance",
          fee_advance_link_id: link.id,
        });
      } else {
        lines.push({
          ledger_year: bm.year,
          month: bm.month,
          amount: dAdv,
          allocation_kind: "normal",
          fee_advance_link_id: null,
        });
      }
    }
  }

  if (opts.skipDrift) return lines;

  const sum = lines.reduce((s, l) => s + roundMoney(l.amount), 0);
  const drift = roundMoney(expectedTotal - sum);
  if (drift !== 0 && lines.length) {
    lines[lines.length - 1].amount = roundMoney(lines[lines.length - 1].amount + drift);
  }
  return lines;
}

function fifoAdvanceLinesFromRecorder(recorder, advanceLinks) {
  const linkById = new Map((advanceLinks || []).map((l) => [String(l.id), l]));
  const totalsByLink = new Map();
  for (const d of recorder || []) {
    const lid = d.fee_advance_link_id != null ? String(d.fee_advance_link_id) : "";
    if (!lid) continue;
    totalsByLink.set(lid, roundMoney((totalsByLink.get(lid) || 0) + roundMoney(d.amount)));
  }
  const lines = [];
  for (const [lid, amt] of totalsByLink) {
    const link = linkById.get(lid);
    if (!link || amt <= 0) continue;
    lines.push({
      ledger_year: Number(link.target_year),
      month: Number(link.target_month),
      amount: roundMoney(amt),
      allocation_kind: "advance",
      fee_advance_link_id: link.id,
    });
  }
  return lines;
}

async function inferPaymentAllocationLines({ student_id, class_id, amount_paid, ledger_year, selected_month, payment_date }) {
  const amount = roundMoney(amount_paid);
  if (amount <= 0 || !student_id || !class_id) return null;

  let y = Number(ledger_year);
  if (Number.isNaN(y) || y < 1900 || y > 2100) {
    const b = paymentAllocationService.ledgerBucketForPayment({
      ledger_year,
      selected_month,
      payment_date,
      payment_type: "payment",
    });
    y = Number(b.ledgerYear);
  }
  if (Number.isNaN(y) || y < 1900 || y > 2100) return null;

  const priorPayments = await challanService.getStudentPayments(student_id, y);

  const synthetic = {
    id: "__infer__",
    student_id,
    amount_paid: amount,
    payment_date,
    payment_type: "payment",
    ledger_year,
    selected_month,
    allocations: [],
    deleted_at: null,
  };

  const structure = await feeService.getMonthlyFeeStructure(class_id, y);
  const feeConfig = { year: y, start_month: structure.start_month, end_month: structure.end_month };
  const overrides = await getAssignmentOverrides(student_id, y);

  let advanceLinks = [];
  try {
    advanceLinks = await feeAdvanceLinkService.listForClassYear(class_id, y);
  } catch {
    advanceLinks = [];
  }

  const crossYear = await buildCrossYearTargetMonthlyMap(student_id, class_id, y, advanceLinks);

  const billingMonths = buildBillingMonthsFromRange(
    feeConfig,
    structure,
    overrides.monthly,
    overrides.admission,
    overrides.admissionByMonth,
    overrides.monthlyByMonth,
    overrides.advancedByMonth,
    overrides.componentByMonth,
    advanceLinks,
    crossYear.monthlyByKey,
    crossYear.hasOverrideByKey
  );

  const offGridTargetFeeMap = await buildOffGridTargetFeeMap(
    student_id,
    class_id,
    billingMonths,
    advanceLinks,
    crossYear,
    y
  );

  const before = distributeLedger(priorPayments, billingMonths, null, y, advanceLinks, offGridTargetFeeMap, {
    rowYearFilter: null,
  });
  const fifoAdvanceRecorder = [];
  const after = distributeLedger([...priorPayments, synthetic], billingMonths, null, y, advanceLinks, offGridTargetFeeMap, {
    rowYearFilter: null,
    collectFifoAdvancesForPaymentId: "__infer__",
    fifoAdvanceRecorder,
  });

  const normalLines = allocationLinesFromLedgerDelta(before.monthRows, after.monthRows, billingMonths, advanceLinks, amount, {
    emitAdvanceRows: false,
    skipDrift: true,
  });
  const advanceLines = fifoAdvanceLinesFromRecorder(fifoAdvanceRecorder, advanceLinks);
  const lines = [...normalLines, ...advanceLines];
  const sum = lines.reduce((s, l) => s + roundMoney(l.amount), 0);
  const drift = roundMoney(amount - sum);
  if (drift !== 0 && lines.length) {
    lines[lines.length - 1].amount = roundMoney(lines[lines.length - 1].amount + drift);
  }
  return lines.length ? lines : null;
}

/** Mirror payment infer lines as concession rows (month-level; advance link id is payment-only in DB). */
function inferLinesToConcessionAllocations(lines) {
  const byKey = new Map();
  for (const l of lines || []) {
    const amt = roundMoney(l.amount);
    if (amt <= 0) continue;
    const mk = ledgerYearMonthKey(Number(l.ledger_year), Number(l.month));
    byKey.set(mk, roundMoney((byKey.get(mk) || 0) + amt));
  }
  return [...byKey.entries()].map(([mk, amount]) => {
    const dash = mk.indexOf("-");
    const y = Number(mk.slice(0, dash));
    const m = Number(mk.slice(dash + 1));
    return {
      ledger_year: y,
      month: m,
      amount: roundMoney(amount),
      allocation_kind: "concession",
      fee_advance_link_id: null,
    };
  });
}

/** Same FIFO/ledger traversal as payments; only allocation_kind differs on save. */
async function inferConcessionAllocationLines({
  student_id,
  class_id,
  amount_paid,
  ledger_year,
  selected_month,
  payment_date,
}) {
  const paymentLines = await inferPaymentAllocationLines({
    student_id,
    class_id,
    amount_paid,
    ledger_year,
    selected_month,
    payment_date,
  });
  if (!paymentLines || paymentLines.length === 0) return null;
  return inferLinesToConcessionAllocations(paymentLines);
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

/** Per-month due cap (matches monthly ledger card `feeDisplay`). */
function rowFeeDisplay(m, outEntry, billingMonths, advanceLinks, offGridTargetFeeMap = {}) {
  const moFee = roundMoney(m.fee);
  const paymentOnlyBundleAdd = outEntry
    ? bundleFeeAddForOutgoing(outEntry, billingMonths, advanceLinks, m.year, m.month, offGridTargetFeeMap)
    : 0;
  return roundMoney(moFee + paymentOnlyBundleAdd);
}

/** Per-month paid total (matches monthly ledger card `paidDisplay`, includes FIFO advance from source). */
function rowPaidDisplay(m, outEntry, fifoAdvanceFromSourceByKey) {
  const paid = roundMoney(m.paid);
  const key = `${m.year}-${m.month}`;
  const outgoingTotal = outEntry ? roundMoney(outEntry.total) : 0;
  const fifoAdvanceFromSource = roundMoney(fifoAdvanceFromSourceByKey.get(key) || 0);
  return roundMoney(paid + outgoingTotal + fifoAdvanceFromSource);
}

function targetBillingIndex(billingMonths, targetYear, targetMonth) {
  return findBillingMonthIndex(billingMonths, targetMonth, targetYear);
}

function calendarMonthAfter(aYear, aMonth, bYear, bMonth) {
  if (Number(aYear) !== Number(bYear)) return Number(aYear) > Number(bYear);
  return Number(aMonth) > Number(bMonth);
}

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

function distributeLedger(payments, billingMonths, currentMonth, calendarYear, advanceLinks = [], offGridTargetFeeMap = {}, options = {}) {
  const activePayments = activePaymentsOnly(payments);
  const cy = Number(
    calendarYear != null && calendarYear !== undefined && !Number.isNaN(Number(calendarYear))
      ? calendarYear
      : (billingMonths || [])[0]?.year
  );
  const rowYearFilter = options.rowYearFilter !== undefined ? options.rowYearFilter : cy;
  const regular = activePayments.filter(
    (p) => (p.payment_type || "payment") === "payment" && !isConcessionPayment(p)
  );
  const concessions = activePayments.filter(isConcessionPayment);
  const totalPaidRegular = roundMoney(
    regular.reduce((s, p) => s + feeCollectionSummaryPaidForYear(p, cy, advanceLinks), 0)
  );
  const concessionTotal = roundMoney(
    concessions.reduce((s, p) => s + feeCollectionSummaryPaidForYear(p, cy, advanceLinks), 0)
  );
  const totalPaidAll = roundMoney(totalPaidRegular + concessionTotal);
  const gross = feeCollectionGrossForYear(cy, billingMonths, advanceLinks, offGridTargetFeeMap);
  const totalYearDueEmpty = roundMoney(Math.max(0, gross - totalPaidRegular - concessionTotal));

  if (!Array.isArray(billingMonths) || billingMonths.length === 0) {
    return {
      monthRows: [],
      totalFeeGross: gross,
      totalYearDue: totalYearDueEmpty,
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
  const inferId = options.collectFifoAdvancesForPaymentId;
  const fifoRec = Array.isArray(options.fifoAdvanceRecorder) ? options.fifoAdvanceRecorder : null;

  for (const p of sortedFifo) {
    let remainingPayment = roundMoney(Number(p.amount_paid || 0));
    if (remainingPayment <= 0) continue;
    const recordFifo =
      fifoRec && inferId != null && String(p.id) === String(inferId)
        ? (detail) => fifoRec.push(detail)
        : undefined;
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
        recordFifo,
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

  let runningRemaining = 0;
  for (let i = 0; i <= currentMonthIndex; i += 1) {
    const m = monthsState[i];
    const key = `${m.year}-${m.month}`;
    const outEntry = outgoingBySource.get(key);
    const feeD = rowFeeDisplay(m, outEntry, billingMonths, advanceLinks, offGridTargetFeeMap);
    const paidD = rowPaidDisplay(m, outEntry, fifoAdvanceFromSourceByKey);
    runningRemaining = roundMoney(runningRemaining + Math.max(0, feeD - paidD));
  }

  const remaining = roundMoney(Math.max(0, runningRemaining));

  const totalYearDue = roundMoney(Math.max(0, gross - totalPaidRegular - concessionTotal));

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
    const fifoAdvanceFromSource = roundMoney(fifoAdvanceFromSourceByKey.get(key) || 0);
    const paidDisplay = rowPaidDisplay(m, outEntry, fifoAdvanceFromSourceByKey);
    const mergedParts = outEntry ? mergedOutgoingParts(outEntry.parts) : [];

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

    const gapFee = feeDisplay;
    const gapPaid = paidDisplay;
    let status = "neutral";
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

/**
 * Month boundary for "current due" (due through this month, FIFO-aligned with Fee Collection).
 * @param {number} calendarYear billing year
 * @param {Array<{ month: number, year: number }>} billingMonths
 * @param {number|undefined} queryMonth optional 1–12 from API
 */
function resolveCurrentMonthForDue(calendarYear, billingMonths, queryMonth) {
  const y = Number(calendarYear);
  const now = new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;

  let m =
    queryMonth != null && Number.isInteger(Number(queryMonth)) && Number(queryMonth) >= 1 && Number(queryMonth) <= 12
      ? Number(queryMonth)
      : null;
  if (m == null) {
    if (y === cy) m = cm;
    else if (y < cy) m = 12;
    else m = 1;
  }

  const list = (billingMonths || []).filter((b) => Number(b.year) === y);
  if (!list.length) {
    return { month: m, year: y };
  }
  const exact = list.find((b) => Number(b.month) === m);
  if (exact) {
    return { month: Number(exact.month), year: Number(exact.year) };
  }
  const sorted = list.slice().sort((a, b) => Number(a.month) - Number(b.month));
  const atOrBefore = sorted.filter((b) => Number(b.month) <= m);
  const pick = atOrBefore.length ? atOrBefore[atOrBefore.length - 1] : sorted[0];
  return { month: Number(pick.month), year: Number(pick.year) };
}

/** Calendar month 1–12 for cumulative current-due cutoff (dashboard / reports). */
function resolveDueThroughCalendarMonth(calendarYear, queryMonth) {
  const y = Number(calendarYear);
  const now = new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;

  if (
    queryMonth != null &&
    Number.isInteger(Number(queryMonth)) &&
    Number(queryMonth) >= 1 &&
    Number(queryMonth) <= 12
  ) {
    return Number(queryMonth);
  }
  if (y === cy) return cm;
  if (y < cy) return 12;
  return 1;
}

/**
 * Sum unpaid `monthly[].remaining` from Jan through `throughMonth` (inclusive).
 * Skips bundled advance targets (e.g. Nov when Aug→Nov) — already in source month bundle.
 */
function sumMonthlyDueThroughMonth(monthly, throughMonth, calendarYear, excludeTargetKeys = null) {
  const cap = Number(throughMonth);
  const y = Number(calendarYear);
  if (!Array.isArray(monthly) || !Number.isInteger(cap) || cap < 1 || cap > 12) {
    return 0;
  }
  const exclude = excludeTargetKeys instanceof Set ? excludeTargetKeys : new Set();
  return roundMoney(
    monthly
      .filter((m) => {
        const mo = Number(m.month);
        if (mo < 1 || mo > cap) return false;
        if (exclude.size && Number.isInteger(y) && exclude.has(`${y}-${mo}`)) return false;
        return true;
      })
      .reduce((sum, m) => sum + Math.max(0, roundMoney(Number(m.remaining || 0))), 0)
  );
}

function parseAdmissionMonthMapFromRow(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const m = Number(String(k).trim());
    if (!Number.isInteger(m) || m < 1 || m > 12) continue;
    if (v === null || v === undefined || v === "") continue;
    const n = Math.round(Number(v));
    if (!Number.isNaN(n) && n >= 0) out[String(m)] = n;
  }
  return Object.keys(out).length ? out : null;
}

function parseComponentOverrideMapFromRow(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [cid, monthObj] of Object.entries(raw)) {
    if (!cid || typeof monthObj !== "object" || monthObj === null || Array.isArray(monthObj)) continue;
    const inner = {};
    for (const [mk, mv] of Object.entries(monthObj)) {
      const m = Number(String(mk).trim());
      if (!Number.isInteger(m) || m < 1 || m > 12) continue;
      if (mv === null || mv === undefined || mv === "") continue;
      const n = roundMoney(Number(mv));
      if (Number.isNaN(n)) continue;
      inner[String(m)] = n;
    }
    if (Object.keys(inner).length) out[String(cid).trim()] = inner;
  }
  return Object.keys(out).length ? out : null;
}

async function getAssignmentOverrides(studentId, year) {
  const y = Number(year);
  if (!Number.isInteger(y)) {
    return {
      monthly: null,
      admission: null,
      admissionByMonth: null,
      monthlyByMonth: null,
      advancedByMonth: null,
      componentByMonth: null,
    };
  }
  const r = await pool.query(
    `
      SELECT discount_amount, admission_fee_override, admission_fee_override_by_month, override_amount_by_month, advanced_fee_override_by_month, component_override_by_month
      FROM student_fee_assignments
      WHERE student_id = $1 AND year = $2
      LIMIT 1
    `,
    [studentId, y]
  );
  if (!r.rows[0]) {
    return {
      monthly: null,
      admission: null,
      admissionByMonth: null,
      monthlyByMonth: null,
      advancedByMonth: null,
      componentByMonth: null,
    };
  }
  const dm = r.rows[0].discount_amount;
  const am = r.rows[0].admission_fee_override;
  const monthly = dm != null && dm !== "" ? roundMoney(Number(dm)) : null;
  const admission = am != null && am !== "" ? roundMoney(Number(am)) : null;
  const admissionByMonth = parseAdmissionMonthMapFromRow(r.rows[0].admission_fee_override_by_month);
  const monthlyByMonth = parseAdmissionMonthMapFromRow(r.rows[0].override_amount_by_month);
  const advancedByMonth = parseAdmissionMonthMapFromRow(r.rows[0].advanced_fee_override_by_month);
  const componentByMonth = parseComponentOverrideMapFromRow(r.rows[0].component_override_by_month);
  return { monthly, admission, admissionByMonth, monthlyByMonth, advancedByMonth, componentByMonth };
}

/**
 * Effective monthly fee per cross-year advance target (override if set, else class fee for that target year).
 */
async function buildCrossYearTargetMonthlyMap(studentId, resolvedClassId, sourceCalendarYear, advanceLinks) {
  const monthlyByKey = {};
  const hasOverrideByKey = {};
  if (!resolvedClassId || !Array.isArray(advanceLinks) || !advanceLinks.length) {
    return { monthlyByKey, hasOverrideByKey };
  }
  const sy = Number(sourceCalendarYear);
  const needByTargetYear = new Map();
  for (const link of advanceLinks) {
    if (Number(link.source_year) !== sy) continue;
    const ty = Number(link.target_year);
    const tm = Number(link.target_month);
    if (ty === sy) continue;
    if (!needByTargetYear.has(ty)) needByTargetYear.set(ty, new Set());
    needByTargetYear.get(ty).add(tm);
  }
  for (const [ty, monthSet] of needByTargetYear) {
    try {
      const structure = await feeService.getMonthlyFeeStructure(resolvedClassId, ty);
      const rawMonths = Array.isArray(structure?.months) ? structure.months : [];
      const o = await getAssignmentOverrides(studentId, ty);
      for (const tm of monthSet) {
        const fee = computeEffectiveMonthlyPart(tm, rawMonths, o.monthly, o.monthlyByMonth);
        const key = targetMonthlyKey(ty, tm);
        monthlyByKey[key] = fee;
        hasOverrideByKey[key] = monthHasMonthlyOverride(tm, o.monthly, o.monthlyByMonth);
      }
    } catch {
      /* skip year */
    }
  }
  return { monthlyByKey, hasOverrideByKey };
}

async function buildOffGridTargetFeeMap(
  studentId,
  resolvedClassId,
  billingMonths,
  advanceLinks,
  crossYearPrefetch = null,
  sourceCalendarYear = null
) {
  const map = {};
  if (!resolvedClassId || !Array.isArray(advanceLinks) || !advanceLinks.length) {
    return map;
  }
  const sy = Number(sourceCalendarYear ?? billingMonths?.[0]?.year);
  const gk = targetMonthlyKey;
  const gridKeys = new Set((billingMonths || []).map((b) => gk(b.year, b.month)));

  let monthlyByKey = crossYearPrefetch?.monthlyByKey || null;
  if (!monthlyByKey) {
    const cross = await buildCrossYearTargetMonthlyMap(studentId, resolvedClassId, sy, advanceLinks);
    monthlyByKey = cross.monthlyByKey;
  }
  for (const [key, fee] of Object.entries(monthlyByKey || {})) {
    if (!gridKeys.has(key)) map[key] = roundMoney(fee);
  }

  const needByYear = new Map();
  for (const link of advanceLinks) {
    if (Number(link.source_year) !== sy) continue;
    const ty = Number(link.target_year);
    const tm = Number(link.target_month);
    if (ty !== sy) continue;
    if (!gridKeys.has(gk(ty, tm)) && !Object.prototype.hasOwnProperty.call(map, gk(ty, tm))) {
      if (!needByYear.has(ty)) needByYear.set(ty, new Set());
      needByYear.get(ty).add(tm);
    }
  }
  for (const [ty, monthSet] of needByYear) {
    try {
      const structure = await feeService.getMonthlyFeeStructure(resolvedClassId, ty);
      const feeCfg = { year: ty, start_month: structure.start_month, end_month: structure.end_month };
      const o = await getAssignmentOverrides(studentId, ty);
      let linksTy = [];
      try {
        linksTy = await feeAdvanceLinkService.listForClassYear(resolvedClassId, ty);
      } catch {
        linksTy = [];
      }
      const cross = await buildCrossYearTargetMonthlyMap(studentId, resolvedClassId, ty, linksTy);
      const bm = buildBillingMonthsFromRange(
        feeCfg,
        structure,
        o.monthly,
        o.admission,
        o.admissionByMonth,
        o.monthlyByMonth,
        o.advancedByMonth,
        o.componentByMonth,
        linksTy,
        cross.monthlyByKey,
        cross.hasOverrideByKey
      );
      for (const tm of monthSet) {
        const row = bm.find((b) => Number(b.month) === tm && Number(b.year) === ty);
        if (row) map[gk(ty, tm)] = roundMoney(row.monthlyPart != null ? row.monthlyPart : row.fee);
      }
    } catch {
      /* skip year */
    }
  }
  return map;
}

/**
 * @param {object} [reportOptions]
 * @param {number} [reportOptions.current_month] optional calendar month 1–12 for current-due cutoff
 * @returns {Promise<object>}
 */
async function computeStudentYearLedger(studentRow, calendarYear, reportOptions = {}) {
  const studentId = studentRow.id;
  const y = Number(calendarYear);
  const enrollment = await academicService.resolveStudentEnrollmentForYear(studentId, y);

  let resolvedClassId = null;
  if (enrollment.source !== "alumni_post_graduation") {
    resolvedClassId = enrollment.class_id || studentRow.current_class_id || null;
  }

  let feeConfig;
  let structure;

  if (resolvedClassId) {
    structure = await feeService.getMonthlyFeeStructure(resolvedClassId, y);
    feeConfig = { year: y, start_month: structure.start_month, end_month: structure.end_month };
  } else {
    const cfg = await feeService.readFeeConfigForClass(y, null);
    feeConfig = { year: y, start_month: cfg.start_month, end_month: cfg.end_month };
    const months = [];
    for (let m = cfg.start_month; m <= cfg.end_month; m += 1) months.push({ month: m, fee: 0 });
    structure = { year: y, start_month: cfg.start_month, end_month: cfg.end_month, months };
  }

  const {
    monthly: overrideAmount,
    admission: admissionOverride,
    admissionByMonth,
    monthlyByMonth,
    advancedByMonth,
    componentByMonth,
  } = await getAssignmentOverrides(studentId, y);

  let advanceLinks = [];
  if (resolvedClassId) {
    try {
      advanceLinks = await feeAdvanceLinkService.listForClassYear(resolvedClassId, y);
    } catch {
      advanceLinks = [];
    }
  }

  let crossYear = { monthlyByKey: {}, hasOverrideByKey: {} };
  if (resolvedClassId) {
    crossYear = await buildCrossYearTargetMonthlyMap(studentId, resolvedClassId, y, advanceLinks);
  }

  const billingMonths = buildBillingMonthsFromRange(
    feeConfig,
    structure,
    overrideAmount,
    admissionOverride,
    admissionByMonth,
    monthlyByMonth,
    advancedByMonth,
    componentByMonth,
    advanceLinks,
    crossYear.monthlyByKey,
    crossYear.hasOverrideByKey
  );

  const payments = await challanService.getStudentPayments(studentId, y);
  const offGridTargetFeeMap = await buildOffGridTargetFeeMap(
    studentId,
    resolvedClassId,
    billingMonths,
    advanceLinks,
    crossYear,
    y
  );
  const ledger = distributeLedger(payments, billingMonths, null, y, advanceLinks, offGridTargetFeeMap);
  const dueThroughMonth = resolveDueThroughCalendarMonth(y, reportOptions.current_month);

  const byMonth = new Map(ledger.monthRows.map((row) => [row.month, row]));
  const monthly = [];
  for (let m = 1; m <= 12; m += 1) {
    const row = byMonth.get(m);
    if (!row) {
      monthly.push({ month: m, fee: 0, paid: 0, remaining: 0, status: "neutral" });
      continue;
    }
    const fee = roundMoney(row.feeDisplay != null ? row.feeDisplay : row.fee);
    const paid = roundMoney(row.paidDisplay != null ? row.paidDisplay : row.paid);
    const remaining = Math.max(0, roundMoney(fee - paid));
    let status = "neutral";
    if (fee > 0 && paid >= fee) status = "paid";
    else if (fee > 0 && paid > 0) status = "partial";
    else if (fee > 0) status = "unpaid";
    monthly.push({ month: m, fee, paid, remaining, status });
  }

  const excludeTargetKeys = bundledTargetMonthKeysForYear(
    y,
    billingMonths,
    advanceLinks,
    offGridTargetFeeMap
  );
  const current_due = sumMonthlyDueThroughMonth(monthly, dueThroughMonth, y, excludeTargetKeys);

  let className = enrollment.class_name || "—";
  if (studentRow.graduation_year != null && Number.isInteger(Number(studentRow.graduation_year))) {
    className = `Alumni ${studentRow.graduation_year}`;
  } else if (enrollment.source === "alumni_post_graduation" && enrollment.graduation_year != null) {
    className = `Alumni ${enrollment.graduation_year}`;
  }

  const overallStatus = ledger.totalYearDue <= 0 ? "paid" : "partial";

  return {
    student_id: studentId,
    student_name: studentRow.name || "Unknown",
    class_name: className,
    total_year_due: ledger.totalYearDue,
    current_due,
    remaining: ledger.remaining,
    overall_status: overallStatus,
    monthly,
  };
}

module.exports = {
  computeStudentYearLedger,
  roundMoney,
  distributeLedger,
  buildBillingMonthsFromRange,
  inferPaymentAllocationLines,
  inferConcessionAllocationLines,
  attributedAmountForCalendarYear,
  concessionCountsTowardCalendarYear,
};
