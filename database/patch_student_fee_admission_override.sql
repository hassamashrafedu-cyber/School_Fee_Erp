ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS admission_fee_override NUMERIC(12,2);
ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS admission_fee_override_by_month JSONB;
ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS override_amount_by_month JSONB;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_fee_assignments'
      AND column_name = 'discount_amount'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE student_fee_assignments ALTER COLUMN discount_amount DROP NOT NULL;
  END IF;
END
$$;
