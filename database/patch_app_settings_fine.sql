-- Fee slip late fine: percent or fixed amount (school-configured).
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS fine_type TEXT NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS fine_value NUMERIC(12, 2) NOT NULL DEFAULT 0;

UPDATE app_settings
SET
  fine_type = COALESCE(NULLIF(TRIM(fine_type), ''), 'percent'),
  fine_value = COALESCE(fine_value, 0)
WHERE id = 1;
