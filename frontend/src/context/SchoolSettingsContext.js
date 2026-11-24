import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import API from "../api";
import defaultLogo from "../assets/logo.jpeg";

const SchoolSettingsContext = createContext(null);

const EMPTY = {
  school_name: "FEE ERP",
  school_name_line2: "",
  address_line1: "",
  address_line2: "",
  phone: "",
  academic_year: "",
  bank_name: "",
  bank_account_no: "",
  fine_type: "percent",
  fine_value: 0,
  logo_data: null,
  logo_mime: null,
};

export function SchoolSettingsProvider({ children }) {
  const [settings, setSettings] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await API.get("/settings");
      setSettings({ ...EMPTY, ...(data || {}) });
    } catch {
      /* keep last / defaults when offline */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logoUrl = settings.logo_data || defaultLogo;
  const displayName =
    [settings.school_name, settings.school_name_line2].filter(Boolean).join(" ").trim() || "FEE ERP";
  const fineConfig = useMemo(
    () => ({
      fine_type: settings.fine_type === "amount" ? "amount" : "percent",
      fine_value: Number(settings.fine_value) >= 0 ? Number(settings.fine_value) : 0,
    }),
    [settings.fine_type, settings.fine_value]
  );

  const value = useMemo(
    () => ({
      settings,
      loading,
      refresh,
      setSettings,
      logoUrl,
      displayName,
      fineConfig,
    }),
    [settings, loading, refresh, logoUrl, displayName, fineConfig]
  );

  return <SchoolSettingsContext.Provider value={value}>{children}</SchoolSettingsContext.Provider>;
}

export function useSchoolSettings() {
  const ctx = useContext(SchoolSettingsContext);
  if (!ctx) {
    return {
      settings: EMPTY,
      loading: false,
      refresh: async () => {},
      setSettings: () => {},
      logoUrl: defaultLogo,
      displayName: "FEE ERP",
      fineConfig: { fine_type: "percent", fine_value: 0 },
    };
  }
  return ctx;
}
