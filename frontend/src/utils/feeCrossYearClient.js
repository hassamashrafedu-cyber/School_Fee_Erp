import API from "../api";
import {
  computeEffectiveMonthlyPart,
  monthHasMonthlyOverride,
  targetMonthlyKey,
} from "./feeAdvanceEffective";
import { roundMoney } from "./money";

/**
 * Load effective monthly fees for cross-year advance link targets (override or class fee for target year).
 */
export async function fetchCrossYearTargetMonthlyMap({ studentId, classId, sourceCalendarYear, advanceLinks }) {
  const monthlyByKey = {};
  const hasOverrideByKey = {};
  if (!studentId || !classId || !Array.isArray(advanceLinks) || !advanceLinks.length) {
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
      const [structureRes, sfRes] = await Promise.all([
        API.get("/fees/structure", { params: { class_id: classId, year: ty } }),
        API.get("/student-fee", { params: { student_id: studentId, year: String(ty) } }),
      ]);
      const structure = structureRes?.data && typeof structureRes.data === "object" ? structureRes.data : {};
      const data = sfRes?.data && typeof sfRes.data === "object" ? sfRes.data : {};
      const rawMonths = Array.isArray(structure?.months) ? structure.months : [];
      let oM = null;
      let oMmap = null;
      const oa = data?.override_amount;
      if (oa !== undefined && oa !== null && !Number.isNaN(Number(oa))) oM = roundMoney(oa);
      const omMap = data?.override_amount_by_month;
      if (omMap && typeof omMap === "object" && !Array.isArray(omMap) && Object.keys(omMap).length > 0) {
        oMmap = omMap;
      }
      for (const tm of monthSet) {
        const fee = computeEffectiveMonthlyPart(tm, rawMonths, oM, oMmap);
        const key = targetMonthlyKey(ty, tm);
        monthlyByKey[key] = fee;
        hasOverrideByKey[key] = monthHasMonthlyOverride(tm, oM, oMmap);
      }
    } catch {
      /* skip year */
    }
  }
  return { monthlyByKey, hasOverrideByKey };
}
