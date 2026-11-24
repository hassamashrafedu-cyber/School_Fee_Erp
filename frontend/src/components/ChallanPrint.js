import React, { useEffect, useMemo, useState } from "react";
import defaultLogo from "../assets/logo.jpeg";
import { useSchoolSettings } from "../context/SchoolSettingsContext";
import {
  calcAfterDueFromWithinDue,
  countFineMonthsFromChallan,
  formatFineNote,
  getAdvancedFeeFromItems,
} from "../utils/challanAdjustUtils";

import "./challanPrint.css";

const FALLBACK_BRANDING = {
  school_name: "ISLAMIA MODEL SCHOOL",
  school_name_line2: "AND COLLEGE",
  address_line1: "CAMPUS KHARICK RAWALAKOT , AJK",
  address_line2: "",
  phone: "03125051520",
  academic_year: "",
  bank_name: "Easypaisa Bank Limited (For Online)",
  bank_account_no: "03408107933",
  logoUrl: defaultLogo,
  fineConfig: { fine_type: "percent", fine_value: 0 },
};

const COPY_LABELS = ["Student Copy", "School Copy", "Bank Copy"];

const PREV_ROW_COUNT = 9;

function toAmount(value) {
  const n = Math.round(Number(value || 0));
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtDate(value) {
  if (!value) return "";
  const s = String(value).trim();
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoDay) {
    const y = Number(isoDay[1]);
    const m = Number(isoDay[2]);
    const d = Number(isoDay[3]);
    return `${m}/${d}/${y}`;
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`;
}

function displayStudentId(id) {
  const s = String(id || "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) return s;
  if (s.length > 10) return s.slice(0, 8);
  return s;
}

/** Keep month on one line: MAY-2025 (not "May" / "2025" wrapped). */
function formatMonthCell(month) {
  const s = String(month ?? "").trim();
  if (!s || s === "-") return "-";

  if (/^[A-Za-z]{3}-\d{4}$/.test(s)) return s.toUpperCase();

  const named = s.match(/^([A-Za-z]+)[\s\-/]+(\d{4})$/);
  if (named) {
    return `${named[1].slice(0, 3).toUpperCase()}-${named[2]}`;
  }

  const iso = s.match(/^(\d{4})[\s\-/](\d{1,2})$/);
  if (iso) {
    const names = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const m = Number(iso[2]);
    if (m >= 1 && m <= 12) return `${names[m - 1]}-${iso[1]}`;
  }

  return s.replace(/\s+/g, "-").toUpperCase();
}

function normalizeRows(data) {
  if (Array.isArray(data)) return data;
  if (!data) return [];
  return [data];
}

function buildDynamicFeeRows(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const rows = items.map((row) => ({
    label: String(row.label || "Fee").trim() || "Fee",
    amount: Math.round(Number(row.amount || 0)),
  }));

  const arrears = Math.round(Number(data?.arrears ?? 0));
  rows.push({ label: "Arrears", amount: arrears, isArrears: true });

  return rows;
}

function sumFeeRowAmounts(rows) {
  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function normalizePreviousRows(previous) {
  const source = Array.isArray(previous) ? previous : [];
  const rows = source.slice(0, PREV_ROW_COUNT).map((row) => ({
    month: formatMonthCell(row.month),
    paid: Number(row.paid || 0),
    arrear: Number(row.arrear || 0),
  }));
  while (rows.length < PREV_ROW_COUNT) {
    rows.push({ month: "-", paid: 0, arrear: 0 });
  }
  return rows;
}

function ChallanCopy({ data, copyLabel, branding }) {
  const {
    student = {},
    summary = {},
    previous = [],
    due_date = "",
    issue_date = "",
    slip_no = "",
    staticFields = {},
    within_due,
  } = data || {};

  const brand = branding || FALLBACK_BRANDING;
  const phoneLine = brand.phone ? `PH : ${brand.phone}` : brand.address_line2 || "";
  const addrLine2 = brand.phone ? brand.address_line2 : "";

  const feeRows = buildDynamicFeeRows(data);
  const feeSum = sumFeeRowAmounts(feeRows);
  const withinDue =
    within_due != null
      ? Math.round(Number(within_due))
      : summary?.total != null && Number(summary.total) > 0
        ? Math.round(Number(summary.total))
        : feeSum;
  const fineMonthCount = countFineMonthsFromChallan(data);
  const afterDue = Math.round(
    calcAfterDueFromWithinDue(
      withinDue,
      brand.fineConfig || FALLBACK_BRANDING.fineConfig,
      fineMonthCount
    )
  );

  const prevRows = normalizePreviousRows(previous);
  const studentId = displayStudentId(student.id);
  const className = String(student.class_name || "").trim();
  const sectionName = String(student.section_name || "").trim();

  return (
    <section className="challan-copy">
      <header className="ch-copy-header">
        <div className="ch-school-row">
          <div className="ch-logo-wrap">
            <img src={brand.logoUrl || defaultLogo} alt="" className="ch-logo" />
          </div>
          <div className="ch-school-text">
            <div className="ch-school-name">
              <span className="ch-school-name-line">{brand.school_name || FALLBACK_BRANDING.school_name}</span>
              {brand.school_name_line2 ? (
                <span className="ch-school-name-line">{brand.school_name_line2}</span>
              ) : null}
            </div>
            <div className="ch-school-address">
              {brand.address_line1 ? <span className="ch-school-line">{brand.address_line1}</span> : null}
              {addrLine2 ? <span className="ch-school-line">{addrLine2}</span> : null}
              {phoneLine ? <span className="ch-school-line">{phoneLine}</span> : null}
              {brand.academic_year ? (
                <span className="ch-school-line ch-school-session">
                  Session {brand.academic_year}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="ch-student-area">
        <div className="ch-student-fields">
          <div className="ch-student-line">
            <span className="ch-lbl">Student ID :</span>{" "}
            <span className="ch-val">{studentId}</span>
          </div>
          <div className="ch-student-line">
            <span className="ch-lbl">Name :</span> <span className="ch-val">{student.name || ""}</span>
          </div>
          <div className="ch-student-line">
            <span className="ch-lbl">Father Name :</span>{" "}
            <span className="ch-val">{student.father_name || ""}</span>
          </div>
          <div className="ch-student-line">
            <span className="ch-lbl">Class :</span> <span className="ch-val">{className}</span>
          </div>
          <div className="ch-student-line">
            <span className="ch-lbl">Section :</span>{" "}
            <span className="ch-val">{sectionName}</span>
          </div>
          <div className="ch-student-line">
            <span className="ch-lbl">Last Fee Deposit :</span>{" "}
            <span className="ch-val">{staticFields.lastFeeDeposit || ""}</span>
          </div>
          <div className="ch-student-line">
            <span className="ch-lbl">Fee Month :</span>{" "}
            <span className="ch-val">{staticFields.feeMonth || ""}</span>
          </div>
          <div className="ch-student-line">
            <span className="ch-lbl">Bank Name :</span>{" "}
            <span className="ch-val">{brand.bank_name || ""}</span>
          </div>
          <div className="ch-student-line">
            <span className="ch-lbl">Account no :</span>{" "}
            <span className="ch-val">{brand.bank_account_no || ""}</span>
          </div>
        </div>
        <div className="ch-due-wrap">
          <div className="ch-due-box">
            <div className="ch-due-head">DUE DATE</div>
            <div className="ch-due-date">{fmtDate(due_date)}</div>
          </div>
        </div>
      </div>

      <div className="ch-middle-tables">
        <div className="ch-table-prev-wrap">
          <table className="ch-table ch-prev-table">
            <thead>
              <tr className="ch-prev-title">
                <th colSpan={3}>PREVIOUS FEE SUMMARY</th>
              </tr>
              <tr className="ch-prev-head">
                <th>Month</th>
                <th>Paid</th>
                <th>Arrear</th>
              </tr>
            </thead>
            <tbody className="ch-prev-body">
              {prevRows.map((row, i) => (
                <tr key={`${row.month}-${i}`}>
                  <td className="ch-prev-month">{formatMonthCell(row.month)}</td>
                  <td className="ch-num">{toAmount(row.paid)}</td>
                  <td className="ch-num">{toAmount(row.arrear)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ch-table-fee-wrap">
          <table className="ch-table ch-fee-table">
            <tbody>
              {feeRows.map((row) => (
                <tr key={row.label} className={row.isArrears ? "ch-fee-row-arrears" : undefined}>
                  <td className="ch-fee-label">{row.label}</td>
                  <td className="ch-amt">{toAmount(row.amount)}</td>
                </tr>
              ))}
              <tr className="ch-fee-row-highlight">
                <td className="ch-fee-label">With in Due Date</td>
                <td className="ch-amt">{toAmount(withinDue)}</td>
              </tr>
              <tr className="ch-fee-row-highlight">
                <td className="ch-fee-label">After Due date</td>
                <td className="ch-amt">{toAmount(afterDue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="ch-notes">
        <div>{formatFineNote(brand.fineConfig || FALLBACK_BRANDING.fineConfig)}</div>
      </div>

      <div className="ch-accountant">
        <div className="ch-accountant-line">
          <span className="ch-ac-field">
            Paid amount: <span className="ch-ac-blank" />
          </span>
          <span className="ch-ac-field">
            Concession: <span className="ch-ac-blank" />
          </span>
          <span className="ch-ac-field ch-ac-field--remaining">
            Remaining: <span className="ch-ac-blank ch-ac-blank--remaining" />
          </span>
        </div>
        <div className="ch-accountant-line">
          <span className="ch-ac-field">
            Accountant Sign: <span className="ch-ac-blank ch-ac-blank--wide" />
          </span>
          <span className="ch-ac-field">
            Paid date: <span className="ch-ac-blank ch-ac-blank--wide" />
          </span>
        </div>
      </div>

      <footer className="ch-footer">
        <div className="ch-footer-left">
          <span>Issue Date: {fmtDate(issue_date)}</span>
          <span>Slip #: {slip_no || ""}</span>
        </div>
        <div className="ch-copy-label">{copyLabel}</div>
      </footer>
    </section>
  );
}

function ChallanSheet({ data, branding }) {
  return (
    <div className="challan-row">
      {COPY_LABELS.map((label) => (
        <ChallanCopy key={label} data={data} copyLabel={label} branding={branding} />
      ))}
    </div>
  );
}

/** Map GET /challans/:id payload to ChallanPrint `data` shape. */
export function mapChallanDetailToPrintData(detail) {
  if (!detail || !detail.challan) {
    return {
      student: {},
      items: [],
      arrears: 0,
      summary: { total: 0, paid: 0, balance: 0 },
      previous: [],
      due_date: "",
      issue_date: "",
      slip_no: "",
      staticFields: {},
      within_due: 0,
    };
  }
  const { challan, student, items, totals } = detail;
  const st = student || {};
  const ch = challan;
  const mappedItems = (items || []).map((it) => ({
    label: it.fee_type_name || it.label || "Fee",
    amount: Number(it.amount || 0),
  }));
  const totalFee =
    totals?.total_fee != null
      ? Number(totals.total_fee)
      : mappedItems.reduce((s, it) => s + Number(it.amount || 0), 0);

  return {
    student: {
      id: st.id || "",
      name: st.name || "",
      father_name: st.father_name || "",
      class_name: st.class_name || "",
      section_name: st.section_name || "",
    },
    items: mappedItems,
    arrears: 0,
    summary: {
      total: totalFee,
      paid: totals?.total_paid ?? 0,
      balance: totals?.remaining ?? 0,
    },
    previous: [],
    due_date: ch.due_date,
    issue_date: ch.issue_date,
    slip_no: ch.slip_no || ch.id || "",
    staticFields: {
      lastFeeDeposit: "",
      feeMonth: "",
    },
    within_due: totalFee,
  };
}

function challanRowKey(row, idx) {
  return row?.statement_ref || row?.student?.id || idx;
}

function ChallanAdjustmentsEditor({
  challans,
  onArrearsChange,
  onAdvancedFeeChange,
  onChallanAdjustmentsReset,
}) {
  if (!challans.length) return null;

  return (
    <section className="challan-arrears-edit no-print" aria-label="Edit challan amounts">
      <h2 className="challan-arrears-edit__title">Edit arrears &amp; advanced fee (optional)</h2>
      <p className="challan-arrears-edit__hint">
        Arrears default from unpaid months before the selected fee month. Advanced fee comes from class setup and advance
        links. Change any amount before printing; Within Due Date updates automatically.
      </p>
      <div className="challan-arrears-edit__list">
        {challans.map((row, idx) => {
          const key = challanRowKey(row, idx);
          const name = String(row?.student?.name || "Student").trim() || "Student";
          const classText = [row?.student?.class_name, row?.student?.section_name].filter(Boolean).join(" - ");
          const defaultArrears =
            row?.calculated_arrears != null ? row.calculated_arrears : row?.arrears ?? 0;
          const advancedAmount = getAdvancedFeeFromItems(row.items);
          const hasAdvanced = advancedAmount !== null || row?.calculated_advanced_fee != null;
          const currentAdvanced = advancedAmount ?? row?.calculated_advanced_fee ?? 0;
          const defaultAdvanced =
            row?.calculated_advanced_fee != null ? row.calculated_advanced_fee : currentAdvanced;
          const arrearsEdited =
            row?.calculated_arrears != null &&
            Math.round(Number(row.arrears ?? 0)) !== Math.round(Number(defaultArrears));
          const advancedEdited =
            hasAdvanced && Math.round(Number(currentAdvanced)) !== Math.round(Number(defaultAdvanced));
          const isEdited = arrearsEdited || advancedEdited;

          return (
            <div key={key} className="challan-arrears-edit__row">
              <div className="challan-arrears-edit__meta">
                <span className="challan-arrears-edit__name">{name}</span>
                {classText ? <span className="challan-arrears-edit__class">{classText}</span> : null}
              </div>
              <div className="challan-arrears-edit__fields">
                <label className="challan-arrears-edit__field label">
                  Arrears
                  <input
                    className="input challan-arrears-edit__input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={row.arrears ?? 0}
                    onChange={(e) => onArrearsChange?.(key, e.target.value)}
                  />
                </label>
                {hasAdvanced ? (
                  <label className="challan-arrears-edit__field label">
                    Advanced fee
                    <input
                      className="input challan-arrears-edit__input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={currentAdvanced}
                      onChange={(e) => onAdvancedFeeChange?.(key, e.target.value)}
                    />
                  </label>
                ) : null}
              </div>
              <span className="challan-arrears-edit__within">Within due: {toAmount(row.within_due ?? 0)}</span>
              {onChallanAdjustmentsReset && isEdited ? (
                <button
                  type="button"
                  className="button challan-arrears-edit__reset"
                  onClick={() => onChallanAdjustmentsReset(key)}
                >
                  Reset
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function ChallanPrint({
  data,
  editableArrears = false,
  onArrearsChange,
  onAdvancedFeeChange,
  onChallanAdjustmentsReset,
}) {
  const { settings, logoUrl, fineConfig } = useSchoolSettings();
  const branding = useMemo(
    () => ({
      school_name: settings.school_name || FALLBACK_BRANDING.school_name,
      school_name_line2: settings.school_name_line2 || "",
      address_line1: settings.address_line1 || FALLBACK_BRANDING.address_line1,
      address_line2: settings.address_line2 || "",
      phone: settings.phone || FALLBACK_BRANDING.phone,
      academic_year: String(settings.academic_year || "").trim(),
      bank_name: settings.bank_name || FALLBACK_BRANDING.bank_name,
      bank_account_no: settings.bank_account_no || FALLBACK_BRANDING.bank_account_no,
      logoUrl: logoUrl || defaultLogo,
      fineConfig: fineConfig || FALLBACK_BRANDING.fineConfig,
    }),
    [settings, logoUrl, fineConfig]
  );
  const challans = useMemo(() => normalizeRows(data), [data]);
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);

  const challansKey = useMemo(
    () => challans.map((row, idx) => row?.statement_ref || row?.student?.id || idx).join("|"),
    [challans]
  );

  useEffect(() => {
    setAdjustmentsOpen(false);
  }, [challansKey]);

  if (!challans.length) return null;

  const showAdjustments = editableArrears && onArrearsChange;

  return (
    <div className="challan-print-wrap">
      {showAdjustments ? (
        <div className="challan-adjustments-toggle no-print">
          <div className="challan-adjustments-toggle__actions">
            <button type="button" className="button" onClick={() => setAdjustmentsOpen(true)}>
              Edit Arrears and Advanced Fee
            </button>
            {adjustmentsOpen ? (
              <button
                type="button"
                className="button challan-adjustments-toggle__hide"
                onClick={() => setAdjustmentsOpen(false)}
              >
                Hide
              </button>
            ) : null}
          </div>
          {adjustmentsOpen ? (
            <ChallanAdjustmentsEditor
              challans={challans}
              onArrearsChange={onArrearsChange}
              onAdvancedFeeChange={onAdvancedFeeChange}
              onChallanAdjustmentsReset={onChallanAdjustmentsReset}
            />
          ) : null}
        </div>
      ) : null}
      <div id="print-area" className="print-area">
        {challans.map((row, idx) => (
          <div key={row?.statement_ref || row?.slip_no || idx} className="challan-page challan">
            <ChallanSheet data={row} branding={branding} />
          </div>
        ))}
      </div>
      <button type="button" className="button no-print challan-print-screen-btn" onClick={() => window.print()}>
        {challans.length > 1 ? `Print (${challans.length})` : "Print"}
      </button>
    </div>
  );
}
