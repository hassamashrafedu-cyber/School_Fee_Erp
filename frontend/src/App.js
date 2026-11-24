import React from "react";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";

import AdminOnlyRoute from "./components/AdminOnlyRoute";
import ProtectedRoute from "./components/ProtectedRoute";
import { SchoolSettingsProvider } from "./context/SchoolSettingsContext";
import MainLayout from "./layout/MainLayout";

import Challan from "./pages/Challan";
import Classes from "./pages/Classes";
import Config from "./pages/Config";
import Dashboard from "./pages/Dashboard";
import Expenses from "./pages/Expenses";
import AdditionalAmount from "./pages/AdditionalAmount";
import FeeCollection from "./pages/FeeCollection";
import FeeStructure from "./pages/FeeStructure";
import FeeSetup from "./pages/FeeSetup";
import Login from "./pages/Login";
import Payments from "./pages/Payments";
import Reports from "./pages/Reports";
import Students from "./pages/Students";

/** file:// (Electron production) needs HashRouter; http:// (Chrome/dev) uses BrowserRouter */
const Router =
  typeof window !== "undefined" && window.location.protocol === "file:"
    ? HashRouter
    : BrowserRouter;

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          element={
            <ProtectedRoute>
              <SchoolSettingsProvider>
                <MainLayout />
              </SchoolSettingsProvider>
            </ProtectedRoute>
          }
        >
          <Route
            path="/"
            element={
              <AdminOnlyRoute>
                <Dashboard />
              </AdminOnlyRoute>
            }
          />
          <Route path="/students" element={<Students />} />
          <Route path="/classes" element={<Classes />} />
          <Route
            path="/settings"
            element={
              <AdminOnlyRoute>
                <Config />
              </AdminOnlyRoute>
            }
          />
          <Route path="/fee-structure" element={<FeeStructure />} />
          <Route path="/fee-setup" element={<FeeSetup />} />
          <Route path="/fee-collection" element={<FeeCollection />} />
          <Route path="/challan" element={<Challan />} />
          <Route path="/challans" element={<Navigate to="/challan" replace />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/config" element={<Navigate to="/settings" replace />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/additional-amount" element={<AdditionalAmount />} />
          <Route path="/reports" element={<Reports />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}
