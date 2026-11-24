import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import AccessDeniedModal from "./AccessDeniedModal";
import { isAdmin } from "../utils/auth";

export default function AdminOnlyRoute({ children, redirectTo = "/students" }) {
  const navigate = useNavigate();
  const [showDenied, setShowDenied] = useState(false);

  useEffect(() => {
    if (!isAdmin()) {
      setShowDenied(true);
    }
  }, []);

  if (isAdmin()) {
    return children;
  }

  const closeDenied = () => {
    setShowDenied(false);
    navigate(redirectTo, { replace: true });
  };

  return (
    <AccessDeniedModal
      open={showDenied}
      message="You do not have access. Only admin can open."
      onClose={closeDenied}
    />
  );
}
