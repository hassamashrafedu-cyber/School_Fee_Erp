const pool = require("../config/db");
const feeService = require("./feeService");
const feeLedgerService = require("./feeLedgerService");
const challanService = require("./challanService");
const feeAdvanceLinkService = require("./feeAdvanceLinkService");
const settingsService = require("./settingsService");
const { calcLateFineFromWithinDue, calcAfterDueFromWithinDue } = require("../utils/fineConfig");

class ChallanGenerationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChallanGenerationValidationError";
  }
}

const { roundMoney } = feeLedgerService;

const MONTH_SHORT_UPPER = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTH_SHORT_TITLE = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseYear(value) {
  const y = Number(value);
  if (!Number.isInteger(y) || y < 1900 || y > 2100) {
    throw new ChallanGenerationValidationError("fee_year must be a valid year");
  }
  return y;
}

function parseMonth(value) {
  const m = Number(value);
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw new ChallanGenerationValidationError("fee_month must be 1–12");
  }
  return m;
}

function parseIssueDate(value) {
  const s = String(value || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isNaN(d.getTime())) {
      return { date: d, isoDay: `${m[1]}-${m[2]}-${m[3]}` };
    }
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new ChallanGenerationValidationError("issue_date is invalid");
  }
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return { date: d, isoDay: `${y}-${mo}-${day}` };
}

function formatDueDateIsoDay(feeMonth, feeYear) {
  return `${feeYear}-${String(feeMonth).padStart(2, "0")}-10`;
}

function formatFeeMonthDisplay(month, year) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatMonthYearShort(month, year) {
  return formatFeeMonthDisplay(month, year);
}

function paymentHistorySortKey(payment) {
  const d = payment.payment_date || payment.created_at;
  const t = d ? new Date(d).getTime() : 0;
  const created = payment.created_at ? new Date(payment.created_at).getTime() : 0;
  return t * 1_000_000 + created;
}

function parsePaymentCalendarParts(payment) {
  const pd = payment?.payment_date || payment?.created_at;
  if (!pd) return null;
  const s = String(pd).trim();
  const isoDayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoDayOnly) {
    const year = Number(isoDayOnly[1]);
    const month = Number(isoDayOnly[2]);
    if (month >= 1 && month <= 12 && year >= 1900) return { month, year };
  }
  const d = new Date(pd);
  if (Number.isNaN(d.getTime())) return null;
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

function formatLastFeeDepositFromPaymentDate(payment) {
  const parts = parsePaymentCalendarParts(payment);
  if (!parts) return null;
  return formatMonthYearShort(parts.month, parts.year);
}

function formatPreviousTableMonth(month, year) {
  return `${MONTH_SHORT_UPPER[month - 1]}-${year}`;
}

function monthShortTitle(month) {
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return "";
  return MONTH_SHORT_TITLE[m - 1] || `M${m}`;
}

function isAdvancedFeeItemLabel(label) {
  const lab = String(label || "").trim().toLowerCase();
  return (
    lab === "advanced fee" ||
    lab === "advance fee" ||
    lab.startsWith("advanced fee ") ||
    lab.startsWith("advance fee ")
  );
}

/**
 * If advance link(s) exist for this fee month (source), label Advanced fee with target month name(s).
 * e.g. March source → May target → "Advanced fee May"
 */
function formatAdvancedFeeLabelFromLinks(links, feeMonth, feeYear) {
  const relevant = (links || []).filter(
    (link) =>
      link?.active !== false &&
      Number(link.source_year) === feeYear &&
      Number(link.source_month) === feeMonth
  );
  if (!relevant.length) return null;

  const sorted = [...relevant].sort((a, b) => {
    const ao = Number(a.sort_order ?? 0);
    const bo = Number(b.sort_order ?? 0);
    if (ao !== bo) return ao - bo;
    const ay = Number(a.target_year) - Number(b.target_year);
    if (ay !== 0) return ay;
    return Number(a.target_month) - Number(b.target_month);
  });

  const seen = new Set();
  const targetMonths = [];
  for (const link of sorted) {
    const tm = Number(link.target_month);
    const ty = Number(link.target_year);
    const key = `${ty}-${tm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = monthShortTitle(tm);
    if (name) targetMonths.push(name);
  }

  if (!targetMonths.length) return null;
  return targetMonths.length === 1
    ? `Advanced fee ${targetMonths[0]}`
    : `Advanced fee ${targetMonths.join(", ")}`;
}

function applyAdvancedFeeLabelToItems(items, advancedLabel) {
  if (!advancedLabel) return items;
  return (items || []).map((row) => {
    if (isAdvancedFeeItemLabel(row.label)) {
      return { ...row, label: advancedLabel };
    }
    return row;
  });
}

async function loadAdvanceLinksByClass(classIds, feeYear) {
  const map = new Map();
  const unique = [...new Set((classIds || []).map((id) => String(id)).filter(Boolean))];
  await Promise.all(
    unique.map(async (classId) => {
      try {
        const links = await feeAdvanceLinkService.listForClassYear(classId, feeYear);
        map.set(classId, Array.isArray(links) ? links : []);
      } catch {
        map.set(classId, []);
      }
    })
  );
  return map;
}

async function loadAdvanceLinksForStudentYears(studentRow, feeYear) {
  const classId = studentRow?.current_class_id;
  if (!classId) return [];

  const byId = new Map();
  for (let y = feeYear - 2; y <= feeYear; y += 1) {
    if (y < 2000) continue;
    try {
      const links = await feeAdvanceLinkService.listForClassYear(classId, y);
      for (const link of links || []) {
        if (link?.id != null) byId.set(String(link.id), link);
      }
    } catch {
      // Class/year without links — skip
    }
  }
  return [...byId.values()];
}

/**
 * Target months advanced-to from any source month before the selected fee month — skip in arrears
 * (e.g. May→Aug: August unpaid is not added when May already carried advance for August).
 */
function buildArrearsExcludeTargetKeys(advanceLinks, feeYear, feeMonth) {
  const exclude = new Set();
  const fy = Number(feeYear);
  const fm = Number(feeMonth);

  for (const link of advanceLinks || []) {
    if (link?.active === false) continue;
    const sy = Number(link.source_year);
    const sm = Number(link.source_month);
    const ty = Number(link.target_year);
    const tm = Number(link.target_month);
    if (!Number.isInteger(sy) || !Number.isInteger(sm) || sm < 1 || sm > 12) continue;
    if (!Number.isInteger(ty) || !Number.isInteger(tm) || tm < 1 || tm > 12) continue;

    const sourceBeforeFeeMonth = sy < fy || (sy === fy && sm < fm);
    if (!sourceBeforeFeeMonth) continue;

    const targetBeforeFeeMonth = ty < fy || (ty === fy && tm < fm);
    if (!targetBeforeFeeMonth) continue;

    exclude.add(`${ty}-${tm}`);
  }

  return exclude;
}

function sumArrearsFromLedgerMonthly(ledger, calendarYear, feeYear, feeMonth, excludeKeys) {
  const y = Number(calendarYear);
  const fy = Number(feeYear);
  const fm = Number(feeMonth);
  const monthCap = y < fy ? 12 : y === fy ? fm - 1 : 0;
  if (monthCap < 1) return 0;

  const exclude = excludeKeys instanceof Set ? excludeKeys : new Set();
  let total = 0;
  for (const row of ledger?.monthly || []) {
    const mo = Number(row.month);
    if (mo < 1 || mo > monthCap) continue;
    if (exclude.has(`${y}-${mo}`)) continue;
    total += Math.max(0, roundMoney(Number(row.remaining || 0)));
  }
  return roundMoney(total);
}

/** Count months before fee month that still have remaining > 0 (for per-month late fine). */
function countUnpaidArrearsMonthsFromLedger(ledger, calendarYear, feeYear, feeMonth, excludeKeys) {
  const y = Number(calendarYear);
  const fy = Number(feeYear);
  const fm = Number(feeMonth);
  const monthCap = y < fy ? 12 : y === fy ? fm - 1 : 0;
  if (monthCap < 1) return 0;

  const exclude = excludeKeys instanceof Set ? excludeKeys : new Set();
  let count = 0;
  for (const row of ledger?.monthly || []) {
    const mo = Number(row.month);
    if (mo < 1 || mo > monthCap) continue;
    if (exclude.has(`${y}-${mo}`)) continue;
    if (Math.max(0, roundMoney(Number(row.remaining || 0))) > 0) count += 1;
  }
  return count;
}

/**
 * Arrears — unpaid balance for months BEFORE selected fee month/year only (not the current fee month).
 * Skips advance-link target months when a prior source month already advanced to them.
 */
async function computeArrearsBeforeFeeMonth(studentRow, feeMonth, feeYear) {
  let advanceLinks = [];
  try {
    advanceLinks = await loadAdvanceLinksForStudentYears(studentRow, feeYear);
  } catch {
    advanceLinks = [];
  }
  const excludeKeys = buildArrearsExcludeTargetKeys(advanceLinks, feeYear, feeMonth);

  let total = 0;
  let unpaidMonthCount = 0;
  for (let y = feeYear - 2; y <= feeYear; y += 1) {
    if (y < 2000) continue;
    try {
      const ledger = await feeLedgerService.computeStudentYearLedger(studentRow, y, {});
      total += sumArrearsFromLedgerMonthly(ledger, y, feeYear, feeMonth, excludeKeys);
      unpaidMonthCount += countUnpaidArrearsMonthsFromLedger(ledger, y, feeYear, feeMonth, excludeKeys);
    } catch {
      // Year without fee config / enrollment — skip
    }
  }

  return {
    arrears: roundMoney(total),
    unpaid_month_count: unpaidMonthCount,
  };
}

/** True when the student's class Fee Setup includes the selected fee month (billing range). */
async function isFeeMonthInFeeSetupForStudent(studentRow, feeMonth, feeYear, billingCache) {
  const classId = studentRow.current_class_id;
  if (!classId) return false;
  try {
    const key = `${classId}:${feeYear}`;
    let billing = billingCache?.get(key);
    if (!billing) {
      billing = await feeService.readFeeConfigForClass(feeYear, classId);
      billingCache?.set(key, billing);
    }
    const m = Number(feeMonth);
    return m >= billing.start_month && m <= billing.end_month;
  } catch {
    return false;
  }
}

/** True when Fee Collection shows the selected fee month fully paid (no challan needed). */
async function isFeeMonthFullyPaidForStudent(studentRow, feeMonth, feeYear) {
  try {
    const ledger = await feeLedgerService.computeStudentYearLedger(studentRow, feeYear, {});
    const row = (ledger.monthly || []).find((m) => Number(m.month) === Number(feeMonth));
    if (!row) return false;
    const fee = roundMoney(Number(row.fee ?? 0));
    if (fee <= 0) return false;
    if (String(row.status || "").toLowerCase() === "paid") return true;
    return roundMoney(Number(row.remaining ?? 0)) <= 0;
  } catch {
    return false;
  }
}

/** Last fee deposit = month/year of the latest payment date in Fee Collection history; "Nill" if none. */
async function resolveLastFeeDeposit(studentId) {
  let payments;
  try {
    payments = await challanService.getStudentPayments(studentId);
  } catch {
    payments = [];
  }

  const rows = Array.isArray(payments) ? payments : [];
  if (!rows.length) return "Nill";

  const sorted = [...rows].sort((a, b) => paymentHistorySortKey(b) - paymentHistorySortKey(a));
  return formatLastFeeDepositFromPaymentDate(sorted[0]) || "Nill";
}

/** Previous fee summary rows (up to 9) — months before selected fee month/year in billing history. */
async function buildPreviousFeeSummary(studentRow, feeMonth, feeYear) {
  const rows = [];

  for (let y = feeYear - 1; y <= feeYear; y += 1) {
    if (y < 2000) continue;
    let ledger;
    try {
      ledger = await feeLedgerService.computeStudentYearLedger(studentRow, y, {});
    } catch {
      continue;
    }
    for (const m of ledger.monthly || []) {
      const mo = Number(m.month);
      if (mo < 1 || mo > 12) continue;
      if (y > feeYear || (y === feeYear && mo >= feeMonth)) continue;
      const fee = Number(m.fee || 0);
      const paid = Number(m.paid || 0);
      if (fee <= 0 && paid <= 0) continue;
      rows.push({
        month: formatPreviousTableMonth(mo, y),
        paid: roundMoney(paid),
        arrear: Math.max(0, roundMoney(Number(m.remaining || 0))),
        sortKey: y * 100 + mo,
      });
    }
  }

  rows.sort((a, b) => a.sortKey - b.sortKey);
  return rows.slice(-9).map(({ month, paid, arrear }) => ({ month, paid, arrear }));
}

async function loadLookupMaps() {
  const [classRes, sectionRes] = await Promise.all([
    pool.query(`SELECT id, name FROM classes WHERE deleted_at IS NULL`),
    pool.query(`SELECT id, name FROM sections WHERE deleted_at IS NULL`),
  ]);
  const classNameById = {};
  const sectionNameById = {};
  classRes.rows.forEach((r) => {
    classNameById[r.id] = r.name;
  });
  sectionRes.rows.forEach((r) => {
    sectionNameById[r.id] = r.name;
  });
  return { classNameById, sectionNameById };
}

async function loadStudentsByIds(studentIds) {
  if (!studentIds.length) return [];
  const result = await pool.query(
    `
      SELECT
        id,
        name,
        father_name,
        phone,
        current_class_id,
        current_section_id
      FROM students
      WHERE id = ANY($1::uuid[])
        AND deleted_at IS NULL
      ORDER BY name ASC
    `,
    [studentIds]
  );
  return result.rows;
}

async function generateChallanForStudent(studentRow, ctx, params) {
  const { issueDate, issueDateIso, feeMonth, feeYear } = params;
  const studentId = studentRow.id;

  const [feeLinesPayload, arrearsInfo, lastFeeDeposit, previous] = await Promise.all([
    feeService.getChallanFeeLines({ student_id: studentId, year: feeYear, month: feeMonth }),
    computeArrearsBeforeFeeMonth(studentRow, feeMonth, feeYear),
    resolveLastFeeDeposit(studentId),
    buildPreviousFeeSummary(studentRow, feeMonth, feeYear),
  ]);

  const feeItemsRaw = (feeLinesPayload.items || []).map((row) => ({
    label: String(row.label || "Fee").trim() || "Fee",
    amount: roundMoney(Number(row.amount || 0)),
  }));

  const classId = studentRow.current_class_id ? String(studentRow.current_class_id) : "";
  const classLinks = classId && ctx.advanceLinksByClass ? ctx.advanceLinksByClass.get(classId) || [] : [];
  const advancedFeeLabel = formatAdvancedFeeLabelFromLinks(classLinks, feeMonth, feeYear);
  const feeItems = applyAdvancedFeeLabelToItems(feeItemsRaw, advancedFeeLabel);

  const arrears = roundMoney(Number(arrearsInfo?.arrears ?? 0));
  const unpaidPrevMonths = Math.max(0, Number(arrearsInfo?.unpaid_month_count ?? 0));
  // Fine months = each unpaid previous month + current fee month
  const fineMonthCount = Math.max(1, unpaidPrevMonths + 1);

  const feeMonthTotal = roundMoney(feeItems.reduce((s, r) => s + r.amount, 0));
  const withinDue = roundMoney(feeMonthTotal + arrears);
  const fineConfig = ctx.fineConfig || { fine_type: "percent", fine_value: 0 };
  const lateFee = calcLateFineFromWithinDue(withinDue, fineConfig, fineMonthCount);
  const afterDue = calcAfterDueFromWithinDue(withinDue, fineConfig, fineMonthCount);
  const dueDateIso = formatDueDateIsoDay(feeMonth, feeYear);

  const className = ctx.classNameById[studentRow.current_class_id] || "—";
  const sectionName = ctx.sectionNameById[studentRow.current_section_id] || "";

  return {
    statement_ref: studentId,
    student: {
      id: studentId,
      name: studentRow.name || "—",
      phone: studentRow.phone || "",
      father_name: studentRow.father_name || "",
      class_name: className,
      section_name: sectionName,
    },
    items: feeItems,
    arrears,
    previous,
    fine_month_count: fineMonthCount,
    staticFields: {
      lastFeeDeposit,
      feeMonth: formatFeeMonthDisplay(feeMonth, feeYear),
    },
    summary: {
      total: withinDue,
      paid: 0,
      balance: withinDue,
    },
    within_due: withinDue,
    after_due: afterDue,
    due_date: dueDateIso,
    issue_date: issueDateIso,
    slip_no: `S-${String(studentId).slice(0, 8)}`,
    late_fee: lateFee,
  };
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex;
      nextIndex += 1;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/**
 * Bulk dynamic challan preview for print.
 * @param {{ issue_date: string, fee_month: number, fee_year: number, student_ids: string[] }}
 */
async function generateChallanPreview({ issue_date, fee_month, fee_year, student_ids }) {
  if (!Array.isArray(student_ids) || !student_ids.length) {
    throw new ChallanGenerationValidationError("student_ids is required");
  }

  const parsedIssue = parseIssueDate(issue_date);
  const feeMonth = parseMonth(fee_month);
  const feeYear = parseYear(fee_year);

  const uniqueIds = [...new Set(student_ids.map((id) => String(id).trim()).filter(Boolean))];
  const [students, lookup, appSettings] = await Promise.all([
    loadStudentsByIds(uniqueIds),
    loadLookupMaps(),
    settingsService.getSettings(),
  ]);

  const byId = new Map(students.map((s) => [String(s.id), s]));
  const ordered = uniqueIds.map((id) => byId.get(id)).filter(Boolean);

  if (!ordered.length) {
    throw new ChallanGenerationValidationError("No valid students found for the given ids");
  }

  const ctx = {
    ...lookup,
    fineConfig: {
      fine_type: appSettings.fine_type,
      fine_value: appSettings.fine_value,
    },
    advanceLinksByClass: await loadAdvanceLinksByClass(
      ordered.map((s) => s.current_class_id),
      feeYear
    ),
  };
  const params = {
    issueDate: parsedIssue.date,
    issueDateIso: parsedIssue.isoDay,
    feeMonth,
    feeYear,
  };

  const billingCache = new Map();
  const toGenerate = [];
  const skippedStudents = [];
  for (const student of ordered) {
    if (!(await isFeeMonthInFeeSetupForStudent(student, feeMonth, feeYear, billingCache))) {
      skippedStudents.push({
        student_id: student.id,
        name: student.name || "Student",
        skip_reason: "no_fee_setup",
      });
      continue;
    }
    if (await isFeeMonthFullyPaidForStudent(student, feeMonth, feeYear)) {
      skippedStudents.push({
        student_id: student.id,
        name: student.name || "Student",
        skip_reason: "paid",
      });
      continue;
    }
    toGenerate.push(student);
  }

  const challans = await mapWithConcurrency(toGenerate, 6, (student) =>
    generateChallanForStudent(student, ctx, params)
  );

  return {
    issue_date: parsedIssue.isoDay,
    fee_month: feeMonth,
    fee_year: feeYear,
    challans,
    skipped_count: skippedStudents.length,
    skipped_students: skippedStudents,
  };
}

module.exports = {
  generateChallanPreview,
  ChallanGenerationValidationError,
  parseIssueDate,
  parseMonth,
  parseYear,
  formatFeeMonthDisplay,
  formatDueDateIsoDay,
  formatAdvancedFeeLabelFromLinks,
  isAdvancedFeeItemLabel,
  applyAdvancedFeeLabelToItems,
  buildArrearsExcludeTargetKeys,
  sumArrearsFromLedgerMonthly,
};
