import React, { useCallback, useEffect, useState } from "react";

import API from "../api";

import "./classes.css";

const CLASS_IN_USE_ALERT = "Cannot delete class. It is in use.";
const SECTION_NAME_MAX_LENGTH = 25;

export default function Classes() {
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);

  const [className, setClassName] = useState("");
  const [classLevel, setClassLevel] = useState("school");
  const [sectionName, setSectionName] = useState("");

  const [loading, setLoading] = useState(true);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      API.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      delete API.defaults.headers.common.Authorization;
    }
  }, []);

  const fetchClasses = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await API.get("/classes");
      const list = Array.isArray(data) ? data : [];
      setClasses(list);
      setSelectedClass((prev) => {
        if (!list.length) return null;
        if (prev && list.some((c) => c.id === prev.id)) {
          return list.find((c) => c.id === prev.id);
        }
        return list[0];
      });
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load classes");
      setClasses([]);
      setSelectedClass(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  const fetchSections = useCallback(async (classId) => {
    if (!classId) {
      setSections([]);
      return;
    }
    setSectionsLoading(true);
    setError("");
    try {
      const { data } = await API.get(`/sections/${classId}`);
      setSections(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load sections");
      setSections([]);
    } finally {
      setSectionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedClass?.id) {
      fetchSections(selectedClass.id);
    } else {
      setSections([]);
    }
  }, [selectedClass?.id, fetchSections]);

  const handleAddClass = async (e) => {
    e.preventDefault();
    const name = className.trim();
    if (!name) {
      setError("Class name is required.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await API.post("/classes", { name, level: classLevel });
      setClassName("");
      setClassLevel("school");
      await fetchClasses();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to create class");
    } finally {
      setLoading(false);
    }
  };

  const handleAddSection = async (e) => {
    e.preventDefault();
    if (!selectedClass?.id) {
      setError("Select a class first.");
      return;
    }
    const name = sectionName.trim();
    if (!name) {
      setError("Section name is required.");
      return;
    }
    if (name.length > SECTION_NAME_MAX_LENGTH) {
      setError(`Section name must be at most ${SECTION_NAME_MAX_LENGTH} characters.`);
      return;
    }
    setSectionsLoading(true);
    setError("");
    try {
      await API.post("/sections", { class_id: selectedClass.id, name });
      setSectionName("");
      await fetchSections(selectedClass.id);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to create section");
    } finally {
      setSectionsLoading(false);
    }
  };

  const handleDeleteClass = async (cls) => {
    if (!window.confirm(`Permanently delete class “${cls.name}”? This cannot be undone.`)) return;
    setLoading(true);
    setError("");
    try {
      await API.delete(`/classes/${cls.id}`);
      if (selectedClass?.id === cls.id) {
        setSelectedClass(null);
      }
      await fetchClasses();
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.message || "";
      if (status === 400 && (msg.includes("in use") || msg === CLASS_IN_USE_ALERT)) {
        window.alert(CLASS_IN_USE_ALERT);
      } else {
        window.alert(msg || err.message || "Failed to delete class");
      }
      setError(msg || err.message || "Failed to delete class");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSection = async (section) => {
    if (!window.confirm(`Permanently delete section “${section.name}”? This cannot be undone.`)) return;
    if (!selectedClass?.id) return;
    setSectionsLoading(true);
    setError("");
    try {
      await API.delete(`/sections/${section.id}`);
      await fetchSections(selectedClass.id);
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.message || "";
      if (status === 400) {
        window.alert(msg || "Cannot delete section. It is in use.");
      } else {
        window.alert(msg || err.message || "Failed to delete section");
      }
      setError(msg || err.message || "Failed to delete section");
    } finally {
      setSectionsLoading(false);
    }
  };

  return (
    <section className="page-card classes-page">
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title page-title">Classes &amp; sections</h1>
          <p className="page-header__subtitle classes-page__intro">
            Manage classes and their sections. Select a class to edit sections.
          </p>
        </div>
      </div>

      {error ? (
        <div className="alert alert--error classes-banner" role="alert">
          {error}
        </div>
      ) : null}

      <div className="classes-layout">
        <div className="classes-panel">
          <h2 className="classes-panel__title">Classes</h2>
          <p className="classes-panel__hint">Select a class to view and edit its sections.</p>

          {loading && classes.length === 0 ? (
            <div className="classes-loading">Loading classes…</div>
          ) : classes.length === 0 ? (
            <p className="classes-empty">No classes yet. Add one below.</p>
          ) : (
            <div className="classes-list">
              {classes.map((c) => (
                <div key={c.id} className="classes-class-row">
                  <button
                    type="button"
                    className={`classes-list-item${selectedClass?.id === c.id ? " classes-list-item--selected" : ""}`}
                    onClick={() => setSelectedClass(c)}
                  >
                    <span className="classes-list-item__main">
                      <span className="classes-list-item__name">{c.name}</span>
                      <span className="classes-list-item__meta">{c.level}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="classes-btn classes-btn--danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteClass(c);
                    }}
                    disabled={loading}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}

          <form className="classes-form" onSubmit={handleAddClass}>
            <div className="classes-form__row">
              <label className="label">
                New class name
                <input className="input" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="e.g. 10th" />
              </label>
              <label className="label">
                Level
                <select className="input" value={classLevel} onChange={(e) => setClassLevel(e.target.value)}>
                  <option value="school">School</option>
                  <option value="college">College</option>
                </select>
              </label>
            </div>
            <button type="submit" className="classes-btn" disabled={loading}>
              Add class
            </button>
          </form>
        </div>

        <div className="classes-panel">
          <h2 className="classes-panel__title">Sections</h2>
          {!selectedClass ? (
            <p className="classes-empty">Select a class to see sections.</p>
          ) : (
            <p className="classes-panel__hint">
              Sections for <strong>{selectedClass.name}</strong>
            </p>
          )}

          {selectedClass && sectionsLoading ? <div className="classes-loading">Loading sections…</div> : null}

          {selectedClass && !sectionsLoading && sections.length === 0 ? (
            <p className="classes-empty">No sections for this class. Add one below.</p>
          ) : null}

          {selectedClass && !sectionsLoading && sections.length > 0 ? (
            <div className="classes-list">
              {sections.map((s) => (
                <div key={s.id} className="classes-section-row">
                  <span className="classes-section-row__name">{s.name}</span>
                  <button type="button" className="classes-btn classes-btn--danger" onClick={() => handleDeleteSection(s)} disabled={sectionsLoading}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <form className="classes-form" onSubmit={handleAddSection}>
            <label className="label">
              New section name
              <input
                className="input"
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value.slice(0, SECTION_NAME_MAX_LENGTH))}
                placeholder="e.g. A, Pre Medical, Pre Engineer"
                maxLength={SECTION_NAME_MAX_LENGTH}
                disabled={!selectedClass}
              />
            </label>
            <button type="submit" className="classes-btn" disabled={!selectedClass || sectionsLoading}>
              Add section
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
