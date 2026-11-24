import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import API from "../api";
import { defaultPathForRole } from "../utils/auth";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "accountant", label: "Accountant" },
];

export default function Login() {
  const navigate = useNavigate();

  const [role, setRole] = useState("admin");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const alreadyAuthed = Boolean(localStorage.getItem("token"));

  useEffect(() => {
    if (alreadyAuthed) {
      const raw = localStorage.getItem("user");
      try {
        const user = raw ? JSON.parse(raw) : null;
        navigate(defaultPathForRole(user?.role), { replace: true });
      } catch {
        navigate("/", { replace: true });
      }
    }
  }, [alreadyAuthed, navigate]);

  const canSubmit = useMemo(() => password.length > 0, [password]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!canSubmit) {
      setError("Password is required");
      return;
    }

    setLoading(true);
    try {
      const res = await API.post("/login", { role, password });
      const { token, user } = res.data || {};

      if (!token) {
        setError("Invalid login response (missing token)");
        return;
      }

      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user || {}));

      navigate(defaultPathForRole(user?.role), { replace: true });
    } catch (err) {
      const message = err?.response?.data?.message || err.message || "Login failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (alreadyAuthed) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="page">
      <div className="card">
        <div className="login-brand">
          <div className="login-brand__mark" aria-hidden="true">
            FE
          </div>
          <h1 className="title">Sign in</h1>
          <p className="subtitle">Fee ERP · Aqua Ledger</p>
        </div>

        <form className="form" onSubmit={onSubmit}>
          <label className="label">
            Sign in as
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="label">
            Password
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error ? <div className="error" role="alert">{error}</div> : null}

          <button className="button" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
