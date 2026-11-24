import React, { useCallback, useEffect, useMemo, useState } from "react";

import API from "../api";

import "./feeStructure.css";

const emptyCurrentItem = () => ({
  fee_type_id: "",
  amount: "",
  is_monthly: false,
});

export default function FeeStructure() {
  const [classes, setClasses] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [feeTypes, setFeeTypes] = useState([]);

  const [selectedClass, setSelectedClass] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [structureTitle, setStructureTitle] = useState("");

  const [items, setItems] = useState([]);
  const [currentItem, setCurrentItem] = useState(emptyCurrentItem);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      API.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      delete API.defaults.headers.common.Authorization;
    }
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const [classesRes, feeTypesRes, yearsRes] = await Promise.all([
        API.get("/classes"),
        API.get("/fee-types"),
        API.get("/academic-years"),
      ]);
      setClasses(Array.isArray(classesRes.data) ? classesRes.data : []);
      setFeeTypes(Array.isArray(feeTypesRes.data) ? feeTypesRes.data : []);
      setAcademicYears(Array.isArray(yearsRes.data) ? yearsRes.data : []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load data");
      setClasses([]);
      setFeeTypes([]);
      setAcademicYears([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    const c = classes.find((x) => x.id === selectedClass);
    const y = academicYears.find((x) => x.id === selectedYear);
    if (c && y) {
      setStructureTitle(`${c.name} fees (${y.name})`);
    } else if (c) {
      setStructureTitle(`${c.name} fees`);
    } else {
      setStructureTitle("");
    }
  }, [selectedClass, selectedYear, classes, academicYears]);

  const feeTypeNameById = useMemo(() => {
    const m = {};
    feeTypes.forEach((ft) => {
      m[ft.id] = ft.name;
    });
    return m;
  }, [feeTypes]);

  const addItem = (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!currentItem.fee_type_id) {
      setError("Select a fee type.");
      return;
    }
    const amountNum = Number.parseFloat(String(currentItem.amount).replace(/,/g, ""));
    if (Number.isNaN(amountNum) || amountNum <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    if (items.some((row) => row.fee_type_id === currentItem.fee_type_id)) {
      setError("That fee type is already in the list.");
      return;
    }

    setItems((prev) => [
      ...prev,
      {
        fee_type_id: currentItem.fee_type_id,
        amount: amountNum,
        is_monthly: Boolean(currentItem.is_monthly),
      },
    ]);
    setCurrentItem(emptyCurrentItem());
  };

  const removeItem = (index) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setError("");
    setSuccess("");
  };

  const handleSave = async () => {
    setError("");
    setSuccess("");

    if (!selectedClass || !selectedYear) {
      setError("Select a class and academic year.");
      return;
    }
    const title = structureTitle.trim();
    if (!title) {
      setError("Structure title is required.");
      return;
    }
    if (items.length === 0) {
      setError("Add at least one fee line before saving.");
      return;
    }

    setSaving(true);
    try {
      const { data: structure } = await API.post("/fee-structures", {
        class_id: selectedClass,
        academic_year_id: selectedYear,
        title,
      });

      const structureId = structure?.id;
      if (!structureId) {
        setError("Invalid response from server when creating structure.");
        return;
      }

      await Promise.all(
        items.map((item) =>
          API.post("/fee-structure-items", {
            structure_id: structureId,
            fee_type_id: item.fee_type_id,
            amount: item.amount,
            is_monthly: item.is_monthly,
          })
        )
      );

      setSuccess("Fee structure saved successfully.");
      setItems([]);
      setCurrentItem(emptyCurrentItem());
      await loadInitial();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || "Save failed";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const canSave = Boolean(selectedClass && selectedYear && structureTitle.trim() && items.length > 0 && !saving && !loading);

  return (
    <section className="page-card fee-structure-page">
      <div>
        <h1 className="page-header__title page-title">Fee structure builder</h1>
        <p className="page-header__subtitle fee-structure-page__intro">
          Pick a class and academic year, add fee lines, then save. Uses your API base URL and JWT—no raw IDs typed by hand.
        </p>
      </div>

      {error ? (
        <div className="fee-structure-banner" role="alert">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="fee-structure-banner fee-structure-banner--success" role="status">
          {success}
        </div>
      ) : null}

      {loading ? <div className="fee-structure-loading">Loading classes, academic years, and fee types…</div> : null}

      {!loading ? (
        <>
          <div className="fee-structure-panel">
            <h2 className="fee-structure-panel__title">Structure details</h2>
            <p className="fee-structure-panel__hint">Title updates when you change class or year; you can edit it before saving.</p>
            <div className="fee-structure-grid">
              <label className="label">
                Class
                <select className="fee-structure-select" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} aria-label="Class">
                  <option value="">Select class</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                Academic year
                <select className="fee-structure-select" value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} aria-label="Academic year">
                  <option value="">Select academic year</option>
                  {academicYears.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name}
                      {y.is_active ? " (active)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label label--full">
                Structure title
                <input className="input" value={structureTitle} onChange={(e) => setStructureTitle(e.target.value)} placeholder="e.g. 10th fees (2025-2026)" />
              </label>
            </div>
          </div>

          <div className="fee-structure-panel">
            <h2 className="fee-structure-panel__title">Line items</h2>
            <p className="fee-structure-panel__hint">Each fee type can appear once. Amount must be greater than zero.</p>

            <form className="fee-structure-add-row" onSubmit={addItem}>
              <label className="label">
                Fee type
                <select
                  className="fee-structure-select"
                  value={currentItem.fee_type_id}
                  onChange={(e) => setCurrentItem((s) => ({ ...s, fee_type_id: e.target.value }))}
                  aria-label="Fee type for new line"
                >
                  <option value="">Select fee type</option>
                  {feeTypes.map((ft) => (
                    <option key={ft.id} value={ft.id}>
                      {ft.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                Amount
                <input
                  className="input"
                  inputMode="decimal"
                  value={currentItem.amount}
                  onChange={(e) => setCurrentItem((s) => ({ ...s, amount: e.target.value }))}
                  placeholder="0.00"
                />
              </label>
              <label className="fee-structure-checkbox">
                <input
                  type="checkbox"
                  checked={currentItem.is_monthly}
                  onChange={(e) => setCurrentItem((s) => ({ ...s, is_monthly: e.target.checked }))}
                />
                Monthly
              </label>
              <button type="submit" className="fee-structure-btn fee-structure-btn--ghost">
                Add line
              </button>
            </form>

            {items.length === 0 ? (
              <p className="fee-structure-panel__hint">No lines yet. Add at least one to enable Save.</p>
            ) : (
              <div className="fee-structure-table-wrap">
                <table className="fee-structure-table">
                  <thead>
                    <tr>
                      <th>Fee type</th>
                      <th>Amount</th>
                      <th>Billing</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row, index) => (
                      <tr key={`${row.fee_type_id}-${index}`}>
                        <td>{feeTypeNameById[row.fee_type_id] || "—"}</td>
                        <td>{Number(row.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td>
                          {row.is_monthly ? (
                            <span className="fee-structure-badge">Monthly</span>
                          ) : (
                            <span className="fee-structure-badge fee-structure-badge--off">One-time</span>
                          )}
                        </td>
                        <td>
                          <button type="button" className="fee-structure-btn fee-structure-btn--danger fee-structure-btn--sm" onClick={() => removeItem(index)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="fee-structure-actions">
              <button type="button" className="fee-structure-btn" onClick={handleSave} disabled={!canSave}>
                {saving ? "Saving…" : "Save structure"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
