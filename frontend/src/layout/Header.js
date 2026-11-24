import React, { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import API from "../api";
import { useNavigationBack } from "../context/NavigationBackContext";
import { clearAuth, formatUserRole, getStoredUser } from "../utils/auth";
import { clearAllPageState } from "../utils/pageStateCache";
import { IconBack, IconMenu } from "./SidebarIcons";

import "./layout.css";

const ROUTE_META = {
  "/": { title: "Dashboard", subtitle: "Collection overview and analytics" },
  "/students": { title: "Students", subtitle: "Manage student records and payment status" },
  "/classes": { title: "Classes & Sections", subtitle: "Organize classes and sections" },
  "/fee-setup": { title: "Fee Setup", subtitle: "Choose a class to configure fees" },
  "/fee-collection": { title: "Fee Collection", subtitle: "Record payments and view ledger" },
  "/challan": { title: "Challan & Print", subtitle: "Generate and print fee challans" },
  "/expenses": { title: "Expenses", subtitle: "Track school expenses by month" },
  "/additional-amount": { title: "Additional Amount", subtitle: "Other income and adjustments" },
  "/reports": { title: "Reports", subtitle: "Fee register and defaulters" },
  "/settings": { title: "Settings", subtitle: "School profile, backup, and system" },
  "/fee-structure": { title: "Fee Structure", subtitle: "Legacy fee structure builder" },
  "/payments": { title: "Payments", subtitle: "Payment workspace" },
  "/config": { title: "Settings", subtitle: "School profile, backup, and system" },
};

function metaForPath(pathname, search = "") {
  if (pathname === "/fee-setup") {
    const hasClass = new URLSearchParams(search).has("class");
    return {
      title: "Fee Setup",
      subtitle: hasClass ? "Class fee structure" : "Choose a class to configure fees",
    };
  }
  if (ROUTE_META[pathname]) return ROUTE_META[pathname];
  const match = Object.keys(ROUTE_META).find(
    (key) => key !== "/" && pathname.startsWith(key)
  );
  return match ? ROUTE_META[match] : { title: "Fee ERP", subtitle: "Workspace" };
}

export default function Header({ sidebarOpen, onToggleSidebar }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { canGoBack, goBack } = useNavigationBack();
  const user = getStoredUser();
  const displayName = String(user?.name || "").trim();
  const roleLabel = formatUserRole(user?.role);
  const showUserName =
    Boolean(displayName) &&
    displayName.toLowerCase() !== roleLabel.toLowerCase() &&
    displayName.toLowerCase() !== String(user?.role || "").toLowerCase();

  const meta = useMemo(
    () => metaForPath(location.pathname, location.search),
    [location.pathname, location.search]
  );

  const onLogout = () => {
    clearAllPageState();
    clearAuth();
    delete API.defaults.headers.common.Authorization;
    navigate("/login", { replace: true });
  };

  return (
    <header className="header">
      <div className="header-left">
        <button
          type="button"
          className="header-menu-btn"
          aria-label={sidebarOpen ? "Collapse menu" : "Open menu"}
          aria-expanded={sidebarOpen}
          onClick={onToggleSidebar}
        >
          <IconMenu size={20} />
        </button>
        {canGoBack ? (
          <button
            type="button"
            className="header-back-btn"
            aria-label="Go back"
            title="Back"
            onClick={goBack}
          >
            <IconBack size={18} />
            <span className="header-back-btn__label">Back</span>
          </button>
        ) : null}
        <div className="header-title-block">
          <div className="header-center">{meta.title}</div>
          <span className="header-page-badge">{meta.subtitle}</span>
        </div>
      </div>

      <div className="header-right">
        <div className="header-user">
          {showUserName ? <span className="header-user__name">{displayName}</span> : null}
          <span className="header-user__role">{roleLabel}</span>
        </div>
        <button type="button" className="button header-logout-btn" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </header>
  );
}
