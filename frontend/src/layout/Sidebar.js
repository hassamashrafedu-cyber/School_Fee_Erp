import React from "react";
import { NavLink, useNavigate } from "react-router-dom";

import AccessDeniedModal from "../components/AccessDeniedModal";
import { useSchoolSettings } from "../context/SchoolSettingsContext";
import { isAdmin } from "../utils/auth";
import { IconClose, NAV_ICONS } from "./SidebarIcons";

import "./layout.css";

const NAV_GROUPS = [
  {
    id: "overview",
    label: "Overview",
    items: [{ to: "/", label: "Dashboard", adminOnly: true }],
  },
  {
    id: "academic",
    label: "Academic",
    items: [
      { to: "/students", label: "Students" },
      { to: "/classes", label: "Classes & Sections" },
    ],
  },
  {
    id: "fees",
    label: "Fees",
    items: [
      { to: "/fee-setup", label: "Fee Setup" },
      { to: "/fee-collection", label: "Fee Collection" },
      { to: "/challan", label: "Challan & Print" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      { to: "/expenses", label: "Expenses" },
      { to: "/additional-amount", label: "Additional Amount" },
      { to: "/reports", label: "Reports" },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [{ to: "/settings", label: "Settings", adminOnly: true }],
  },
];

export default function Sidebar({ open, isMobile, onClose }) {
  const navigate = useNavigate();
  const admin = isAdmin();
  const { logoUrl, displayName, settings } = useSchoolSettings();
  const [deniedOpen, setDeniedOpen] = React.useState(false);

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.adminOnly || admin),
  })).filter((group) => group.items.length > 0);

  const onNavClick = (e, item) => {
    if (!item.adminOnly || admin) {
      if (isMobile && typeof onClose === "function") onClose();
      return;
    }
    e.preventDefault();
    setDeniedOpen(true);
  };

  const railMode = !isMobile && !open;

  return (
    <aside
      className={`sidebar${open ? " is-open" : " is-closed"}`}
      aria-label="Primary navigation"
      aria-hidden={isMobile && !open}
    >
      <AccessDeniedModal
        open={deniedOpen}
        message="You do not have access. Only admin can open."
        onClose={() => {
          setDeniedOpen(false);
          navigate("/students", { replace: true });
        }}
      />

      <div className="sidebar-top">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="" />
          <div className="brand-text">
            <div className="brand-title">{displayName}</div>
            <div className="brand-subtitle">
              {settings.academic_year ? `Session ${settings.academic_year}` : "Fee management"}
            </div>
          </div>
        </div>
        {isMobile ? (
          <button
            type="button"
            className="sidebar-close-btn"
            aria-label="Close sidebar"
            onClick={onClose}
          >
            <IconClose size={18} />
          </button>
        ) : null}
      </div>

      <nav className="nav">
        {groups.map((group) => (
          <div key={group.id} className="nav-group">
            <div className="nav-group__label">{group.label}</div>
            {group.items.map((item) => {
              const Icon = NAV_ICONS[item.to] || IconClose;
              return (
                <NavLink
                  key={item.to}
                  className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
                  to={item.to}
                  end={item.to === "/"}
                  title={railMode ? item.label : undefined}
                  tabIndex={isMobile && !open ? -1 : 0}
                  onClick={(e) => onNavClick(e, item)}
                >
                  <span className="nav-link__icon">
                    <Icon size={18} />
                  </span>
                  <span className="nav-link__label">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="sidebar-footer__text">Aqua Ledger</span>
      </div>
    </aside>
  );
}
