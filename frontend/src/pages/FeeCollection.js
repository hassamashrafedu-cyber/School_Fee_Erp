import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import API from "../api";
import { localDateInputValue } from "../utils/dateLocal";
import { fetchPaymentStatusesForStudents } from "../utils/feeListPaymentStatus";
import {
  activePaymentsOnly,
  attributedAmountForCalendarYear,
  buildBillingMonthsFromRange,
  CURRENT_MONTH_STORAGE_KEY,
  distributeLedger,
  formatPaymentAllocationSummary,
  isConcessionPayment,
  ledgerStatus,
  paymentSortKey,
  pickCurrentMonthForBilling,
} from "../utils/ledgerDistribute";
import { fetchCrossYearTargetMonthlyMap } from "../utils/feeCrossYearClient";
import { parseWholeAmount, roundMoney, toMoney } from "../utils/money";
import { getPageState, setPageState } from "../utils/pageStateCache";

import "./feeCollection.css";

const YEAR_STORAGE_KEY = "fee_collection_calendar_year";
const FEE_COLLECTION_CACHE_KEY = "fee-collection";

/** First month in billing order that is not fully paid — matches FIFO “next bucket” for new payments. */
function firstUnpaidMonthFromLedger(billingMonths, ledger) {
  if (!Array.isArray(billingMonths) || !ledger?.monthRows?.length) return null;
  for (const bm of billingMonths) {
    const row = ledger.monthRows.find(
      (r) => Number(r.month) === Number(bm.month) && Number(r.year) === Number(bm.year)
    );
    if (!row) continue;
    const feeD = row.feeDisplay != null ? roundMoney(row.feeDisplay) : roundMoney(row.fee);
    const paidD = row.paidDisplay != null ? roundMoney(row.paidDisplay) : roundMoney(row.paid);
    if (feeD > 0 && paidD < feeD) {
      return { month: bm.month, year: bm.year };
    }
  }
  return null;
}

function isAlumniOption(value) {
  return String(value || "").startsWith("alumni:");
}

function alumniYearFromOption(value) {
  const raw = String(value || "");
  if (!raw.startsWith("alumni:")) return null;
  const year = Number(raw.slice("alumni:".length));
  return Number.isInteger(year) ? year : null;
}

function formatStatus(status) {
  if (status === "paid") return "Paid";
  return "Unpaid";
}

function readFeeCollectionCache() {
  const cached = getPageState(FEE_COLLECTION_CACHE_KEY);
  return cached && typeof cached === "object" ? cached : null;
}

function readReportsOpenBoot(state) {
  if (!state?.openStudentId) return null;
  return {
    studentId: String(state.openStudentId),
    studentName: String(state.studentName || "Student").trim() || "Student",
    phone: state.phone != null ? String(state.phone) : "",
    year: state.year,
    month: state.month,
    alumniYear: state.alumniYear != null ? Number(state.alumniYear) : null,
  };
}

export default function FeeCollection() {
  const location = useLocation();
  const navigate = useNavigate();
  const pendingMonthRef = useRef(null);
  const openBootRef = useRef(undefined);
  if (openBootRef.current === undefined) {
    openBootRef.current = readReportsOpenBoot(location.state);
  }
  const openBoot = openBootRef.current;
  const cached = useMemo(() => (openBoot ? null : readFeeCollectionCache()), [openBoot]);
  const snapshotRef = useRef(null);
  const skipSectionResetRef = useRef(Boolean(cached && (cached.selectedClass || cached.selectedSection)));

  const [students, setStudents] = useState([]);
  const [regularStudents, setRegularStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [alumniYears, setAlumniYears] = useState([]);
  const [sections, setSections] = useState([]);
  const [calendarYear, setCalendarYear] = useState(() => {
    if (openBoot?.year != null && /^\d{4}$/.test(String(openBoot.year).trim())) {
      return String(openBoot.year).trim();
    }
    if (cached?.calendarYear && /^\d{4}$/.test(String(cached.calendarYear).trim())) {
      return String(cached.calendarYear).trim();
    }
    const s = localStorage.getItem(YEAR_STORAGE_KEY);
    if (s && /^\d+$/.test(s)) return s;
    return String(new Date().getFullYear());
  });

  const [search, setSearch] = useState(() => cached?.search ?? "");
  const [selectedClass, setSelectedClass] = useState(() => {
    if (openBoot?.alumniYear != null && Number.isInteger(openBoot.alumniYear)) {
      return `alumni:${openBoot.alumniYear}`;
    }
    return cached?.selectedClass ?? "";
  });
  const [selectedSection, setSelectedSection] = useState(() => cached?.selectedSection ?? "");
  const [selectedGender, setSelectedGender] = useState(() => cached?.selectedGender ?? "all");
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState(
    () => cached?.selectedPaymentStatus ?? "all"
  );
  const [selectedStudentId, setSelectedStudentId] = useState(
    () => openBoot?.studentId || cached?.selectedStudentId || ""
  );
  const [seedStudent] = useState(() => {
    if (openBoot) {
      return {
        id: openBoot.studentId,
        name: openBoot.studentName,
        phone: openBoot.phone,
        current_class_id: null,
        graduation_year:
          openBoot.alumniYear != null && Number.isInteger(openBoot.alumniYear)
            ? openBoot.alumniYear
            : null,
      };
    }
    if (cached?.seedStudent?.id) {
      return {
        id: String(cached.seedStudent.id),
        name: String(cached.seedStudent.name || "Student"),
        phone: cached.seedStudent.phone != null ? String(cached.seedStudent.phone) : "",
        current_class_id: cached.seedStudent.current_class_id ?? null,
        graduation_year: cached.seedStudent.graduation_year ?? null,
      };
    }
    return null;
  });
  /** Skip heavy list-status batch until the opened student's ledger has started. */
  const [deferListStatus, setDeferListStatus] = useState(() => Boolean(openBoot));
  const [currentMonth, setCurrentMonth] = useState(null);

  const [feeSetup, setFeeSetup] = useState(null);
  const [feeConfig, setFeeConfig] = useState(null);
  const [paymentsRaw, setPaymentsRaw] = useState([]);
  const [overrideMonthly, setOverrideMonthly] = useState(null);
  const [overrideMonthlyByMonth, setOverrideMonthlyByMonth] = useState(null);
  const [overrideAdmission, setOverrideAdmission] = useState(null);
  const [overrideAdmissionByMonth, setOverrideAdmissionByMonth] = useState(null);
  const [overrideAdvancedByMonth, setOverrideAdvancedByMonth] = useState(null);
  const [overrideComponentByMonth, setOverrideComponentByMonth] = useState(null);
  const [resolvedEnrollment, setResolvedEnrollment] = useState(null);

  const [loading, setLoading] = useState(true);
  const [loadingStudentDetail, setLoadingStudentDetail] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => localDateInputValue());
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [concessionSubmitting, setConcessionSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [advanceLinks, setAdvanceLinks] = useState([]);
  /** Target-month fees for advance links whose target is outside the open year grid (e.g. Jan 2027). */
  const [offGridTargetFees, setOffGridTargetFees] = useState({});
  /** Cross-year advance targets: effective monthly + whether target year has override. */
  const [crossYearTargetMonthly, setCrossYearTargetMonthly] = useState({});
  const [crossYearTargetHasOverride, setCrossYearTargetHasOverride] = useState({});

  /** Previous calendar year's total year due (read-only; same rules as main ledger). */
  const [previousYearForBanner, setPreviousYearForBanner] = useState(null);

  /** List badges: paid/partial = Current Due (through resolved current month; shared with Students batch). */
  const [listPaymentStatusByStudentId, setListPaymentStatusByStudentId] = useState({});
  const [listPaymentStatusLoading, setListPaymentStatusLoading] = useState(false);
  const [listStatusNonce, setListStatusNonce] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      API.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      delete API.defaults.headers.common.Authorization;
    }
  }, []);

  useEffect(() => {
    if (calendarYear) localStorage.setItem(YEAR_STORAGE_KEY, calendarYear);
  }, [calendarYear]);

  useEffect(() => {
    if (currentMonth == null) return;
    try {
      localStorage.setItem(CURRENT_MONTH_STORAGE_KEY, JSON.stringify(currentMonth));
    } catch {
      // ignore
    }
  }, [currentMonth]);

  const classNameById = useMemo(() => {
    const map = {};
    classes.forEach((c) => {
      map[c.id] = c.name;
    });
    return map;
  }, [classes]);

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

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [studentsRes, classesRes, alumniYearsRes] = await Promise.all([
        API.get("/students"),
        API.get("/classes"),
        API.get("/alumni/years"),
      ]);
      const baseStudents = Array.isArray(studentsRes.data) ? studentsRes.data : [];
      setRegularStudents(baseStudents);
      setStudents(baseStudents);
      setClasses(Array.isArray(classesRes.data) ? classesRes.data : []);
      setAlumniYears(Array.isArray(alumniYearsRes.data) ? alumniYearsRes.data : []);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to load students.");
      setStudents([]);
      setRegularStudents([]);
      setClasses([]);
      setAlumniYears([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (skipSectionResetRef.current) {
      skipSectionResetRef.current = false;
      if (!selectedClass || isAlumniOption(selectedClass)) {
        setSections([]);
        return;
      }
      fetchSectionOptions(selectedClass);
      return;
    }
    setSelectedSection("");
    if (!selectedClass || isAlumniOption(selectedClass)) {
      setSections([]);
      return;
    }
    fetchSectionOptions(selectedClass);
  }, [selectedClass, fetchSectionOptions]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedClass || !isAlumniOption(selectedClass)) {
      setStudents(regularStudents);
      return () => {
        cancelled = true;
      };
    }
    const year = alumniYearFromOption(selectedClass);
    if (!Number.isInteger(year)) {
      setStudents([]);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const { data } = await API.get("/alumni/students", { params: { year } });
        if (cancelled) return;
        setStudents(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setStudents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedClass, regularStudents]);

  const displayStudents = useMemo(() => {
    if (!seedStudent) return students;
    if (students.some((s) => String(s.id) === String(seedStudent.id))) return students;
    return [seedStudent, ...students];
  }, [students, seedStudent]);

  const baseFilteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return displayStudents.filter((s) => {
      if (!isAlumniOption(selectedClass)) {
        if (selectedClass && String(s.current_class_id) !== String(selectedClass)) return false;
        if (selectedSection && String(s.current_section_id) !== String(selectedSection)) return false;
      }
      if (selectedGender !== "all") {
        const g = String(s.gender || "").toLowerCase();
        if (g !== selectedGender) return false;
      }
      if (!q) return true;
      const name = String(s.name || "").toLowerCase();
      const phone = String(s.phone || "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [displayStudents, search, selectedClass, selectedSection, selectedGender]);

  const filteredStudents = useMemo(() => {
    if (selectedPaymentStatus === "all" || listPaymentStatusLoading) {
      return baseFilteredStudents;
    }
    return baseFilteredStudents.filter((s) => {
      const status = listPaymentStatusByStudentId[s.id] || "partial";
      return status === selectedPaymentStatus;
    });
  }, [baseFilteredStudents, selectedPaymentStatus, listPaymentStatusByStudentId, listPaymentStatusLoading]);

  const classOptions = useMemo(() => {
    const base = classes.map((c) => ({ value: c.id, label: c.name }));
    const alumni = alumniYears
      .map((y) => Number(y))
      .filter((y) => Number.isInteger(y))
      .sort((a, b) => b - a)
      .map((y) => ({ value: `alumni:${y}`, label: `Alumni ${y}` }));
    return [...base, ...alumni];
  }, [classes, alumniYears]);

  useLayoutEffect(() => {
    if (openBoot?.month != null && Number.isInteger(Number(openBoot.month))) {
      pendingMonthRef.current = Number(openBoot.month);
    }
    if (location.state?.openStudentId) {
      navigate("/fee-collection", { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedStudentId) return;
    if (loading) return;
    const exists = filteredStudents.some((s) => String(s.id) === String(selectedStudentId));
    if (!exists) setSelectedStudentId("");
  }, [filteredStudents, selectedStudentId, loading]);

  snapshotRef.current = {
    calendarYear,
    search,
    selectedClass,
    selectedSection,
    selectedGender,
    selectedPaymentStatus,
    selectedStudentId,
    seedStudent: (() => {
      const fromList = displayStudents.find((s) => String(s.id) === String(selectedStudentId));
      if (fromList) {
        return {
          id: fromList.id,
          name: fromList.name,
          phone: fromList.phone,
          current_class_id: fromList.current_class_id ?? null,
          graduation_year: fromList.graduation_year ?? null,
        };
      }
      if (seedStudent && String(seedStudent.id) === String(selectedStudentId)) {
        return {
          id: seedStudent.id,
          name: seedStudent.name,
          phone: seedStudent.phone,
          current_class_id: seedStudent.current_class_id ?? null,
          graduation_year: seedStudent.graduation_year ?? null,
        };
      }
      return null;
    })(),
  };

  useEffect(() => {
    return () => {
      if (snapshotRef.current) setPageState(FEE_COLLECTION_CACHE_KEY, snapshotRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (deferListStatus) {
      setListPaymentStatusLoading(false);
      return () => {
        cancelled = true;
      };
    }
    if (!baseFilteredStudents.length) {
      setListPaymentStatusByStudentId({});
      setListPaymentStatusLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const y = parseInt(String(calendarYear).trim(), 10);
    if (!Number.isInteger(y) || y < 1900 || y > 2100) {
      setListPaymentStatusByStudentId({});
      setListPaymentStatusLoading(false);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      setListPaymentStatusLoading(true);
      try {
        const map = await fetchPaymentStatusesForStudents(API, baseFilteredStudents, y);
        if (!cancelled) setListPaymentStatusByStudentId(map);
      } catch {
        if (!cancelled) setListPaymentStatusByStudentId({});
      } finally {
        if (!cancelled) setListPaymentStatusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseFilteredStudents, calendarYear, listStatusNonce, deferListStatus]);

  const selectedStudent = useMemo(
    () => displayStudents.find((s) => String(s.id) === String(selectedStudentId)) || null,
    [displayStudents, selectedStudentId]
  );

  const classIdForAdvanceLinks = useMemo(() => {
    if (!selectedStudent) return null;
    if (resolvedEnrollment?.source === "alumni_post_graduation") return null;
    return resolvedEnrollment?.class_id || selectedStudent.current_class_id || null;
  }, [selectedStudent, resolvedEnrollment]);

  const loadStudentDetail = useCallback(async () => {
    if (!selectedStudent?.id) {
      setFeeSetup(null);
      setFeeConfig(null);
      setPaymentsRaw([]);
      setOverrideMonthly(null);
      setOverrideMonthlyByMonth(null);
      setOverrideAdmission(null);
      setOverrideAdmissionByMonth(null);
      setOverrideAdvancedByMonth(null);
      setResolvedEnrollment(null);
      return;
    }
    const y = String(calendarYear).trim();
    if (!/^\d+$/.test(y)) {
      setError("Enter a valid billing year.");
      setFeeSetup(null);
      setFeeConfig(null);
      setPaymentsRaw([]);
      setOverrideMonthly(null);
      setOverrideMonthlyByMonth(null);
      setOverrideAdmission(null);
      setOverrideAdmissionByMonth(null);
      setOverrideAdvancedByMonth(null);
      setResolvedEnrollment(null);
      return;
    }

    setLoadingStudentDetail(true);
    setLoadingHistory(true);
    setError("");
    try {
      const feeYear = parseInt(y, 10);
      const fy = feeYear;
      // Start enrollment + payments together so ledger can open faster from Reports.
      const [enrollmentRes, paymentsRes, paymentsPrevRes, paymentsNextRes] = await Promise.all([
        API.get(`/students/${selectedStudent.id}/enrollment`, {
          params: { year: fy },
        }),
        API.get(`/payments/student/${selectedStudent.id}`, { params: { year: fy } }),
        fy > 1900
          ? API.get(`/payments/student/${selectedStudent.id}`, { params: { year: fy - 1 } }).catch(() => ({
              data: [],
            }))
          : Promise.resolve({ data: [] }),
        fy < 2100
          ? API.get(`/payments/student/${selectedStudent.id}`, { params: { year: fy + 1 } }).catch(() => ({
              data: [],
            }))
          : Promise.resolve({ data: [] }),
      ]);
      const enrollment = enrollmentRes?.data && typeof enrollmentRes.data === "object" ? enrollmentRes.data : {};
      const resolvedClassId =
        enrollment?.source === "alumni_post_graduation"
          ? null
          : enrollment?.class_id || selectedStudent.current_class_id || null;
      setResolvedEnrollment(enrollment);

      const listCur = Array.isArray(paymentsRes?.data) ? paymentsRes.data : [];
      const listPrev = Array.isArray(paymentsPrevRes?.data) ? paymentsPrevRes.data : [];
      const listNext = Array.isArray(paymentsNextRes?.data) ? paymentsNextRes.data : [];
      const payById = new Map();
      for (const p of listPrev) {
        if (p && p.id != null) payById.set(p.id, p);
      }
      for (const p of listNext) {
        if (p && p.id != null) payById.set(p.id, p);
      }
      for (const p of listCur) {
        if (p && p.id != null) payById.set(p.id, p);
      }
      setPaymentsRaw(activePaymentsOnly([...payById.values()]));

      const configParams = { year: feeYear };
      if (resolvedClassId) configParams.class_id = resolvedClassId;
      const [configRes, studentFeeRes, structureRes] = await Promise.all([
        API.get("/fees/config", { params: configParams }),
        resolvedClassId
          ? API.get("/student-fee", {
              params: { student_id: selectedStudent.id, year: y },
            }).catch(() => ({ data: null }))
          : Promise.resolve({ data: null }),
        resolvedClassId
          ? API.get("/fees/structure", {
              params: { class_id: resolvedClassId, year: feeYear },
            })
          : Promise.resolve({ data: null }),
      ]);
      const config = configRes.data && typeof configRes.data === "object" ? configRes.data : {};
      const startMonth = Number(config.start_month || 1);
      const endMonth = Number(config.end_month || 12);
      let structure;
      if (resolvedClassId) {
        structure = structureRes.data && typeof structureRes.data === "object" ? structureRes.data : {};
      } else {
        const months = [];
        for (let m = startMonth; m <= endMonth; m += 1) months.push({ month: m, fee: 0 });
        structure = { year: feeYear, start_month: startMonth, end_month: endMonth, months };
      }
      setFeeConfig({
        year: feeYear,
        start_month: startMonth,
        end_month: endMonth,
      });
      setFeeSetup(structure);

      if (!resolvedClassId) {
        setOverrideMonthly(null);
        setOverrideMonthlyByMonth(null);
        setOverrideAdmission(null);
        setOverrideAdmissionByMonth(null);
        setOverrideAdvancedByMonth(null);
        setOverrideComponentByMonth(null);
      } else {
        try {
          const data = studentFeeRes?.data;
          const oa = data?.override_amount;
          if (oa !== undefined && oa !== null && !Number.isNaN(Number(oa))) {
            setOverrideMonthly(roundMoney(oa));
          } else {
            setOverrideMonthly(null);
          }
          const omMap = data?.override_amount_by_month;
          if (omMap && typeof omMap === "object" && !Array.isArray(omMap) && Object.keys(omMap).length > 0) {
            setOverrideMonthlyByMonth(omMap);
          } else {
            setOverrideMonthlyByMonth(null);
          }
          const adm = data?.admission_fee_override;
          if (adm !== undefined && adm !== null && !Number.isNaN(Number(adm))) {
            setOverrideAdmission(roundMoney(adm));
          } else {
            setOverrideAdmission(null);
          }
          const admMap = data?.admission_fee_override_by_month;
          if (admMap && typeof admMap === "object" && !Array.isArray(admMap) && Object.keys(admMap).length > 0) {
            setOverrideAdmissionByMonth(admMap);
          } else {
            setOverrideAdmissionByMonth(null);
          }
          const advMap = data?.advanced_fee_override_by_month;
          if (advMap && typeof advMap === "object" && !Array.isArray(advMap) && Object.keys(advMap).length > 0) {
            setOverrideAdvancedByMonth(advMap);
          } else {
            setOverrideAdvancedByMonth(null);
          }
          const compMap = data?.component_override_by_month;
          if (compMap && typeof compMap === "object" && !Array.isArray(compMap) && Object.keys(compMap).length > 0) {
            setOverrideComponentByMonth(compMap);
          } else {
            setOverrideComponentByMonth(null);
          }
        } catch {
          setOverrideMonthly(null);
          setOverrideMonthlyByMonth(null);
          setOverrideAdmission(null);
          setOverrideAdmissionByMonth(null);
          setOverrideAdvancedByMonth(null);
          setOverrideComponentByMonth(null);
        }
      }
    } catch (err) {
      setFeeSetup(null);
      setFeeConfig(null);
      setPaymentsRaw([]);
      setOverrideMonthly(null);
      setOverrideMonthlyByMonth(null);
      setOverrideAdmission(null);
      setOverrideAdmissionByMonth(null);
      setOverrideAdvancedByMonth(null);
      setResolvedEnrollment(null);
      setError(err?.response?.data?.message || err.message || "Failed to load fee or payments.");
    } finally {
      setLoadingStudentDetail(false);
      setLoadingHistory(false);
      setDeferListStatus(false);
    }
  }, [selectedStudent, calendarYear]);

  useEffect(() => {
    if (!classIdForAdvanceLinks || !/^\d+$/.test(String(calendarYear).trim())) {
      setAdvanceLinks([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await API.get("/fees/advance-links", {
          params: { class_id: classIdForAdvanceLinks, year: parseInt(String(calendarYear).trim(), 10) },
        });
        if (!cancelled) setAdvanceLinks(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setAdvanceLinks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classIdForAdvanceLinks, calendarYear]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedStudent?.id || !selectedStudent?.current_class_id) {
      setPreviousYearForBanner(null);
      return undefined;
    }
    const sid = selectedStudent.id;
    const yStr = String(calendarYear).trim();
    if (!/^\d+$/.test(yStr)) {
      setPreviousYearForBanner(null);
      return undefined;
    }
    const currentY = parseInt(yStr, 10);
    const prevY = currentY - 1;

    setPreviousYearForBanner({ studentId: sid, loading: true, totalYearDue: null });

    if (prevY < 1900) {
      setPreviousYearForBanner({ studentId: sid, loading: false, totalYearDue: 0 });
      return undefined;
    }

    (async () => {
      try {
        const enrollmentRes = await API.get(`/students/${selectedStudent.id}/enrollment`, { params: { year: prevY } });
        if (cancelled) return;
        const enrollment = enrollmentRes?.data && typeof enrollmentRes.data === "object" ? enrollmentRes.data : {};
        const resolvedClassId =
          enrollment?.source === "alumni_post_graduation"
            ? null
            : enrollment?.class_id || selectedStudent.current_class_id || null;
        const configParams = { year: prevY };
        if (resolvedClassId) configParams.class_id = resolvedClassId;
        const [configRes, paymentsRes, paymentsOlderRes] = await Promise.all([
          API.get("/fees/config", { params: configParams }),
          API.get(`/payments/student/${selectedStudent.id}`, { params: { year: prevY } }),
          prevY > 1900
            ? API.get(`/payments/student/${selectedStudent.id}`, { params: { year: prevY - 1 } }).catch(() => ({
                data: [],
              }))
            : Promise.resolve({ data: [] }),
        ]);
        if (cancelled) return;
        const config = configRes.data && typeof configRes.data === "object" ? configRes.data : {};
        const sm = Number(config.start_month || 1);
        const em = Number(config.end_month || 12);
        let structure;
        if (resolvedClassId) {
          const structureRes = await API.get("/fees/structure", {
            params: { class_id: resolvedClassId, year: prevY },
          });
          structure = structureRes.data && typeof structureRes.data === "object" ? structureRes.data : {};
        } else {
          const months = [];
          for (let m = sm; m <= em; m += 1) months.push({ month: m, fee: 0 });
          structure = { year: prevY, start_month: sm, end_month: em, months };
        }
        const feeCfg = {
          year: prevY,
          start_month: Number(config.start_month || 1),
          end_month: Number(config.end_month || 12),
        };
        let overridePrev = null;
        let overrideByMonthPrev = null;
        let admissionPrev = null;
        let admissionByMonthPrev = null;
        let advancedByMonthPrev = null;
        let componentByMonthPrev = null;
        try {
          const { data } = await API.get("/student-fee", {
            params: { student_id: selectedStudent.id, year: String(prevY) },
          });
          const oa = data?.override_amount;
          if (oa !== undefined && oa !== null && !Number.isNaN(Number(oa))) {
            overridePrev = roundMoney(oa);
          }
          const omMap = data?.override_amount_by_month;
          if (omMap && typeof omMap === "object" && !Array.isArray(omMap) && Object.keys(omMap).length > 0) {
            overrideByMonthPrev = omMap;
          }
          const adm = data?.admission_fee_override;
          if (adm !== undefined && adm !== null && !Number.isNaN(Number(adm))) {
            admissionPrev = roundMoney(adm);
          }
          const admMap = data?.admission_fee_override_by_month;
          if (admMap && typeof admMap === "object" && !Array.isArray(admMap) && Object.keys(admMap).length > 0) {
            admissionByMonthPrev = admMap;
          }
          const advMap = data?.advanced_fee_override_by_month;
          if (advMap && typeof advMap === "object" && !Array.isArray(advMap) && Object.keys(advMap).length > 0) {
            advancedByMonthPrev = advMap;
          }
          const compMap = data?.component_override_by_month;
          if (compMap && typeof compMap === "object" && !Array.isArray(compMap) && Object.keys(compMap).length > 0) {
            componentByMonthPrev = compMap;
          }
        } catch {
          overridePrev = null;
          overrideByMonthPrev = null;
          admissionPrev = null;
          admissionByMonthPrev = null;
          advancedByMonthPrev = null;
          componentByMonthPrev = null;
        }
        const gkPrev = (yy, mm) => `${Number(yy)}-${Number(mm)}`;
        let prevAdvanceLinks = [];
        if (resolvedClassId) {
          try {
            const { data: advData } = await API.get("/fees/advance-links", {
              params: { class_id: resolvedClassId, year: prevY },
            });
            prevAdvanceLinks = Array.isArray(advData) ? advData : [];
          } catch {
            prevAdvanceLinks = [];
          }
        }
        if (cancelled) return;
        let prevCross = { monthlyByKey: {}, hasOverrideByKey: {} };
        if (resolvedClassId && selectedStudent?.id) {
          prevCross = await fetchCrossYearTargetMonthlyMap({
            studentId: selectedStudent.id,
            classId: resolvedClassId,
            sourceCalendarYear: prevY,
            advanceLinks: prevAdvanceLinks,
          });
        }
        const prevBillingMonths = buildBillingMonthsFromRange(
          feeCfg,
          structure,
          resolvedClassId ? overridePrev : null,
          resolvedClassId ? admissionPrev : null,
          resolvedClassId ? admissionByMonthPrev : null,
          resolvedClassId ? overrideByMonthPrev : null,
          resolvedClassId ? advancedByMonthPrev : null,
          resolvedClassId ? componentByMonthPrev : null,
          prevAdvanceLinks,
          prevCross.monthlyByKey,
          prevCross.hasOverrideByKey
        );
        const listCur = Array.isArray(paymentsRes?.data) ? paymentsRes.data : [];
        const listOlder = Array.isArray(paymentsOlderRes?.data) ? paymentsOlderRes.data : [];
        const payByIdPrev = new Map();
        for (const p of listOlder) {
          if (p && p.id != null) payByIdPrev.set(p.id, p);
        }
        for (const p of listCur) {
          if (p && p.id != null) payByIdPrev.set(p.id, p);
        }
        const payList = [...payByIdPrev.values()];
        if (cancelled) return;
        const prevOffGridTargetFees = {};
        if (resolvedClassId && prevAdvanceLinks.length && prevBillingMonths.length) {
          const gridKeysPrev = new Set(prevBillingMonths.map((b) => gkPrev(b.year, b.month)));
          const needByYearPrev = new Map();
          for (const link of prevAdvanceLinks) {
            const sy = Number(link.source_year);
            const sm = Number(link.source_month);
            const ty = Number(link.target_year);
            const tm = Number(link.target_month);
            if (!prevBillingMonths.some((b) => Number(b.year) === sy && Number(b.month) === sm)) continue;
            if (!gridKeysPrev.has(gkPrev(ty, tm))) {
              if (!needByYearPrev.has(ty)) needByYearPrev.set(ty, new Set());
              needByYearPrev.get(ty).add(tm);
            }
          }
          for (const [ty, monthSet] of needByYearPrev) {
            try {
              const [configTyRes, structureTyRes, sfTyRes] = await Promise.all([
                API.get("/fees/config", { params: { year: ty, class_id: resolvedClassId } }),
                API.get("/fees/structure", { params: { class_id: resolvedClassId, year: ty } }),
                API.get("/student-fee", { params: { student_id: selectedStudent.id, year: String(ty) } }),
              ]);
              if (cancelled) return;
              const cfgTy = configTyRes?.data && typeof configTyRes.data === "object" ? configTyRes.data : {};
              const structureTy = structureTyRes?.data && typeof structureTyRes.data === "object" ? structureTyRes.data : {};
              const dataTy = sfTyRes?.data && typeof sfTyRes.data === "object" ? sfTyRes.data : {};
              const feeCfgTy = {
                year: ty,
                start_month: Number(cfgTy.start_month || 1),
                end_month: Number(cfgTy.end_month || 12),
              };
              let oM = null;
              let oMmap = null;
              let oA = null;
              let oAmap = null;
              let oAdv = null;
              let oComp = null;
              const oa = dataTy?.override_amount;
              if (oa !== undefined && oa !== null && !Number.isNaN(Number(oa))) oM = roundMoney(oa);
              const omMap = dataTy?.override_amount_by_month;
              if (omMap && typeof omMap === "object" && !Array.isArray(omMap) && Object.keys(omMap).length > 0) {
                oMmap = omMap;
              }
              const adm = dataTy?.admission_fee_override;
              if (adm !== undefined && adm !== null && !Number.isNaN(Number(adm))) oA = roundMoney(adm);
              const admMap = dataTy?.admission_fee_override_by_month;
              if (admMap && typeof admMap === "object" && !Array.isArray(admMap) && Object.keys(admMap).length > 0) {
                oAmap = admMap;
              }
              const advMap = dataTy?.advanced_fee_override_by_month;
              if (advMap && typeof advMap === "object" && !Array.isArray(advMap) && Object.keys(advMap).length > 0) {
                oAdv = advMap;
              }
              const compMap = dataTy?.component_override_by_month;
              if (compMap && typeof compMap === "object" && !Array.isArray(compMap) && Object.keys(compMap).length > 0) {
                oComp = compMap;
              }
              let linksTy = [];
              try {
                const { data: advTy } = await API.get("/fees/advance-links", {
                  params: { class_id: resolvedClassId, year: ty },
                });
                linksTy = Array.isArray(advTy) ? advTy : [];
              } catch {
                linksTy = [];
              }
              const bmTy = buildBillingMonthsFromRange(
                feeCfgTy,
                structureTy,
                oM,
                oA,
                oAmap,
                oMmap,
                oAdv,
                oComp,
                linksTy
              );
              for (const tm of monthSet) {
                const row = bmTy.find((b) => Number(b.month) === tm && Number(b.year) === ty);
                if (row) {
                  prevOffGridTargetFees[gkPrev(ty, tm)] = roundMoney(
                    row.monthlyPart != null ? row.monthlyPart : row.fee
                  );
                }
              }
            } catch {
              /* skip year */
            }
          }
        }

        const prevLedger = distributeLedger(
          activePaymentsOnly(payList),
          prevBillingMonths,
          null,
          prevY,
          prevAdvanceLinks,
          prevOffGridTargetFees
        );
        if (!cancelled) {
          setPreviousYearForBanner({
            studentId: sid,
            loading: false,
            totalYearDue: roundMoney(prevLedger.totalYearDue),
          });
        }
      } catch {
        if (!cancelled) {
          setPreviousYearForBanner({ studentId: sid, loading: false, totalYearDue: 0 });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedStudent?.id, selectedStudent?.current_class_id, calendarYear]);

  useEffect(() => {
    if (!selectedStudentId) {
      setFeeSetup(null);
      setFeeConfig(null);
      setPaymentsRaw([]);
    setOverrideMonthly(null);
    setOverrideMonthlyByMonth(null);
    setOverrideAdmission(null);
      setOverrideAdmissionByMonth(null);
      setOverrideAdvancedByMonth(null);
      setOverrideComponentByMonth(null);
      setResolvedEnrollment(null);
      return;
  }
  setFeeSetup(null);
  setPaymentsRaw([]);
  setOverrideMonthly(null);
  setOverrideMonthlyByMonth(null);
  setOverrideAdmission(null);
  setOverrideAdmissionByMonth(null);
  setOverrideAdvancedByMonth(null);
  setOverrideComponentByMonth(null);
  setResolvedEnrollment(null);
    loadStudentDetail();
  }, [selectedStudentId, loadStudentDetail]);

  const billingMonths = useMemo(() => {
    if (!feeSetup || !feeConfig) return [];
    return buildBillingMonthsFromRange(
      feeConfig,
      feeSetup,
      overrideMonthly,
      overrideAdmission,
      overrideAdmissionByMonth,
      overrideMonthlyByMonth,
      overrideAdvancedByMonth,
      overrideComponentByMonth,
      advanceLinks,
      crossYearTargetMonthly,
      crossYearTargetHasOverride
    );
  }, [
    feeSetup,
    feeConfig,
    overrideMonthly,
    overrideMonthlyByMonth,
    overrideAdmission,
    overrideAdmissionByMonth,
    overrideAdvancedByMonth,
    overrideComponentByMonth,
    advanceLinks,
    crossYearTargetMonthly,
    crossYearTargetHasOverride,
  ]);

  useEffect(() => {
    if (!classIdForAdvanceLinks || !selectedStudent?.id || !Array.isArray(advanceLinks) || advanceLinks.length === 0 || !billingMonths.length) {
      setOffGridTargetFees({});
      return undefined;
    }
    const gk = (yy, mm) => `${Number(yy)}-${Number(mm)}`;
    const gridKeys = new Set(billingMonths.map((b) => gk(b.year, b.month)));
    const needByYear = new Map();
    for (const link of advanceLinks) {
      const sy = Number(link.source_year);
      const sm = Number(link.source_month);
      const ty = Number(link.target_year);
      const tm = Number(link.target_month);
      if (!billingMonths.some((b) => Number(b.year) === sy && Number(b.month) === sm)) continue;
      if (!gridKeys.has(gk(ty, tm))) {
        if (!needByYear.has(ty)) needByYear.set(ty, new Set());
        needByYear.get(ty).add(tm);
      }
    }
    if (needByYear.size === 0) {
      setOffGridTargetFees({});
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const out = {};
      for (const [key, fee] of Object.entries(crossYearTargetMonthly || {})) {
        if (!gridKeys.has(key)) out[key] = roundMoney(fee);
      }
      const ledgerY = billingMonths[0]?.year;
      for (const [ty, monthSet] of needByYear) {
        if (Number(ty) !== Number(ledgerY)) continue;
        try {
          const [configRes, structureRes, sfRes] = await Promise.all([
            API.get("/fees/config", { params: { year: ty, class_id: classIdForAdvanceLinks } }),
            API.get("/fees/structure", { params: { class_id: classIdForAdvanceLinks, year: ty } }),
            API.get("/student-fee", { params: { student_id: selectedStudent.id, year: String(ty) } }),
          ]);
          if (cancelled) return;
          const cfg = configRes?.data && typeof configRes.data === "object" ? configRes.data : {};
          const structure = structureRes?.data && typeof structureRes.data === "object" ? structureRes.data : {};
          const data = sfRes?.data && typeof sfRes.data === "object" ? sfRes.data : {};
          const feeCfg = {
            year: ty,
            start_month: Number(cfg.start_month || 1),
            end_month: Number(cfg.end_month || 12),
          };
          let oM = null;
          let oMmap = null;
          let oA = null;
          let oAmap = null;
          let oAdv = null;
          let oComp = null;
          const oa = data?.override_amount;
          if (oa !== undefined && oa !== null && !Number.isNaN(Number(oa))) oM = roundMoney(oa);
          const omMap = data?.override_amount_by_month;
          if (omMap && typeof omMap === "object" && !Array.isArray(omMap) && Object.keys(omMap).length > 0) {
            oMmap = omMap;
          }
          const adm = data?.admission_fee_override;
          if (adm !== undefined && adm !== null && !Number.isNaN(Number(adm))) oA = roundMoney(adm);
          const admMap = data?.admission_fee_override_by_month;
          if (admMap && typeof admMap === "object" && !Array.isArray(admMap) && Object.keys(admMap).length > 0) {
            oAmap = admMap;
          }
          const advMap = data?.advanced_fee_override_by_month;
          if (advMap && typeof advMap === "object" && !Array.isArray(advMap) && Object.keys(advMap).length > 0) {
            oAdv = advMap;
          }
          const compMap = data?.component_override_by_month;
          if (compMap && typeof compMap === "object" && !Array.isArray(compMap) && Object.keys(compMap).length > 0) {
            oComp = compMap;
          }
          let linksTy = [];
          try {
            const { data: advTy } = await API.get("/fees/advance-links", {
              params: { class_id: classIdForAdvanceLinks, year: ty },
            });
            linksTy = Array.isArray(advTy) ? advTy : [];
          } catch {
            linksTy = [];
          }
          const bm = buildBillingMonthsFromRange(
            feeCfg,
            structure,
            oM,
            oA,
            oAmap,
            oMmap,
            oAdv,
            oComp,
            linksTy
          );
          for (const tm of monthSet) {
            const row = bm.find((b) => Number(b.month) === tm && Number(b.year) === ty);
            if (row) {
              out[gk(ty, tm)] = roundMoney(row.monthlyPart != null ? row.monthlyPart : row.fee);
            }
          }
        } catch {
          /* skip year */
        }
      }
      if (!cancelled) setOffGridTargetFees(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [advanceLinks, billingMonths, classIdForAdvanceLinks, selectedStudent?.id, crossYearTargetMonthly]);

  useEffect(() => {
    if (!billingMonths.length) {
      setCurrentMonth(null);
      return;
    }
    const pendingMonth = pendingMonthRef.current;
    if (pendingMonth != null) {
      const match = billingMonths.find((m) => Number(m.month) === Number(pendingMonth));
      if (match) {
        setCurrentMonth(match);
        pendingMonthRef.current = null;
        return;
      }
    }
    setCurrentMonth((prev) => pickCurrentMonthForBilling(billingMonths, prev));
  }, [billingMonths]);

  const ledgerCalendarYear = parseInt(String(calendarYear).trim(), 10);

  useEffect(() => {
    if (!classIdForAdvanceLinks || !selectedStudent?.id || !advanceLinks.length || Number.isNaN(ledgerCalendarYear)) {
      setCrossYearTargetMonthly({});
      setCrossYearTargetHasOverride({});
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const cross = await fetchCrossYearTargetMonthlyMap({
        studentId: selectedStudent.id,
        classId: classIdForAdvanceLinks,
        sourceCalendarYear: ledgerCalendarYear,
        advanceLinks,
      });
      if (!cancelled) {
        setCrossYearTargetMonthly(cross.monthlyByKey);
        setCrossYearTargetHasOverride(cross.hasOverrideByKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classIdForAdvanceLinks, selectedStudent?.id, advanceLinks, ledgerCalendarYear]);

  /** Payments that touch this billing year (normal lines + advances via source or target year). */
  const paymentsForLedgerYear = useMemo(() => {
    const list = activePaymentsOnly(paymentsRaw);
    if (Number.isNaN(ledgerCalendarYear)) return list;
    return list.filter((p) => attributedAmountForCalendarYear(p, ledgerCalendarYear, advanceLinks) > 0);
  }, [paymentsRaw, ledgerCalendarYear, advanceLinks]);

  const ledger = useMemo(
    () =>
      distributeLedger(
        paymentsForLedgerYear,
        billingMonths,
        currentMonth,
        ledgerCalendarYear,
        advanceLinks,
        offGridTargetFees
      ),
    [paymentsForLedgerYear, billingMonths, currentMonth, ledgerCalendarYear, advanceLinks, offGridTargetFees]
  );

  /** Where the next payment will book (FIFO): first unpaid month, not the “Current month” dropdown. */
  const paymentBookingMonth = useMemo(
    () => firstUnpaidMonthFromLedger(billingMonths, ledger),
    [billingMonths, ledger]
  );

  const suggestedRecordPaymentAmount = useMemo(() => {
    if (!billingMonths.length || !ledger?.monthRows?.length) return "";
    const target = paymentBookingMonth ?? currentMonth;
    if (!target) return "";
    const row = ledger.monthRows.find(
      (r) => Number(r.month) === Number(target.month) && Number(r.year) === Number(target.year)
    );
    if (!row) return "";
    const feeD = row.feeDisplay != null ? roundMoney(row.feeDisplay) : roundMoney(row.fee);
    const paidD = row.paidDisplay != null ? roundMoney(row.paidDisplay) : roundMoney(row.paid);
    const rem = roundMoney(Math.max(0, feeD - paidD));
    return rem > 0 ? String(rem) : "";
  }, [billingMonths, ledger, paymentBookingMonth, currentMonth]);

  const suggestedPaymentRef = useRef("");
  suggestedPaymentRef.current = suggestedRecordPaymentAmount;

  useEffect(() => {
    if (!selectedStudentId) return;
    setPaymentAmount(suggestedRecordPaymentAmount);
  }, [selectedStudentId, suggestedRecordPaymentAmount]);

  const paymentHistoryDesc = useMemo(() => {
    const base = activePaymentsOnly(paymentsRaw);
    const filtered = Number.isNaN(ledgerCalendarYear)
      ? base
      : base.filter((p) => attributedAmountForCalendarYear(p, ledgerCalendarYear, advanceLinks) > 0);
    return [...filtered].sort((a, b) => paymentSortKey(b) - paymentSortKey(a));
  }, [paymentsRaw, ledgerCalendarYear, advanceLinks]);

  const onSelectStudent = (studentId) => {
    setSelectedStudentId(studentId);
    setPaymentDate(localDateInputValue());
    setError("");
    setInfo("");
  };

  const submitPayment = async () => {
    if (!selectedStudent) {
      setError("Select a student first.");
      return;
    }
    const amountPaid = parseWholeAmount(paymentAmount);
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
      setError("Enter a valid whole amount (e.g. 500, no decimals).");
      return;
    }

    const openYear = parseInt(String(calendarYear).trim(), 10);
    /** Book from first unpaid month (FIFO); fallback to Current month if everything is paid. */
    const bookingMonth = paymentBookingMonth ?? currentMonth;
    const useBookingMonth = bookingMonth != null;
    const payload = {
      student_id: selectedStudent.id,
      amount_paid: roundMoney(amountPaid),
      payment_date: paymentDate || localDateInputValue(),
      method: paymentMethod,
      payment_type: "payment",
      selected_month:
        useBookingMonth && bookingMonth.month != null ? Number(bookingMonth.month) : null,
      ledger_year:
        useBookingMonth && bookingMonth.year != null ? Number(bookingMonth.year) : openYear,
    };

    setPaymentSubmitting(true);
    setError("");
    setInfo("");
    try {
      await API.post("/payments", payload);
      await loadStudentDetail();
      setListStatusNonce((n) => n + 1);
      setPaymentAmount(suggestedPaymentRef.current);
      setInfo("Payment recorded.");
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to submit payment.");
    } finally {
      setPaymentSubmitting(false);
    }
  };

  const submitConcession = async () => {
    if (!selectedStudent) {
      setError("Select a student first.");
      return;
    }
    const amountPaid = parseWholeAmount(paymentAmount);
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
      setError("Enter a valid whole amount (e.g. 500, no decimals).");
      return;
    }
    setConcessionSubmitting(true);
    setError("");
    setInfo("");
    try {
      const openYear = parseInt(String(calendarYear).trim(), 10);
      const bookingMonth = paymentBookingMonth ?? currentMonth;
      const useBookingMonth = bookingMonth != null;
      await API.post("/payments", {
        student_id: selectedStudent.id,
        amount_paid: roundMoney(amountPaid),
        payment_date: paymentDate || localDateInputValue(),
        method: "cash",
        selected_month:
          useBookingMonth && bookingMonth.month != null ? Number(bookingMonth.month) : null,
        ledger_year:
          useBookingMonth && bookingMonth.year != null ? Number(bookingMonth.year) : openYear,
        payment_type: "concession",
      });
      await loadStudentDetail();
      setListStatusNonce((n) => n + 1);
      setPaymentAmount(suggestedPaymentRef.current);
      setInfo("Concession recorded.");
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to add concession.");
    } finally {
      setConcessionSubmitting(false);
    }
  };

  const handleDeletePayment = async (paymentId) => {
    if (!paymentId) return;
    if (!window.confirm("Delete this payment?")) return;
    if (!selectedStudent?.id) return;
    setDeletingId(paymentId);
    setError("");
    try {
      await API.delete(`/payments/${paymentId}`);
      await loadStudentDetail();
      setListStatusNonce((n) => n + 1);
      setPaymentAmount(suggestedPaymentRef.current);
      setInfo("Payment deleted successfully");
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.message || err.message || "Failed to delete payment.");
      window.alert("Failed to delete payment");
    } finally {
      setDeletingId(null);
    }
  };

  const overallStatus = ledgerStatus(ledger.remaining);
  const currentMonthSelectIndex = useMemo(() => {
    if (!currentMonth || !billingMonths.length) return -1;
    return billingMonths.findIndex((m) => m.month === currentMonth.month && m.year === currentMonth.year);
  }, [billingMonths, currentMonth]);

  return (
    <section className="page-card fee-collection-page fee-ledger-ui">
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title">Fee Collection</h1>
          <p className="page-header__subtitle">
            Enter the amount and submit. New payments book from the <strong>first unpaid month</strong> in order (FIFO), including advance links from Fee Setup — you don&apos;t need to
            match the <strong>Current month</strong> dropdown (that only affects which month is used for &quot;Pending Fee&quot; on screen). Concessions are separate. No challans
            required.
          </p>
          {selectedStudent &&
          previousYearForBanner &&
          String(previousYearForBanner.studentId) === String(selectedStudent.id) ? (
            <p className="alert alert--error fee-collection-banner fee-collection-banner--previous-year" role="status">
              The remaining balance for {String(selectedStudent.name || "").trim() || "Student"} from the previous year
              is:{" "}
              {previousYearForBanner.loading || previousYearForBanner.totalYearDue === null
                ? "…"
                : toMoney(previousYearForBanner.totalYearDue)}
              .
            </p>
          ) : null}
        </div>
      </div>

      {error ? <div className="alert alert--error fee-collection-banner fee-collection-banner--error">{error}</div> : null}
      {info ? <div className="alert alert--info fee-collection-banner fee-collection-banner--info">{info}</div> : null}

      <div className="fee-collection-main-grid fee-ledger-layout">
        <div className="fee-collection-toolbar card">
          <label className="label fee-collection-year-field">
            Billing year
            <input
              className="input"
              type="number"
              min={1900}
              max={2100}
              placeholder="e.g. 2026"
              value={calendarYear}
              onChange={(e) => setCalendarYear(e.target.value)}
            />
          </label>
          <label className="label fee-collection-year-field">
            Current month (for due display)
            <select
              className="input"
              value={currentMonthSelectIndex >= 0 ? String(currentMonthSelectIndex) : ""}
              onChange={(e) => {
                const idx = Number(e.target.value);
                if (!Number.isInteger(idx) || idx < 0 || !billingMonths[idx]) return;
                const selectedMonth = billingMonths[idx];
                setCurrentMonth(selectedMonth);
                localStorage.setItem(CURRENT_MONTH_STORAGE_KEY, JSON.stringify(selectedMonth));
              }}
            >
              <option value="">Select month</option>
              {billingMonths.map((m, index) => (
                <option key={`${m.year}-${m.month}`} value={String(index)}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <aside className="fee-collection-left card">
          <h2 className="fee-collection-title">Students</h2>

          <div className="fee-collection-controls">
            <label className="label">
              Search
              <input
                className="input"
                placeholder="Search student..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>

            <div className="fee-collection-filters">
              <label className="label">
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
              <label className="label">
                Section
                <select
                  className="input"
                  value={selectedSection}
                  onChange={(e) => setSelectedSection(e.target.value)}
                  disabled={isAlumniOption(selectedClass)}
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
                <select className="input" value={selectedGender} onChange={(e) => setSelectedGender(e.target.value)}>
                  <option value="all">All</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </label>
              <label className="label">
                Payment Status
                <select
                  className="input"
                  value={selectedPaymentStatus}
                  onChange={(e) => setSelectedPaymentStatus(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="paid">Paid</option>
                  <option value="partial">Unpaid</option>
                </select>
              </label>
            </div>
          </div>

          <div className="fee-collection-list-wrap fee-ledger-student-list">
            {loading && filteredStudents.length === 0 ? (
              <div className="fee-collection-empty">Loading students...</div>
            ) : filteredStudents.length === 0 ? (
              <div className="fee-collection-empty">No students found.</div>
            ) : (
              <div className="fee-ledger-student-cards">
                {filteredStudents.map((student) => {
                  const isSel = String(selectedStudentId) === String(student.id);
                  const topStatus =
                    isSel && !loadingStudentDetail
                      ? overallStatus
                      : listPaymentStatusLoading
                        ? null
                        : (listPaymentStatusByStudentId[student.id] || "partial");
                  return (
                    <button
                      key={student.id}
                      type="button"
                      className={isSel ? "fee-ledger-student-card is-selected" : "fee-ledger-student-card"}
                      onClick={() => onSelectStudent(student.id)}
                    >
                      <div className="fee-ledger-student-card__top">
                        <strong>{student.name}</strong>
                        {topStatus == null ? (
                          <span className="fc-status fc-status--muted">…</span>
                        ) : (
                          <span className={`fc-status fc-status--${topStatus}`}>{formatStatus(topStatus)}</span>
                        )}
                      </div>
                      <div className="fee-ledger-student-card__bottom">
                        <span>
                          {student.graduation_year
                            ? `Alumni ${student.graduation_year}`
                            : classNameById[student.current_class_id] || "—"}
                        </span>
                        {isSel && !loadingStudentDetail ? (
                          <span className="fee-collection-number">{toMoney(ledger.remaining)}</span>
                        ) : (
                          <span className="fee-collection-muted">—</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <div className="fee-collection-right fee-ledger-right">
          {!selectedStudent ? (
            <section className="card fee-collection-placeholder">Select a student</section>
          ) : loadingStudentDetail ? (
            <section className="card fee-collection-placeholder">Loading fee and payments…</section>
          ) : (
            <>
              <section className="card fee-ledger-header">
                <h2 className="fee-collection-title">Ledger — {selectedStudent.name}</h2>
                <p className="fee-collection-label fee-ledger-header__meta">
                  <span>
                    Class:{" "}
                    {selectedStudent.graduation_year
                      ? `Alumni ${selectedStudent.graduation_year}`
                      : classNameById[resolvedEnrollment?.class_id || selectedStudent.current_class_id] || "—"}
                  </span>
                  <span>
                    Std ID: {selectedStudent.id ? String(selectedStudent.id).slice(0, 8) : "—"}
                  </span>
                </p>
              </section>

              <section className="fee-ledger-summary-grid verdict-strip">
                <div className="card fee-ledger-summary-card verdict-card">
                  <span className="fee-collection-label verdict-card__label">Total fee (gross)</span>
                  <strong className="fee-collection-number verdict-card__value">{toMoney(ledger.totalFeeGross)}</strong>
                </div>
                <div className="card fee-ledger-summary-card verdict-card">
                  <span className="fee-collection-label verdict-card__label">Concession</span>
                  <strong className="fee-collection-number verdict-card__value">{toMoney(ledger.concessionTotal)}</strong>
                </div>
                <div className="card fee-ledger-summary-card verdict-card verdict-card--accent">
                  <span className="fee-collection-label verdict-card__label">Total paid</span>
                  <strong className="fee-collection-number verdict-card__value fee-ledger-value--paid">{toMoney(ledger.totalPaidRegular)}</strong>
                </div>
                <div className="card fee-ledger-summary-card verdict-card verdict-card--danger">
                  <span className="fee-collection-label verdict-card__label">Pending Fee</span>
                  <strong className="fee-collection-number verdict-card__value fee-ledger-value--remaining">{toMoney(ledger.remaining)}</strong>
                </div>
                <div className="card fee-ledger-summary-card verdict-card verdict-card--warn">
                  <span className="fee-collection-label verdict-card__label">Total Year Due</span>
                  <strong className="fee-collection-number verdict-card__value">{toMoney(ledger.totalYearDue)}</strong>
                </div>
              </section>

              <section className="card fee-collection-monthly fee-ledger-section">
                <h2 className="fee-collection-title">Monthly ledger</h2>
                <p className="fee-collection-hint">
                  Fees per month from Fee Setup (each month can differ)
                  {overrideMonthly != null ||
                  overrideMonthlyByMonth != null ||
                  overrideAdmission != null ||
                  overrideAdmissionByMonth != null ||
                  overrideAdvancedByMonth != null
                    ? "; student fee overrides from Fee Setup may apply (e.g. monthly amount, admission by month)"
                    : ""}
                  {" "}· {billingMonths.length} month(s) in range
                </p>
                <p className="fee-collection-hint">Current Month: {currentMonth?.label ?? "—"}</p>
                {ledger.monthRows.length === 0 ? (
                  <div className="fee-collection-empty">No billing months for this class/year in Fee Setup.</div>
                ) : (
                  <div className="fee-collection-month-grid fee-ledger-month-grid">
                    {ledger.monthRows.map((row) => {
                      const paidR = roundMoney(row.paid);
                      const feeR = roundMoney(row.fee);
                      const feeDisplayR = row.feeDisplay != null ? roundMoney(row.feeDisplay) : feeR;
                      const paidDisplayR = row.paidDisplay != null ? roundMoney(row.paidDisplay) : paidR;
                      const paidBaseR = row.paidBase != null ? roundMoney(row.paidBase) : paidR;
                      const outgoingParts = Array.isArray(row.outgoingParts) ? row.outgoingParts : [];
                      const structuralTargets = Array.isArray(row.structuralTargets) ? row.structuralTargets : [];
                      const fifoSrcR = roundMoney(row.fifoAdvanceFromSource || 0);
                      const advR = roundMoney(row.advancePaid || 0);
                      const capR = feeDisplayR;
                      const bundleFullyPaid =
                        row.bundleFullyPaid === true || (capR > 0 && paidDisplayR >= capR);
                      const localCapR =
                        row.localCap != null ? roundMoney(row.localCap) : roundMoney(feeR);
                      const localFullyPaid =
                        row.localFullyPaid === true ||
                        (localCapR > 0 && paidBaseR >= localCapR);
                      const advanceRemainderParts = Array.isArray(row.advanceRemainderParts)
                        ? row.advanceRemainderParts
                        : [];
                      const advanceLeftR = roundMoney(row.advanceRemainder || 0);
                      const showCheck = bundleFullyPaid || localFullyPaid;
                      const bundleRemaining = capR > paidDisplayR ? roundMoney(capR - paidDisplayR) : 0;
                      const shortMonth = row.label.split(" ")[0] || row.monthLabel;
                      const tipParts = [
                        `Paid ${toMoney(paidDisplayR)}`,
                        capR > 0 ? `due ${toMoney(capR)} (this month billing total)` : null,
                      ];
                      if (advR > 0) tipParts.push(`${toMoney(advR)} advance received on this month`);
                      if (!bundleFullyPaid && advanceLeftR > 0) {
                        tipParts.push(
                          advanceRemainderParts
                            .map((p) => `${toMoney(p.amount)} ${p.label} left`)
                            .join(", ")
                        );
                      } else if (capR > 0 && paidDisplayR > 0 && paidDisplayR < capR) {
                        tipParts.push(`${toMoney(bundleRemaining)} remaining`);
                      }
                      const tip = tipParts.filter(Boolean).join(" · ");

                      const showPaidBreakdown = outgoingParts.length > 0 || fifoSrcR > 0;
                      const paidBreakdown =
                        showPaidBreakdown ? (
                          <span className="fc-month-paid-breakdown">
                            <span className="fc-month-paid-num">{toMoney(paidBaseR)}</span>
                            <span className="fc-month-paid-src"> {shortMonth}</span>
                            {outgoingParts.map((op, opi) => (
                              <span key={`${op.targetLabel}-${opi}`} className="fc-month-paid-plus">
                                {" "}
                                +{" "}
                                <span className="fc-month-paid-num">{toMoney(op.amount)}</span>
                                <span className="fc-month-paid-tgt"> {op.targetLabel}</span>
                              </span>
                            ))}
                            {fifoSrcR > 0 ? (
                              <span key="fifo-advance-src" className="fc-month-paid-plus">
                                {" "}
                                +{" "}
                                <span className="fc-month-paid-num">{toMoney(fifoSrcR)}</span>
                                <span className="fc-month-paid-tgt"> linked (FIFO)</span>
                              </span>
                            ) : null}
                            <span className="fc-month-paid-sum">
                              {" "}
                              = {toMoney(paidDisplayR)}
                            </span>
                          </span>
                        ) : null;

                      return (
                        <div
                          key={row.key}
                          className={`fc-month fc-month--${row.status}`}
                          title={tip}
                        >
                          <span className="fc-month-name">{row.label}</span>
                          <span className="fc-month-value">
                            {feeR > 0 || feeDisplayR > 0 || paidDisplayR > 0 ? (
                              paidDisplayR > 0 || paidR > 0 ? (
                                <>
                                  {showCheck ? <span className="fc-month-check">✔ </span> : null}
                                  {paidBreakdown ? (
                                    paidBreakdown
                                  ) : (
                                    <>
                                      <span className="fc-month-paid-num">{toMoney(paidR)}</span>
                                      {advR > 0 ? <span className="fc-month-adv"> Adv</span> : null}
                                    </>
                                  )}
                                  {!bundleFullyPaid && advanceLeftR > 0 ? (
                                    <span className="fc-month-remain">
                                      {" · "}
                                      {advanceRemainderParts
                                        .map((p) => `${toMoney(p.amount)} ${p.label} left`)
                                        .join(" · ")}
                                    </span>
                                  ) : !showCheck && bundleRemaining > 0 ? (
                                    <span className="fc-month-remain"> · {toMoney(bundleRemaining)} left</span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="fc-month-unpaid-num">0</span>
                              )
                            ) : paidR > 0 ? (
                              <>
                                <span className="fc-month-paid-num">{toMoney(paidR)}</span>
                                {advR > 0 ? <span className="fc-month-adv"> Adv</span> : null}
                              </>
                            ) : (
                              <span className="fc-month-dash">—</span>
                            )}
                          </span>
                          {structuralTargets.length > 0 ? (
                            <span className="fc-month-bundle-parts">
                              {toMoney(feeR)}
                              {structuralTargets.map((t) => (
                                <span key={t.label}>
                                  {" "}
                                  + {toMoney(t.fee)} {t.label}
                                </span>
                              ))}
                            </span>
                          ) : null}
                          <span className="fc-month-cap">
                            {capR > 0 ? `/ ${toMoney(capR)}` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="card fee-ledger-section">
                <h2 className="fee-collection-title">Payment history</h2>
                <p className="fee-collection-hint">
                  Rows shown include any payment that has an allocation touching calendar year {calendarYear}
                  (including advance links from or to this year).
                </p>
                <div className="fee-ledger-history-wrap">
                  <table className="fee-collection-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Type</th>
                        <th className="fee-col-actions">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingHistory ? (
                        <tr>
                          <td colSpan={4}>Loading…</td>
                        </tr>
                      ) : paymentHistoryDesc.length === 0 ? (
                        <tr>
                          <td colSpan={4}>No payments.</td>
                        </tr>
                      ) : (
                        paymentHistoryDesc.map((row) => {
                          const isCon = isConcessionPayment(row);
                          const allocSummary = formatPaymentAllocationSummary(row, advanceLinks);
                          return (
                            <tr key={row.id}>
                              <td>
                                {row.payment_date ? new Date(row.payment_date).toLocaleDateString() : "—"}
                                {allocSummary ? (
                                  <div className="fee-ledger-alloc-detail">{allocSummary}</div>
                                ) : null}
                              </td>
                              <td className="fee-collection-number">{toMoney(row.amount_paid)}</td>
                              <td>{isCon ? "Concession" : row.type || "Payment"}</td>
                              <td className="fee-col-actions">
                                <button
                                  type="button"
                                  className="button fee-btn-danger-outline"
                                  disabled={deletingId === row.id}
                                  onClick={() => handleDeletePayment(row.id)}
                                >
                                  {deletingId === row.id ? "…" : "Delete"}
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card fee-ledger-section">
                <h2 className="fee-collection-title">Record payment</h2>
                {advanceLinks.length > 0 && classIdForAdvanceLinks ? (
                  <p className="fee-collection-hint">
                    This class has advance links in Fee Setup. Pay <strong>more than the current month&apos;s total fee</strong> (shown in the monthly grid) and the surplus is
                    allocated automatically to the linked month. Use <strong>Billing year</strong> to review earlier or later calendar years (e.g. advance paid toward 2027).
                  </p>
                ) : null}
                <div className="fee-ledger-payment-grid">
                  <label className="label">
                    Amount
                    <input
                      className="input"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={paymentAmount}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") {
                          setPaymentAmount("");
                          return;
                        }
                        if (/^\d+$/.test(v)) setPaymentAmount(v);
                      }}
                      placeholder="0"
                    />
                  </label>
                  <label className="label">
                    Date
                    <input
                      className="input"
                      type="date"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                    />
                  </label>
                  <label className="label">
                    Method
                    <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                      <option value="cash">Cash</option>
                      <option value="bank">Bank</option>
                      <option value="online">Online</option>
                    </select>
                  </label>
                </div>
                <div className="fee-ledger-action-buttons">
                  <button type="button" className="button" disabled={paymentSubmitting || concessionSubmitting} onClick={submitPayment}>
                    {paymentSubmitting ? "Saving…" : "Submit payment"}
                  </button>
                  <button
                    type="button"
                    className="button fee-collection-secondary-btn"
                    disabled={paymentSubmitting || concessionSubmitting}
                    onClick={submitConcession}
                  >
                    {concessionSubmitting ? "Saving…" : "+ Add concession"}
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
