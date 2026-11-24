import React, { useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";

import { NavigationBackProvider } from "../context/NavigationBackContext";
import Header from "./Header";
import Sidebar from "./Sidebar";

import "./layout.css";

const STORAGE_KEY = "feeerp.sidebarOpen";
const MOBILE_MQ = "(max-width: 900px)";

function readStoredDesktopOpen() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

export default function MainLayout() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_MQ).matches : false
  );
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia(MOBILE_MQ).matches ? false : readStoredDesktopOpen();
  });

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => {
      const mobile = mq.matches;
      setIsMobile(mobile);
      setSidebarOpen(mobile ? false : readStoredDesktopOpen());
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (isMobile) return;
    try {
      localStorage.setItem(STORAGE_KEY, sidebarOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarOpen, isMobile]);

  useEffect(() => {
    if (!isMobile || !sidebarOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile, sidebarOpen]);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

  const shellClass = [
    "app-layout",
    sidebarOpen ? "is-sidebar-open" : "is-sidebar-closed",
    isMobile ? "is-mobile" : "is-desktop",
  ].join(" ");

  return (
    <div className="app-shell">
      <div className={shellClass}>
        {isMobile && sidebarOpen ? (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close menu"
            onClick={closeSidebar}
          />
        ) : null}

        <Sidebar
          open={sidebarOpen}
          isMobile={isMobile}
          onClose={closeSidebar}
        />

        <div className="main-layout">
          <NavigationBackProvider>
            <Header sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
            <main className="main-content">
              <Outlet />
            </main>
          </NavigationBackProvider>
        </div>
      </div>
    </div>
  );
}
