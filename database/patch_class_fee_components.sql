-- Extra fee columns per class/year (registration, heating, etc.). Amounts add to each billing month's total after monthly fee.

CREATE TABLE IF NOT EXISTS class_fee_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL,
  year INTEGER NOT NULL,
  label VARCHAR(120) NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_class_fee_components_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT chk_cfc_amount CHECK (amount >= 0),
  CONSTRAINT chk_cfc_label CHECK (BTRIM(label) <> ''),
  CONSTRAINT chk_cfc_year CHECK (year >= 1900 AND year <= 2100)
);

CREATE INDEX IF NOT EXISTS idx_class_fee_components_class_year ON class_fee_components (class_id, year);

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_fee_components_class_year_label
ON class_fee_components (class_id, year, lower(trim(label)));

ALTER TABLE class_fee_components ADD COLUMN IF NOT EXISTS apply_month INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cfc_apply_month') THEN
    ALTER TABLE class_fee_components
    ADD CONSTRAINT chk_cfc_apply_month
    CHECK (apply_month IS NULL OR (apply_month >= 1 AND apply_month <= 12));
  END IF;
END
$$;
