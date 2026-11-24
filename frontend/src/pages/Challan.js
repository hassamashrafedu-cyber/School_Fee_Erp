import React, { useCallback, useEffect, useMemo, useState } from "react";

import API from "../api";
import ChallanPrint from "../components/ChallanPrint";
import { useSchoolSettings } from "../context/SchoolSettingsContext";
import { localDateInputValue } from "../utils/dateLocal";
import {
  applyAdvancedFeeToChallan,
  applyArrearsToChallan,
  getAdvancedFeeFromItems,
} from "../utils/challanAdjustUtils";
import { roundMoney } from "../utils/money";

import "./challanPage.css";

const MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

function buildYearOptions() {
  const y = new Date().getFullYear();
  const years = [];
  for (let i = y - 2; i <= y + 2; i += 1) years.push(i);
  return years;
}

const defaultSchool = {
  name: process.env.REACT_APP_SCHOOL_NAME || "School name",
  address: process.env.REACT_APP_SCHOOL_ADDRESS || "",
  phone: process.env.REACT_APP_SCHOOL_PHONE || "",
};

/**
 * Fee grid rows for challan: same order as Fee Setup — "Monthly fee" then extra columns (no Fine).
 * Amounts are class grid values for the given billing month (calendar month number 1–12).
 */
export function buildFeeLineItemsFromStructure(structure, billingMonth) {
  const m = Number(billingMonth);
  const rawMonths = Array.isArray(structure?.months) ? structure.months : [];
  const monthRow = rawMonths.find((x) => Number(x.month) === m);
  const monthly = roundMoney(Number(monthRow?.monthly_fee ?? monthRow?.fee ?? 0));

  const fromFee = Array.isArray(structure?.fee_components) ? structure.fee_components : null;
  const fromComp = Array.isArray(structure?.components) ? structure.components : null;
  const rawComps = (fromFee && fromFee.length > 0 ? fromFee : fromComp) || [];
  const comps = rawComps.filter((c) => String(c.label || "").trim().toLowerCase() !== "fine");
  const sorted = [...comps].sort((a, b) => {
    const ao = Number(a.sort_order ?? 0);
    const bo = Number(b.sort_order ?? 0);
    if (ao !== bo) return ao - bo;
    return String(a.label || "").localeCompare(String(b.label || ""));
  });

  const rows = [{ label: "Monthly fee", amount: monthly }];
  for (const c of sorted) {
    const amts = c.amounts || {};
    const v = amts[String(m)] ?? amts[m];
    const num = v === undefined || v === null || v === "" ? 0 : roundMoney(Number(v));
    rows.push({ label: String(c.label || "").trim() || "Fee", amount: num });
  }
  return rows;
}

export function buildFeeLineItemsFromSummary(summary) {
  const total = Number(summary?.total_fee ?? 0);
  const tuition = Number(summary?.tuition_amount);
  const exam = Number(summary?.exam_amount);
  const misc = Number(summary?.misc_amount);

  const hasBreakdown =
    (!Number.isNaN(tuition) && tuition > 0) ||
    (!Number.isNaN(exam) && exam > 0) ||
    (!Number.isNaN(misc) && misc > 0);

  if (hasBreakdown) {
    const rows = [];
    if (!Number.isNaN(tuition) && tuition > 0) rows.push({ label: "Tuition", amount: tuition });
    if (!Number.isNaN(exam) && exam > 0) rows.push({ label: "Exam fee", amount: exam });
    if (!Number.isNaN(misc) && misc > 0) rows.push({ label: "Other fees", amount: misc });
    const sumParts = rows.reduce((a, r) => a + r.amount, 0);
    const remainder = Math.max(0, total - sumParts);
    if (remainder > 0) rows.push({ label: "Additional fees", amount: remainder });
    return rows.length ? rows : [{ label: "Total fees (all challans)", amount: total }];
  }

  if (total > 0) {
    return [{ label: "Total fees (all challans)", amount: total }];
  }
  return [{ label: "No challan charges recorded", amount: 0 }];
}

/**
 * @param {object} student — row from GET /students
 * @param {object} summary — row from GET /student-summary/:id
 * @param {{ classNameById: Record<string,string>, sectionNameById: Record<string,string>, school?: object }} ctx
 * @param {{ feeLineItems?: Array<{ label: string, amount: number }>, feeStructure?: object } | undefined} options — prefer `feeLineItems` from GET /fees/challan-lines (applies student overrides); else class grid from GET /fees/structure.
 */
export function buildChallanData(student, summary, ctx, options = {}) {
  const { classNameById, sectionNameById, school } = ctx;
  const { feeLineItems, feeStructure } = options;
  const issue = new Date();
  const due = new Date(issue);
  due.setDate(due.getDate() + 14);

  const billDate = new Date(issue.getFullYear(), issue.getMonth() + 1, 1);
  const billingMonth = billDate.getMonth() + 1;

  const feeMonth = billDate.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
  const lastFeeDeposit = new Date(issue.getFullYear(), issue.getMonth(), 1).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });

  const totalFee = Number(summary.total_fee ?? 0);
  const paid = Number(summary.total_paid ?? 0);
  const balance = Number(summary.remaining ?? 0);

  const previousHistory = Array.isArray(summary.previous_history)
    ? summary.previous_history.map((r) => ({
        month: r.month || "-",
        paid: Number(r.paid || 0),
        arrear: Number(r.arrear || 0),
      }))
    : [];

  let items;
  if (feeLineItems && feeLineItems.length) {
    items = feeLineItems.map((row) => ({
      label: String(row.label || "Fee").trim() || "Fee",
      amount: roundMoney(Number(row.amount ?? 0)),
    }));
  } else if (feeStructure && student.current_class_id) {
    items = buildFeeLineItemsFromStructure(feeStructure, billingMonth);
  } else {
    items = buildFeeLineItemsFromSummary(summary);
  }

  return {
    statement_ref: student.id,
    school: { ...defaultSchool, ...(school || {}) },
    student: {
      id: student.id || "",
      name: student.name || "—",
      phone: student.phone || "",
      father_name: student.father_name || "",
      class_name: classNameById[student.current_class_id] || "—",
      section_name: sectionNameById[student.current_section_id] || "—",
    },
    items,
    previous: previousHistory,
    staticFields: {
      conc: Number(summary.conc ?? 0),
      feeGroup: summary.fee_group || "A",
      familyNo: summary.family_no || "N/A",
      category: summary.category || "GEN",
      admNo: summary.adm_no || "( NA )",
      lastFeeDeposit,
      feeMonth,
    },
    summary: {
      total: totalFee,
      paid,
      balance,
    },
    due_date: due.toISOString(),
    issue_date: issue.toISOString(),
    slip_no: summary.slip_no || `S-${String(student.id || "").slice(0, 8)}`,
    late_fee: Number(summary.late_fee ?? 0),
    challan_id: summary.challan_id || null,
    notes: "",
  };
}

export default function Challan() {
  const { fineConfig } = useSchoolSettings();
  const now = useMemo(() => new Date(), []);
  const yearOptions = useMemo(() => buildYearOptions(), []);

  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);

  const [challans, setChallans] = useState([]);
  const [sections, setSections] = useState([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [selectedGender, setSelectedGender] = useState("all");
  const [selectedStudent, setSelectedStudent] = useState("");

  const [issueDate, setIssueDate] = useState(() => localDateInputValue(now));
  const [feeMonth, setFeeMonth] = useState(now.getMonth() + 1);
  const [feeYear, setFeeYear] = useState(now.getFullYear());

  const [loading, setLoading] = useState(true);
  const [busyMessage, setBusyMessage] = useState("");
  const [error, setError] = useState("");
  const [skipNotice, setSkipNotice] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      API.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      delete API.defaults.headers.common.Authorization;
    }
  }, []);

  const loadBaseData = useCallback(async () => {
    setLoading(true);
    setBusyMessage("Loading students and classes…");
    setError("");
    try {
      const [studentsRes, classesRes] = await Promise.all([API.get("/students"), API.get("/classes")]);
      const studentRows = Array.isArray(studentsRes.data) ? studentsRes.data : [];
      const classRows = Array.isArray(classesRes.data) ? classesRes.data : [];
      setStudents(studentRows);
      setClasses(classRows);
      setChallans([]);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load data");
      setStudents([]);
      setClasses([]);
    } finally {
      setLoading(false);
      setBusyMessage("");
    }
  }, []);

  useEffect(() => {
    loadBaseData();
  }, [loadBaseData]);

  const fetchSectionOptions = useCallback(async (classId) => {
    if (!classId) {
      setSections([]);
      return;
    }
    try {
      const { data } = await API.get(`/sections/${classId}`);
      setSections(Array.isArray(data) ? data : []);
    } catch {
      setSections([]);
    }
  }, []);

  useEffect(() => {
    setSelectedSection("");
    if (!selectedClass) {
      setSections([]);
      return;
    }
    fetchSectionOptions(selectedClass);
  }, [selectedClass, fetchSectionOptions]);

  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      if (selectedClass && String(s.current_class_id) !== String(selectedClass)) return false;
      if (selectedSection && String(s.current_section_id) !== String(selectedSection)) return false;
      if (selectedGender !== "all") {
        const g = String(s.gender || "").toLowerCase();
        if (g !== selectedGender) return false;
      }
      return true;
    });
  }, [students, selectedClass, selectedSection, selectedGender]);

  useEffect(() => {
    if (!selectedStudent) return;
    const stillVisible = filteredStudents.some((s) => s.id === selectedStudent);
    if (!stillVisible) setSelectedStudent("");
  }, [filteredStudents, selectedStudent]);

  const fetchSummariesAndBuild = async (targetStudents, message) => {
    if (!targetStudents.length) {
      setError("No students in scope.");
      setChallans([]);
      return;
    }
    setLoading(true);
    setBusyMessage(message);
    setError("");
    setSkipNotice("");
    try {
      const { data } = await API.post("/challans/generate-preview", {
        issue_date: issueDate,
        fee_month: feeMonth,
        fee_year: feeYear,
        student_ids: targetStudents.map((s) => s.id),
      });

      const rows = Array.isArray(data?.challans) ? data.challans : [];
      const skippedCount = Number(data?.skipped_count ?? 0);
      const skippedList = Array.isArray(data?.skipped_students) ? data.skipped_students : [];
      const paidSkipCount = skippedList.filter((s) => s.skip_reason === "paid").length;
      const setupSkipCount = skippedList.filter((s) => s.skip_reason === "no_fee_setup").length;
      const monthLabel = MONTH_OPTIONS.find((m) => m.value === feeMonth)?.label || `Month ${feeMonth}`;

      const skipParts = [];
      if (setupSkipCount > 0) {
        skipParts.push(
          `${setupSkipCount} not in Fee Setup for ${monthLabel} ${feeYear}`
        );
      }
      if (paidSkipCount > 0) {
        skipParts.push(`${paidSkipCount} already paid for ${monthLabel} ${feeYear}`);
      }
      const skipDetail =
        skipParts.length > 0 ? skipParts.join("; ") : `${skippedCount} skipped`;

      if (skippedCount > 0 && rows.length === 0) {
        setError(`No challans generated: ${skipDetail}.`);
        setChallans([]);
        return;
      }

      if (skippedCount > 0) {
        setSkipNotice(`Skipped ${skipDetail}. Generated ${rows.length} challan(s).`);
      }
      const built = rows.map((row) => {
        const calculatedAdvanced = getAdvancedFeeFromItems(row.items);
        return {
          ...row,
          calculated_arrears: roundMoney(Number(row.arrears ?? 0)),
          calculated_advanced_fee: calculatedAdvanced != null ? calculatedAdvanced : undefined,
          school: { ...defaultSchool },
        };
      });
      setChallans(built);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to generate challans");
      setChallans([]);
    } finally {
      setLoading(false);
      setBusyMessage("");
    }
  };

  const onGenerateSingle = () => {
    if (!selectedStudent) {
      setError("Select a student first.");
      return;
    }
    const student = students.find((s) => s.id === selectedStudent);
    if (!student) {
      setError("Student not found.");
      return;
    }
    return fetchSummariesAndBuild([student], "Generating challan…");
  };

  const onGenerateClass = () => {
    if (!selectedClass) {
      setError("Select a class to generate class challans.");
      return;
    }
    if (!filteredStudents.length) {
      setError("No students match the selected class, section, and gender filters.");
      return;
    }
    return fetchSummariesAndBuild(filteredStudents, "Generating challans for class…");
  };

  const onGenerateAll = () => {
    if (!filteredStudents.length) {
      setError("No students match the current filters.");
      return;
    }
    return fetchSummariesAndBuild(filteredStudents, "Generating challans for filtered students…");
  };

  const handleArrearsChange = useCallback(
    (challanKey, rawValue) => {
      setChallans((prev) =>
        prev.map((row) => {
          const key = row.statement_ref || row.student?.id;
          if (String(key) !== String(challanKey)) return row;
          return applyArrearsToChallan(row, rawValue, fineConfig);
        })
      );
    },
    [fineConfig]
  );

  const handleAdvancedFeeChange = useCallback(
    (challanKey, rawValue) => {
      setChallans((prev) =>
        prev.map((row) => {
          const key = row.statement_ref || row.student?.id;
          if (String(key) !== String(challanKey)) return row;
          return applyAdvancedFeeToChallan(row, rawValue, fineConfig);
        })
      );
    },
    [fineConfig]
  );

  const handleChallanAdjustmentsReset = useCallback(
    (challanKey) => {
      setChallans((prev) =>
        prev.map((row) => {
          const key = row.statement_ref || row.student?.id;
          if (String(key) !== String(challanKey)) return row;
          const defaultArrears =
            row.calculated_arrears != null ? row.calculated_arrears : roundMoney(Number(row.arrears ?? 0));
          let next = applyArrearsToChallan(row, defaultArrears, fineConfig);
          if (getAdvancedFeeFromItems(row.items) !== null || row.calculated_advanced_fee != null) {
            const defaultAdvanced =
              row.calculated_advanced_fee != null
                ? row.calculated_advanced_fee
                : getAdvancedFeeFromItems(row.items) ?? 0;
            next = applyAdvancedFeeToChallan(next, defaultAdvanced, fineConfig);
          }
          return next;
        })
      );
    },
    [fineConfig]
  );

  return (
    <section className="page-card challan-gen">
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title page-title">Challan generation</h1>
          <p className="page-header__subtitle challan-gen__intro">
            Load summaries in parallel for fast bulk runs. Filter, review, then print.
          </p>
        </div>
      </div>

      <ol className="challan-gen__flow" aria-label="Challan workflow">
        <li className="challan-gen__flow-step is-active">
          <span className="challan-gen__flow-num">1</span> Filters
        </li>
        <li className={`challan-gen__flow-step${loading ? " is-active" : ""}`}>
          <span className="challan-gen__flow-num">2</span> Review
        </li>
        <li className="challan-gen__flow-step">
          <span className="challan-gen__flow-num">3</span> Print
        </li>
      </ol>

      {error ? (
        <div className="alert alert--error challan-gen__banner" role="alert">
          {error}
        </div>
      ) : null}
      {loading && busyMessage ? (
        <div className="alert alert--info challan-gen__banner challan-gen__banner--info" role="status">
          {busyMessage}
        </div>
      ) : null}
      {skipNotice ? (
        <div className="alert alert--warn challan-gen__banner challan-gen__banner--skip" role="status">
          {skipNotice}
        </div>
      ) : null}

      <div className="challan-gen__toolbar challan-gen__toolbar--filters">
        <label className="label">
          Issue date
          <input
            className="input"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            disabled={loading}
          />
        </label>
        <label className="label">
          Fee month
          <select
            className="input"
            value={feeMonth}
            onChange={(e) => setFeeMonth(Number(e.target.value))}
            disabled={loading}
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Fee year
          <select
            className="input"
            value={feeYear}
            onChange={(e) => setFeeYear(Number(e.target.value))}
            disabled={loading}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="challan-gen__intro challan-gen__hint">
        Issue date appears on the challan footer only. Fee month and year control fee amounts and due date (10th).
        Arrears default from previous months unpaid; Advanced fee from class setup / overrides — you can edit both per
        student before print.
      </p>

      <div className="challan-gen__toolbar">
        <label className="label">
          Filter by class
          <select className="input" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} disabled={loading}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Section
          <select
            className="input"
            value={selectedSection}
            onChange={(e) => setSelectedSection(e.target.value)}
            disabled={loading || !selectedClass}
          >
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Gender
          <select
            className="input"
            value={selectedGender}
            onChange={(e) => setSelectedGender(e.target.value)}
            disabled={loading}
          >
            <option value="all">All</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </label>
        <label className="label">
          Student (single print)
          <select className="input" value={selectedStudent} onChange={(e) => setSelectedStudent(e.target.value)} disabled={loading}>
            <option value="">Select student</option>
            {filteredStudents.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="challan-gen__actions">
        <button type="button" className="button" onClick={onGenerateSingle} disabled={loading}>
          Generate selected
        </button>
        <button type="button" className="button" onClick={onGenerateClass} disabled={loading}>
          Generate class
        </button>
        <button type="button" className="button" onClick={onGenerateAll} disabled={loading}>
          Generate all
        </button>
        <button type="button" className="button challan-gen__btn--secondary" onClick={loadBaseData} disabled={loading}>
          Refresh data
        </button>
      </div>

      <p className="challan-gen__intro">
        In scope: <strong>{filteredStudents.length}</strong> student(s) · Loaded: <strong>{students.length}</strong>
      </p>

      {challans.length > 0 ? (
        <ChallanPrint
          data={challans}
          editableArrears
          onArrearsChange={handleArrearsChange}
          onAdvancedFeeChange={handleAdvancedFeeChange}
          onChallanAdjustmentsReset={handleChallanAdjustmentsReset}
        />
      ) : !loading ? (
        <p className="challan-gen__intro">Generate to show the print preview and A4 layout.</p>
      ) : null}
    </section>
  );
}
