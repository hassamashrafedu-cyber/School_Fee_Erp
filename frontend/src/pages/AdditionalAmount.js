import React, { useEffect, useMemo, useState } from "react";

import API from "../api";
import { localDateInputValue, toDateInputValue } from "../utils/dateLocal";
import { toMoney } from "../utils/money";
import { printSheet } from "../utils/sheetPrint";

import "./expenses.css";

export default function AdditionalAmount() {
  const [form, setForm] = useState({ name: "", date: localDateInputValue(), amount: "" });
  const [rows, setRows] = useState([]);
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState({ name: "", date: "", amount: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const fetchRows = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await API.get("/additional-amounts");
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setRows([]);
      setError(err?.response?.data?.message || err.message || "Failed to fetch additional amounts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, []);

  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0), [rows]);

  const printAdditionalSheet = () => printSheet({ sheetKey: "additional-amount", orientation: "portrait" });

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setInfo("");
    try {
      await API.post("/additional-amounts", form);
      setForm((prev) => ({ ...prev, name: "", amount: "", date: localDateInputValue() }));
      setInfo("Additional amount added successfully.");
      await fetchRows();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to save additional amount");
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
      await API.patch(`/additional-amounts/${editingId}`, editForm);
      setInfo("Additional amount updated successfully.");
      cancelEdit();
      await fetchRows();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to update additional amount");
    } finally {
      setSaving(false);
    }
  };

  const removeRow = async (row) => {
    if (!window.confirm(`Delete additional amount "${row.name}"?`)) return;
    setSaving(true);
    setError("");
    setInfo("");
    try {
      await API.delete(`/additional-amounts/${row.id}`);
      setInfo("Additional amount deleted successfully.");
      if (editingId === row.id) cancelEdit();
      await fetchRows();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || "Failed to delete additional amount");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="page-card expenses-page">
      <header className="expenses-page__head page-header">
        <div className="page-header__text">
          <h1 className="page-header__title page-title">Additional Amount</h1>
          <p className="page-header__subtitle page-lead expenses-no-print">
            Enter direct additional income. This amount is added directly to profit on dashboard.
          </p>
        </div>
      </header>

      <section className="card expenses-entry-card expenses-no-print">
        <h3>Add Additional Amount</h3>
        <form className="expenses-entry-form" onSubmit={onSubmit}>
          <label className="label">
            Additional Amount Name
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Donation"
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
            {saving ? "Saving..." : "Save Amount"}
          </button>
        </form>
      </section>

      <section className="card expenses-filters expenses-no-print">
        <div className="expenses-filters__total">
          <span className="expenses-filters__total-label">Total Additional Amount</span>
          <strong className="expenses-filters__total-value">{toMoney(total)}</strong>
        </div>
      </section>

      <div className="expenses-toolbar expenses-no-print">
        <button type="button" className="button expenses-print-btn" onClick={printAdditionalSheet}>
          Print sheet
        </button>
      </div>

      {error ? <div className="expenses-banner expenses-banner--error expenses-no-print">{error}</div> : null}
      {info ? <div className="expenses-banner expenses-banner--info expenses-no-print">{info}</div> : null}
      {loading ? <div className="expenses-banner expenses-no-print">Loading additional amounts...</div> : null}

      <section className="card expenses-table-card expenses-print-panel">
        <h2 className="expenses-print-title">Additional Amount — all entries</h2>
        <h3 className="expenses-screen-heading">Additional Amount Entries</h3>
        <div className="expenses-table-wrap">
          <table className="expenses-table expenses-table--general">
            <thead>
              <tr>
                <th>Name</th>
                <th>Date</th>
                <th>Amount</th>
                <th className="expenses-no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4}>No additional amounts yet.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {editingId === row.id ? (
                        <input className="input" value={editForm.name} onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))} />
                      ) : (
                        row.name
                      )}
                    </td>
                    <td>
                      {editingId === row.id ? (
                        <input className="input" type="date" value={editForm.date} onChange={(e) => setEditForm((prev) => ({ ...prev, date: e.target.value }))} />
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
                          <button className="button expenses-btn" type="button" onClick={saveEdit} disabled={saving}>Save</button>
                          <button className="button expenses-btn expenses-btn--muted" type="button" onClick={cancelEdit} disabled={saving}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="button expenses-btn" type="button" onClick={() => startEdit(row)} disabled={saving}>Edit</button>
                          <button className="button expenses-btn expenses-btn--danger" type="button" onClick={() => removeRow(row)} disabled={saving}>Delete</button>
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
                <td className="expenses-number">{toMoney(total)}</td>
                <td className="expenses-no-print" />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </section>
  );
}
