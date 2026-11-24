import React, { useCallback, useEffect, useMemo, useState } from "react";

import API from "../api";
import { localDateInputValue } from "../utils/dateLocal";
import { fetchPaymentStatusesForStudents } from "../utils/feeListPaymentStatus";

import "./students.css";

function createEmptyForm() {
  return {
    name: "",
    phone: "",
    gender: "male",
    father_name: "",
    current_class_id: "",
    current_section_id: "",
  };
}

function formatStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) return "Inactive";
  return normalized === "active" ? "Active" : "Inactive";
}

function statusClass(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "active" ? "status-badge status-active" : "status-badge status-inactive";
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

/** Up to 3 numbers from one stored field; separated by comma, semicolon, pipe, or newline. */
function parseStudentPhones(raw) {
  if (raw == null || String(raw).trim() === "") return [];
  return String(raw)
    .split(/[,;|\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export default function Students() {
  const [students, setStudents] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [classes, setClasses] = useState([]);
  const [alumniYears, setAlumniYears] = useState([]);
  const [sectionOptions, setSectionOptions] = useState([]);

  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [paymentStatusByStudentId, setPaymentStatusByStudentId] = useState({});

  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(createEmptyForm);
  const [modalError, setModalError] = useState("");
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [expandedPhoneStudentId, setExpandedPhoneStudentId] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      API.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      delete API.defaults.headers.common.Authorization;
    }
  }, []);

  const loadReferenceData = useCallback(async () => {
    try {
      const [{ data: campusRows }, { data: classRows }, { data: alumniYearRows }] = await Promise.all([
        API.get("/campuses"),
        API.get("/classes"),
        API.get("/alumni/years"),
      ]);
      setCampuses(Array.isArray(campusRows) ? campusRows : []);
      setClasses(Array.isArray(classRows) ? classRows : []);
      setAlumniYears(Array.isArray(alumniYearRows) ? alumniYearRows : []);
    } catch {
      setCampuses([]);
      setClasses([]);
      setAlumniYears([]);
    }
  }, []);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  const fetchStudents = useCallback(async () => {
    setListLoading(true);
    setListError("");
    try {
      let data = [];
      if (isAlumniOption(classFilter)) {
        const y = alumniYearFromOption(classFilter);
        if (y == null) {
          setStudents([]);
          setListLoading(false);
          return;
        }
        const res = await API.get("/alumni/students", { params: { year: y } });
        data = res.data;
      } else {
        const params = {};
        if (classFilter) params.current_class_id = classFilter;
        if (genderFilter) params.gender = genderFilter;
        const res = await API.get("/students", { params });
        data = res.data;
      }
      setStudents(Array.isArray(data) ? data : []);
    } catch (err) {
      setListError(err.response?.data?.message || err.message || "Failed to load students");
      setStudents([]);
    } finally {
      setListLoading(false);
    }
  }, [classFilter, genderFilter]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  useEffect(() => {
    let cancelled = false;
    if (!students.length) {
      setPaymentStatusByStudentId({});
      return undefined;
    }

    const yRaw = localStorage.getItem("fee_collection_calendar_year");
    const billingYear = yRaw && /^\d{4}$/.test(String(yRaw)) ? Number(yRaw) : new Date().getFullYear();

    (async () => {
      try {
        const map = await fetchPaymentStatusesForStudents(API, students, billingYear);
        if (!cancelled) setPaymentStatusByStudentId(map);
      } catch {
        if (!cancelled) setPaymentStatusByStudentId({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [students]);

  useEffect(() => {
    if (!showModal || editId || !classes.length) return;
    setForm((f) => {
      if (f.current_class_id) return f;
      return { ...f, current_class_id: classes[0].id };
    });
  }, [showModal, editId, classes]);

  useEffect(() => {
    if (!showModal || editId) return;
    const classId = form.current_class_id;
    if (!classId) {
      setSectionOptions([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data } = await API.get(`/sections/${classId}`);
        const list = Array.isArray(data) ? data : [];
        if (cancelled) return;
        setSectionOptions(list);
        setForm((f) => {
          if (f.current_class_id !== classId) return f;
          const nextSection =
            list.length && list.some((s) => s.id === f.current_section_id) ? f.current_section_id : list[0]?.id || "";
          return { ...f, current_section_id: nextSection };
        });
      } catch {
        if (!cancelled) {
          setSectionOptions([]);
          setForm((f) => (f.current_class_id === classId ? { ...f, current_section_id: "" } : f));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showModal, editId, form.current_class_id]);

  const classNameById = useMemo(() => {
    const m = {};
    classes.forEach((c) => {
      m[c.id] = c.name;
    });
    return m;
  }, [classes]);

  const classOptions = useMemo(() => {
    const base = classes.map((c) => ({ value: c.id, label: c.name }));
    const alumni = alumniYears
      .map((y) => Number(y))
      .filter((y) => Number.isInteger(y))
      .sort((a, b) => b - a)
      .map((y) => ({ value: `alumni:${y}`, label: `Alumni ${y}` }));
    return [...base, ...alumni];
  }, [classes, alumniYears]);

  const visibleStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => String(s.name || "").toLowerCase().includes(q));
  }, [students, search]);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditId(null);
    setForm(createEmptyForm());
    setModalError("");
    setSectionOptions([]);
  }, []);

  useEffect(() => {
    if (!showModal) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showModal, closeModal]);

  const openAddModal = useCallback(() => {
    setEditId(null);
    setForm({
      ...createEmptyForm(),
      current_class_id: classes[0]?.id || "",
      current_section_id: "",
    });
    setModalError("");
    setShowModal(true);
  }, [classes]);

  const openEditModal = useCallback((student) => {
    setEditId(student.id);
    setForm({
      name: student.name || "",
      phone: student.phone || "",
      gender: student.gender || "male",
      father_name: student.father_name || "",
      current_class_id: "",
      current_section_id: "",
    });
    setModalError("");
    setShowModal(true);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setModalError("");

    if (!form.name.trim()) {
      setModalError("Name is required.");
      return;
    }

    setModalSubmitting(true);
    try {
      if (editId) {
        await API.put(`/students/${editId}`, {
          name: form.name.trim(),
          father_name: form.father_name.trim() || "N/A",
          phone: form.phone.trim() || null,
          gender: form.gender,
        });
      } else {
        if (!campuses.length) {
          setModalError("No campus available. Add a campus or run the database seed.");
          return;
        }
        if (!form.current_class_id || !form.current_section_id) {
          setModalError("Class and section are required.");
          return;
        }
        const today = localDateInputValue();
        await API.post("/students", {
          campus_id: campuses[0].id,
          current_class_id: form.current_class_id,
          current_section_id: form.current_section_id,
          name: form.name.trim(),
          father_name: form.father_name.trim() || "N/A",
          phone: form.phone.trim() || null,
          gender: form.gender,
          address: "",
          admission_date: today,
        });
      }
      closeModal();
      await fetchStudents();
    } catch (err) {
      setModalError(err.response?.data?.message || err.message || "Request failed");
    } finally {
      setModalSubmitting(false);
    }
  };

  const deleteStudent = async (student) => {
    const label = student.name || "this student";
    if (
      !window.confirm(
        `Permanently delete ${label}? All fee and payment records for this student will also be removed. This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await API.delete(`/students/${student.id}`);
      await fetchStudents();
    } catch (err) {
      window.alert(err.response?.data?.message || err.message || "Delete failed");
    }
  };

  const onBackdropMouseDown = (e) => {
    if (e.target === e.currentTarget) closeModal();
  };

  const isEdit = Boolean(editId);

  return (
    <section className="page-card students-page">
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title students-page__title">Students</h1>
          <p className="page-header__subtitle students-page__lead">
            Live search, class and gender filters, and add/edit in a modal.
          </p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="students-btn btn" onClick={openAddModal}>
            + Add student
          </button>
        </div>
      </div>

      {listError ? <div className="alert alert--error students-banner students-banner--error">{listError}</div> : null}

      <div className="students-toolbar page-toolbar">
        <div className="students-toolbar__grow">
          <input
            className="input"
            type="search"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search students by name"
          />
        </div>
        <div className="students-toolbar__actions">
          <select className="students-select" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} aria-label="Filter by class">
            <option value="">All classes</option>
            {classOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select className="students-select" value={genderFilter} onChange={(e) => setGenderFilter(e.target.value)} aria-label="Filter by gender">
            <option value="">All genders</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>
      </div>

      <div className="students-table-wrap">
        {listLoading ? (
          <div className="students-empty">Loading students…</div>
        ) : visibleStudents.length === 0 ? (
          <div className="students-empty">No students match the current filters.</div>
        ) : (
          <table className="students-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Class</th>
                <th>Phone</th>
                <th>Payment Status</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>
                    {s.graduation_year
                      ? `Alumni ${s.graduation_year}`
                      : classNameById[s.current_class_id] || <span className="students-table__muted">—</span>}
                  </td>
                  <td className="students-table__phone-cell">
                    {(() => {
                      const phones = parseStudentPhones(s.phone);
                      if (phones.length === 0) {
                        return <span className="students-table__muted">—</span>;
                      }
                      if (phones.length === 1) {
                        return phones[0];
                      }
                      const isOpen = expandedPhoneStudentId === s.id;
                      return (
                        <span className="students-phone-inline-wrap">
                          <button
                            type="button"
                            className="students-phone-toggle"
                            aria-expanded={isOpen}
                            aria-label={isOpen ? "Hide extra contact numbers" : "Show other contact numbers"}
                            onClick={() =>
                              setExpandedPhoneStudentId((id) => (id === s.id ? null : s.id))
                            }
                          >
                            {phones[0]}
                          </button>
                          {isOpen ? (
                            <>
                              <span className="students-phone-sep" aria-hidden="true">
                                {" · "}
                              </span>
                              <span className="students-phone-rest">{phones.slice(1).join(" · ")}</span>
                            </>
                          ) : null}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    <span
                      className={`status-badge ${
                        paymentStatusByStudentId[s.id] === "paid" ? "status-paid" : "status-partial"
                      }`}
                    >
                      {paymentStatusByStudentId[s.id] === "paid" ? "Paid" : "Partial"}
                    </span>
                  </td>
                  <td>
                    <span className={statusClass(s.status)}>{formatStatus(s.status)}</span>
                  </td>
                  <td>
                    <div className="students-table-actions">
                      <button type="button" className="students-btn students-btn--ghost students-btn--sm" onClick={() => openEditModal(s)}>
                        Edit
                      </button>
                      <button type="button" className="students-btn students-btn--danger students-btn--sm" onClick={() => deleteStudent(s)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal ? (
        <div className="students-modal-backdrop" role="presentation" onMouseDown={onBackdropMouseDown}>
          <div
            className="students-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="students-modal-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="students-modal__header">
              <div>
                <h2 id="students-modal-title" className="students-modal__title">
                  {isEdit ? "Edit student" : "Add student"}
                </h2>
                <p className="students-modal__subtitle">
                  {isEdit
                    ? "Update name, phone, father name, and gender."
                    : "Pick class and section from the server. Campus is the first campus returned by the API."}
                </p>
              </div>
              <button type="button" className="students-modal__close" onClick={closeModal} aria-label="Close dialog">
                ×
              </button>
            </div>

            <form className="students-modal__body" onSubmit={handleSubmit}>
              {modalError ? <div className="students-banner students-banner--error students-modal__alert">{modalError}</div> : null}

              <div className="students-form-grid">
                <label className="label">
                  Name
                  <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
                </label>
                <label className="label">
                  Phone
                  <input
                    className="input"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    autoComplete="tel"
                    placeholder="e.g. 0300… , 0312… (comma between numbers, up to 3)"
                  />
                </label>
                <label className="label">
                  Gender
                  <select className="students-select students-select--block" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </label>
                <label className="label">
                  Father name
                  <input
                    className="input"
                    value={form.father_name}
                    onChange={(e) => setForm({ ...form, father_name: e.target.value })}
                    placeholder="Optional — defaults to N/A"
                  />
                </label>

                {!isEdit ? (
                  <>
                    <label className="label">
                      Class
                      <select
                        className="students-select students-select--block"
                        value={form.current_class_id}
                        onChange={(e) => setForm({ ...form, current_class_id: e.target.value, current_section_id: "" })}
                      >
                        <option value="">Select class</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="label">
                      Section
                      <select
                        className="students-select students-select--block"
                        value={form.current_section_id}
                        onChange={(e) => setForm({ ...form, current_section_id: e.target.value })}
                        disabled={!form.current_class_id || sectionOptions.length === 0}
                      >
                        <option value="">{sectionOptions.length ? "Select section" : "No sections"}</option>
                        {sectionOptions.map((sec) => (
                          <option key={sec.id} value={sec.id}>
                            {sec.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
              </div>

              <div className="students-modal__footer">
                <button type="button" className="students-btn students-btn--ghost" onClick={closeModal} disabled={modalSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="students-btn" disabled={modalSubmitting}>
                  {modalSubmitting ? "Saving…" : isEdit ? "Update" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
