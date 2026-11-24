/** Local-calendar date helpers for dashboard analytics (offline, no libs). */

export function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

/** Monday as start of week */
function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

export const RANGE_PRESETS = [
  { id: "today", label: "Today", shortLabel: "Today" },
  { id: "previous_day", label: "Previous Day", shortLabel: "Prev Day" },
  { id: "this_week", label: "This Week", shortLabel: "This Week" },
  { id: "previous_week", label: "Previous Week", shortLabel: "Prev Week" },
  { id: "this_month", label: "This Month", shortLabel: "This Month" },
  { id: "previous_month", label: "Previous Month", shortLabel: "Prev Month" },
  { id: "this_year", label: "This Year", shortLabel: "This Year" },
  { id: "previous_year", label: "Previous Year", shortLabel: "Prev Year" },
  { id: "custom", label: "Custom", shortLabel: "Custom" },
];

/**
 * @returns {{ from: string, to: string }} ISO dates inclusive
 */
export function resolveRangePreset(presetId, now = new Date()) {
  const today = startOfDay(now);

  switch (presetId) {
    case "today":
      return { from: toIsoDate(today), to: toIsoDate(today) };
    case "previous_day": {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: toIsoDate(y), to: toIsoDate(y) };
    }
    case "this_week":
      return { from: toIsoDate(startOfWeek(today)), to: toIsoDate(today) };
    case "previous_week": {
      const end = startOfWeek(today);
      end.setDate(end.getDate() - 1);
      const start = startOfWeek(end);
      return { from: toIsoDate(start), to: toIsoDate(end) };
    }
    case "this_month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1, 12);
      return { from: toIsoDate(start), to: toIsoDate(today) };
    }
    case "previous_month": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12);
      const end = new Date(today.getFullYear(), today.getMonth(), 0, 12);
      return { from: toIsoDate(start), to: toIsoDate(end) };
    }
    case "this_year": {
      const start = new Date(today.getFullYear(), 0, 1, 12);
      return { from: toIsoDate(start), to: toIsoDate(today) };
    }
    case "previous_year": {
      const y = today.getFullYear() - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    default:
      return { from: toIsoDate(today), to: toIsoDate(today) };
  }
}

export function formatDisplayDate(iso) {
  if (!iso) return "—";
  const d = parseIsoDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}
