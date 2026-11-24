import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import API from "../api";
import FeeSetupGridTable from "../components/FeeSetupGridTable";
import { roundMoney } from "../utils/money";
import { fetchCrossYearTargetMonthlyMap } from "../utils/feeCrossYearClient";
import { targetMonthlyKey } from "../utils/feeAdvanceEffective";
import {
  buildAssignPayloadFromDraft,
  cloneClassGridDraft,
  mergeStudentFeeIntoDraft,
  studentHasStoredOverride,
} from "../utils/feeSetupOverrideUtils";
import "./feeSetup.css";

function normFeeComponentsFromStructure(structure) {
  if (!structure) return [];
  const fromFee = Array.isArray(structure.fee_components) ? structure.fee_components : null;
  const fromComp = Array.isArray(structure.components) ? structure.components : null;
  const raw = (fromFee && fromFee.length > 0 ? fromFee : fromComp) || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => ({
    id: r.id,
    label: r.label != null ? String(r.label) : "",
    sort_order: r.sort_order != null ? Number(r.sort_order) : 0,
    amounts: typeof r.amounts === "object" && r.amounts !== null ? { ...r.amounts } : {},
  }));
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

const monthLabel = (month) => MONTH_OPTIONS.find((m) => m.value === Number(month))?.label || `M${month}`;

/** Advance-link auto-fill targets the standard extra column (same wording as ledger advanced fee). */
function isAdvancedFeeComponent(comp) {
  const lab = String(comp?.label || "").trim().toLowerCase();
  return lab === "advanced fee" || lab === "advance fee";
}

/**
 * For each advance link with source in `calendarYear`, set Advanced fee amounts on source months to the
 * target month’s **monthly fee** from that target year’s fee grid. Returns merged components + hints like "Jan 2027-5000".
 */
async function computeAdvanceLinkFill(classId, calendarYear, components, linksList, options = {}) {
  const { monthlyFeeResolver } = options;
  const y = Number(calendarYear);
  const linksForYear = (linksList || []).filter((l) => Number(l.source_year) === y);
  const emptyHints = {};
  if (!linksForYear.length || !classId) {
    return { nextComponents: components, hints: emptyHints, persistRows: [], advId: null };
  }

  const targetYears = [...new Set(linksForYear.map((l) => Number(l.target_year)))];
  const structuresByYear = {};
  const needsStructureFetch =
    !monthlyFeeResolver ||
    targetYears.some((ty) =>
      linksForYear.some((l) => {
        if (Number(l.target_year) !== ty) return false;
        const custom = monthlyFeeResolver(ty, Number(l.target_month));
        return custom == null || custom === "" || Number.isNaN(Number(custom));
      })
    );
  if (needsStructureFetch) {
    await Promise.all(
      targetYears.map(async (ty) => {
        try {
          const { data } = await API.get("/fees/structure", {
            params: { class_id: classId, year: ty },
          });
          structuresByYear[ty] = data;
        } catch {
          structuresByYear[ty] = null;
        }
      })
    );
  }

  const monthlyFeeForTarget = (data, tm) => {
    const rawMonths = Array.isArray(data?.months) ? data.months : [];
    const targetRow = rawMonths.find((m) => Number(m.month) === tm);
    return targetRow ? roundMoney(Number(targetRow.monthly_fee ?? targetRow.fee ?? 0)) : 0;
  };

  const resolveTargetFee = (ty, tm) => {
    if (monthlyFeeResolver) {
      const custom = monthlyFeeResolver(ty, tm);
      if (custom != null && custom !== "" && !Number.isNaN(Number(custom))) {
        return roundMoney(Number(custom));
      }
    }
    return monthlyFeeForTarget(structuresByYear[ty], tm);
  };

  const agg = new Map();
  for (const link of linksForYear) {
    const sm = Number(link.source_month);
    const ty = Number(link.target_year);
    const tm = Number(link.target_month);
    const feeAmt = resolveTargetFee(ty, tm);
    const label = `${monthLabel(tm)} ${ty}-${feeAmt}`;
    const cur = agg.get(sm) || { total: 0, labels: [] };
    cur.total = roundMoney(cur.total + feeAmt);
    cur.labels.push(label);
    agg.set(sm, cur);
  }

  const hints = {};
  for (const [sm, v] of agg.entries()) {
    hints[String(sm)] = v.labels.join("; ");
  }

  const adv = components.find(isAdvancedFeeComponent);
  if (!adv) {
    return { nextComponents: components, hints, persistRows: [], advId: null };
  }

  const nextAmounts = { ...adv.amounts };
  const persistRows = [];
  for (const [sm, v] of agg.entries()) {
    const key = String(sm);
    if (nextAmounts[key] !== v.total) {
      nextAmounts[key] = v.total;
      persistRows.push({ month: sm, amount: v.total });
    }
  }

  if (persistRows.length === 0) {
    return { nextComponents: components, hints, persistRows: [], advId: adv.id };
  }

  const nextComponents = components.map((c) => (c.id === adv.id ? { ...c, amounts: nextAmounts } : c));
  return { nextComponents, hints, persistRows, advId: adv.id };
}

export default function FeeSetup() {
  const navigate = useNavigate();
  const location = useLocation();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [startMonth, setStartMonth] = useState(1);
  const [endMonth, setEndMonth] = useState(12);
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const classRouteRef = useRef("");
  const [students, setStudents] = useState([]);
  const [months, setMonths] = useState([]);
  const [overridePanelOpen, setOverridePanelOpen] = useState(false);
  const [selectedOverrideStudentIds, setSelectedOverrideStudentIds] = useState(() => new Set());
  const [overrideDraft, setOverrideDraft] = useState(null);
  const [studentsWithOverride, setStudentsWithOverride] = useState(() => new Set());
  const [savingStudentOverride, setSavingStudentOverride] = useState(false);
  const [loadingOverrideDraft, setLoadingOverrideDraft] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingRange, setSavingRange] = useState(false);
  const [revertingRange, setRevertingRange] = useState(false);
  const [savingMonths, setSavingMonths] = useState(false);
  const [billingRangeSource, setBillingRangeSource] = useState("default");
  const [feeComponents, setFeeComponents] = useState([]);
  const [advanceLinks, setAdvanceLinks] = useState([]);
  /** source billing month (1–12) → label from advance links (e.g. Jan 2027-5000) */
  const [advanceFeeLinkHints, setAdvanceFeeLinkHints] = useState({});
  const [overrideAdvanceHints, setOverrideAdvanceHints] = useState({});
  const overrideDraftRef = useRef(null);
  const [newAdv, setNewAdv] = useState(() => {
    const y = new Date().getFullYear();
    return { source_year: y, source_month: 11, target_year: y + 1, target_month: 1 };
  });
  const [savingAdvanceLink, setSavingAdvanceLink] = useState(false);

  /** Class fee grid is locked after save until Edit is clicked. */
  const [classGridEditing, setClassGridEditing] = useState(false);
  /** Override grid locked after save until Edit. */
  const [overrideEditing, setOverrideEditing] = useState(false);
  const [classSearch, setClassSearch] = useState("");
  const [overrideStudentSearch, setOverrideStudentSearch] = useState("");
  const [applyMonthlyAmount, setApplyMonthlyAmount] = useState("");
  const [applyMonthIds, setApplyMonthIds] = useState(() => new Set());
  /** Which fee column the apply bar targets: "monthly" or a component id. */
  const [applyColumnKey, setApplyColumnKey] = useState("monthly");
  const [overrideApplyMonthlyAmount, setOverrideApplyMonthlyAmount] = useState("");
  const [overrideApplyMonthIds, setOverrideApplyMonthIds] = useState(() => new Set());
  const [overrideApplyColumnKey, setOverrideApplyColumnKey] = useState("monthly");
  /** While editing, month matrix starts hidden until user clicks Show months. */
  const [monthMatrixOpen, setMonthMatrixOpen] = useState(true);
  const [overrideMonthMatrixOpen, setOverrideMonthMatrixOpen] = useState(true);
  const [advanceSectionOpen, setAdvanceSectionOpen] = useState(false);
  const [rangeSectionOpen, setRangeSectionOpen] = useState(false);

  const classStudents = useMemo(
    () => students.filter((s) => String(s.current_class_id) === String(selectedClassId)),
    [students, selectedClassId]
  );
  const studentCountByClass = useMemo(() => {
    const map = new Map();
    for (const s of students) {
      const key = String(s.current_class_id || "");
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [students]);

  const filteredClasses = useMemo(() => {
    const q = classSearch.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter((c) => String(c.name || "").toLowerCase().includes(q));
  }, [classes, classSearch]);

  const filteredOverrideStudents = useMemo(() => {
    const q = overrideStudentSearch.trim().toLowerCase();
    if (!q) return classStudents;
    return classStudents.filter((s) => String(s.name || "").toLowerCase().includes(q));
  }, [classStudents, overrideStudentSearch]);

  /** Re-run advance-link fill when columns appear/rename; ignore amount-only updates (avoids loops). */
  const feeComponentsStructureKey = useMemo(
    () => feeComponents.map((c) => `${c.id}:${String(c.label || "")}`).join("|"),
    [feeComponents]
  );

  const feeComponentsRef = useRef(feeComponents);
  feeComponentsRef.current = feeComponents;

  const getCellAmountDisplay = (comp, monthNum) => {
    const amts = comp.amounts || {};
    const v = amts[String(monthNum)] ?? amts[monthNum];
    if (v === undefined || v === null || v === "") return "";
    return roundMoney(Number(v));
  };

  const saveComponentMonthAmount = async (componentId, monthNum, rawFee) => {
    if (!selectedClassId) return;
    let value = 0;
    if (rawFee !== "" && rawFee !== null && rawFee !== undefined) {
      const num = Number(rawFee);
      if (Number.isNaN(num) || num < 0) {
        setError("Each amount must be a non-negative whole number.");
        return;
      }
      value = roundMoney(num);
    }
    setError("");
    try {
      await API.post("/fees/component-month-amount", {
        component_id: componentId,
        month: monthNum,
        amount: value,
      });
      setFeeComponents((prev) =>
        prev.map((c) =>
          c.id === componentId
            ? {
                ...c,
                amounts:
                  value === 0
                    ? { ...c.amounts, [String(monthNum)]: 0 }
                    : { ...c.amounts, [String(monthNum)]: value },
              }
            : c
        )
      );
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to save extra fee amount.");
    }
  };

  const saveComponentLabel = async (componentId, nextLabel) => {
    const trimmed = String(nextLabel || "").trim();
    if (!trimmed) {
      setError("Column name cannot be empty.");
      return;
    }
    setError("");
    try {
      await API.patch(`/fees/components/${componentId}`, { label: trimmed });
      setFeeComponents((prev) => prev.map((c) => (c.id === componentId ? { ...c, label: trimmed } : c)));
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to save column name.");
    }
  };

  const loadBase = async () => {
    setLoading(true);
    setError("");
    try {
      const y = Number(year);
      const [classesRes, studentsRes, configRes] = await Promise.all([
        API.get("/classes"),
        API.get("/students"),
        API.get("/fees/config", { params: { year: y } }),
      ]);
      setClasses(Array.isArray(classesRes.data) ? classesRes.data : []);
      setStudents(Array.isArray(studentsRes.data) ? studentsRes.data : []);
      setStartMonth(Number(configRes.data?.start_month || 1));
      setEndMonth(Number(configRes.data?.end_month || 12));
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to load fee setup.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBase();
  }, [year]);

  useEffect(() => {
    const y = Number(year);
    if (Number.isInteger(y) && y >= 1900 && y <= 2100) {
      setNewAdv((p) => ({ ...p, source_year: y, target_year: y + 1 }));
    }
  }, [year]);

  /** When advance links or column layout changes, sync Advanced fee cells + hints (uses latest grid via ref). */
  useEffect(() => {
    let cancelled = false;
    if (!selectedClassId || !/^\d{4}$/.test(String(year))) {
      setAdvanceFeeLinkHints({});
      return undefined;
    }
    if (!feeComponentsRef.current.length) {
      return undefined;
    }

    (async () => {
      try {
        const y = Number(year);
        const filled = await computeAdvanceLinkFill(selectedClassId, y, feeComponentsRef.current, advanceLinks);
        if (cancelled) return;
        setAdvanceFeeLinkHints(filled.hints || {});
        // Keep old Advanced-link fill behavior, but only patch the Advanced fee column
        // on the latest state (do not replace all feeComponents — that broke Apply).
        if (filled.advId) {
          const advIdKey = String(filled.advId);
          const filledAdv = (filled.nextComponents || []).find((c) => String(c.id) === advIdKey);
          const linkMonths = new Set([
            ...Object.keys(filled.hints || {}),
            ...(filled.persistRows || []).map((p) => String(p.month)),
          ]);
          if (filledAdv && linkMonths.size > 0) {
            setFeeComponents((prev) =>
              prev.map((c) => {
                if (String(c.id) !== advIdKey) return c;
                const nextAmounts = { ...(c.amounts || {}) };
                let changed = false;
                linkMonths.forEach((mk) => {
                  const v = filledAdv.amounts?.[mk];
                  if (v === undefined || v === null || v === "") return;
                  if (nextAmounts[mk] !== v) {
                    nextAmounts[mk] = v;
                    changed = true;
                  }
                });
                return changed ? { ...c, amounts: nextAmounts } : c;
              })
            );
          }
          for (const p of filled.persistRows || []) {
            try {
              await API.post("/fees/component-month-amount", {
                component_id: filled.advId,
                month: p.month,
                amount: p.amount,
              });
            } catch {
              /* optional */
            }
          }
        }
      } catch {
        if (!cancelled) setAdvanceFeeLinkHints({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedClassId, year, advanceLinks, feeComponentsStructureKey]);

  useEffect(() => {
    const loadClassData = async () => {
      if (!selectedClassId || !/^\d{4}$/.test(String(year))) {
        setMonths([]);
        setFeeComponents([]);
        setAdvanceLinks([]);
        setAdvanceFeeLinkHints({});
        setOverridePanelOpen(false);
        setSelectedOverrideStudentIds(new Set());
        setOverrideDraft(null);
        setStudentsWithOverride(new Set());
        setBillingRangeSource("default");
        setClassGridEditing(false);
        setOverrideEditing(false);
        setMonthMatrixOpen(true);
        setOverrideMonthMatrixOpen(true);
        return;
      }
      try {
        const y = Number(year);
        const [structureRes, linksRes] = await Promise.all([
          API.get("/fees/structure", { params: { class_id: selectedClassId, year: y } }),
          API.get("/fees/advance-links", { params: { class_id: selectedClassId, year: y } }).catch(() => ({
            data: [],
          })),
        ]);
        setStartMonth(Number(structureRes.data?.start_month || 1));
        setEndMonth(Number(structureRes.data?.end_month || 12));
        setBillingRangeSource(structureRes.data?.billing_range_source === "class" ? "class" : "default");
        const rawMonths = Array.isArray(structureRes.data?.months) ? structureRes.data.months : [];
        setMonths(
          rawMonths.map((m) => ({
            month: m.month,
            fee: roundMoney(m.monthly_fee ?? m.fee ?? 0),
          }))
        );
        const advLinks = Array.isArray(linksRes?.data) ? linksRes.data : [];
        setAdvanceLinks(advLinks);
        const baseComponents = normFeeComponentsFromStructure(structureRes.data);
        const filled = await computeAdvanceLinkFill(selectedClassId, y, baseComponents, advLinks);
        setFeeComponents(filled.nextComponents);
        setAdvanceFeeLinkHints(filled.hints);
        if (filled.advId && filled.persistRows.length) {
          for (const p of filled.persistRows) {
            try {
              await API.post("/fees/component-month-amount", {
                component_id: filled.advId,
                month: p.month,
                amount: p.amount,
              });
            } catch {
              /* saved in UI even if persist fails */
            }
          }
        }
        setClassGridEditing(false);
        setOverrideEditing(false);
        setMonthMatrixOpen(true);
        setOverrideMonthMatrixOpen(true);
        setApplyColumnKey("monthly");
        setOverrideApplyColumnKey("monthly");
        setApplyMonthlyAmount("");
        setApplyMonthIds(new Set());
        setOverrideApplyMonthlyAmount("");
        setOverrideApplyMonthIds(new Set());
        setOverrideStudentSearch("");
      } catch (err) {
        setError(err?.response?.data?.message || err.message || "Failed to load class fee structure.");
      }
    };
    loadClassData();
  }, [selectedClassId, year, classStudents]);

  const reloadClassStructure = useCallback(async () => {
    if (!selectedClassId || !/^\d{4}$/.test(String(year))) return;
    try {
      const y = Number(year);
      const structureRes = await API.get("/fees/structure", {
        params: { class_id: selectedClassId, year: y },
      });
      setStartMonth(Number(structureRes.data?.start_month || 1));
      setEndMonth(Number(structureRes.data?.end_month || 12));
      setBillingRangeSource(structureRes.data?.billing_range_source === "class" ? "class" : "default");
      const rawMonths = Array.isArray(structureRes.data?.months) ? structureRes.data.months : [];
      setMonths(
        rawMonths.map((m) => ({
          month: m.month,
          fee: roundMoney(m.monthly_fee ?? m.fee ?? 0),
        }))
      );
      setFeeComponents(normFeeComponentsFromStructure(structureRes.data));
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to reload fee structure.");
    }
  }, [selectedClassId, year]);

  const openClass = (classId) => {
    const id = String(classId || "");
    if (!id) return;
    setError("");
    setInfo("");
    const alreadyInClass = Boolean(new URLSearchParams(location.search).get("class"));
    navigate(`/fee-setup?class=${encodeURIComponent(id)}`, { replace: alreadyInClass });
  };

  /** Keep class drill-down in the URL so the app header Back returns to the class list. */
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("class") || "";
    if (classRouteRef.current === id) return;
    classRouteRef.current = id;
    setSelectedClassId(id);
    setOverridePanelOpen(false);
    setAdvanceSectionOpen(false);
    setRangeSectionOpen(false);
    setSelectedOverrideStudentIds(new Set());
    setOverrideDraft(null);
    setClassGridEditing(false);
    setOverrideEditing(false);
    setMonthMatrixOpen(true);
    setOverrideMonthMatrixOpen(true);
    setApplyColumnKey("monthly");
    setOverrideApplyColumnKey("monthly");
    setError("");
    setInfo("");
  }, [location.search]);

  const startClassGridEdit = () => {
    setClassGridEditing(true);
    setMonthMatrixOpen(false);
    setApplyColumnKey("monthly");
    setApplyMonthlyAmount("");
    setApplyMonthIds(new Set());
  };

  const finishClassGridShow = () => {
    setClassGridEditing(false);
    setMonthMatrixOpen(true);
    setApplyMonthlyAmount("");
    setApplyMonthIds(new Set());
    setApplyColumnKey("monthly");
  };

  const cancelClassGridEdit = async () => {
    finishClassGridShow();
    await reloadClassStructure();
  };

  const saveRange = async () => {
    setError("");
    setInfo("");
    const y = Number(year);
    if (Number.isNaN(y) || y < 1900 || y > 2100) {
      setError("Enter a valid year.");
      return;
    }
    if (Number(startMonth) > Number(endMonth)) {
      setError("Start month must be less than or equal to end month.");
      return;
    }
    setSavingRange(true);
    try {
      const body = {
        year: y,
        start_month: Number(startMonth),
        end_month: Number(endMonth),
      };
      if (selectedClassId) body.class_id = selectedClassId;
      const { data } = await API.post("/fees/config", body);
      setStartMonth(Number(data.start_month));
      setEndMonth(Number(data.end_month));
      if (data.source === "class" || (selectedClassId && data.class_id)) {
        setBillingRangeSource("class");
      } else {
        setBillingRangeSource("default");
      }
      setInfo(
        selectedClassId
          ? "Month range saved for this class."
          : "Default month range saved for the year (all classes without their own range)."
      );
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to save month range.");
    } finally {
      setSavingRange(false);
    }
  };

  const revertClassRange = async () => {
    if (!selectedClassId) return;
    setError("");
    setInfo("");
    const y = Number(year);
    setRevertingRange(true);
    try {
      await API.delete("/fees/config/class", { params: { year: y, class_id: selectedClassId } });
      const yf = Number(year);
      const structureRes = await API.get("/fees/structure", { params: { class_id: selectedClassId, year: yf } });
      setStartMonth(Number(structureRes.data?.start_month || 1));
      setEndMonth(Number(structureRes.data?.end_month || 12));
      setBillingRangeSource(structureRes.data?.billing_range_source === "class" ? "class" : "default");
      const rawMonths = Array.isArray(structureRes.data?.months) ? structureRes.data.months : [];
      setMonths(
        rawMonths.map((m) => ({
          month: m.month,
          fee: roundMoney(m.monthly_fee ?? m.fee ?? 0),
        }))
      );
      setFeeComponents(normFeeComponentsFromStructure(structureRes.data));
      setInfo("This class now uses the year default month range.");
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to revert class range.");
    } finally {
      setRevertingRange(false);
    }
  };

  const saveMonth = async (month, fee) => {
    if (!selectedClassId) return false;
    if (fee === "" || fee === null || fee === undefined) return false;
    const y = Number(year);
    const num = Number(fee);
    if (Number.isNaN(num) || num < 0) {
      setError("Fee must be a non-negative whole amount.");
      return false;
    }
    const value = roundMoney(num);
    try {
      await API.post("/fees/structure", { class_id: selectedClassId, year: y, month, fee: value });
      return true;
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to save monthly fee.");
      return false;
    }
  };

  const saveAllMonths = async () => {
    setError("");
    setInfo("");
    if (!selectedClassId) {
      setError("Select a class first.");
      return;
    }
    setSavingMonths(true);
    try {
      for (const row of months) {
        // Keep per-month independence; save each month as its own row.
        // eslint-disable-next-line no-await-in-loop
        const ok = await saveMonth(row.month, row.fee);
        if (!ok && row.fee !== "" && row.fee !== null && row.fee !== undefined) {
          return;
        }
      }
      for (const comp of feeComponents) {
        for (const row of months) {
          const raw = getCellAmountDisplay(comp, row.month);
          // eslint-disable-next-line no-await-in-loop
          await saveComponentMonthAmount(comp.id, row.month, raw === "" ? 0 : raw);
        }
      }
      setInfo("Fees saved.");
      finishClassGridShow();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to save monthly fees.");
    } finally {
      setSavingMonths(false);
    }
  };

  const applyFeeColumnToSelectedMonths = () => {
    if (!classGridEditing) return;
    const num = Number(applyMonthlyAmount);
    if (applyMonthlyAmount === "" || Number.isNaN(num) || num < 0) {
      setError("Enter a valid non-negative amount.");
      return;
    }
    if (applyMonthIds.size === 0) {
      setError("Select at least one month.");
      return;
    }
    const value = roundMoney(num);
    setError("");
    if (applyColumnKey === "monthly") {
      setMonths((prev) =>
        prev.map((row) => (applyMonthIds.has(Number(row.month)) ? { ...row, fee: value } : row))
      );
    } else {
      const colKey = String(applyColumnKey);
      const target = feeComponents.find((c) => String(c.id) === colKey);
      if (!target) {
        setError("Selected fee column was not found.");
        return;
      }
      setFeeComponents((prev) =>
        prev.map((c) => {
          if (String(c.id) !== colKey) return c;
          const next = { ...(c.amounts || {}) };
          applyMonthIds.forEach((m) => {
            next[String(m)] = value;
          });
          return { ...c, amounts: next };
        })
      );
    }
    const colLabel =
      applyColumnKey === "monthly"
        ? "Monthly fee"
        : feeComponents.find((c) => String(c.id) === String(applyColumnKey))?.label || "Column";
    setInfo(`${colLabel}: ${value} → ${applyMonthIds.size} month${applyMonthIds.size === 1 ? "" : "s"}.`);
    setMonthMatrixOpen(true);
  };

  const toggleApplyMonth = (monthNum) => {
    setApplyMonthIds((prev) => {
      const next = new Set(prev);
      if (next.has(monthNum)) next.delete(monthNum);
      else next.add(monthNum);
      return next;
    });
  };

  const selectAllApplyMonths = () => {
    setApplyMonthIds(new Set(months.map((m) => Number(m.month))));
  };

  const clearApplyMonths = () => setApplyMonthIds(new Set());

  const applyOverrideFeeColumnToSelectedMonths = () => {
    if (!overrideEditing) return;
    const num = Number(overrideApplyMonthlyAmount);
    if (overrideApplyMonthlyAmount === "" || Number.isNaN(num) || num < 0) {
      setError("Enter a valid non-negative amount.");
      return;
    }
    if (overrideApplyMonthIds.size === 0) {
      setError("Select at least one month.");
      return;
    }
    const value = roundMoney(num);
    setError("");
    const colKey = String(overrideApplyColumnKey);
    setOverrideDraft((prev) => {
      if (!prev) return prev;
      if (overrideApplyColumnKey === "monthly") {
        return {
          ...prev,
          months: prev.months.map((row) =>
            overrideApplyMonthIds.has(Number(row.month)) ? { ...row, fee: value } : row
          ),
        };
      }
      return {
        ...prev,
        components: prev.components.map((c) => {
          if (String(c.id) !== colKey) return c;
          const next = { ...(c.amounts || {}) };
          overrideApplyMonthIds.forEach((m) => {
            next[String(m)] = value;
          });
          return { ...c, amounts: next };
        }),
      };
    });
    const colLabel =
      overrideApplyColumnKey === "monthly"
        ? "Monthly fee"
        : overrideDraft?.components?.find((c) => String(c.id) === colKey)?.label || "Column";
    setInfo(`Override ${colLabel}: ${value} → ${overrideApplyMonthIds.size} month${overrideApplyMonthIds.size === 1 ? "" : "s"}.`);
    setOverrideMonthMatrixOpen(true);
  };

  const refreshStudentsWithOverride = useCallback(async () => {
    if (!selectedClassId || !classStudents.length || !/^\d{4}$/.test(String(year))) {
      setStudentsWithOverride(new Set());
      return;
    }
    const y = Number(year);
    const results = await Promise.all(
      classStudents.map(async (s) => {
        try {
          const { data } = await API.get("/student-fee", { params: { student_id: s.id, year: y } });
          return studentHasStoredOverride(data) ? s.id : null;
        } catch {
          return null;
        }
      })
    );
    setStudentsWithOverride(new Set(results.filter(Boolean)));
  }, [selectedClassId, classStudents, year]);

  useEffect(() => {
    if (overridePanelOpen && selectedClassId) {
      refreshStudentsWithOverride();
    }
  }, [overridePanelOpen, selectedClassId, refreshStudentsWithOverride]);

  const rebuildOverrideDraft = useCallback(async () => {
    if (!months.length || !feeComponents.length) {
      setOverrideDraft(null);
      return;
    }
    const draft = cloneClassGridDraft(months, feeComponents);
    const ids = [...selectedOverrideStudentIds];
    if (ids.length === 1) {
      setLoadingOverrideDraft(true);
      try {
        const { data } = await API.get("/student-fee", {
          params: { student_id: ids[0], year: Number(year) },
        });
        mergeStudentFeeIntoDraft(draft, data, feeComponents);
      } catch {
        /* class grid only */
      } finally {
        setLoadingOverrideDraft(false);
      }
    }
    setOverrideDraft(draft);
    setOverrideEditing(false);
  }, [months, feeComponents, selectedOverrideStudentIds, year]);

  useEffect(() => {
    if (!overridePanelOpen) return;
    rebuildOverrideDraft();
  }, [overridePanelOpen, rebuildOverrideDraft]);

  useEffect(() => {
    overrideDraftRef.current = overrideDraft;
  }, [overrideDraft]);

  const overrideMonthlyFeesKey = useMemo(() => {
    if (!overrideDraft?.months?.length) return "";
    return overrideDraft.months.map((m) => `${m.month}:${m.fee}`).join("|");
  }, [overrideDraft?.months]);

  useEffect(() => {
    if (!overridePanelOpen || !selectedClassId || !advanceLinks.length) {
      if (!overridePanelOpen) setOverrideAdvanceHints({});
      return undefined;
    }
    const draft = overrideDraftRef.current;
    if (!draft?.months?.length) return undefined;
    let cancelled = false;
    const draftMonths = draft.months;
    const draftComponents = draft.components;
    const singleOverrideStudentId =
      selectedOverrideStudentIds.size === 1 ? [...selectedOverrideStudentIds][0] : null;
    (async () => {
      let crossMonthlyByKey = {};
      if (singleOverrideStudentId) {
        const cross = await fetchCrossYearTargetMonthlyMap({
          studentId: singleOverrideStudentId,
          classId: selectedClassId,
          sourceCalendarYear: Number(year),
          advanceLinks,
        });
        crossMonthlyByKey = cross.monthlyByKey;
      }
      const filled = await computeAdvanceLinkFill(
        selectedClassId,
        Number(year),
        draftComponents,
        advanceLinks,
        {
          monthlyFeeResolver: (ty, tm) => {
            const calY = Number(year);
            if (Number(ty) === calY) {
              const row = draftMonths.find((m) => Number(m.month) === tm);
              if (row) return roundMoney(Number(row.fee || 0));
            }
            const ck = targetMonthlyKey(ty, tm);
            if (Object.prototype.hasOwnProperty.call(crossMonthlyByKey, ck)) {
              return crossMonthlyByKey[ck];
            }
            return null;
          },
        }
      );
      if (cancelled) return;
      setOverrideAdvanceHints(filled.hints);
      setOverrideDraft((prev) => {
        if (!prev) return prev;
        return { ...prev, components: filled.nextComponents };
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [overridePanelOpen, overrideMonthlyFeesKey, advanceLinks, selectedClassId, year, selectedOverrideStudentIds]);

  const toggleOverrideStudent = (studentId) => {
    setSelectedOverrideStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const selectAllFilteredOverrideStudents = () => {
    setSelectedOverrideStudentIds((prev) => {
      const next = new Set(prev);
      for (const s of filteredOverrideStudents) next.add(s.id);
      return next;
    });
  };

  const clearAllOverrideStudents = () => {
    setSelectedOverrideStudentIds(new Set());
  };

  const saveStudentOverride = async () => {
    setError("");
    setInfo("");
    const ids = [...selectedOverrideStudentIds];
    if (!ids.length) {
      setError("Select at least one student.");
      return;
    }
    if (!overrideDraft) {
      setError("No fee grid to save.");
      return;
    }
    const y = Number(year);
    setSavingStudentOverride(true);
    try {
      const payload = buildAssignPayloadFromDraft(months, feeComponents, overrideDraft);
      await Promise.all(
        ids.map((studentId) =>
          API.post("/fees/assign", {
            student_id: studentId,
            year: y,
            ...payload,
          })
        )
      );
      setInfo(
        ids.length === 1
          ? `Override saved for ${classStudents.find((s) => s.id === ids[0])?.name || "student"}.`
          : `Override saved for ${ids.length} students.`
      );
      setOverrideEditing(false);
      setOverrideMonthMatrixOpen(true);
      setOverrideApplyMonthlyAmount("");
      setOverrideApplyMonthIds(new Set());
      setOverrideApplyColumnKey("monthly");
      await refreshStudentsWithOverride();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to save student override.");
    } finally {
      setSavingStudentOverride(false);
    }
  };

  const clearStudentOverride = async () => {
    const ids = [...selectedOverrideStudentIds];
    if (ids.length !== 1) {
      setError("Select exactly one student to clear their override.");
      return;
    }
    if (!window.confirm("Remove all fee overrides for this student and use class fees?")) return;
    setError("");
    setSavingStudentOverride(true);
    try {
      await API.post("/fees/assign", {
        student_id: ids[0],
        year: Number(year),
        override_amount: null,
        override_amount_by_month: null,
        admission_fee_override: null,
        admission_fee_override_by_month: null,
        advanced_fee_override_by_month: null,
        component_override_by_month: null,
      });
      setInfo("Override cleared; student uses class fees.");
      setOverrideDraft(cloneClassGridDraft(months, feeComponents));
      setOverrideEditing(false);
      await refreshStudentsWithOverride();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to clear override.");
    } finally {
      setSavingStudentOverride(false);
    }
  };

  const addAdvanceLink = async () => {
    if (!selectedClassId) return;
    setError("");
    setInfo("");
    const sy = Number(newAdv.source_year);
    const ty = Number(newAdv.target_year);
    if (!Number.isInteger(sy) || !Number.isInteger(ty)) {
      setError("Enter source and target years.");
      return;
    }
    setSavingAdvanceLink(true);
    try {
      await API.post("/fees/advance-links", {
        class_id: selectedClassId,
        source_year: sy,
        source_month: Number(newAdv.source_month),
        target_year: ty,
        target_month: Number(newAdv.target_month),
      });
      const { data } = await API.get("/fees/advance-links", {
        params: { class_id: selectedClassId, year: Number(year) },
      });
      setAdvanceLinks(Array.isArray(data) ? data : []);
      setInfo("Advance link saved.");
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to save advance link.");
    } finally {
      setSavingAdvanceLink(false);
    }
  };

  const removeAdvanceLink = async (id) => {
    if (!id) return;
    if (!window.confirm("Remove this advance link?")) return;
    setError("");
    try {
      await API.delete(`/fees/advance-links/${id}`);
      setAdvanceLinks((prev) => prev.filter((r) => r.id !== id));
      setInfo("Advance link removed.");
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to remove link.");
    }
  };

  const bumpYear = (delta) => {
    const n = Number(year);
    const base = Number.isFinite(n) ? n : new Date().getFullYear();
    const next = base + delta;
    if (next < 1900 || next > 2100) return;
    setYear(String(next));
  };

  const renderYearControl = () => (
    <div className="fee-setup-year" role="group" aria-label="Year">
      <button
        type="button"
        className="fee-setup-year__btn"
        aria-label="Previous year"
        title="Previous year"
        onClick={() => bumpYear(-1)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M10.2 3.2 5.4 8l4.8 4.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <input
        className="fee-setup-year__input fee-setup-input--no-spin"
        type="number"
        min={1900}
        max={2100}
        value={year}
        onChange={(e) => setYear(e.target.value)}
        aria-label="Year"
      />
      <button
        type="button"
        className="fee-setup-year__btn"
        aria-label="Next year"
        title="Next year"
        onClick={() => bumpYear(1)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M5.8 3.2 10.6 8l-4.8 4.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );

  const renderColumnApplyBar = ({
    amount,
    setAmount,
    selectedIds,
    onToggle,
    onSelectAll,
    onClear,
    onApply,
    columnKey,
    setColumnKey,
    components,
    monthRows,
  }) => (
    <div className="fee-setup-apply-bar">
      <div className="fee-setup-apply-bar__main">
        <label className="label fee-setup-field fee-setup-field--compact">
          Fee column
          <select className="input" value={columnKey} onChange={(e) => setColumnKey(e.target.value)}>
            <option value="monthly">Monthly fee</option>
            {(components || []).map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.label || `Column ${c.id}`}
              </option>
            ))}
          </select>
        </label>
        <label className="label fee-setup-field fee-setup-field--compact">
          Amount
          <input
            className="input fee-setup-input--no-spin"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 5000"
          />
        </label>
        <div className="fee-setup-apply-months">
          <div className="fee-setup-apply-months__head">
            <span className="fee-setup-apply-months__title">Months</span>
            <div className="fee-setup-apply-months__actions">
              <button type="button" className="fee-setup-link-btn" onClick={onSelectAll}>
                Select all
              </button>
              <button type="button" className="fee-setup-link-btn" onClick={onClear}>
                Clear
              </button>
            </div>
          </div>
          <div className="fee-setup-month-chips">
            {(monthRows || []).map((m) => {
              const id = Number(m.month);
              const active = selectedIds.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`fee-setup-month-chip${active ? " fee-setup-month-chip--active" : ""}`}
                  aria-pressed={active}
                  onClick={() => onToggle(id)}
                >
                  {monthLabel(id)}
                </button>
              );
            })}
          </div>
        </div>
        <button type="button" className="button fee-setup-btn-tall" onClick={onApply}>
          Apply
        </button>
      </div>
    </div>
  );

  return (
    <section className="page-card fee-setup-page fee-setup-page--wide">
      {error ? <div className="alert alert--error fee-setup-banner fee-setup-banner--error">{error}</div> : null}
      {info ? <div className="alert alert--success fee-setup-toast">{info}</div> : null}

      {!selectedClassId ? (
        <>
          <div className="fee-setup-topbar" role="toolbar" aria-label="Fee setup controls">
            <div className="fee-setup-topbar__cluster" role="group" aria-label="Year and billing range">
              {renderYearControl()}
              <span className="fee-setup-topbar__sep" role="separator" aria-orientation="vertical" />
              <button
                type="button"
                className={`fee-setup-chip-btn${rangeSectionOpen ? " fee-setup-chip-btn--active" : ""}`}
                onClick={() => setRangeSectionOpen((o) => !o)}
                aria-expanded={rangeSectionOpen}
                aria-controls="fee-setup-range-panel"
              >
                <span className="fee-setup-chip-btn__label">Billing</span>
                <span className="fee-setup-chip-btn__value">
                  {monthLabel(startMonth)}–{monthLabel(endMonth)}
                </span>
                <span className={`fee-setup-chip-btn__chev${rangeSectionOpen ? " is-open" : ""}`} aria-hidden="true" />
              </button>
            </div>
            <label className="fee-setup-search">
              <span className="fee-setup-search__icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" focusable="false">
                  <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M10.5 10.5 13.5 13.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <input
                className="fee-setup-search__input"
                type="search"
                value={classSearch}
                onChange={(e) => setClassSearch(e.target.value)}
                placeholder="Search classes…"
                aria-label="Search classes"
              />
            </label>
          </div>

          {rangeSectionOpen ? (
            <div id="fee-setup-range-panel" className="fee-setup-panel card">
              <div className="fee-setup-panel__head">
                <h2 className="fee-setup-panel__title">Default billing month range</h2>
                <p className="fee-setup-panel__hint">Applies to classes without their own override.</p>
              </div>
              <div className="fee-setup-toolbar fee-setup-toolbar--nested">
                <label className="label fee-setup-field">
                  Start Month
                  <select className="input" value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}>
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="label fee-setup-field">
                  End Month
                  <select className="input" value={endMonth} onChange={(e) => setEndMonth(Number(e.target.value))}>
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="button fee-setup-btn-tall" onClick={saveRange} disabled={savingRange}>
                  {savingRange ? "Saving..." : "Save Range"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="card fee-setup-class-landing">
            <div className="fee-setup-class-landing__head">
              <div>
                <h2 className="fee-setup-subtitle">Classes</h2>
                <p className="fee-setup-class-landing__count">
                  {loading
                    ? "Loading…"
                    : `${filteredClasses.length} class${filteredClasses.length === 1 ? "" : "es"}${
                        classSearch.trim() ? " matched" : ""
                      }`}
                </p>
              </div>
            </div>
            {loading ? (
              <div className="fee-setup-empty">Loading classes…</div>
            ) : filteredClasses.length === 0 ? (
              <div className="fee-setup-empty">
                {classes.length === 0 ? "No classes found." : "No classes match your search."}
              </div>
            ) : (
              <div className="fee-setup-class-grid">
                {filteredClasses.map((c) => {
                  const count = studentCountByClass.get(String(c.id)) || 0;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="fee-setup-class-card"
                      onClick={() => openClass(c.id)}
                    >
                      <span className="fee-setup-class-card__top">
                        <span className="fee-setup-class-card__name">{c.name}</span>
                        <span className="fee-setup-class-card__arrow" aria-hidden="true">
                          →
                        </span>
                      </span>
                      <span className="fee-setup-class-card__meta">
                        <span className="fee-setup-class-card__badge">
                          {count} student{count === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="fee-setup-context">
            <div className="fee-setup-context__identity">
              <label className="fee-setup-class-switch">
                <span className="fee-setup-class-switch__label">Class</span>
                <select
                  className="fee-setup-class-switch__select"
                  value={selectedClassId}
                  onChange={(e) => openClass(e.target.value)}
                  aria-label="Switch class"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="fee-setup-context__meta-row">
                <span className="fee-setup-meta-chip">
                  {classStudents.length} student{classStudents.length === 1 ? "" : "s"}
                </span>
                <span className="fee-setup-meta-chip">
                  {monthLabel(startMonth)}–{monthLabel(endMonth)}
                  {billingRangeSource === "class" ? " · override" : ""}
                </span>
              </div>
            </div>
            <div className="fee-setup-context__actions">
              {renderYearControl()}
              <button
                type="button"
                className={`fee-setup-chip-btn${rangeSectionOpen ? " fee-setup-chip-btn--active" : ""}`}
                onClick={() => setRangeSectionOpen((o) => !o)}
                aria-expanded={rangeSectionOpen}
                aria-controls="fee-setup-class-range-panel"
              >
                <span className="fee-setup-chip-btn__label">Billing</span>
                <span className="fee-setup-chip-btn__value">
                  {monthLabel(startMonth)}–{monthLabel(endMonth)}
                </span>
                <span className={`fee-setup-chip-btn__chev${rangeSectionOpen ? " is-open" : ""}`} aria-hidden="true" />
              </button>
            </div>
          </div>

          {rangeSectionOpen ? (
            <div id="fee-setup-class-range-panel" className="fee-setup-panel card">
              <div className="fee-setup-panel__head">
                <h2 className="fee-setup-panel__title">Billing month range</h2>
                <p className="fee-setup-panel__hint">
                  {billingRangeSource === "class" ? "Class override active." : "Using year default."}
                </p>
              </div>
              <div className="fee-setup-toolbar fee-setup-toolbar--nested">
                <label className="label fee-setup-field">
                  Start Month
                  <select className="input" value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}>
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="label fee-setup-field">
                  End Month
                  <select className="input" value={endMonth} onChange={(e) => setEndMonth(Number(e.target.value))}>
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="button fee-setup-btn-tall" onClick={saveRange} disabled={savingRange}>
                  {savingRange ? "Saving..." : "Save Range"}
                </button>
                {billingRangeSource === "class" ? (
                  <button
                    type="button"
                    className="button fee-setup-btn-tall fee-setup-btn-secondary"
                    onClick={revertClassRange}
                    disabled={revertingRange}
                  >
                    {revertingRange ? "Reverting..." : "Use year default"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="card fee-setup-advance">
            <button
              type="button"
              className="fee-setup-section-toggle fee-setup-section-toggle--flush"
              onClick={() => setAdvanceSectionOpen((o) => !o)}
              aria-expanded={advanceSectionOpen}
            >
              <span className="fee-setup-section-toggle__title">
                Advance payment links
                <span className="fee-setup-section-toggle__count">{advanceLinks.length}</span>
              </span>
              <span className={`fee-setup-chip-btn__chev${advanceSectionOpen ? " is-open" : ""}`} aria-hidden="true" />
            </button>
            {advanceSectionOpen ? (
              <div className="fee-setup-section-body">
                <div className="fee-setup-advance-form">
                  <label className="label">
                    Source
                    <div className="fee-setup-advance-pair">
                      <select
                        className="input"
                        value={newAdv.source_month}
                        onChange={(e) => setNewAdv((p) => ({ ...p, source_month: Number(e.target.value) }))}
                      >
                        {MONTH_OPTIONS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input"
                        type="number"
                        min={1900}
                        max={2100}
                        value={newAdv.source_year}
                        onChange={(e) => setNewAdv((p) => ({ ...p, source_year: e.target.value }))}
                      />
                    </div>
                  </label>
                  <label className="label">
                    Target
                    <div className="fee-setup-advance-pair">
                      <select
                        className="input"
                        value={newAdv.target_month}
                        onChange={(e) => setNewAdv((p) => ({ ...p, target_month: Number(e.target.value) }))}
                      >
                        {MONTH_OPTIONS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input"
                        type="number"
                        min={1900}
                        max={2100}
                        value={newAdv.target_year}
                        onChange={(e) => setNewAdv((p) => ({ ...p, target_year: e.target.value }))}
                      />
                    </div>
                  </label>
                  <button
                    type="button"
                    className="button fee-setup-btn-tall"
                    disabled={savingAdvanceLink}
                    onClick={addAdvanceLink}
                  >
                    {savingAdvanceLink ? "Saving…" : "Add link"}
                  </button>
                </div>
                {advanceLinks.length === 0 ? (
                  <p className="fee-setup-empty fee-setup-empty--inline">No advance links for this class and year.</p>
                ) : (
                  <table className="fee-setup-advance-table">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Target</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {advanceLinks.map((lnk) => (
                        <tr key={lnk.id}>
                          <td>
                            {monthLabel(lnk.source_month)} {lnk.source_year}
                          </td>
                          <td>
                            {monthLabel(lnk.target_month)} {lnk.target_year}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="button fee-setup-btn-danger-outline"
                              onClick={() => removeAdvanceLink(lnk.id)}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : null}
          </div>

          <div className="card fee-setup-table-outer">
            <div className="fee-setup-overrides-head">
              <div className="fee-setup-head-title-block">
                <h2 className="fee-setup-subtitle">Class fees</h2>
                <span
                  className={`fee-setup-status-pill${
                    classGridEditing ? " fee-setup-status-pill--edit" : " fee-setup-status-pill--show"
                  }`}
                >
                  {classGridEditing ? "Editing" : "Showing"}
                </span>
              </div>
              <div className="fee-setup-head-actions">
                {classGridEditing ? (
                  <>
                    <button
                      type="button"
                      className="button fee-setup-btn-tall fee-setup-btn-secondary"
                      onClick={() => setMonthMatrixOpen(true)}
                      disabled={savingMonths}
                    >
                      Show months
                    </button>
                    <button
                      type="button"
                      className="button fee-setup-btn-tall fee-setup-btn-secondary"
                      onClick={cancelClassGridEdit}
                      disabled={savingMonths}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="button fee-setup-btn-tall"
                      onClick={saveAllMonths}
                      disabled={savingMonths}
                    >
                      {savingMonths ? "Saving..." : "Save fees"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="button fee-setup-btn-tall"
                    onClick={startClassGridEdit}
                    disabled={loading || months.length === 0}
                  >
                    Edit fees
                  </button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="fee-setup-empty">Loading...</div>
            ) : months.length === 0 ? (
              <div className="fee-setup-empty">No billing months. Adjust the billing range.</div>
            ) : (
              <>
                {classGridEditing
                  ? renderColumnApplyBar({
                      amount: applyMonthlyAmount,
                      setAmount: setApplyMonthlyAmount,
                      selectedIds: applyMonthIds,
                      onToggle: toggleApplyMonth,
                      onSelectAll: selectAllApplyMonths,
                      onClear: clearApplyMonths,
                      onApply: applyFeeColumnToSelectedMonths,
                      columnKey: applyColumnKey,
                      setColumnKey: setApplyColumnKey,
                      components: feeComponents,
                      monthRows: months,
                    })
                  : null}

                {!classGridEditing || monthMatrixOpen ? (
                  <FeeSetupGridTable
                    months={months}
                    feeComponents={feeComponents}
                    editableColumnHeaders
                    readOnly={!classGridEditing}
                    advanceFeeLinkHints={advanceFeeLinkHints}
                    getCellAmountDisplay={getCellAmountDisplay}
                    onMonthFeeChange={(monthNum, raw) =>
                      setMonths((prev) =>
                        prev.map((x) => {
                          if (x.month !== monthNum) return x;
                          if (raw === "") return { ...x, fee: "" };
                          const n = Number(raw);
                          if (Number.isNaN(n) || n < 0) return x;
                          return { ...x, fee: roundMoney(n) };
                        })
                      )
                    }
                    onMonthFeeBlur={(monthNum, fee) => {
                      if (!classGridEditing) return;
                      saveMonth(monthNum, fee);
                    }}
                    onComponentAmountChange={(componentId, monthNum, raw) =>
                      setFeeComponents((prev) =>
                        prev.map((c) => {
                          if (c.id !== componentId) return c;
                          if (raw === "") {
                            const next = { ...c.amounts };
                            delete next[String(monthNum)];
                            return { ...c, amounts: next };
                          }
                          const n = Number(raw);
                          if (Number.isNaN(n) || n < 0) return c;
                          return { ...c, amounts: { ...c.amounts, [String(monthNum)]: roundMoney(n) } };
                        })
                      )
                    }
                    onComponentAmountBlur={(componentId, monthNum, raw) => {
                      if (!classGridEditing) return;
                      saveComponentMonthAmount(componentId, monthNum, raw);
                    }}
                    onComponentLabelChange={(componentId, label) =>
                      setFeeComponents((prev) =>
                        prev.map((c) => (c.id === componentId ? { ...c, label } : c))
                      )
                    }
                    onComponentLabelBlur={async (componentId, label) => {
                      if (!classGridEditing) return;
                      const t = String(label || "").trim();
                      if (!t) {
                        setError("Column name cannot be empty.");
                        try {
                          const y = Number(year);
                          const { data } = await API.get("/fees/structure", {
                            params: { class_id: selectedClassId, year: y },
                          });
                          setFeeComponents(normFeeComponentsFromStructure(data));
                        } catch {
                          /* ignore */
                        }
                        return;
                      }
                      saveComponentLabel(componentId, label);
                    }}
                  />
                ) : (
                  <div className="fee-setup-matrix-placeholder">
                    Set fees by column above, then click <strong>Show months</strong> to review the full grid.
                  </div>
                )}
              </>
            )}
          </div>

          {months.length > 0 ? (
            <div className="card fee-setup-overrides">
              <div className="fee-setup-overrides-head">
                <h2 className="fee-setup-subtitle">Student fee overrides</h2>
                <button
                  type="button"
                  className="button fee-setup-btn-tall"
                  onClick={() => setOverridePanelOpen((o) => !o)}
                >
                  {overridePanelOpen ? "Hide overrides" : "Manage student overrides"}
                </button>
              </div>
              {overridePanelOpen ? (
                <>
                  {selectedOverrideStudentIds.size > 1 ? (
                    <p className="fee-setup-hint fee-setup-hint--warn fee-setup-hint--padded">
                      Same amounts will apply to all {selectedOverrideStudentIds.size} selected students.
                    </p>
                  ) : null}

                  <div className="fee-setup-override-tools">
                    <label className="label fee-setup-field fee-setup-field--search">
                      Search
                      <input
                        className="input"
                        type="search"
                        value={overrideStudentSearch}
                        onChange={(e) => setOverrideStudentSearch(e.target.value)}
                        placeholder="Student name…"
                      />
                    </label>
                    <div className="fee-setup-override-bulk">
                      <button type="button" className="fee-setup-link-btn" onClick={selectAllFilteredOverrideStudents}>
                        Select all{overrideStudentSearch.trim() ? " shown" : ""}
                      </button>
                      <button type="button" className="fee-setup-link-btn" onClick={clearAllOverrideStudents}>
                        Clear selection
                      </button>
                      <span className="fee-setup-override-count">
                        {selectedOverrideStudentIds.size} selected
                        {overrideStudentSearch.trim()
                          ? ` · ${filteredOverrideStudents.length} shown`
                          : ` · ${classStudents.length} in class`}
                      </span>
                    </div>
                  </div>

                  <div className="fee-setup-override-checklist">
                    {filteredOverrideStudents.length === 0 ? (
                      <p className="fee-setup-empty fee-setup-empty--inline">
                        {classStudents.length === 0 ? "No students in this class." : "No students match your search."}
                      </p>
                    ) : (
                      filteredOverrideStudents.map((s) => (
                        <label key={s.id} className="fee-setup-override-check">
                          <input
                            type="checkbox"
                            checked={selectedOverrideStudentIds.has(s.id)}
                            onChange={() => toggleOverrideStudent(s.id)}
                          />
                          <span>
                            {s.name}
                            {studentsWithOverride.has(s.id) ? (
                              <span className="fee-setup-override-badge"> has override</span>
                            ) : null}
                          </span>
                        </label>
                      ))
                    )}
                  </div>

                  {selectedOverrideStudentIds.size === 0 ? (
                    <p className="fee-setup-empty fee-setup-empty--inline">Select at least one student to edit fees.</p>
                  ) : loadingOverrideDraft || !overrideDraft ? (
                    <p className="fee-setup-empty">Loading override grid…</p>
                  ) : (
                    <>
                      <div className="fee-setup-overrides-head fee-setup-overrides-head--inner">
                        <span
                          className={`fee-setup-status-pill${
                            overrideEditing ? " fee-setup-status-pill--edit" : " fee-setup-status-pill--show"
                          }`}
                        >
                          {overrideEditing ? "Editing" : "Showing"}
                        </span>
                        <div className="fee-setup-head-actions">
                          {overrideEditing ? (
                            <>
                              <button
                                type="button"
                                className="button fee-setup-btn-tall fee-setup-btn-secondary"
                                onClick={() => setOverrideMonthMatrixOpen(true)}
                                disabled={savingStudentOverride}
                              >
                                Show months
                              </button>
                              <button
                                type="button"
                                className="button fee-setup-btn-tall fee-setup-btn-secondary"
                                onClick={() => {
                                  setOverrideEditing(false);
                                  setOverrideMonthMatrixOpen(true);
                                  setOverrideApplyMonthlyAmount("");
                                  setOverrideApplyMonthIds(new Set());
                                  setOverrideApplyColumnKey("monthly");
                                  rebuildOverrideDraft();
                                }}
                                disabled={savingStudentOverride}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="button fee-setup-btn-tall"
                                disabled={savingStudentOverride || selectedOverrideStudentIds.size === 0}
                                onClick={saveStudentOverride}
                              >
                                {savingStudentOverride
                                  ? "Saving…"
                                  : `Save override${
                                      selectedOverrideStudentIds.size > 1
                                        ? ` (${selectedOverrideStudentIds.size})`
                                        : ""
                                    }`}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="button fee-setup-btn-tall"
                              onClick={() => {
                                setOverrideEditing(true);
                                setOverrideMonthMatrixOpen(false);
                                setOverrideApplyColumnKey("monthly");
                                setOverrideApplyMonthlyAmount("");
                                setOverrideApplyMonthIds(new Set());
                              }}
                            >
                              Edit override
                            </button>
                          )}
                          {selectedOverrideStudentIds.size === 1 ? (
                            <button
                              type="button"
                              className="button fee-setup-btn-danger-outline fee-setup-btn-tall"
                              disabled={savingStudentOverride}
                              onClick={clearStudentOverride}
                            >
                              Clear override
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {overrideEditing
                        ? renderColumnApplyBar({
                            amount: overrideApplyMonthlyAmount,
                            setAmount: setOverrideApplyMonthlyAmount,
                            selectedIds: overrideApplyMonthIds,
                            onToggle: (monthNum) => {
                              setOverrideApplyMonthIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(monthNum)) next.delete(monthNum);
                                else next.add(monthNum);
                                return next;
                              });
                            },
                            onSelectAll: () =>
                              setOverrideApplyMonthIds(
                                new Set((overrideDraft?.months || []).map((m) => Number(m.month)))
                              ),
                            onClear: () => setOverrideApplyMonthIds(new Set()),
                            onApply: applyOverrideFeeColumnToSelectedMonths,
                            columnKey: overrideApplyColumnKey,
                            setColumnKey: setOverrideApplyColumnKey,
                            components: overrideDraft.components,
                            monthRows: overrideDraft.months,
                          })
                        : null}

                      {!overrideEditing || overrideMonthMatrixOpen ? (
                        <FeeSetupGridTable
                          months={overrideDraft.months}
                          feeComponents={overrideDraft.components}
                          advanceFeeLinkHints={overrideAdvanceHints}
                          readOnly={!overrideEditing}
                          onMonthFeeChange={(monthNum, raw) =>
                            setOverrideDraft((prev) => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                months: prev.months.map((x) => {
                                  if (x.month !== monthNum) return x;
                                  if (raw === "") return { ...x, fee: 0 };
                                  const n = Number(raw);
                                  if (Number.isNaN(n) || n < 0) return x;
                                  return { ...x, fee: roundMoney(n) };
                                }),
                              };
                            })
                          }
                          onComponentAmountChange={(componentId, monthNum, raw) =>
                            setOverrideDraft((prev) => {
                              if (!prev) return prev;
                              return {
                                ...prev,
                                components: prev.components.map((c) => {
                                  if (c.id !== componentId) return c;
                                  const next = { ...c.amounts };
                                  if (raw === "") delete next[String(monthNum)];
                                  else {
                                    const n = Number(raw);
                                    if (!Number.isNaN(n) && n >= 0) next[String(monthNum)] = roundMoney(n);
                                  }
                                  return { ...c, amounts: next };
                                }),
                              };
                            })
                          }
                        />
                      ) : (
                        <div className="fee-setup-matrix-placeholder">
                          Set fees by column, then click <strong>Show months</strong> to review.
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
