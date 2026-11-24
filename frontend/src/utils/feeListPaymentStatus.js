import { roundMoney } from "./money";
import {
  buildBillingMonthsFromRange,
  distributeLedger,
  ledgerStatus,
  pickCurrentMonthForBilling,
} from "./ledgerDistribute";

/**
 * Paid / partial from **Current Due** (through resolved current month), same rules as Fee Collection detail.
 * @param {import("axios").AxiosInstance} API
 * @param {Array<object>} students
 * @param {number} billingYear
 * @returns {Promise<Record<string, 'paid'|'partial'>>}
 */
export async function fetchPaymentStatusesForStudents(API, students, billingYear) {
  const y = Number(billingYear);
  if (!Array.isArray(students) || !students.length) {
    return {};
  }
  if (!Number.isInteger(y) || y < 1900 || y > 2100) {
    return {};
  }

  const baseYearParams = { year: y };
  const structureByClass = new Map();
  const statusEntries = await Promise.all(
    students.map(async (s) => {
      try {
        const [enrollmentRes, paymentsRes] = await Promise.all([
          API.get(`/students/${s.id}/enrollment`, { params: { year: y } }),
          API.get(`/payments/student/${s.id}`, { params: { year: y } }),
        ]);
        const enr = enrollmentRes?.data && typeof enrollmentRes.data === "object" ? enrollmentRes.data : {};
        const classId = enr.source === "alumni_post_graduation" ? null : enr.class_id || s.current_class_id || null;
        const cfgParams = { ...baseYearParams };
        if (classId) cfgParams.class_id = classId;
        const { data: cfg } = await API.get("/fees/config", { params: cfgParams });
        const feeConfig = {
          year: y,
          start_month: Number(cfg?.start_month || 1),
          end_month: Number(cfg?.end_month || 12),
        };
        if (!classId) {
          const payments = Array.isArray(paymentsRes?.data) ? paymentsRes.data : [];
          const billingMonths = buildBillingMonthsFromRange(feeConfig, { months: [] }, null, null, null, null, null);
          const currentMonth = pickCurrentMonthForBilling(billingMonths, null);
          const { remaining } = distributeLedger(payments, billingMonths, currentMonth, y, [], {});
          return [s.id, ledgerStatus(remaining)];
        }

        if (!structureByClass.has(classId)) {
          const { data: structure } = await API.get("/fees/structure", {
            params: { class_id: classId, year: y },
          });
          structureByClass.set(classId, structure || {});
        }

        let overrideMonthly = null;
        let overrideAdmission = null;
        let overrideAdmissionByMonth = null;
        let overrideMonthlyByMonth = null;
        let overrideAdvancedByMonth = null;
        try {
          const { data: overrideRes } = await API.get("/student-fee", {
            params: { student_id: s.id, year: y },
          });
          const oa = overrideRes?.override_amount;
          if (oa !== undefined && oa !== null && !Number.isNaN(Number(oa))) {
            overrideMonthly = roundMoney(oa);
          }
          const adm = overrideRes?.admission_fee_override;
          if (adm !== undefined && adm !== null && !Number.isNaN(Number(adm))) {
            overrideAdmission = roundMoney(adm);
          }
          const admMap = overrideRes?.admission_fee_override_by_month;
          if (admMap && typeof admMap === "object" && !Array.isArray(admMap) && Object.keys(admMap).length > 0) {
            overrideAdmissionByMonth = admMap;
          }
          const omMap = overrideRes?.override_amount_by_month;
          if (omMap && typeof omMap === "object" && !Array.isArray(omMap) && Object.keys(omMap).length > 0) {
            overrideMonthlyByMonth = omMap;
          }
          const advMap = overrideRes?.advanced_fee_override_by_month;
          if (advMap && typeof advMap === "object" && !Array.isArray(advMap) && Object.keys(advMap).length > 0) {
            overrideAdvancedByMonth = advMap;
          }
        } catch {
          overrideMonthly = null;
          overrideAdmission = null;
          overrideAdmissionByMonth = null;
          overrideMonthlyByMonth = null;
          overrideAdvancedByMonth = null;
        }

        const billingMonths = buildBillingMonthsFromRange(
          feeConfig,
          structureByClass.get(classId),
          overrideMonthly,
          overrideAdmission,
          overrideAdmissionByMonth,
          overrideMonthlyByMonth,
          overrideAdvancedByMonth
        );
        const payments = Array.isArray(paymentsRes?.data) ? paymentsRes.data : [];
        const currentMonth = pickCurrentMonthForBilling(billingMonths, null);
        const { remaining } = distributeLedger(payments, billingMonths, currentMonth, y, [], {});
        return [s.id, ledgerStatus(remaining)];
      } catch {
        return [s.id, "partial"];
      }
    })
  );
  return Object.fromEntries(statusEntries);
}
