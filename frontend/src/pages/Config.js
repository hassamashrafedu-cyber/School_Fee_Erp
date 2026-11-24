import React, { useCallback, useEffect, useMemo, useState } from "react";

import API, { refreshApiBaseUrl } from "../api";
import { useNavigationBack } from "../context/NavigationBackContext";
import { useSchoolSettings } from "../context/SchoolSettingsContext";
import {
  clearStoredApiBaseUrl,
  getActiveApiBaseUrl,
  getDefaultApiBaseUrl,
  normalizeApiBaseUrl,
  setStoredApiBaseUrl,
} from "../utils/apiBase";

import "./config.css";

const HUB = "hub";

const CARDS = [
  {
    id: "school",
    group: "school",
    title: "Logo & School Name",
    desc: "School name, address, phone, academic year, and logo used across the app and fee slips.",
    action: "Open school profile",
  },
  {
    id: "feeslip",
    group: "school",
    title: "Fee Slip Configuration",
    desc: "Bank details and late fine (percent or amount) for fee slips. Logo and school name come from school profile.",
    action: "Open fee slip settings",
  },
  {
    id: "promotion",
    group: "operations",
    title: "Student Promotion",
    desc: "Move students to the next class or alumni for a new academic year.",
    action: "Open promotion",
  },
  {
    id: "workstation",
    group: "operations",
    title: "Workstation Connection",
    desc: "For 2–3 PCs in one school: point this PC at the server API. Single PC uses localhost.",
    action: "Open workstation settings",
  },
  {
    id: "backup",
    group: "safety",
    title: "Backup & Restore",
    desc: "Save a full database backup to this PC, or restore from a previous backup file.",
    action: "Open backup & restore",
  },
  {
    id: "password",
    group: "safety",
    title: "Set Password",
    desc: "Change Admin or Accountant login passwords.",
    action: "Open password settings",
  },
  {
    id: "delete",
    group: "safety",
    title: "Delete Student / Class",
    desc: "Permanently remove a student, class, or section. Deleted data cannot be recovered.",
    action: "Open delete tools",
  },
  {
    id: "about",
    group: "info",
    title: "About / App Version",
    desc: "See app name and version for support when you install at different schools.",
    action: "Open about",
  },
];

const SETTINGS_GROUPS = [
  {
    id: "school",
    title: "School profile",
    hint: "Name, logo, and fee slip details parents and staff see every day.",
  },
  {
    id: "operations",
    title: "Yearly operations",
    hint: "Promote students and connect extra office PCs to the same school data.",
  },
  {
    id: "safety",
    title: "Safety & access",
    hint: "Backups, passwords, and permanent deletes — use these carefully.",
  },
  {
    id: "info",
    title: "About this install",
    hint: "Version details for support and multi-school installs.",
  },
];

function CardIcon({ id }) {
  const common = { width: 22, height: 22, fill: "none", stroke: "currentColor", strokeWidth: 1.8 };
  if (id === "backup") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M4 7h16v12H4z" />
        <path d="M8 7V5h8v2" />
        <path d="M12 11v5M9.5 14.5 12 17l2.5-2.5" />
      </svg>
    );
  }
  if (id === "school") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M4 10 12 5l8 5v8H4z" />
        <path d="M9 18v-5h6v5" />
      </svg>
    );
  }
  if (id === "feeslip") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M7 4h10v16H7z" />
        <path d="M10 8h4M10 12h4M10 16h3" />
      </svg>
    );
  }
  if (id === "delete") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12" />
      </svg>
    );
  }
  if (id === "password") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        <rect x="6" y="11" width="12" height="9" rx="2" />
      </svg>
    );
  }
  if (id === "workstation") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <rect x="3" y="5" width="18" height="12" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }
  if (id === "promotion") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M12 19V7M7 12l5-5 5 5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" {...common}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 1.5" />
    </svg>
  );
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "application/sql;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

export default function Config() {
  const { settings, refresh: refreshSchoolSettings, logoUrl, setSettings } = useSchoolSettings();
  const { setPageBackHandler } = useNavigationBack();
  const [view, setView] = useState(HUB);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [schoolForm, setSchoolForm] = useState({
    school_name: "",
    school_name_line2: "",
    address_line1: "",
    address_line2: "",
    phone: "",
    academic_year: "",
  });
  const [feeForm, setFeeForm] = useState({
    bank_name: "",
    bank_account_no: "",
    fine_type: "percent",
    fine_value: "0",
  });

  const [adminCurrentPassword, setAdminCurrentPassword] = useState("");
  const [adminNewPassword, setAdminNewPassword] = useState("");
  const [adminConfirmPassword, setAdminConfirmPassword] = useState("");
  const [accountantNewPassword, setAccountantNewPassword] = useState("");
  const [accountantConfirmPassword, setAccountantConfirmPassword] = useState("");

  const [purgeStudents, setPurgeStudents] = useState([]);
  const [purgeClasses, setPurgeClasses] = useState([]);
  const [purgeSections, setPurgeSections] = useState([]);
  const [purgeStudentId, setPurgeStudentId] = useState("");
  const [purgeClassId, setPurgeClassId] = useState("");
  const [purgeSectionId, setPurgeSectionId] = useState("");
  const [purgeStudentPreview, setPurgeStudentPreview] = useState(null);
  const [purgeConfirmName, setPurgeConfirmName] = useState("");
  const [purgeConfirmPhrase, setPurgeConfirmPhrase] = useState("");
  const [purgeAdminPassword, setPurgeAdminPassword] = useState("");

  const [apiBaseDraft, setApiBaseDraft] = useState(getActiveApiBaseUrl());
  const [activeApiUrl, setActiveApiUrl] = useState(getActiveApiBaseUrl());
  const [about, setAbout] = useState(null);

  const [promoYear, setPromoYear] = useState(String(new Date().getFullYear()));
  const [promoClasses, setPromoClasses] = useState([]);
  const [fromClassId, setFromClassId] = useState("");
  const [fromSectionId, setFromSectionId] = useState("");
  const [toClassId, setToClassId] = useState("");
  const [toSectionId, setToSectionId] = useState("");
  const [fromSections, setFromSections] = useState([]);
  const [toSections, setToSections] = useState([]);
  const [promoteToAlumni, setPromoteToAlumni] = useState(false);
  const [promotionCandidates, setPromotionCandidates] = useState([]);
  const [selectedPromotionStudentIds, setSelectedPromotionStudentIds] = useState([]);
  const [promotionSummary, setPromotionSummary] = useState(null);

  useEffect(() => {
    setSchoolForm({
      school_name: settings.school_name || "",
      school_name_line2: settings.school_name_line2 || "",
      address_line1: settings.address_line1 || "",
      address_line2: settings.address_line2 || "",
      phone: settings.phone || "",
      academic_year: settings.academic_year || "",
    });
    setFeeForm({
      bank_name: settings.bank_name || "",
      bank_account_no: settings.bank_account_no || "",
      fine_type: settings.fine_type === "amount" ? "amount" : "percent",
      fine_value: String(settings.fine_value ?? 0),
    });
  }, [settings]);

  const openPanel = (id) => {
    setError("");
    setMessage("");
    setView(id);
  };

  const backToHub = useCallback(() => {
    setError("");
    setMessage("");
    setView(HUB);
  }, []);

  useEffect(() => {
    if (view === HUB) {
      setPageBackHandler(null);
      return undefined;
    }
    setPageBackHandler(backToHub);
    return () => setPageBackHandler(null);
  }, [view, backToHub, setPageBackHandler]);

  const loadPurgeLists = useCallback(async () => {
    const [studentsRes, classesRes] = await Promise.all([
      API.get("/admin/purge/students", { params: { include_deleted: true } }),
      API.get("/admin/purge/classes"),
    ]);
    setPurgeStudents(Array.isArray(studentsRes.data) ? studentsRes.data : []);
    setPurgeClasses(Array.isArray(classesRes.data) ? classesRes.data : []);
  }, []);

  useEffect(() => {
    if (view !== "delete") return undefined;
    let cancelled = false;
    (async () => {
      try {
        await loadPurgeLists();
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || err.message || "Failed to load delete lists");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, loadPurgeLists]);

  useEffect(() => {
    if (view !== "about") return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await API.get("/settings/about");
        if (!cancelled) setAbout(data);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || err.message || "Failed to load about info");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  useEffect(() => {
    if (view !== "promotion") return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await API.get("/classes");
        if (!cancelled) setPromoClasses(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || err.message || "Failed to load classes");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  useEffect(() => {
    const loadSections = async () => {
      if (!fromClassId) {
        setFromSections([]);
        setFromSectionId("");
        return;
      }
      try {
        const { data } = await API.get(`/sections/${fromClassId}`);
        setFromSections(Array.isArray(data) ? data : []);
      } catch {
        setFromSections([]);
      }
    };
    loadSections();
  }, [fromClassId]);

  useEffect(() => {
    const loadSections = async () => {
      if (!toClassId || promoteToAlumni) {
        setToSections([]);
        setToSectionId("");
        return;
      }
      try {
        const { data } = await API.get(`/sections/${toClassId}`);
        setToSections(Array.isArray(data) ? data : []);
      } catch {
        setToSections([]);
      }
    };
    loadSections();
  }, [toClassId, promoteToAlumni]);

  useEffect(() => {
    const loadSections = async () => {
      if (!purgeClassId) {
        setPurgeSections([]);
        setPurgeSectionId("");
        return;
      }
      try {
        const { data } = await API.get("/admin/purge/sections", { params: { class_id: purgeClassId } });
        setPurgeSections(Array.isArray(data) ? data : []);
      } catch {
        setPurgeSections([]);
      }
    };
    loadSections();
  }, [purgeClassId]);

  useEffect(() => {
    let cancelled = false;
    if (!purgeStudentId) {
      setPurgeStudentPreview(null);
      return undefined;
    }
    (async () => {
      try {
        const { data } = await API.get(`/admin/purge/students/${purgeStudentId}/preview`);
        if (!cancelled) setPurgeStudentPreview(data);
      } catch {
        if (!cancelled) setPurgeStudentPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [purgeStudentId]);

  const saveSchoolProfile = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data } = await API.put("/settings", schoolForm);
      setSettings(data);
      setMessage("School profile saved. Logo and name now apply across the app.");
      await refreshSchoolSettings();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to save school profile");
    } finally {
      setBusy(false);
    }
  };

  const onLogoSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (PNG, JPG, etc.).");
      return;
    }
    if (file.size > 1_500_000) {
      setError("Logo is too large. Please use an image under 1.5 MB.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const { data } = await API.put("/settings/logo", {
        logo_data: dataUrl,
        logo_mime: file.type,
      });
      setSettings(data);
      setMessage("Logo updated. It will show in the app and on fee slips.");
      await refreshSchoolSettings();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to upload logo");
    } finally {
      setBusy(false);
    }
  };

  const clearLogo = async () => {
    if (!window.confirm("Remove the custom logo and use the default?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data } = await API.delete("/settings/logo");
      setSettings(data);
      setMessage("Custom logo removed.");
      await refreshSchoolSettings();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to clear logo");
    } finally {
      setBusy(false);
    }
  };

  const saveFeeSlip = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    const fineValue = Number(feeForm.fine_value);
    if (!Number.isFinite(fineValue) || fineValue < 0) {
      setError("Fine value must be zero or a positive number.");
      setBusy(false);
      return;
    }
    try {
      const { data } = await API.put("/settings", {
        bank_name: feeForm.bank_name,
        bank_account_no: feeForm.bank_account_no,
        fine_type: feeForm.fine_type === "amount" ? "amount" : "percent",
        fine_value: fineValue,
      });
      setSettings(data);
      setMessage("Fee slip settings saved.");
      await refreshSchoolSettings();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to save fee slip settings");
    } finally {
      setBusy(false);
    }
  };

  const runBackup = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { data } = await API.post("/settings/backup");
      downloadTextFile(data.filename || "fee-erp-backup.sql", data.content || "");
      setMessage("Backup downloaded. Keep this file in a safe place.");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Backup failed");
    } finally {
      setBusy(false);
    }
  };

  const runRestore = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (
      !window.confirm(
        "Restore will replace the current database with this backup. Continue only if you are sure."
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const sql = await readFileAsText(file);
      const { data } = await API.post("/settings/restore", { sql });
      setMessage(data?.message || "Restore completed. Refresh the page.");
      await refreshSchoolSettings();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  const changeRolePassword = async (targetRole, newPassword, confirmPassword) => {
    setError("");
    setMessage("");
    if (!adminCurrentPassword) {
      setError("Enter your current Admin password to confirm changes.");
      return;
    }
    if (!newPassword || String(newPassword).length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    try {
      await API.post("/auth/change-role-password", {
        admin_current_password: adminCurrentPassword,
        target_role: targetRole,
        new_password: newPassword,
      });
      setMessage(targetRole === "admin" ? "Admin password updated." : "Accountant password updated.");
      if (targetRole === "admin") {
        setAdminNewPassword("");
        setAdminConfirmPassword("");
      } else {
        setAccountantNewPassword("");
        setAccountantConfirmPassword("");
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to update password.");
    } finally {
      setBusy(false);
    }
  };

  const runPurge = async (fn) => {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const result = await fn();
      setMessage(result?.data?.message || "Done.");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Permanent delete failed.");
    } finally {
      setBusy(false);
    }
  };

  const permanentlyDeleteStudent = async () => {
    if (!purgeStudentId) {
      setError("Select a student to permanently delete.");
      return;
    }
    if (
      !window.confirm(
        "This will PERMANENTLY delete the student and all payments, challans, and fee records. This cannot be undone."
      )
    ) {
      return;
    }
    await runPurge(() =>
      API.post(`/admin/purge/students/${purgeStudentId}`, {
        admin_current_password: purgeAdminPassword,
        confirm_name: purgeConfirmName,
      })
    );
    setPurgeStudentId("");
    setPurgeConfirmName("");
    await loadPurgeLists();
  };

  const permanentlyDeleteClass = async () => {
    if (!purgeClassId) {
      setError("Select a class to permanently delete.");
      return;
    }
    if (!window.confirm("Permanently delete this class and its fee setup? This cannot be undone.")) return;
    await runPurge(() =>
      API.post(`/admin/purge/classes/${purgeClassId}`, {
        admin_current_password: purgeAdminPassword,
        confirm_phrase: purgeConfirmPhrase,
      })
    );
    setPurgeClassId("");
    setPurgeConfirmPhrase("");
    await loadPurgeLists();
  };

  const permanentlyDeleteSection = async () => {
    if (!purgeSectionId) {
      setError("Select a section to permanently delete.");
      return;
    }
    if (!window.confirm("Permanently delete this section? This cannot be undone.")) return;
    await runPurge(() =>
      API.post(`/admin/purge/sections/${purgeSectionId}`, {
        admin_current_password: purgeAdminPassword,
        confirm_phrase: purgeConfirmPhrase || "DELETE",
      })
    );
    setPurgeSectionId("");
    await loadPurgeLists();
  };

  const saveWorkstation = () => {
    setError("");
    setMessage("");
    const normalized = normalizeApiBaseUrl(apiBaseDraft);
    if (!normalized) {
      setError("Enter an API address.");
      return;
    }
    const active = setStoredApiBaseUrl(normalized);
    refreshApiBaseUrl();
    setApiBaseDraft(active);
    setActiveApiUrl(active);
    setMessage("Workstation API address saved. Reload if pages still use the old server.");
  };

  const useThisPc = () => {
    const local = normalizeApiBaseUrl("http://127.0.0.1:5000");
    setApiBaseDraft(local);
    const active = setStoredApiBaseUrl(local);
    refreshApiBaseUrl();
    setActiveApiUrl(active);
    setMessage("Using this PC (127.0.0.1:5000).");
  };

  const clearWorkstation = () => {
    const active = clearStoredApiBaseUrl();
    refreshApiBaseUrl();
    setApiBaseDraft(active);
    setActiveApiUrl(active);
    setMessage("Override cleared. Using default API address.");
  };

  const fetchPromotionCandidates = async () => {
    if (!fromClassId) {
      setError("Select source class for promotion.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const { data } = await API.get("/promotions/candidates", {
        params: {
          from_class_id: fromClassId,
          from_section_id: fromSectionId || undefined,
        },
      });
      const rows = Array.isArray(data) ? data : [];
      setPromotionCandidates(rows);
      setSelectedPromotionStudentIds(rows.map((r) => r.id));
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load promotion candidates.");
      setPromotionCandidates([]);
      setSelectedPromotionStudentIds([]);
    } finally {
      setBusy(false);
    }
  };

  const previewPromotion = async () => {
    if (!promoYear || !/^\d{4}$/.test(String(promoYear))) {
      setError("Enter a valid promotion year.");
      return;
    }
    if (!fromClassId) {
      setError("Select source class.");
      return;
    }
    if (!promoteToAlumni && (!toClassId || !toSectionId)) {
      setError("Select target class and section.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const { data } = await API.post("/promotions/preview", {
        year: Number(promoYear),
        from_class_id: fromClassId,
        from_section_id: fromSectionId || null,
        target_class_id: promoteToAlumni ? null : toClassId,
        target_section_id: promoteToAlumni ? null : toSectionId,
        promote_to_alumni: promoteToAlumni,
      });
      setPromotionSummary(data || null);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to preview promotion.");
      setPromotionSummary(null);
    } finally {
      setBusy(false);
    }
  };

  const executePromotion = async () => {
    if (!selectedPromotionStudentIds.length) {
      setError("Select at least one student to promote.");
      return;
    }
    if (!window.confirm("Run promotion for selected students?")) return;
    setBusy(true);
    setMessage("");
    try {
      const { data } = await API.post("/promotions/execute", {
        year: Number(promoYear),
        student_ids: selectedPromotionStudentIds,
        target_class_id: promoteToAlumni ? null : toClassId,
        target_section_id: promoteToAlumni ? null : toSectionId,
        promote_to_alumni: promoteToAlumni,
      });
      setMessage(
        `${data?.message || "Promotion completed."} Processed: ${data?.processed || 0}, skipped: ${
          data?.skipped || 0
        }.`
      );
      await fetchPromotionCandidates();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to execute promotion.");
    } finally {
      setBusy(false);
    }
  };

  const panelTitle = useMemo(() => {
    const card = CARDS.find((c) => c.id === view);
    return card?.title || "Settings";
  }, [view]);

  const settingsGroups = useMemo(
    () =>
      SETTINGS_GROUPS.map((group) => ({
        ...group,
        cards: CARDS.filter((card) => card.group === group.id),
      })).filter((group) => group.cards.length > 0),
    []
  );

  return (
    <section className="page-card config-page">
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title config-page__title">{view === HUB ? "Settings" : panelTitle}</h1>
          <p className="page-header__subtitle config-page__intro">
            {view === HUB
              ? "Everything for this school install — pick a section below. Changes stay on this PC’s connected database."
              : "Take your time. Save when you are ready — nothing is sent until you confirm."}
          </p>
        </div>
      </div>

      {error ? (
        <div className="alert alert--error config-banner" role="alert">
          {error}
        </div>
      ) : null}
      {message ? <div className="alert alert--success config-banner config-banner--success">{message}</div> : null}

      {view === HUB ? (
        <div className="config-hub">
          {settingsGroups.map((group) => (
            <section key={group.id} className={`config-group config-group--${group.id}`} aria-labelledby={`settings-group-${group.id}`}>
              <header className="config-group__header">
                <h2 id={`settings-group-${group.id}`} className="config-group__title">
                  {group.title}
                </h2>
                <p className="config-group__hint">{group.hint}</p>
              </header>
              <div className="config-cards">
                {group.cards.map((card) => (
                  <article key={card.id} className={`config-card config-card--${card.id}`}>
                    <div className="config-card__icon" aria-hidden="true">
                      <CardIcon id={card.id} />
                    </div>
                    <div className="config-card__body">
                      <h3 className="config-card__title">{card.title}</h3>
                      <p className="config-card__desc">{card.desc}</p>
                      <button type="button" className="config-card__btn" onClick={() => openPanel(card.id)}>
                        {card.action}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {view === "school" ? (
        <div className="config-panel">
          <p className="config-panel__hint">
            Choose a logo from this PC. It shows in the sidebar and on fee slips together with the school name.
          </p>
          <div className="config-actions">
            <img className="config-logo-preview" src={logoUrl} alt="School logo preview" />
            <label className="config-btn" style={{ display: "inline-flex", alignItems: "center" }}>
              Choose logo
              <input type="file" accept="image/*" hidden onChange={onLogoSelected} disabled={busy} />
            </label>
            <button type="button" className="config-btn config-btn--ghost" onClick={clearLogo} disabled={busy}>
              Use default logo
            </button>
          </div>
          <div className="config-form">
            <div className="config-form__row">
              <label className="label">
                School name
                <input
                  className="input"
                  value={schoolForm.school_name}
                  onChange={(e) => setSchoolForm((s) => ({ ...s, school_name: e.target.value }))}
                />
              </label>
              <label className="label">
                Name line 2 (optional)
                <input
                  className="input"
                  value={schoolForm.school_name_line2}
                  onChange={(e) => setSchoolForm((s) => ({ ...s, school_name_line2: e.target.value }))}
                />
              </label>
            </div>
            <div className="config-form__row">
              <label className="label">
                Address
                <input
                  className="input"
                  value={schoolForm.address_line1}
                  onChange={(e) => setSchoolForm((s) => ({ ...s, address_line1: e.target.value }))}
                />
              </label>
              <label className="label">
                Address line 2 (optional)
                <input
                  className="input"
                  value={schoolForm.address_line2}
                  onChange={(e) => setSchoolForm((s) => ({ ...s, address_line2: e.target.value }))}
                />
              </label>
            </div>
            <div className="config-form__row">
              <label className="label">
                Phone
                <input
                  className="input"
                  value={schoolForm.phone}
                  onChange={(e) => setSchoolForm((s) => ({ ...s, phone: e.target.value }))}
                />
              </label>
              <label className="label">
                Academic year / session
                <input
                  className="input"
                  placeholder="e.g. 2025-26"
                  value={schoolForm.academic_year}
                  onChange={(e) => setSchoolForm((s) => ({ ...s, academic_year: e.target.value }))}
                />
              </label>
            </div>
            <button type="button" className="config-btn" disabled={busy} onClick={saveSchoolProfile}>
              {busy ? "Saving…" : "Save school profile"}
            </button>
          </div>
        </div>
      ) : null}

      {view === "feeslip" ? (
        <div className="config-panel">
          <p className="config-panel__hint">
            Set bank details and late fine here. Logo and school name come from Logo & School Name.
          </p>
          <div className="config-form">
            <label className="label">
              Bank name
              <input
                className="input"
                value={feeForm.bank_name}
                onChange={(e) => setFeeForm((s) => ({ ...s, bank_name: e.target.value }))}
              />
            </label>
            <label className="label">
              Bank account number
              <input
                className="input"
                value={feeForm.bank_account_no}
                onChange={(e) => setFeeForm((s) => ({ ...s, bank_account_no: e.target.value }))}
              />
            </label>
            <div className="config-form__row">
              <label className="label">
                Fine type
                <select
                  className="input"
                  value={feeForm.fine_type}
                  onChange={(e) => setFeeForm((s) => ({ ...s, fine_type: e.target.value }))}
                >
                  <option value="percent">Percent (%)</option>
                  <option value="amount">Fixed amount</option>
                </select>
              </label>
              <label className="label">
                {feeForm.fine_type === "amount" ? "Fine amount" : "Fine percent"}
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={feeForm.fine_value}
                  onChange={(e) => setFeeForm((s) => ({ ...s, fine_value: e.target.value }))}
                  placeholder={feeForm.fine_type === "amount" ? "e.g. 200" : "e.g. 5"}
                />
              </label>
            </div>
            <p className="config-meta">
              Used for “After Due date” on the fee slip. Set 0 for no fine.
            </p>
            <button type="button" className="config-btn" disabled={busy} onClick={saveFeeSlip}>
              {busy ? "Saving…" : "Save fee slip settings"}
            </button>
          </div>
        </div>
      ) : null}

      {view === "backup" ? (
        <div className="config-panel">
          <p className="config-panel__hint">
            Backup uses PostgreSQL tools on this PC (auto-detected from Program Files). Restore replaces current data
            with the backup file.
          </p>
          <div className="config-actions">
            <button type="button" className="config-btn" disabled={busy} onClick={runBackup}>
              {busy ? "Working…" : "Download backup"}
            </button>
            <label className="config-btn config-btn--ghost" style={{ display: "inline-flex", alignItems: "center" }}>
              Restore from file
              <input type="file" accept=".sql,text/plain" hidden onChange={runRestore} disabled={busy} />
            </label>
          </div>
        </div>
      ) : null}

      {view === "password" ? (
        <div className="config-panel config-panel--passwords">
          <p className="config-panel__hint">
            Only Admin can change passwords. Enter your current Admin password, then set a new password.
          </p>
          <label className="label">
            Your current Admin password
            <input
              className="input"
              type="password"
              value={adminCurrentPassword}
              onChange={(e) => setAdminCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <div className="config-password-grid">
            <div className="config-password-block">
              <h3 className="config-password-block__title">Admin password</h3>
              <label className="label">
                New password
                <input
                  className="input"
                  type="password"
                  value={adminNewPassword}
                  onChange={(e) => setAdminNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label className="label">
                Confirm new password
                <input
                  className="input"
                  type="password"
                  value={adminConfirmPassword}
                  onChange={(e) => setAdminConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <button
                type="button"
                className="config-btn"
                disabled={busy}
                onClick={() => changeRolePassword("admin", adminNewPassword, adminConfirmPassword)}
              >
                {busy ? "Saving…" : "Update Admin password"}
              </button>
            </div>
            <div className="config-password-block">
              <h3 className="config-password-block__title">Accountant password</h3>
              <label className="label">
                New password
                <input
                  className="input"
                  type="password"
                  value={accountantNewPassword}
                  onChange={(e) => setAccountantNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label className="label">
                Confirm new password
                <input
                  className="input"
                  type="password"
                  value={accountantConfirmPassword}
                  onChange={(e) => setAccountantConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <button
                type="button"
                className="config-btn"
                disabled={busy}
                onClick={() =>
                  changeRolePassword("accountant", accountantNewPassword, accountantConfirmPassword)
                }
              >
                {busy ? "Saving…" : "Update Accountant password"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {view === "workstation" ? (
        <div className="config-panel">
          <p className="config-panel__hint">
            Point this PC at the Express API. Single-PC uses localhost. LAN clients use the server PC&apos;s LAN IP
            (port 5000). PostgreSQL stays only on the server — never enter database passwords here.
          </p>
          <div className="config-form">
            <label className="label">
              API base URL*
              <input
                className="input"
                value={apiBaseDraft}
                onChange={(e) => setApiBaseDraft(e.target.value)}
                placeholder="http://localhost:5000/api"
              />
            </label>
            <p className="config-meta">
              Examples: http://127.0.0.1:5000/api (this PC) or http://192.168.1.10:5000/api (LAN server). Default:{" "}
              {getDefaultApiBaseUrl()}
            </p>
            <div className="config-actions">
              <button type="button" className="config-btn" onClick={saveWorkstation}>
                Save
              </button>
              <button type="button" className="config-btn config-btn--ghost" onClick={useThisPc}>
                Use this PC (127.0.0.1)
              </button>
              <button type="button" className="config-btn config-btn--ghost" onClick={clearWorkstation}>
                Clear override
              </button>
            </div>
            <p className="config-meta">Active URL: {activeApiUrl}</p>
          </div>
        </div>
      ) : null}

      {view === "about" ? (
        <div className="config-panel">
          <p className="config-panel__hint">Use this info when asking for support or installing updates.</p>
          <p>
            <strong>{about?.app_name || "FEE ERP"}</strong>
          </p>
          <p className="config-meta">Version: {about?.version || "—"}</p>
          <p className="config-meta">{about?.description || "School fee management"}</p>
        </div>
      ) : null}

      {view === "delete" ? (
        <div className="config-panel config-panel--danger">
          <p className="config-panel__hint config-panel__hint--danger">
            Deletes are permanent. There is no soft delete. Enter your Admin password for every action.
          </p>
          <label className="label">
            Your Admin password
            <input
              className="input"
              type="password"
              value={purgeAdminPassword}
              onChange={(e) => setPurgeAdminPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          <div className="config-purge-block">
            <h3 className="config-password-block__title">Delete student</h3>
            <label className="label">
              Student
              <select className="input" value={purgeStudentId} onChange={(e) => setPurgeStudentId(e.target.value)}>
                <option value="">Select student</option>
                {purgeStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.class_name || "No class"}
                  </option>
                ))}
              </select>
            </label>
            {purgeStudentPreview?.student ? (
              <p className="config-panel__hint">
                Will remove: {purgeStudentPreview.counts?.payments ?? 0} payment(s),{" "}
                {purgeStudentPreview.counts?.challans ?? 0} challan(s),{" "}
                {purgeStudentPreview.counts?.fee_assignments ?? 0} fee assignment(s).
              </p>
            ) : null}
            <label className="label">
              Type student name exactly to confirm
              <input
                className="input"
                value={purgeConfirmName}
                onChange={(e) => setPurgeConfirmName(e.target.value)}
                placeholder={purgeStudentPreview?.student?.name || "Student name"}
              />
            </label>
            <button
              type="button"
              className="config-btn config-btn--danger"
              disabled={busy}
              onClick={permanentlyDeleteStudent}
            >
              {busy ? "Deleting…" : "Permanently delete student"}
            </button>
          </div>

          <div className="config-purge-block">
            <h3 className="config-password-block__title">Delete class</h3>
            <p className="config-panel__hint">Class must have zero students. Fee setup for that class is removed.</p>
            <label className="label">
              Class
              <select className="input" value={purgeClassId} onChange={(e) => setPurgeClassId(e.target.value)}>
                <option value="">Select class</option>
                {purgeClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.student_count} student(s)
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Type DELETE to confirm
              <input
                className="input"
                value={purgeConfirmPhrase}
                onChange={(e) => setPurgeConfirmPhrase(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="config-btn config-btn--danger"
              disabled={busy}
              onClick={permanentlyDeleteClass}
            >
              {busy ? "Deleting…" : "Permanently delete class"}
            </button>
          </div>

          <div className="config-purge-block">
            <h3 className="config-password-block__title">Delete section</h3>
            <label className="label">
              Class
              <select className="input" value={purgeClassId} onChange={(e) => setPurgeClassId(e.target.value)}>
                <option value="">Select class</option>
                {purgeClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Section
              <select
                className="input"
                value={purgeSectionId}
                onChange={(e) => setPurgeSectionId(e.target.value)}
              >
                <option value="">Select section</option>
                {purgeSections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.name} — {sec.student_count} student(s)
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Type DELETE to confirm
              <input
                className="input"
                value={purgeConfirmPhrase}
                onChange={(e) => setPurgeConfirmPhrase(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="config-btn config-btn--danger"
              disabled={busy}
              onClick={permanentlyDeleteSection}
            >
              {busy ? "Deleting…" : "Permanently delete section"}
            </button>
          </div>
        </div>
      ) : null}

      {view === "promotion" ? (
        <div className="config-panel">
          <p className="config-panel__hint">
            Promote students by class/year without losing historical records. For Grade 10 completion, use Promote to
            Alumni.
          </p>
          <div className="config-form__row">
            <label className="label">
              Year
              <input
                className="input"
                type="number"
                min={1900}
                max={2100}
                value={promoYear}
                onChange={(e) => setPromoYear(e.target.value)}
              />
            </label>
            <label className="label">
              From class
              <select className="input" value={fromClassId} onChange={(e) => setFromClassId(e.target.value)}>
                <option value="">Select class</option>
                {promoClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              From section (optional)
              <select className="input" value={fromSectionId} onChange={(e) => setFromSectionId(e.target.value)}>
                <option value="">All sections</option>
                {fromSections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="config-form__row">
            <label className="label config-checkbox-inline">
              <input
                type="checkbox"
                checked={promoteToAlumni}
                onChange={(e) => setPromoteToAlumni(e.target.checked)}
              />
              Promote to alumni
            </label>
            {!promoteToAlumni ? (
              <>
                <label className="label">
                  To class
                  <select className="input" value={toClassId} onChange={(e) => setToClassId(e.target.value)}>
                    <option value="">Select class</option>
                    {promoClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="label">
                  To section
                  <select className="input" value={toSectionId} onChange={(e) => setToSectionId(e.target.value)}>
                    <option value="">Select section</option>
                    {toSections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>
          <div className="config-form__row">
            <button type="button" className="config-btn" onClick={fetchPromotionCandidates} disabled={busy}>
              Load students
            </button>
            <button type="button" className="config-btn" onClick={previewPromotion} disabled={busy}>
              Preview
            </button>
            <button
              type="button"
              className="config-btn"
              onClick={executePromotion}
              disabled={busy || !selectedPromotionStudentIds.length}
            >
              {promoteToAlumni ? "Move to alumni" : "Promote selected"}
            </button>
          </div>
          {promotionSummary ? (
            <p className="config-panel__hint">
              Preview: {promotionSummary.total_candidates || 0} candidates in{" "}
              {promotionSummary.academic_year_name || promoYear}.
            </p>
          ) : null}
          <div className="config-list">
            {promotionCandidates.length === 0 ? (
              <p className="config-empty">No candidates loaded.</p>
            ) : (
              promotionCandidates.map((s) => {
                const checked = selectedPromotionStudentIds.includes(s.id);
                return (
                  <label key={s.id} className="config-list-item config-selectable-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedPromotionStudentIds((prev) =>
                          e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                        );
                      }}
                    />
                    <span className="config-list-item__name">
                      {s.name} ({s.class_name || "—"} / {s.section_name || "—"})
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
