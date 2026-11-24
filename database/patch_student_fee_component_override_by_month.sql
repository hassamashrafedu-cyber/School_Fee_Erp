-- Per-student overrides for any class fee component column (by billing month), e.g. Sports fund.
-- Stored as JSONB: { "component_uuid": { "6": 500, "7": 500 } }

ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS component_override_by_month JSONB;
