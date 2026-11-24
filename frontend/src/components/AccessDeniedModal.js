import React from "react";
import "./accessDeniedModal.css";

export default function AccessDeniedModal({
  open,
  message = "You do not have access. Only admin can open.",
  onClose,
}) {
  if (!open) return null;

  return (
    <div className="access-denied-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="access-denied-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="access-denied-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="access-denied-title" className="access-denied-dialog__title">
          Access denied
        </h2>
        <p className="access-denied-dialog__message">{message}</p>
        <button type="button" className="button access-denied-dialog__btn" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}
