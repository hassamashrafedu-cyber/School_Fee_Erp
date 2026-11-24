import React, { useEffect, useMemo, useState } from "react";

import API from "../api";
import { isAdmin } from "../utils/auth";
import { localDateInputValue } from "../utils/dateLocal";
import { toMoney } from "../utils/money";

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

const emptyStaffForm = {
  name: "",
  monthly_salary: "",
  absent_deduction_per_day: "",
};

const calcLocalPayable = (base, absents, perDay) => {
  const b = Number(base) || 0;
  const a = Math.max(0, Number(absents) || 0);
  const p = Number(perDay) || 0;
  const deduction = Math.round(a * p * 100) / 100;
  const payable = Math.round(Math.max(0, b - deduction) * 100) / 100;
  return { deduction, payable };
};

export default function StaffSalariesPanel() {
  const admin = isAdmin();
  const now = new Date();

  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [yearInput, setYearInput] = useState(String(now.getFullYear()));
  const [paymentDate, setPaymentDate] = useState(localDateInputValue());

  const [staffList, setStaffList] = useState([]);
  const [payroll, setPayroll] = useState(null);
  const [absentDraft, setAbsentDraft] = useState({});

  const [staffForm, setStaffForm] = useState(emptyStaffForm);
  const [editingStaffId, setEditingStaffId] = useState("");
  const [editStaffForm, setEditStaffForm] = useState(emptyStaffForm);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const selectedMonthLabel = useMemo(
    () => MONTH_OPTIONS.find((m) => m.value === selectedMonth)?.label || "",
    [selectedMonth]
  );

  const syncAbsentDraft = (rows = []) => {
    const next = {};
    rows.forEach((row) => {
      next[row.staff_id] = String(row.absent_days ?? 0);
    });
    setAbsentDraft(next);
  };

  const fetchAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [staffRes, payrollRes] = await Promise.all([
        API.get("/staff-members", { params: { include_inactive: "true" } }),
        API.get("/staff-payroll/month", {
          params: { month: selectedMonth, year: selectedYear },
        }),
      ]);
      setStaffList(Array.isArray(staffRes.data) ? staffRes.data : []);
      setPayroll(payrollRes.data || null);
      syncAbsentDraft(payrollRes.data?.rows || []);
    } catch (err) {
      setStaffList([]);
      setPayroll(null);
      setError(err?.response?.data?.message || err.message || "Failed to load staff salaries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      const y = Number(yearInput);
      if (Number.isInteger(y) && y >= 1900 && y <= 2100) {
        setSelectedYear(y);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [yearInput]);

  useEffect(() => {
    fetchAll();
  }, [selectedMonth, selectedYear]);

  const previewRows = useMemo(() => {
    const rows = payroll?.rows || [];
    return rows.map((row) => {
      if (row.status === "paid") return row;
      const absents = Number(absentDraft[row.staff_id] ?? row.absent_days ?? 0);
      const { deduction, payable } = calcLocalPayable(
        row.base_salary,
        absents,
        row.absent_deduction_per_day
      );
      return {
        ...row,
        absent_days: absents,
        deduction_amount: deduction,
        payable_amount: payable,
      };
    });
  }, [payroll, absentDraft]);

  const previewTotals = useMemo(() => {
    return previewRows.reduce(
      (acc, row) => {
        acc.payable += Number(row.payable_amount || 0);
        acc.deduction += Number(row.deduction_amount || 0);
        acc.base += Number(row.base_salary || 0);
        if (row.status === "paid") acc.paid += 1;
        else acc.draft += 1;
        return acc;
      },
      { base: 0, deduction: 0, payable: 0, paid: 0, draft: 0 }
    );
  }, [previewRows]);

  const onCreateStaff = async (e) => {
    e.preventDefault();
    if (!admin) return;
    setSaving(true);
    setError("");
    setInfo("");
    try {
      await API.post("/staff-members", {
        name: staffForm.name,
        monthly_salary: staffForm.monthly_salary,
        absent_deduction_per_day: staffForm.absent_deduction_per_day || 0,
      });
      setStaffForm(emptyStaffForm);
      setInfo("Staff member added.");
      await fetchAll();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to add staff");
    } finally {
      setSaving(false);
    }
  };

  const startEditStaff = (row) => {
    setEditingStaffId(row.id);
    setEditStaffForm({
      name: row.name || "",
      monthly_salary: String(row.monthly_salary ?? ""),
      absent_deduction_per_day: String(row.absent_deduction_per_day ?? ""),
    });
    setError("");
    setInfo("");
  };

  const cancelEditStaff = () => {
    setEditingStaffId("");
    setEditStaffForm(emptyStaffForm);
  };

  const saveEditStaff = async () => {
    if (!admin || !editingStaffId) return;
    setSaving(true);
    setError("");
    setInfo("");
    try {
      await API.patch(`/staff-members/${editingStaffId}`, {
        name: editStaffForm.name,
        monthly_salary: editStaffForm.monthly_salary,
        absent_deduction_per_day: editStaffForm.absent_deduction_per_day || 0,
      });
      setInfo("Staff member updated.");
      cancelEditStaff();
      await fetchAll();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to update staff");
    } finally {
      setSaving(false);
    }
  };

  const deactivateStaff = async (row) => {
    if (!admin) return;
    if (!window.confirm(`Deactivate "${row.name}"? They will not appear in new payroll months.`)) return;
    setSaving(true);
    setError("");
    setInfo("");
    try {
      await API.delete(`/staff-members/${row.id}`);
      setInfo("Staff member deactivated.");
      if (editingStaffId === row.id) cancelEditStaff();
      await fetchAll();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to deactivate staff");
    } finally {
      setSaving(false);
    }
  };

  const reactivateStaff = async (row) => {
    if (!admin) return;
    setSaving(true);
    setError("");
    setInfo("");
    try {
      await API.patch(`/staff-members/${row.id}`, { is_active: true });
      setInfo("Staff member reactivated.");
      await fetchAll();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to reactivate staff");
    } finally {
      setSaving(false);
    }
  };

  const saveAbsences = async () => {
    if (!admin) return;
    setSaving(true);
    setError("");
    setInfo("");
    try {
      const items = previewRows
        .filter((row) => row.status !== "paid")
        .map((row) => ({
          staff_id: row.staff_id,
          absent_days: Number(absentDraft[row.staff_id] ?? 0),
        }));
      const { data } = await API.put("/staff-payroll/month/absences", {
        month: selectedMonth,
        year: selectedYear,
        items,
      });
      setPayroll(data);
      syncAbsentDraft(data?.rows || []);
      setInfo("Absences saved for this month.");
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to save absences");
    } finally {
      setSaving(false);
    }
  };

  const payOne = async (row) => {
    if (!admin) return;
    const payable = Number(row.payable_amount || 0);
    const msg =
      payable > 0
        ? `Confirm pay ${toMoney(payable)} for ${row.staff_name}? This will add to expenses and reduce profit.`
        : `Confirm mark ${row.staff_name} as paid with zero payable (full deduction)?`;
    if (!window.confirm(msg)) return;

    setSaving(true);
    setError("");
    setInfo("");
    try {
      await API.post(`/staff-payroll/${row.staff_id}/pay`, {
        month: selectedMonth,
        year: selectedYear,
        payment_date: paymentDate,
        absent_days: Number(absentDraft[row.staff_id] ?? row.absent_days ?? 0),
      });
      setInfo(`Salary paid for ${row.staff_name}.`);
      await fetchAll();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to pay salary");
    } finally {
      setSaving(false);
    }
  };

  const payAllDraft = async () => {
    if (!admin) return;
    const draftCount = previewRows.filter((r) => r.status !== "paid").length;
    if (!draftCount) {
      setInfo("No unpaid salaries for this month.");
      return;
    }
    if (
      !window.confirm(
        `Save absences and pay all ${draftCount} unpaid staff for ${selectedMonthLabel} ${selectedYear}? Amounts will post to expenses.`
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");
    setInfo("");
    try {
      const items = previewRows
        .filter((row) => row.status !== "paid")
        .map((row) => ({
          staff_id: row.staff_id,
          absent_days: Number(absentDraft[row.staff_id] ?? 0),
        }));
      await API.put("/staff-payroll/month/absences", {
        month: selectedMonth,
        year: selectedYear,
        items,
      });
      const { data } = await API.post("/staff-payroll/pay-all", {
        month: selectedMonth,
        year: selectedYear,
        payment_date: paymentDate,
      });
      setInfo(`Paid ${data?.paid_count || 0} staff salary(ies).`);
      await fetchAll();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to pay salaries");
    } finally {
      setSaving(false);
    }
  };

  const reverseOne = async (row) => {
    if (!admin) return;
    if (
      !window.confirm(
        `Reverse payment for ${row.staff_name}? Linked expense will be removed and profit will restore.`
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    setInfo("");
    try {
      await API.post(`/staff-payroll/${row.staff_id}/reverse`, {
        month: selectedMonth,
        year: selectedYear,
      });
      setInfo(`Payment reversed for ${row.staff_name}.`);
      await fetchAll();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to reverse payment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="staff-salaries">
      {!admin ? (
        <div className="expenses-banner expenses-no-print">
          View only. Admin can manage staff, absences, and salary payments.
        </div>
      ) : null}

      <section className="card expenses-filters staff-salaries__filters expenses-no-print">
        <label className="label">
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
        <label className="label">
          Year
          <input
            className="input"
            value={yearInput}
            onChange={(e) => setYearInput(e.target.value)}
            inputMode="numeric"
            placeholder="2026"
          />
        </label>
        <label className="label">
          Payment Date
          <input
            className="input"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            disabled={!admin}
          />
        </label>
        <div className="expenses-filters__total">
          <span className="expenses-filters__total-label">Payable This Month</span>
          <strong className="expenses-filters__total-value">{toMoney(previewTotals.payable)}</strong>
        </div>
      </section>

      {error ? <div className="expenses-banner expenses-banner--error expenses-no-print">{error}</div> : null}
      {info ? <div className="expenses-banner expenses-banner--info expenses-no-print">{info}</div> : null}
      {loading ? <div className="expenses-banner expenses-no-print">Loading payroll...</div> : null}

      <section className="card expenses-table-card">
        <h3 className="expenses-screen-heading">
          Monthly Payroll — {selectedMonthLabel} {selectedYear}
        </h3>
        <div
          className="expenses-table-wrap"
          role="region"
          aria-label={`Monthly payroll ${selectedMonthLabel} ${selectedYear}`}
          tabIndex={0}
        >
          <table className="expenses-table staff-salaries__payroll-table">
            <colgroup>
              <col className="pay-col-staff" />
              <col className="pay-col-salary" />
              <col className="pay-col-absents" />
              <col className="pay-col-deduction" />
              <col className="pay-col-payable" />
              <col className="pay-col-status" />
              {admin ? <col className="pay-col-actions" /> : null}
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Staff</th>
                <th scope="col">Base Salary</th>
                <th scope="col">Absents</th>
                <th scope="col">Deduction</th>
                <th scope="col">Payable</th>
                <th scope="col">Status</th>
                {admin ? (
                  <th scope="col" className="expenses-no-print">
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {previewRows.length === 0 ? (
                <tr>
                  <td colSpan={admin ? 7 : 6}>No active staff for this month.</td>
                </tr>
              ) : (
                previewRows.map((row) => {
                  const paid = row.status === "paid";
                  return (
                    <tr key={row.staff_id}>
                      <td className="expenses-col--text">{row.staff_name}</td>
                      <td className="expenses-number">{toMoney(row.base_salary)}</td>
                      <td>
                        {paid || !admin ? (
                          row.absent_days
                        ) : (
                          <input
                            className="input staff-salaries__absent-input"
                            type="number"
                            min="0"
                            max="31"
                            step="1"
                            value={absentDraft[row.staff_id] ?? "0"}
                            onChange={(e) =>
                              setAbsentDraft((prev) => ({
                                ...prev,
                                [row.staff_id]: e.target.value,
                              }))
                            }
                          />
                        )}
                      </td>
                      <td className="expenses-number">{toMoney(row.deduction_amount)}</td>
                      <td className="expenses-number">{toMoney(row.payable_amount)}</td>
                      <td>
                        <span
                          className={
                            paid
                              ? "staff-salaries__badge staff-salaries__badge--paid"
                              : "staff-salaries__badge"
                          }
                        >
                          {paid ? "Paid" : "Draft"}
                        </span>
                      </td>
                      {admin ? (
                        <td className="expenses-actions expenses-no-print">
                          {paid ? (
                            <button
                              className="button expenses-btn expenses-btn--muted"
                              type="button"
                              onClick={() => reverseOne(row)}
                              disabled={saving}
                            >
                              Reverse
                            </button>
                          ) : (
                            <button
                              className="button expenses-btn"
                              type="button"
                              onClick={() => payOne(row)}
                              disabled={saving}
                            >
                              Confirm Pay
                            </button>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr className="expenses-tfoot-total">
                <td colSpan={3}>Totals</td>
                <td className="expenses-number">{toMoney(previewTotals.deduction)}</td>
                <td className="expenses-number">{toMoney(previewTotals.payable)}</td>
                <td>
                  {previewTotals.paid} paid / {previewTotals.draft} draft
                </td>
                {admin ? <td className="expenses-no-print" /> : null}
              </tr>
            </tfoot>
          </table>
        </div>

        {admin ? (
          <div className="expenses-toolbar staff-salaries__toolbar expenses-no-print">
            <button
              type="button"
              className="button expenses-btn expenses-btn--muted"
              onClick={saveAbsences}
              disabled={saving}
            >
              Save Absences
            </button>
            <button type="button" className="button" onClick={payAllDraft} disabled={saving}>
              Pay All Unpaid
            </button>
          </div>
        ) : null}
      </section>

      <section className="card expenses-entry-card expenses-no-print">
        <h3>Staff Members</h3>

        {admin ? (
          <form className="staff-salaries__staff-form" onSubmit={onCreateStaff}>
            <label className="label">
              Name
              <input
                className="input"
                value={staffForm.name}
                onChange={(e) => setStaffForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Staff member name"
                required
              />
            </label>
            <label className="label">
              Monthly Salary
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={staffForm.monthly_salary}
                onChange={(e) => setStaffForm((p) => ({ ...p, monthly_salary: e.target.value }))}
                placeholder="0.00"
                required
              />
            </label>
            <label className="label">
              Deduction / Absent Day
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={staffForm.absent_deduction_per_day}
                onChange={(e) =>
                  setStaffForm((p) => ({ ...p, absent_deduction_per_day: e.target.value }))
                }
                placeholder="0.00"
              />
            </label>
            <button className="button" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Add Staff"}
            </button>
          </form>
        ) : null}

        <div
          className="expenses-table-wrap"
          role="region"
          aria-label="Staff members"
          tabIndex={0}
        >
          <table className="expenses-table staff-salaries__staff-table">
            <colgroup>
              <col className="staff-col-name" />
              <col className="staff-col-salary" />
              <col className="staff-col-deduction" />
              <col className="staff-col-status" />
              {admin ? <col className="staff-col-actions" /> : null}
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Monthly Salary</th>
                <th scope="col">Per-day Deduction</th>
                <th scope="col">Status</th>
                {admin ? (
                  <th scope="col" className="expenses-no-print">
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {staffList.length === 0 ? (
                <tr>
                  <td colSpan={admin ? 5 : 4}>No staff members yet.</td>
                </tr>
              ) : (
                staffList.map((row) => (
                  <tr key={row.id} className={row.is_active ? "" : "staff-salaries__row--inactive"}>
                    <td className="expenses-col--text">
                      {editingStaffId === row.id ? (
                        <input
                          className="input"
                          value={editStaffForm.name}
                          onChange={(e) => setEditStaffForm((p) => ({ ...p, name: e.target.value }))}
                        />
                      ) : (
                        row.name
                      )}
                    </td>
                    <td className="expenses-number">
                      {editingStaffId === row.id ? (
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={editStaffForm.monthly_salary}
                          onChange={(e) =>
                            setEditStaffForm((p) => ({ ...p, monthly_salary: e.target.value }))
                          }
                        />
                      ) : (
                        toMoney(row.monthly_salary)
                      )}
                    </td>
                    <td className="expenses-number">
                      {editingStaffId === row.id ? (
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={editStaffForm.absent_deduction_per_day}
                          onChange={(e) =>
                            setEditStaffForm((p) => ({
                              ...p,
                              absent_deduction_per_day: e.target.value,
                            }))
                          }
                        />
                      ) : (
                        toMoney(row.absent_deduction_per_day)
                      )}
                    </td>
                    <td>
                      <span
                        className={
                          row.is_active
                            ? "staff-salaries__badge staff-salaries__badge--paid"
                            : "staff-salaries__badge"
                        }
                      >
                        {row.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    {admin ? (
                      <td className="expenses-actions expenses-no-print">
                        {editingStaffId === row.id ? (
                          <>
                            <button
                              className="button expenses-btn"
                              type="button"
                              onClick={saveEditStaff}
                              disabled={saving}
                            >
                              Save
                            </button>
                            <button
                              className="button expenses-btn expenses-btn--muted"
                              type="button"
                              onClick={cancelEditStaff}
                              disabled={saving}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="button expenses-btn"
                              type="button"
                              onClick={() => startEditStaff(row)}
                              disabled={saving}
                            >
                              Edit
                            </button>
                            {row.is_active ? (
                              <button
                                className="button expenses-btn expenses-btn--danger"
                                type="button"
                                onClick={() => deactivateStaff(row)}
                                disabled={saving}
                              >
                                Deactivate
                              </button>
                            ) : (
                              <button
                                className="button expenses-btn"
                                type="button"
                                onClick={() => reactivateStaff(row)}
                                disabled={saving}
                              >
                                Reactivate
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
