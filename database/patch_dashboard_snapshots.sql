-- Dashboard snapshot cache (warm on startup + delta updates).
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  month integer NOT NULL,
  year integer NOT NULL,
  class_key text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (month, year, class_key)
);

CREATE TABLE IF NOT EXISTS dashboard_student_contrib (
  month integer NOT NULL,
  year integer NOT NULL,
  class_key text NOT NULL,
  student_id uuid NOT NULL,
  contrib jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (month, year, class_key, student_id)
);

CREATE INDEX IF NOT EXISTS dashboard_student_contrib_student_idx
  ON dashboard_student_contrib (student_id);
