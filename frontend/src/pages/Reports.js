import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";

import API from "../api";

import "./reports.css";
import { toMoney } from "../utils/money";
import { getPageState, setPageState } from "../utils/pageStateCache";

const YEAR_STORAGE_KEY = "fee_collection_calendar_year";
const PRINT_PAGE_STYLE_ID = "reports-print-page-size";
const REPORTS_PAGE_CACHE_KEY = "reports";

function readReportsCache() {
  const cached = getPageState(REPORTS_PAGE_CACHE_KEY);
  return cached && typeof cached === "object" ? cached : null;
}

const MONTH_OPTIONS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
];

function isAlumniOption(value) {
  return String(value || "").startsWith("alumni:");
}

function alumniYearFromOption(value) {
  const raw = String(value || "");
  if (!raw.startsWith("alumni:")) return null;
  const y = Number(raw.slice("alumni:".length));
  return Number.isInteger(y) ? y : null;
}

function normalizeStatus(value) {
  const s = String(value || "partial").toLowerCase();
  if (s === "paid") return "paid";
  // System uses Paid / Partial only (unpaid treated as partial).
  return "partial";
}

function normalizeMonthKey(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    if (value >= 1 && value <= 12) return value;
    return null;
  }

  const str = String(value).trim();
  if (!str) return null;

  const asNumber = Number(str);
  if (!Number.isNaN(asNumber) && asNumber >= 1 && asNumber <= 12) return asNumber;

  const asDate = new Date(`${str} 01, 2000`);
  if (!Number.isNaN(asDate.getTime())) {
    return asDate.getMonth() + 1;
  }

  return null;
}

function getStudentName(row) {
  return row.student_name || row.name || row.student || row.full_name || "Unknown";
}

function getStudentClass(row) {
  return row.class_name || row.class || row.classLabel || "—";
}

function normalizeFeeRegisterRows(rows, months) {
  const monthDefaults = months.reduce((acc, month) => {
    acc[month.index] = { status: "partial", amount: 0 };
    return acc;
  }, {});

  return rows.map((row, idx) => {
    const monthData = { ...monthDefaults };
    const monthlyRaw = row.monthly || row.months || row.fees || row.breakdown || [];

    if (Array.isArray(monthlyRaw)) {
      monthlyRaw.forEach((entry, monthIdx) => {
        const monthIndex = normalizeMonthKey(entry?.month ?? monthIdx + 1);
        if (!monthIndex || !monthData[monthIndex]) return;
        monthData[monthIndex] = {
          status: normalizeStatus(entry?.status),
          amount: Number(entry?.amount ?? entry?.paid_amount ?? entry?.remaining ?? 0),
        };
      });
    } else if (monthlyRaw && typeof monthlyRaw === "object") {
      Object.entries(monthlyRaw).forEach(([monthKey, entry]) => {
        const monthIndex = normalizeMonthKey(monthKey);
        if (!monthIndex || !monthData[monthIndex]) return;
        const status = normalizeStatus(entry?.status || (typeof entry === "string" ? entry : undefined));
        const amount = Number(entry?.amount ?? entry?.paid_amount ?? entry?.remaining ?? 0);
        monthData[monthIndex] = { status, amount };
      });
    }

    return {
      id: row.student_id || row.id || `${getStudentName(row)}-${idx}`,
      studentName: getStudentName(row),
      className: getStudentClass(row),
      totalYearDue: Number(row.total_year_due ?? row.totalYearDue ?? 0),
      currentDue: Number(row.current_due ?? row.currentDue ?? 0),
      remaining: Number(row.remaining ?? row.remaining_amount ?? row.balance ?? 0),
      registerStatus: row.status || "partial",
      monthData,
    };
  });
}

function normalizeDefaulterRows(rows) {
  return rows
    .map((row, idx) => ({
      id: row.student_id || row.id || `${getStudentName(row)}-${idx}`,
      studentName: getStudentName(row),
      className: getStudentClass(row),
      phone: row.phone != null && String(row.phone).trim() !== "" ? String(row.phone).trim() : "",
      currentDue: Number(row.current_due ?? row.currentDue ?? 0),
      remaining: Number(row.remaining ?? row.remaining_amount ?? row.balance ?? 0),
    }))
    .filter((row) => row.currentDue > 0);
}

function isStudentUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function alumniYearFromClassLabel(className) {
  const m = /^Alumni\s+(\d{4})$/i.exec(String(className || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isInteger(y) ? y : null;
}

export default function Reports() {
  const navigate = useNavigate();
  const now = new Date();
  const cached = useMemo(() => readReportsCache(), []);
  const skipSectionResetRef = useRef(
    Boolean(cached && (cached.selectedClass || cached.selectedSection))
  );
  const snapshotRef = useRef(null);

  const [selectedClass, setSelectedClass] = useState(() => cached?.selectedClass ?? "");
  const [selectedSection, setSelectedSection] = useState(() => cached?.selectedSection ?? "");
  const [selectedYear, setSelectedYear] = useState(() => {
    if (cached?.selectedYear && /^\d{4}$/.test(String(cached.selectedYear))) {
      return String(cached.selectedYear);
    }
    const s = localStorage.getItem(YEAR_STORAGE_KEY);
    if (s && /^\d{4}$/.test(s)) return s;
    return String(now.getFullYear());
  });
  /** Pending/defaulters cutoff month (1–12). Default = current calendar month. */
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const m = Number(cached?.selectedMonth);
    if (Number.isInteger(m) && m >= 1 && m <= 12) return m;
    return now.getMonth() + 1;
  });
  const [selectedGender, setSelectedGender] = useState(() => cached?.selectedGender ?? "");

  const [classes, setClasses] = useState([]);
  const [alumniYears, setAlumniYears] = useState([]);
  const [sections, setSections] = useState([]);

  const [activeTab, setActiveTab] = useState(() =>
    cached?.activeTab === "defaulters" ? "defaulters" : "register"
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(() => Boolean(cached?.hasLoaded));

  const [feeRegisterRows, setFeeRegisterRows] = useState(() =>
    Array.isArray(cached?.feeRegisterRows) ? cached.feeRegisterRows : []
  );
  const [defaulterRows, setDefaulterRows] = useState(() =>
    Array.isArray(cached?.defaulterRows) ? cached.defaulterRows : []
  );
  const [studentSearch, setStudentSearch] = useState(() => cached?.studentSearch ?? "");
  const [selectedDefaulterIds, setSelectedDefaulterIds] = useState(() => new Set());
  const [whatsappSending, setWhatsappSending] = useState(false);
  const [whatsappBanner, setWhatsappBanner] = useState(null);

  const classOptions = useMemo(() => {
    const regular = (classes || []).map((c) => ({ value: c.id, label: c.name }));
    const alum = (alumniYears || []).map((y) => ({ value: `alumni:${y}`, label: `Alumni ${y}` }));
    return [...regular, ...alum];
  }, [classes, alumniYears]);

  const registerScopeLabel = useMemo(() => {
    if (!selectedClass) return "All classes";
    if (isAlumniOption(selectedClass)) {
      const y = alumniYearFromOption(selectedClass);
      return y != null ? `Alumni ${y}` : "Alumni";
    }
    const found = classOptions.find((o) => o.value === selectedClass);
    return found?.label || "Class";
  }, [selectedClass, classOptions]);

  const sectionLabel = useMemo(() => {
    if (!selectedSection || isAlumniOption(selectedClass)) return null;
    const found = sections.find((s) => String(s.id) === String(selectedSection));
    return found?.name || null;
  }, [selectedSection, selectedClass, sections]);

  const genderLabel = useMemo(() => {
    if (selectedGender === "male") return "Male";
    if (selectedGender === "female") return "Female";
    return null;
  }, [selectedGender]);

  const months = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(undefined, { month: "short" });
    const safeYear = Number(selectedYear) || now.getFullYear();
    return Array.from({ length: 12 }, (_, index) => ({
      index: index + 1,
      label: formatter.format(new Date(safeYear, index, 1)),
    }));
  }, [now, selectedYear]);

  const loadClasses = useCallback(async () => {
    try {
      const [classesRes, alumRes] = await Promise.all([API.get("/classes"), API.get("/alumni/years")]);
      setClasses(Array.isArray(classesRes.data) ? classesRes.data : []);
      setAlumniYears(Array.isArray(alumRes.data) ? alumRes.data : []);
    } catch {
      setClasses([]);
      setAlumniYears([]);
    }
  }, []);

  const loadSections = useCallback(async (classId) => {
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

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError("");
    const yTrim = String(selectedYear || "").trim();
    if (!/^\d{4}$/.test(yTrim)) {
      setError("Enter a valid 4-digit billing year (e.g. 2025).");
      setLoading(false);
      return;
    }
    const yNum = Number(yTrim);
    if (yNum < 1900 || yNum > 2100) {
      setError("Year must be between 1900 and 2100.");
      setLoading(false);
      return;
    }
    try {
      localStorage.setItem(YEAR_STORAGE_KEY, yTrim);

      const feeRegisterParams = new URLSearchParams();
      if (selectedClass) feeRegisterParams.set("class", selectedClass);
      feeRegisterParams.set("year", yTrim);
      if (selectedSection && !isAlumniOption(selectedClass)) feeRegisterParams.set("section", selectedSection);
      if (selectedGender === "male" || selectedGender === "female") feeRegisterParams.set("gender", selectedGender);

      const defaultersParams = new URLSearchParams();
      if (selectedClass) defaultersParams.set("class", selectedClass);
      defaultersParams.set("year", yTrim);
      if (selectedSection && !isAlumniOption(selectedClass)) defaultersParams.set("section", selectedSection);
      if (selectedGender === "male" || selectedGender === "female") defaultersParams.set("gender", selectedGender);

      const dueMonth = Number(selectedMonth);
      const currentMonthForDue =
        Number.isInteger(dueMonth) && dueMonth >= 1 && dueMonth <= 12 ? dueMonth : new Date().getMonth() + 1;
      feeRegisterParams.set("current_month", String(currentMonthForDue));
      defaultersParams.set("current_month", String(currentMonthForDue));

      const feeRegisterPath = `/reports/fee-register?${feeRegisterParams.toString()}`;
      const defaultersPath = `/reports/defaulters?${defaultersParams.toString()}`;

      const [feeRegisterRes, defaultersRes] = await Promise.all([
        API.get(feeRegisterPath),
        API.get(defaultersPath),
      ]);

      const registerRaw = Array.isArray(feeRegisterRes.data?.rows)
        ? feeRegisterRes.data.rows
        : Array.isArray(feeRegisterRes.data)
          ? feeRegisterRes.data
          : [];

      const defaultersRaw = Array.isArray(defaultersRes.data?.rows)
        ? defaultersRes.data.rows
        : Array.isArray(defaultersRes.data)
          ? defaultersRes.data
          : [];

      setFeeRegisterRows(normalizeFeeRegisterRows(registerRaw, months));
      setDefaulterRows(normalizeDefaulterRows(defaultersRaw));
      setSelectedDefaulterIds(new Set());
      setWhatsappBanner(null);
      setStudentSearch("");
      setHasLoaded(true);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to load reports");
      setFeeRegisterRows([]);
      setDefaulterRows([]);
      setSelectedDefaulterIds(new Set());
      setHasLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [selectedClass, selectedYear, selectedMonth, selectedSection, selectedGender, months]);

  useEffect(() => {
    loadClasses();
  }, [loadClasses]);

  useEffect(() => {
    if (skipSectionResetRef.current) {
      skipSectionResetRef.current = false;
      if (isAlumniOption(selectedClass)) {
        setSections([]);
        return;
      }
      loadSections(selectedClass);
      return;
    }
    setSelectedSection("");
    if (isAlumniOption(selectedClass)) {
      setSections([]);
      return;
    }
    loadSections(selectedClass);
  }, [loadSections, selectedClass]);

  snapshotRef.current = {
    selectedClass,
    selectedSection,
    selectedYear,
    selectedMonth,
    selectedGender,
    activeTab,
    hasLoaded,
    feeRegisterRows,
    defaulterRows,
    studentSearch,
  };

  useEffect(() => {
    return () => {
      if (snapshotRef.current) setPageState(REPORTS_PAGE_CACHE_KEY, snapshotRef.current);
    };
  }, []);

  const studentSearchQuery = String(studentSearch || "").trim().toLowerCase();

  const visibleFeeRegisterRows = useMemo(() => {
    if (!studentSearchQuery) return feeRegisterRows;
    return feeRegisterRows.filter((row) =>
      String(row.studentName || "").toLowerCase().includes(studentSearchQuery)
    );
  }, [feeRegisterRows, studentSearchQuery]);

  const visibleDefaulterRows = useMemo(() => {
    if (!studentSearchQuery) return defaulterRows;
    return defaulterRows.filter((row) =>
      String(row.studentName || "").toLowerCase().includes(studentSearchQuery)
    );
  }, [defaulterRows, studentSearchQuery]);

  const visibleDefaulterIdList = useMemo(
    () => visibleDefaulterRows.map((row) => String(row.id)),
    [visibleDefaulterRows]
  );

  const allVisibleDefaultersSelected = useMemo(() => {
    if (visibleDefaulterIdList.length === 0) return false;
    return visibleDefaulterIdList.every((id) => selectedDefaulterIds.has(id));
  }, [visibleDefaulterIdList, selectedDefaulterIds]);

  const selectedDefaulterCount = selectedDefaulterIds.size;

  const registerTotals = useMemo(() => {
    return visibleFeeRegisterRows.reduce(
      (acc, row) => {
        acc.totalStudents += 1;
        acc.totalRemaining += row.remaining;
        acc.totalYearDueSum += row.totalYearDue ?? 0;
        acc.currentDueSum += row.currentDue ?? 0;
        if (Number(row.currentDue ?? 0) > 0) acc.unpaidStudents += 1;
        else acc.paidStudents += 1;
        return acc;
      },
      {
        totalStudents: 0,
        totalRemaining: 0,
        totalYearDueSum: 0,
        currentDueSum: 0,
        paidStudents: 0,
        unpaidStudents: 0,
      }
    );
  }, [visibleFeeRegisterRows]);

  const defaulterTotals = useMemo(() => {
    return visibleDefaulterRows.reduce(
      (acc, row) => {
        acc.count += 1;
        acc.currentDueSum += row.currentDue;
        return acc;
      },
      { count: 0, currentDueSum: 0 }
    );
  }, [visibleDefaulterRows]);

  const applyPrintPageSize = (mode) => {
    let el = document.getElementById(PRINT_PAGE_STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = PRINT_PAGE_STYLE_ID;
      el.setAttribute("data-reports", "1");
      document.head.appendChild(el);
    }
    if (mode === "landscape") {
      el.textContent = "@media print { @page { size: A4 landscape; margin: 5mm; } }";
    } else {
      el.textContent = "@media print { @page { size: A4 portrait; margin: 8mm; } }";
    }
  };

  const clearPrintPageSize = () => {
    const el = document.getElementById(PRINT_PAGE_STYLE_ID);
    if (el) {
      el.textContent = "";
    }
  };

  const printRegister = () => {
    flushSync(() => {
      setActiveTab("register");
    });
    document.documentElement.setAttribute("data-reports-print", "register");
    applyPrintPageSize("landscape");
    const onAfterPrint = () => {
      document.documentElement.removeAttribute("data-reports-print");
      clearPrintPageSize();
      window.removeEventListener("afterprint", onAfterPrint);
    };
    window.addEventListener("afterprint", onAfterPrint);
    const run = () => {
      try {
        window.print();
      } catch (e) {
        document.documentElement.removeAttribute("data-reports-print");
        clearPrintPageSize();
        window.removeEventListener("afterprint", onAfterPrint);
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(run, 0);
      });
    });
  };

  const printDefaulters = () => {
    flushSync(() => {
      setActiveTab("defaulters");
    });
    document.documentElement.setAttribute("data-reports-print", "defaulters");
    applyPrintPageSize("portrait");
    const onAfterPrint = () => {
      document.documentElement.removeAttribute("data-reports-print");
      clearPrintPageSize();
      window.removeEventListener("afterprint", onAfterPrint);
    };
    window.addEventListener("afterprint", onAfterPrint);
    const run = () => {
      try {
        window.print();
      } catch (e) {
        document.documentElement.removeAttribute("data-reports-print");
        clearPrintPageSize();
        window.removeEventListener("afterprint", onAfterPrint);
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(run, 0);
      });
    });
  };

  const onFilterKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadReports();
    }
  };

  const yearLabel = String(selectedYear).trim() || "—";
  const monthLabel = MONTH_OPTIONS.find((m) => m.value === Number(selectedMonth))?.label || "—";
  const dueThroughLabel = `${monthLabel} ${yearLabel}`;

  const openStudentInFeeCollection = useCallback(
    (row) => {
      const studentId = String(row?.id || "");
      if (!isStudentUuid(studentId)) return;
      const yTrim = String(selectedYear || "").trim();
      navigate("/fee-collection", {
        state: {
          openStudentId: studentId,
          studentName: row.studentName || "Student",
          phone: row.phone || "",
          year: /^\d{4}$/.test(yTrim) ? yTrim : undefined,
          month: Number(selectedMonth),
          alumniYear: alumniYearFromClassLabel(row.className),
        },
      });
    },
    [navigate, selectedYear, selectedMonth]
  );

  const toggleDefaulterSelected = useCallback((rowId) => {
    const id = String(rowId);
    setSelectedDefaulterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllVisibleDefaulters = useCallback(() => {
    setSelectedDefaulterIds((prev) => {
      const next = new Set(prev);
      const allSelected =
        visibleDefaulterIdList.length > 0 && visibleDefaulterIdList.every((id) => next.has(id));
      if (allSelected) {
        visibleDefaulterIdList.forEach((id) => next.delete(id));
      } else {
        visibleDefaulterIdList.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [visibleDefaulterIdList]);

  const sendWhatsappToSelected = useCallback(async () => {
    if (selectedDefaulterIds.size === 0 || whatsappSending) return;

    const selectedRows = defaulterRows.filter((row) => selectedDefaulterIds.has(String(row.id)));
    if (selectedRows.length === 0) return;

    const confirmed = window.confirm(
      `Send WhatsApp fee reminder to ${selectedRows.length} selected student(s)?\n\nUses first phone number only.\nInternet required for this action.\n\nNote: Meta test number can only message allowlisted phones. Template must be APPROVED.`
    );
    if (!confirmed) return;

    setWhatsappSending(true);
    setWhatsappBanner(null);
    try {
      const res = await API.post("/whatsapp/send-fee-reminders", {
        students: selectedRows.map((row) => ({
          id: row.id,
          name: row.studentName,
          phone: row.phone,
          amount: row.currentDue,
        })),
      });
      const totals = res.data?.totals || {};
      setWhatsappBanner({
        type: Number(totals.failed || 0) > 0 || Number(totals.skipped || 0) > 0 ? "warn" : "ok",
        text: `WhatsApp done: ${totals.sent || 0} sent, ${totals.failed || 0} failed, ${totals.skipped || 0} skipped (of ${totals.selected || selectedRows.length}).`,
        results: Array.isArray(res.data?.results) ? res.data.results : [],
      });
    } catch (err) {
      setWhatsappBanner({
        type: "error",
        text: err?.response?.data?.message || err.message || "Failed to send WhatsApp messages",
        results: [],
      });
    } finally {
      setWhatsappSending(false);
    }
  }, [selectedDefaulterIds, whatsappSending, defaulterRows]);

  const canPrint = hasLoaded && !loading;
  const searchActive = Boolean(studentSearchQuery);

  return (
    <section className="page-card reports-page">
      <div className="reports-tabs-shell reports-no-print">
        <div className="reports-tabs" role="tablist" aria-label="Report type">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "register"}
            className={`reports-tabs__btn${activeTab === "register" ? " is-active" : ""}`}
            onClick={() => setActiveTab("register")}
          >
            Fee Register
            {hasLoaded ? <span className="reports-tabs__count">{feeRegisterRows.length}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "defaulters"}
            className={`reports-tabs__btn${activeTab === "defaulters" ? " is-active" : ""}`}
            onClick={() => setActiveTab("defaulters")}
          >
            Defaulters
            {hasLoaded ? <span className="reports-tabs__count">{defaulterRows.length}</span> : null}
          </button>
        </div>
      </div>

      <div className="reports-filters page-toolbar reports-no-print" onKeyDown={onFilterKeyDown}>
        <label className="label reports-field">
          Class
          <select className="input" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
            <option value="">All classes</option>
            {classOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="label reports-field">
          Section
          <select
            className="input"
            value={selectedSection}
            onChange={(e) => setSelectedSection(e.target.value)}
            disabled={!selectedClass || isAlumniOption(selectedClass)}
          >
            <option value="">All sections</option>
            {sections.map((sectionRow) => (
              <option key={sectionRow.id} value={sectionRow.id}>
                {sectionRow.name}
              </option>
            ))}
          </select>
        </label>

        <label className="label reports-field reports-field--year">
          Year
          <input
            className="input"
            type="text"
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="e.g. 2025"
          />
        </label>

        <label className="label reports-field">
          Month
          <select
            className="input"
            value={String(selectedMonth)}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={String(m.value)}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="label reports-field">
          Gender
          <select className="input" value={selectedGender} onChange={(e) => setSelectedGender(e.target.value)}>
            <option value="">All</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </label>

        <div className="reports-filters__action">
          <button type="button" className="btn" onClick={loadReports} disabled={loading}>
            {loading ? "Loading…" : "Load report"}
          </button>
          {activeTab === "register" ? (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={printRegister}
              disabled={!canPrint || feeRegisterRows.length === 0}
            >
              Print
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={printDefaulters}
                disabled={!canPrint || defaulterRows.length === 0}
              >
                Print
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={sendWhatsappToSelected}
                disabled={
                  !hasLoaded ||
                  loading ||
                  whatsappSending ||
                  selectedDefaulterCount === 0 ||
                  defaulterRows.length === 0
                }
                title="Send fee reminder on WhatsApp to selected students (first phone only)"
              >
                {whatsappSending ? "Sending…" : "Send WhatsApp SMS"}
              </button>
            </>
          )}
        </div>
      </div>

      {error ? (
        <div className="alert alert--error reports-banner reports-no-print" role="alert">
          {error}
        </div>
      ) : null}

      {whatsappBanner ? (
        <div
          className={`alert reports-banner reports-no-print${
            whatsappBanner.type === "error"
              ? " alert--error"
              : whatsappBanner.type === "warn"
                ? " alert--warn"
                : " alert--success"
          }`}
          role="status"
        >
          <div className="reports-whatsapp-banner__text">{whatsappBanner.text}</div>
          {whatsappBanner.results?.length ? (
            <details className="reports-whatsapp-banner__details">
              <summary>View per-student results</summary>
              <ul className="reports-whatsapp-banner__list">
                {whatsappBanner.results.slice(0, 50).map((item, idx) => (
                  <li key={`${item.id || item.name || "r"}-${idx}`}>
                    <strong>{item.name || "Student"}</strong>: {item.status}
                    {item.message ? ` — ${item.message}` : ""}
                  </li>
                ))}
                {whatsappBanner.results.length > 50 ? (
                  <li>…and {whatsappBanner.results.length - 50} more</li>
                ) : null}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {hasLoaded && !loading ? (
        <div className="reports-kpis verdict-strip reports-no-print" aria-live="polite">
          <div className="verdict-card">
            <p className="verdict-card__label">Students</p>
            <p className="verdict-card__value">{registerTotals.totalStudents}</p>
          </div>
          <div className="verdict-card verdict-card--warn">
            <p className="verdict-card__label">Pending fee</p>
            <p className="verdict-card__value">{toMoney(registerTotals.currentDueSum)}</p>
            <p className="verdict-card__hint">Through {dueThroughLabel}</p>
          </div>
          <div className="verdict-card verdict-card--danger">
            <p className="verdict-card__label">Defaulters</p>
            <p className="verdict-card__value">{defaulterTotals.count}</p>
            <p className="verdict-card__hint">{toMoney(defaulterTotals.currentDueSum)}</p>
          </div>
          <div className="verdict-card verdict-card--accent">
            <p className="verdict-card__label">Paid / Unpaid</p>
            <p className="verdict-card__value reports-kpis__cells">
              <span className="reports-kpis__paid">{registerTotals.paidStudents}</span>
              <span className="reports-kpis__sep">/</span>
              <span className="reports-kpis__partial">{registerTotals.unpaidStudents}</span>
            </p>
            <p className="verdict-card__hint">Students</p>
          </div>
        </div>
      ) : null}

      <div className="reports-workbench reports-no-print">
        <div className="reports-workbench__tools">
          <div className="reports-search">
            <input
              className="input reports-search__input"
              type="search"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="Search student…"
              aria-label="Search student by name"
              disabled={!hasLoaded || loading}
            />
            {studentSearch ? (
              <button
                type="button"
                className="reports-search__clear"
                onClick={() => setStudentSearch("")}
                aria-label="Clear search"
              >
                ×
              </button>
            ) : null}
          </div>

          {activeTab === "register" ? (
            <div className="reports-legend" aria-hidden="true">
              <span className="reports-legend__item">
                <i className="reports-legend__dot reports-legend__dot--paid" /> Paid
              </span>
              <span className="reports-legend__item">
                <i className="reports-legend__dot reports-legend__dot--partial" /> Partial
              </span>
            </div>
          ) : null}
          {hasLoaded ? (
            <p className="reports-workbench__hint">Row opens Fee Collection</p>
          ) : null}
        </div>
      </div>

      {hasLoaded && !loading ? (
        <div className="reports-scope reports-no-print">
          <span className="reports-scope__chip">{dueThroughLabel}</span>
          <span className="reports-scope__chip">{registerScopeLabel}</span>
          {sectionLabel ? <span className="reports-scope__chip">Sec {sectionLabel}</span> : null}
          {genderLabel ? <span className="reports-scope__chip">{genderLabel}</span> : null}
          {searchActive ? (
            <span className="reports-scope__chip reports-scope__chip--search">
              “{studentSearch.trim()}”
              {activeTab === "register"
                ? ` · ${visibleFeeRegisterRows.length} shown`
                : ` · ${visibleDefaulterRows.length} shown`}
            </span>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="reports-loading reports-no-print" aria-live="polite">
          <span className="reports-spinner" />
          <strong>Loading…</strong>
        </div>
      ) : null}

      {!loading && activeTab === "register" ? (
        <section className="reports-table-panel reports-print-panel reports-print-panel--register">
          <div className="reports-panel-head reports-print-only">
            <h2 className="reports-title reports-print-title">
              Fee Register — {yearLabel} — {registerScopeLabel}
            </h2>
          </div>

          {!hasLoaded ? (
            <div className="empty-state reports-empty">
              <ol className="reports-empty__steps">
                <li>Click Load Report to view all records.</li>
                <li>Apply filters to find specific records.</li>
              </ol>
            </div>
          ) : feeRegisterRows.length === 0 ? (
            <div className="empty-state reports-empty">
              <p className="empty-state__title">No students found</p>
            </div>
          ) : visibleFeeRegisterRows.length === 0 ? (
            <div className="empty-state reports-empty">
              <p className="empty-state__title">No match for “{studentSearch.trim()}”</p>
              <button type="button" className="btn btn--secondary btn--sm reports-no-print" onClick={() => setStudentSearch("")}>
                Clear search
              </button>
            </div>
          ) : (
            <>
              <div className="reports-table-wrap">
                <table className="reports-table reports-register-table">
                  <thead>
                    <tr>
                      <th className="reports-sticky-col">Student Name</th>
                      <th className="reports-col-class">Class</th>
                      {months.map((month) => (
                        <th key={month.index} className="reports-col-month">
                          {month.label}
                        </th>
                      ))}
                      <th className="reports-col-total-due">Pending Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleFeeRegisterRows.map((row) => (
                      <tr
                        key={row.id}
                        className="reports-row--clickable"
                        tabIndex={0}
                        title="Open in Fee Collection"
                        onClick={() => openStudentInFeeCollection(row)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openStudentInFeeCollection(row);
                          }
                        }}
                      >
                        <td className="reports-sticky-col">{row.studentName}</td>
                        <td className="reports-col-class">{row.className}</td>
                        {months.map((month) => {
                          const cell = row.monthData[month.index] || { status: "partial", amount: 0 };
                          const cn = `reports-month-cell reports-month-cell--${cell.status}`;
                          return (
                            <td key={`${row.id}-${month.index}`} className={cn}>
                              {cell.status === "paid" ? "✔" : toMoney(cell.amount)}
                            </td>
                          );
                        })}
                        <td className="reports-remaining-cell reports-col-total-due">{toMoney(row.currentDue ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="reports-total-cell">Totals</td>
                      <td className="reports-total-cell" />
                      <td colSpan={months.length} className="reports-total-meta">
                        Paid: {registerTotals.paidStudents} | Unpaid: {registerTotals.unpaidStudents}
                      </td>
                      <td className="reports-total-cell reports-col-total-due">{toMoney(registerTotals.currentDueSum)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="reports-summary reports-no-print">
                <span>
                  <strong>{registerTotals.totalStudents}</strong> students
                </span>
                <span>
                  Pending fee <strong>{toMoney(registerTotals.currentDueSum)}</strong>
                </span>
              </div>
            </>
          )}
        </section>
      ) : null}

      {!loading && activeTab === "defaulters" ? (
        <section className="reports-table-panel reports-print-panel reports-print-panel--defaulters">
          <div className="reports-panel-head reports-print-only">
            <h2 className="reports-title reports-print-title">Defaulters List</h2>
          </div>

          {!hasLoaded ? (
            <div className="empty-state reports-empty">
              <ol className="reports-empty__steps">
                <li>Click Load Report to view all records.</li>
                <li>Apply filters to find specific records.</li>
              </ol>
            </div>
          ) : defaulterRows.length === 0 ? (
            <div className="empty-state reports-empty">
              <p className="empty-state__title">No defaulters</p>
            </div>
          ) : visibleDefaulterRows.length === 0 ? (
            <div className="empty-state reports-empty">
              <p className="empty-state__title">No match for “{studentSearch.trim()}”</p>
              <button type="button" className="btn btn--secondary btn--sm reports-no-print" onClick={() => setStudentSearch("")}>
                Clear search
              </button>
            </div>
          ) : (
            <>
              <div className="reports-defaulters-toolbar reports-no-print">
                <label className="reports-defaulters-selectall">
                  <input
                    type="checkbox"
                    checked={allVisibleDefaultersSelected}
                    onChange={toggleSelectAllVisibleDefaulters}
                    disabled={visibleDefaulterRows.length === 0 || whatsappSending}
                  />
                  <span>
                    Select all{searchActive ? " (visible)" : ""} · {selectedDefaulterCount} selected
                  </span>
                </label>
              </div>
              <div className="reports-table-wrap">
                <table className="reports-table reports-defaulters-table">
                  <colgroup>
                    <col className="reports-defaulters-col reports-defaulters-col--check reports-no-print" />
                    <col className="reports-defaulters-col reports-defaulters-col--name" />
                    <col className="reports-defaulters-col reports-defaulters-col--class" />
                    <col className="reports-defaulters-col reports-defaulters-col--phone" />
                    <col className="reports-defaulters-col reports-defaulters-col--current" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="reports-no-print reports-defaulter-check-cell" scope="col">
                        <span className="visually-hidden">Select</span>
                      </th>
                      <th>Student Name</th>
                      <th>Class</th>
                      <th>Phone</th>
                      <th>Pending Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDefaulterRows.map((row) => {
                      const rowId = String(row.id);
                      const checked = selectedDefaulterIds.has(rowId);
                      return (
                        <tr
                          key={row.id}
                          className={`reports-row--clickable${checked ? " is-selected" : ""}`}
                          tabIndex={0}
                          title="Open in Fee Collection"
                          onClick={() => openStudentInFeeCollection(row)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openStudentInFeeCollection(row);
                            }
                          }}
                        >
                          <td
                            className="reports-no-print reports-defaulter-check-cell"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleDefaulterSelected(rowId)}
                              disabled={whatsappSending}
                              aria-label={`Select ${row.studentName || "student"}`}
                            />
                          </td>
                          <td>{row.studentName}</td>
                          <td>{row.className}</td>
                          <td className="reports-defaulter-phone">
                            {row.phone ? row.phone : <span className="reports-muted">—</span>}
                          </td>
                          <td className="reports-remaining-cell reports-defaulter-current-due">
                            {toMoney(row.currentDue)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="reports-total-cell reports-no-print" />
                      <td className="reports-total-cell" colSpan={3}>
                        Total · {defaulterTotals.count} students
                      </td>
                      <td className="reports-total-cell reports-defaulter-foot-amount reports-remaining-cell">
                        {toMoney(defaulterTotals.currentDueSum)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="reports-summary reports-no-print">
                <span>
                  <strong>{defaulterTotals.count}</strong> defaulters
                </span>
                <span>
                  <strong>{selectedDefaulterCount}</strong> selected
                </span>
                <span>
                  Pending fee <strong>{toMoney(defaulterTotals.currentDueSum)}</strong>
                </span>
              </div>
            </>
          )}
        </section>
      ) : null}
    </section>
  );
}
