/** Shared print helpers for ledger-style pages (Reports-style @page + cleanup). */

const PRINT_STYLE_ID = "app-sheet-print-page-size";

export function applySheetPrintPageSize(mode) {
  let el = document.getElementById(PRINT_STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = PRINT_STYLE_ID;
    document.head.appendChild(el);
  }
  if (mode === "landscape") {
    el.textContent = "@media print { @page { size: A4 landscape; margin: 5mm; } }";
  } else {
    el.textContent = "@media print { @page { size: A4 portrait; margin: 8mm; } }";
  }
}

export function clearSheetPrintPageSize() {
  const el = document.getElementById(PRINT_STYLE_ID);
  if (el) {
    el.textContent = "";
  }
}

/**
 * @param {{ sheetKey: string, orientation?: 'portrait' | 'landscape' }} opts
 * Sets `data-sheet-print` on `<html>` for optional CSS scoping.
 */
export function printSheet({ sheetKey, orientation = "portrait" }) {
  document.documentElement.setAttribute("data-sheet-print", sheetKey);
  applySheetPrintPageSize(orientation);

  const onAfterPrint = () => {
    document.documentElement.removeAttribute("data-sheet-print");
    clearSheetPrintPageSize();
    window.removeEventListener("afterprint", onAfterPrint);
  };

  window.addEventListener("afterprint", onAfterPrint);

  const run = () => {
    try {
      window.print();
    } catch {
      document.documentElement.removeAttribute("data-sheet-print");
      clearSheetPrintPageSize();
      window.removeEventListener("afterprint", onAfterPrint);
    }
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.setTimeout(run, 0);
    });
  });
}
