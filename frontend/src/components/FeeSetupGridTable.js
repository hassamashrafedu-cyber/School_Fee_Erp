import React from "react";
import { roundMoney } from "../utils/money";
import {
  getComponentCellAmount,
  sumDraftComponentsForMonth,
  isAdmissionFeeComponent,
  isAdvancedFeeComponent,
} from "../utils/feeSetupOverrideUtils";

const isPermanentColumnHeader = (comp) => isAdmissionFeeComponent(comp) || isAdvancedFeeComponent(comp);

const MONTH_OPTIONS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
];

const monthLabel = (month) => MONTH_OPTIONS.find((m) => m.value === Number(month))?.label || `M${month}`;

export default function FeeSetupGridTable({
  months,
  feeComponents,
  onMonthFeeChange,
  onMonthFeeBlur,
  onComponentAmountChange,
  onComponentAmountBlur,
  onComponentLabelChange,
  onComponentLabelBlur,
  editableColumnHeaders = false,
  advanceFeeLinkHints = {},
  getCellAmountDisplay,
  readOnly = false,
}) {
  const cellDisplay =
    getCellAmountDisplay ||
    ((comp, monthNum) => {
      const v = getComponentCellAmount(comp, monthNum);
      return v === 0 ? "" : v;
    });

  const canEdit = !readOnly;

  return (
    <div className={`fee-setup-scroll${readOnly ? " fee-setup-scroll--readonly" : " fee-setup-scroll--editing"}`}>
      <table className="fee-setup-table fee-setup-table--sticky fee-setup-table--compact">
        <thead>
          <tr>
            <th className="fee-setup-th-month fee-setup-th-sticky">Month</th>
            <th className="fee-setup-th-fee">Monthly fee</th>
            {feeComponents.map((col) => (
              <th key={col.id} className="fee-setup-th-fee fee-setup-th-extra">
                {canEdit && editableColumnHeaders && !isPermanentColumnHeader(col) ? (
                  <input
                    className="input fee-setup-header-input"
                    value={col.label}
                    onChange={(e) => onComponentLabelChange?.(col.id, e.target.value)}
                    onBlur={(e) => onComponentLabelBlur?.(col.id, e.target.value)}
                    aria-label="Extra column name"
                  />
                ) : (
                  col.label
                )}
              </th>
            ))}
            <th className="fee-setup-th-total">Total</th>
          </tr>
        </thead>
        <tbody>
          {months.map((row) => (
            <tr key={row.month}>
              <td className="fee-setup-td-month fee-setup-th-sticky">{monthLabel(row.month)}</td>
              <td>
                <input
                  className="input fee-setup-input--no-spin fee-setup-cell-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  readOnly={!canEdit}
                  disabled={!canEdit}
                  value={row.fee === "" ? "" : row.fee}
                  onChange={(e) => canEdit && onMonthFeeChange?.(row.month, e.target.value)}
                  onBlur={() => canEdit && onMonthFeeBlur?.(row.month, row.fee)}
                />
              </td>
              {feeComponents.map((col) => {
                const advHint =
                  isAdvancedFeeComponent(col) && advanceFeeLinkHints[String(row.month)]
                    ? advanceFeeLinkHints[String(row.month)]
                    : "";
                return (
                  <td key={`${col.id}-${row.month}`}>
                    <div className="fee-setup-extra-cell">
                      <input
                        className="input fee-setup-input--no-spin fee-setup-cell-input"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        readOnly={!canEdit}
                        disabled={!canEdit}
                        title={advHint || undefined}
                        value={cellDisplay(col, row.month)}
                        onChange={(e) => canEdit && onComponentAmountChange?.(col.id, row.month, e.target.value)}
                        onBlur={(e) => canEdit && onComponentAmountBlur?.(col.id, row.month, e.target.value)}
                      />
                      {advHint ? (
                        <span className="fee-setup-advance-link-hint" title={advHint}>
                          {advHint}
                        </span>
                      ) : null}
                    </div>
                  </td>
                );
              })}
              <td className="fee-setup-total-cell">
                {roundMoney(Number(row.fee || 0) + sumDraftComponentsForMonth(feeComponents, row.month))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
