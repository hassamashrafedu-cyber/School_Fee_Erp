import React, { useEffect, useMemo, useState } from "react";

import API from "../api";
import { localDateInputValue, toDateInputValue } from "../utils/dateLocal";
import { printSheet } from "../utils/sheetPrint";
import { toMoney } from "../utils/money";

import StaffSalariesPanel from "./StaffSalariesPanel";
import { getPageState, setPageState } from "../utils/pageStateCache";
import "./expenses.css";

const EXPENSES_CACHE_KEY = "expenses";

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

function GeneralExpensesPanel() {
  const now = new Date();

  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [yearInput, setYearInput] = useState(String(now.getFullYear()));
  const [form, setForm] = useState({
    name: "",
    date: localDateInputValue(),
    amount: "",
  });

  const [rows, setRows] = useState([]);
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState({ name: "", date: "", amount: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const fetchExpenses = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await API.get("/expenses", {
        params: { month: selectedMonth, year: selectedYear },
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setRows([]);
      setError(err?.response?.data?.message || err.message || "Failed to fetch expenses");
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
    fetchExpenses();
  }, [selectedMonth, selectedYear]);

  const totalForSelection = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [rows]
  );

  const selectedMonthLabel = useMemo(
    () => MONTH_OPTIONS.find((m) => m.value === selectedMonth)?.label || "",
    [selectedMonth]
  );

  const printExpensesSheet = () => printSheet({ sheetKey: "expenses", orientation: "portrait" });

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setInfo("");
    try {
      await API.post("/expenses", form);
      setInfo("Expense added successfully.");
      setForm((prev) => ({
        ...prev,
        name: "",
        amount: "",
        date: localDateInputValue(),
      }));
      await fetchExpenses();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to save expense");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setEditForm({
      name: row.name || "",
      date: toDateInputValue(row.date),
      amount: String(row.amount ?? ""),
    });
    setError("");
    setInfo("");
  };

  const cancelEdit = () => {
    setEditingId("");
    setEditForm({ name: "", date: "", amount: "" });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    setError("");
    setInfo("");
    try {
      await API.patch(`/expenses/${editingId}`, editForm);
      setInfo("Expense updated successfully.");
      cancelEdit();
      await fetchExpenses();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to update expense");
    } finally {
      setSaving(false);
    }
  };

  const removeExpense = async (row) => {
    if (!window.confirm(`Delete expense "${row.name}"?`)) return;
    setSaving(true);
    setError("");
    setInfo("");
    try {
      await API.delete(`/expenses/${row.id}`);
      setInfo("Expense deleted successfully.");
      if (editingId === row.id) {
        cancelEdit();
      }
      await fetchExpenses();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to delete expense");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="card expenses-entry-card expenses-no-print">
        <h3>Add Expense</h3>
        <form className="expenses-entry-form" onSubmit={onSubmit}>
          <label className="label">
            Expense Name
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Generator fuel"
              required
            />
          </label>
          <label className="label">
            Date
            <input
              className="input"
              type="date"
              value={form.date}
              onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
              required
            />
          </label>
          <label className="label">
            Amount
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
              placeholder="0.00"
              required
            />
          </label>
          <button className="button" type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Expense"}
          </button>
        </form>
      </section>

      <section className="card expenses-filters expenses-no-print">
        <label className="label">
          Month
          <select className="input" value={String(selectedMonth)} onChange={(e) => setSelectedMonth(Number(e.target.value))}>
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
        <div className="expenses-filters__total">
          <span className="expenses-filters__total-label">Total Expense</span>
          <strong className="expenses-filters__total-value">{toMoney(totalForSelection)}</strong>
        </div>
      </section>

      <div className="expenses-toolbar expenses-no-print">
        <button type="button" className="button expenses-print-btn" onClick={printExpensesSheet}>
          Print sheet
        </button>
      </div>

      {error ? <div className="expenses-banner expenses-banner--error expenses-no-print">{error}</div> : null}
      {info ? <div className="expenses-banner expenses-banner--info expenses-no-print">{info}</div> : null}
      {loading ? <div className="expenses-banner expenses-no-print">Loading expenses...</div> : null}

      <section className="card expenses-table-card expenses-print-panel">
        <h2 className="expenses-print-title">{`Expenses — ${selectedMonthLabel} ${selectedYear}`}</h2>
        <h3 className="expenses-screen-heading">Expense Entries</h3>
        <div className="expenses-table-wrap">
          <table className="expenses-table expenses-table--general">
            <colgroup>
              <col className="expenses-col-name" />
              <col className="expenses-col-date" />
              <col className="expenses-col-amount" />
              <col className="expenses-col-actions expenses-no-print" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Expense Name</th>
                <th scope="col">Date</th>
                <th scope="col">Amount</th>
                <th scope="col" className="expenses-no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4}>No expenses for selected month/year.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {editingId === row.id ? (
                        <input
                          className="input"
                          value={editForm.name}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                        />
                      ) : (
                        row.name
                      )}
                    </td>
                    <td>
                      {editingId === row.id ? (
                        <input
                          className="input"
                          type="date"
                          value={editForm.date}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, date: e.target.value }))}
                        />
                      ) : row.date ? (
                        new Date(row.date).toLocaleDateString()
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="expenses-number">
                      {editingId === row.id ? (
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={editForm.amount}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, amount: e.target.value }))}
                        />
                      ) : (
                        toMoney(row.amount)
                      )}
                    </td>
                    <td className="expenses-actions expenses-no-print">
                      {editingId === row.id ? (
                        <>
                          <button className="button expenses-btn" type="button" onClick={saveEdit} disabled={saving}>
                            Save
                          </button>
                          <button className="button expenses-btn expenses-btn--muted" type="button" onClick={cancelEdit} disabled={saving}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="button expenses-btn" type="button" onClick={() => startEdit(row)} disabled={saving}>
                            Edit
                          </button>
                          <button className="button expenses-btn expenses-btn--danger" type="button" onClick={() => removeExpense(row)} disabled={saving}>
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="expenses-tfoot-total">
                <td colSpan={2}>Total</td>
                <td className="expenses-number">{toMoney(totalForSelection)}</td>
                <td className="expenses-no-print" />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </>
  );
}

export default function Expenses() {
  const cached = getPageState(EXPENSES_CACHE_KEY);
  const [tab, setTab] = useState(() =>
    cached?.tab === "salaries" ? "salaries" : "general"
  );

  useEffect(() => {
    setPageState(EXPENSES_CACHE_KEY, { tab });
  }, [tab]);

  return (
    <section className="page-card expenses-page">
      <div className="expenses-tabs-shell expenses-no-print">
        <div className="expenses-tabs" role="tablist" aria-label="Expenses sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "general"}
            className={`expenses-tabs__btn${tab === "general" ? " is-active" : ""}`}
            onClick={() => setTab("general")}
          >
            General Expenses
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "salaries"}
            className={`expenses-tabs__btn${tab === "salaries" ? " is-active" : ""}`}
            onClick={() => setTab("salaries")}
          >
            Staff Salaries
          </button>
        </div>
      </div>

      {tab === "general" ? <GeneralExpensesPanel /> : <StaffSalariesPanel />}
    </section>
  );
}
