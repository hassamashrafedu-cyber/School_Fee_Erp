import React, { useEffect, useState } from "react";

import API from "../api";
import ChallanPrint, { mapChallanDetailToPrintData } from "../components/ChallanPrint";

import "../components/print.css";

function parseIdList(raw) {
  return String(raw || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function Challans() {
  const [challanIdsInput, setChallanIdsInput] = useState("");
  const [printPayload, setPrintPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      API.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      delete API.defaults.headers.common.Authorization;
    }
  }, []);

  const loadForPrint = async () => {
    const ids = parseIdList(challanIdsInput);
    if (ids.length === 0) {
      setError("Enter one or more challan IDs (UUIDs), separated by commas or spaces.");
      setPrintPayload(null);
      return;
    }

    setLoading(true);
    setError("");
    setPrintPayload(null);

    try {
      const results = await Promise.all(
        ids.map((id) =>
          API.get(`/challans/${id}`).then((res) => mapChallanDetailToPrintData(res.data))
        )
      );
      setPrintPayload(results.length === 1 ? results[0] : results);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load challan(s)");
      setPrintPayload(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="page-card">
      <h1 className="page-title">Challans</h1>
      <p className="page-lead">
        Load challan(s) by ID for A4 print. Use one ID for a single sheet, or several for bulk printing—each challan prints on its own page with School Copy and Student Copy.
      </p>

      <div className="challans-toolbar">
        <label className="label">
          Challan ID(s)
          <textarea
            className="input"
            rows={3}
            value={challanIdsInput}
            onChange={(e) => setChallanIdsInput(e.target.value)}
            placeholder="Single UUID, or multiple separated by comma / space / newline"
          />
        </label>
        {error ? (
          <div className="error" role="alert">
            {error}
          </div>
        ) : null}
        <button type="button" className="button" onClick={loadForPrint} disabled={loading}>
          {loading ? "Loading…" : "Load preview"}
        </button>
      </div>

      {printPayload ? <ChallanPrint data={printPayload} /> : null}
    </section>
  );
}
