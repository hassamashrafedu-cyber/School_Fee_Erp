import { roundMoney } from "./money";

export function isAdmissionFeeComponent(comp) {
  return String(comp?.label || "").trim().toLowerCase() === "admission fee";
}

export function isAdvancedFeeComponent(comp) {
  const lab = String(comp?.label || "").trim().toLowerCase();
  return lab === "advanced fee" || lab === "advance fee";
}

export function getComponentCellAmount(comp, monthNum) {
  const amts = comp?.amounts || {};
  const v = amts[String(monthNum)] ?? amts[monthNum];
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : roundMoney(n);
}

/** Deep clone class grid for override editing. */
export function cloneClassGridDraft(months, feeComponents) {
  return {
    months: (months || []).map((m) => ({
      month: m.month,
      fee: roundMoney(Number(m.fee || 0)),
    })),
    components: (feeComponents || []).map((c) => ({
      id: c.id,
      label: c.label,
      sort_order: c.sort_order,
      amounts: { ...(c.amounts || {}) },
    })),
  };
}

function applyMonthMapToDraftMonths(draftMonths, map) {
  if (!map || typeof map !== "object") return;
  for (const row of draftMonths) {
    const key = String(row.month);
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      row.fee = roundMoney(Number(map[key]));
    }
  }
}

function applyMonthMapToComponent(draftComponents, componentId, map) {
  if (!map || typeof map !== "object" || !componentId) return;
  const comp = draftComponents.find((c) => String(c.id) === String(componentId));
  if (!comp) return;
  for (const [mk, mv] of Object.entries(map)) {
    comp.amounts[String(mk)] = roundMoney(Number(mv));
  }
}

/** Merge saved student assignment into a class-based draft (single-student edit). */
export function mergeStudentFeeIntoDraft(draft, studentFee, classComponents) {
  if (!studentFee || !draft) return draft;

  const scalar = studentFee.override_amount ?? studentFee.override_monthly_fee;
  if (
    scalar != null &&
    scalar !== "" &&
    !Number.isNaN(Number(scalar)) &&
    (!studentFee.override_amount_by_month ||
      typeof studentFee.override_amount_by_month !== "object" ||
      !Object.keys(studentFee.override_amount_by_month).length)
  ) {
    for (const row of draft.months) {
      row.fee = roundMoney(Number(scalar));
    }
  } else {
    applyMonthMapToDraftMonths(draft.months, studentFee.override_amount_by_month);
  }

  const admComp = (classComponents || []).find(isAdmissionFeeComponent);
  if (admComp) {
    applyMonthMapToComponent(draft.components, admComp.id, studentFee.admission_fee_override_by_month);
  }

  const advComp = (classComponents || []).find(isAdvancedFeeComponent);
  if (advComp) {
    applyMonthMapToComponent(draft.components, advComp.id, studentFee.advanced_fee_override_by_month);
  }

  const compOv = studentFee.component_override_by_month;
  if (compOv && typeof compOv === "object") {
    for (const [cid, monthObj] of Object.entries(compOv)) {
      applyMonthMapToComponent(draft.components, cid, monthObj);
    }
  }

  return draft;
}

export function studentHasStoredOverride(studentFee) {
  if (!studentFee) return false;
  if (studentFee.override_amount != null && studentFee.override_amount !== "") return true;
  const maps = [
    studentFee.override_amount_by_month,
    studentFee.admission_fee_override_by_month,
    studentFee.advanced_fee_override_by_month,
    studentFee.component_override_by_month,
  ];
  return maps.some((m) => m && typeof m === "object" && !Array.isArray(m) && Object.keys(m).length > 0);
}

/** Diff draft vs class grid → POST /fees/assign body (null fields = clear). */
export function buildAssignPayloadFromDraft(classMonths, classComponents, draft) {
  const override_amount_by_month = {};
  const admission_fee_override_by_month = {};
  const advanced_fee_override_by_month = {};
  const component_override_by_month = {};

  for (const row of classMonths || []) {
    const m = String(row.month);
    const classMonthly = roundMoney(Number(row.fee || 0));
    const draftRow = (draft.months || []).find((r) => Number(r.month) === Number(row.month));
    const draftMonthly = roundMoney(Number(draftRow?.fee ?? classMonthly));
    if (draftMonthly !== classMonthly) {
      override_amount_by_month[m] = draftMonthly;
    }
  }

  for (const comp of classComponents || []) {
    const lab = String(comp.label || "").trim().toLowerCase();
    const draftComp = (draft.components || []).find((c) => String(c.id) === String(comp.id));
    for (const row of classMonths || []) {
      const m = String(row.month);
      const classAmt = getComponentCellAmount(comp, row.month);
      const draftAmt = draftComp ? getComponentCellAmount(draftComp, row.month) : classAmt;
      if (draftAmt === classAmt) continue;
      if (lab === "admission fee") {
        admission_fee_override_by_month[m] = draftAmt;
      } else if (lab === "advanced fee" || lab === "advance fee") {
        advanced_fee_override_by_month[m] = draftAmt;
      } else {
        if (!component_override_by_month[comp.id]) component_override_by_month[comp.id] = {};
        component_override_by_month[comp.id][m] = draftAmt;
      }
    }
  }

  const hasMonthly = Object.keys(override_amount_by_month).length > 0;
  const hasAdmission = Object.keys(admission_fee_override_by_month).length > 0;
  const hasAdvanced = Object.keys(advanced_fee_override_by_month).length > 0;
  const hasComponent = Object.keys(component_override_by_month).length > 0;

  if (!hasMonthly && !hasAdmission && !hasAdvanced && !hasComponent) {
    return {
      override_amount: null,
      override_amount_by_month: null,
      admission_fee_override: null,
      admission_fee_override_by_month: null,
      advanced_fee_override_by_month: null,
      component_override_by_month: null,
    };
  }

  return {
    override_amount: null,
    override_amount_by_month: hasMonthly ? override_amount_by_month : null,
    admission_fee_override: null,
    admission_fee_override_by_month: hasAdmission ? admission_fee_override_by_month : null,
    advanced_fee_override_by_month: hasAdvanced ? advanced_fee_override_by_month : null,
    component_override_by_month: hasComponent ? component_override_by_month : null,
  };
}

export function sumDraftComponentsForMonth(components, monthNum) {
  return (components || []).reduce((sum, row) => sum + getComponentCellAmount(row, monthNum), 0);
}
